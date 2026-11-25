"""Load the pinned public moderation benchmark without saving prompt text."""

import gzip
import hashlib
import json
import unicodedata
from collections import Counter, defaultdict
from urllib.request import urlopen


REVISION = "d3938df6ce8b06c2907f92c6084d8192da61b9aa"
ARCHIVE_SHA256 = "ef3f7de86ee394fe337b0a566ba4b9c7db058f3caa8d6a4a0006138b663ab9a8"
DATA_URL = (
    f"https://raw.githubusercontent.com/openai/moderation-api-release/{REVISION}"
    "/data/samples-1680.jsonl.gz"
)


def load_benchmark() -> tuple[list[str], list[int], dict[str, int]]:
    """Return one example per normalized prompt, excluding ambiguous labels."""
    with urlopen(DATA_URL, timeout=45) as response:
        archive = response.read()
    if hashlib.sha256(archive).hexdigest() != ARCHIVE_SHA256:
        raise ValueError("The benchmark archive does not match the pinned SHA-256.")

    counts = Counter()
    groups = defaultdict(list)
    for line in gzip.decompress(archive).splitlines():
        row = json.loads(line)
        counts["source_rows"] += 1
        if "SH" not in row:
            counts["unlabeled_rows"] += 1
            continue
        prompt = row["prompt"].strip()
        label = row["SH"]
        if not prompt or type(label) is not int or label not in (0, 1):
            raise ValueError("Unexpected prompt or self-harm label in the benchmark.")
        key = " ".join(unicodedata.normalize("NFKC", prompt).casefold().split())
        groups[key].append((prompt, label))

    prompts, labels = [], []
    counts.update(duplicate_rows=0, conflicting_rows=0)
    for rows in groups.values():
        if len({label for _, label in rows}) > 1:
            counts["conflicting_rows"] += len(rows)
            continue
        counts["duplicate_rows"] += len(rows) - 1
        prompt, label = rows[0]
        prompts.append(prompt)
        labels.append(label)
    counts["usable_rows"] = len(labels)
    counts["positive_rows"] = sum(labels)
    return prompts, labels, dict(counts)
