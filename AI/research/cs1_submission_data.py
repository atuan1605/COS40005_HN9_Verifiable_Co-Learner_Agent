"""Aggregate public CS1 IDE events into first-submission prediction windows."""

import hashlib
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from itertools import groupby
from pathlib import Path
from tempfile import gettempdir
from urllib.error import URLError
from urllib.request import Request, urlopen

import polars as pl

from keystroke_data import BIN_SECONDS, FEATURE_NAMES, WINDOW_BINS


SOURCE_URL = "https://zenodo.org/records/6903968/files/IDE_logs.csv?download=1"
SOURCE_BYTES = 1_360_455_804
RANGE_BYTES = 16 * 1024**2
RANGE_STARTS = (
    0, 160_000_000, 330_000_000, 500_000_000, 670_000_000,
    840_000_000, 1_010_000_000, 1_180_000_000, 1_340_000_000,
)
SAMPLE_SHA256 = "b4da778dcd09535313214f784ec17f88f7cfb81eeead2985d9d349f2abfb0109"
HEADER = b"student,part,exercise,eventType,timestamp,timeToDeadline"
WINDOW_SECONDS = WINDOW_BINS * BIN_SECONDS
HORIZON_SECONDS = 600
EXERCISE_KEY = ["student", "part", "exercise"]
WINDOW_KEY = [*EXERCISE_KEY, "anchor_remaining"]


def download_blocks(start: int) -> list[tuple[bytes, bytes]]:
    end = start + RANGE_BYTES - 1
    request = Request(SOURCE_URL, headers={"Range": f"bytes={start}-{end}"})
    for attempt in range(2):
        try:
            with urlopen(request, timeout=75) as response:
                expected = f"bytes {start}-{end}/{SOURCE_BYTES}"
                if response.status != 206 or response.headers.get("Content-Range") != expected:
                    raise ValueError("The server returned an unexpected CSV byte range.")
                data = response.read(RANGE_BYTES + 1)
            break
        except (URLError, TimeoutError):
            if attempt == 1:
                raise
    if len(data) != RANGE_BYTES:
        raise ValueError("The server returned an incomplete CSV byte range.")
    first_line, _, rows = data.partition(b"\n")
    if start == 0 and first_line.rstrip(b"\r") != HEADER:
        raise ValueError("Unexpected CS1 event columns.")
    rows = rows[:rows.rfind(b"\n") + 1]
    blocks = [
        (student, b"".join(lines))
        for student, lines in groupby(BytesIO(rows), key=lambda line: line.split(b",", 1)[0])
    ]
    # An interior range can start and end in the middle of a learner's events.
    return blocks[0 if start == 0 else 1:-1]


def fetch_source() -> Path:
    cache = Path(gettempdir()) / "cos40005-cs1-research"
    cache.mkdir(parents=True, exist_ok=True)
    source = cache / "IDE_logs-6903968-sample-v1.csv"
    if not source.exists():
        partial = source.with_suffix(".download")
        seen = set()
        with ThreadPoolExecutor(max_workers=4) as pool, partial.open("wb") as output:
            output.write(HEADER + b"\n")
            for blocks in pool.map(download_blocks, RANGE_STARTS):
                for student, rows in blocks:
                    if student in seen:
                        raise ValueError("A sampled learner occurs in multiple blocks.")
                    seen.add(student)
                    output.write(rows)
        if not seen:
            raise ValueError("The sample did not contain any interior learner blocks.")
        if sample_checksum(partial) != SAMPLE_SHA256:
            raise ValueError("The sampled data does not match its pinned SHA-256.")
        partial.replace(source)
    elif sample_checksum(source) != SAMPLE_SHA256:
        raise ValueError(f"The cached sample does not match its pinned SHA-256: {source}")
    return source


def sample_checksum(source: Path) -> str:
    with source.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load_windows(source: Path) -> tuple[pl.DataFrame, dict[str, int]]:
    # The file expresses time in seconds before the part deadline, decreasing as time advances.
    events = pl.scan_csv(
        source,
        schema_overrides={
            "student": pl.String,
            "part": pl.String,
            "exercise": pl.String,
            "eventType": pl.String,
            "timeToDeadline": pl.Int64,
        },
    ).select(["student", "part", "exercise", "eventType", "timeToDeadline"])

    part_ends = events.group_by("student", "part").agg(
        pl.col("timeToDeadline").min().alias("last_observed_remaining"),
        pl.len().alias("events"),
    ).collect(engine="streaming")
    first_submissions = (
        events.filter(pl.col("eventType") == "submit")
        .group_by(EXERCISE_KEY)
        .agg(pl.col("timeToDeadline").max().alias("first_submit_remaining"))
        .collect(engine="streaming")
    )

    # In remaining-time coordinates, history is (anchor, anchor + 120].
    remaining = pl.col("timeToDeadline")
    changes = (
        events.filter(
            pl.col("eventType").is_in(["text_insert", "text_remove", "text_paste"])
            & (remaining > HORIZON_SECONDS)
        )
        .with_columns(
            (((remaining - 1) // WINDOW_SECONDS) * WINDOW_SECONDS).alias("anchor_remaining")
        )
        .with_columns(
            ((remaining - pl.col("anchor_remaining") - 1) // BIN_SECONDS).alias("bin")
        )
        .group_by([*WINDOW_KEY, "bin"])
        .agg(
            (pl.col("eventType") != "text_paste").sum().alias("edits"),
            (pl.col("eventType") == "text_remove").sum().alias("corrections"),
            (pl.col("eventType") == "text_paste").sum().alias("pastes"),
        )
        .group_by(WINDOW_KEY)
        .agg(
            pl.col("edits").sum().alias("edit_events"),
            pl.col("corrections").sum().alias("total_corrections"),
            pl.col("pastes").sum().alias("paste_events"),
            pl.col("bin").filter(pl.col("edits") > 0).sort().alias("active_bins"),
        )
        .collect(engine="streaming")
    )

    anchor = pl.col("anchor_remaining")
    first = pl.col("first_submit_remaining")
    seconds_until_submit = anchor - first
    windows = (
        changes.join(part_ends, on=["student", "part"], how="inner")
        .join(first_submissions, on=EXERCISE_KEY, how="left")
        .filter(
            (anchor >= HORIZON_SECONDS)
            & (anchor - pl.col("last_observed_remaining") >= HORIZON_SECONDS)
            & (first.is_null() | (seconds_until_submit >= 0))
        )
        .with_columns(
            pl.col("active_bins").list.len().alias("active_edit_bins"),
            (
                (pl.concat_list(pl.lit([-1]), "active_bins", pl.lit([WINDOW_BINS]))
                 .list.diff().list.max() - 1) * BIN_SECONDS
            ).alias("longest_edit_pause_seconds"),
            (pl.col("total_corrections") / pl.col("edit_events").clip(lower_bound=1))
            .alias("correction_fraction"),
            (seconds_until_submit < HORIZON_SECONDS).fill_null(False).cast(pl.UInt8)
            .alias("submit_within_horizon"),
        )
        .sort(WINDOW_KEY)
        .select("student", *FEATURE_NAMES, "submit_within_horizon")
    )
    return windows, {
        "sample_events": int(part_ends["events"].sum()),
        "sample_learners": part_ends["student"].n_unique(),
        "first_submissions": first_submissions.height,
        "eligible_windows": windows.height,
        "eligible_learners": windows["student"].n_unique(),
        "positive_windows": int(windows["submit_within_horizon"].sum()),
    }
