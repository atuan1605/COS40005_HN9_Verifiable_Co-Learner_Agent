from datetime import UTC, datetime
from importlib.metadata import version
import json
from math import isclose
from pathlib import Path
import platform
from shutil import copyfile
from tempfile import TemporaryDirectory

from classroom_probes import CLASSROOM_CASES

from .metrics import classification_metrics


BASELINE_NAMES = {
    "prompt_constant": "Constant score, always predict other content",
    "activity_three_bins": "At least three active edit bins",
    "active_bins_rank": "Ranking by active edit bins",
    "forecast_constant": "Constant score, always predict submission",
}
TASK_REQUIREMENTS = {
    "prompt_content": ("sh_content", None, {"prompt_constant"}),
    "editor_activity": ("editing", "profiles", {"activity_three_bins"}),
    "first_submission": ("submission_within_10_minutes", "learners", {"active_bins_rank", "forecast_constant"}),
}


def build_report(results: list[dict]) -> dict:
    if len(results) != len(TASK_REQUIREMENTS) or {item["task"] for item in results} != TASK_REQUIREMENTS.keys():
        raise ValueError("The report needs one result for each of the three served tasks.")
    tasks = []
    for item in results:
        task = item["task"]
        positive_label, group_unit, required_baselines = TASK_REQUIREMENTS[task]
        if item["model"].get("positiveLabel") != positive_label:
            raise ValueError(f"The report has an incorrect positive label for {task}.")
        split = item["split"]
        holdout = split["holdout"]
        baselines = item["baselines"]
        if len(baselines) != len(required_baselines) or {entry["id"] for entry in baselines} != required_baselines:
            raise ValueError(f"The report is missing a required baseline for {task}.")
        validate_metrics(item["metrics"], holdout, task)
        for entry in baselines:
            validate_metrics(entry["metrics"], holdout, task, ranking_only=entry["id"] == "active_bins_rank")
        if item["parity"]["holdoutCount"] != holdout["rows"] or not item["parity"]["labelsMatch"]:
            raise ValueError(f"Artifact parity has not been verified for every holdout row of {task}.")
        if group_unit is not None:
            if (
                split.get("groupsDisjoint") is not True
                or split.get("groupUnit") != group_unit
                or any(not 0 < part.get("groups", 0) <= part["rows"] for part in (split["development"], holdout))
            ):
                raise ValueError(f"Group counts or separation are missing for {task}.")
        else:
            validate_probes(item.get("classroomProbes", {}))
        tasks.append({**item, "baselines": [{**entry, "name": BASELINE_NAMES[entry["id"]]} for entry in baselines]})
    return {
        "schemaVersion": 1,
        "generatedAtUtc": datetime.now(UTC).isoformat(),
        "environment": {
            "python": platform.python_version(),
            **{name: version(name) for name in ("numpy", "scipy", "scikit-learn", "polars")},
        },
        "tasks": tasks,
    }


def validate_metrics(metrics: dict, holdout: dict, task: str, ranking_only: bool = False) -> None:
    if not 0 <= metrics.get("averagePrecision", -1) <= 1:
        raise ValueError(f"The report is missing valid AP for {task}.")
    if ranking_only:
        return
    counts = metrics.get("counts", {})
    if (
        set(counts) != {"tp", "fp", "tn", "fn"}
        or any(type(count) is not int or count < 0 for count in counts.values())
        or sum(counts.values()) != holdout["rows"]
        or counts["tp"] + counts["fn"] != holdout["positive"]
    ):
        raise ValueError(f"The confusion counts do not match the holdout for {task}.")
    if any(not isclose(metrics.get(name, -1), expected) for name, expected in classification_metrics(counts).items()):
        raise ValueError(f"The thresholded metrics do not match the confusion counts for {task}.")


def validate_probes(probes: dict) -> None:
    if probes.keys() != CLASSROOM_CASES.keys() or any(
        counts.get("total") != len(CLASSROOM_CASES[name]) or not 0 <= counts.get("flagged", -1) <= counts["total"]
        for name, counts in probes.items()
    ):
        raise ValueError("The report is missing complete classroom probe counts.")


def markdown(report: dict) -> str:
    environment = ", ".join(f"{name} {value}" for name, value in report["environment"].items())
    lines = [
        "# Local ML evaluation",
        "",
        f"Generated {report['generatedAtUtc']} using {environment}.",
    ]
    for task in report["tasks"]:
        model = task["model"]
        dataset = task["dataset"]
        split = task["split"]
        parity = task["parity"]
        lines.extend([
            "",
            f"## {task['title']}",
            "",
            model["meaning"],
            "",
            f"- Model **{model['modelVersion']}** uses **{model['featureVersion']}** features. "
            f"Status **{model['evaluationStatus']}**. Positive label `{model['positiveLabel']}`.",
            f"- Artifact `{model['artifact']}` with SHA-256 `{model['sha256']}`.",
            f"- Data **{dataset['name']}**, {dataset['revision']}. Source {dataset['source']}.",
            f"- Dataset SHA-256 `{dataset['checksum']['sha256']}` ({dataset['checksum']['scope']}).",
            f"- Unit of evaluation: {dataset['unit']}.",
            "- Dataset counts: " + ", ".join(
                f"{key.replace('_', ' ')} {count:,}" for key, count in dataset["counts"].items()
            ) + ".",
            f"- Split uses seed {split['seed']}. {split['policy']}",
            f"- Development: {split_description(split, 'development')}. Holdout: {split_description(split, 'holdout')}.",
            f"- Threshold **{task['threshold']:.12g}**. {task['thresholdSelection']}",
            f"- Artifact parity on all {parity['holdoutCount']:,} holdout rows. "
            f"Maximum absolute score difference **{parity['maximumAbsoluteScoreDifference']:.3g}** "
            f"at absolute tolerance {parity['absoluteTolerance']:.0e} and relative tolerance {parity['relativeTolerance']:.0e}. "
            f"Threshold difference **{parity['absoluteThresholdDifference']:.3g}**. All labels match.",
        ])
        if split.get("groupsDisjoint"):
            lines.append(f"- No {split['groupUnit']} appear in both partitions.")
        lines.extend([
            "",
            "| Model or baseline | AP | Precision | Recall | F1 | TP | FP | TN | FN |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
            metric_row("Served model", task["metrics"]),
            *(metric_row(entry["name"], entry["metrics"]) for entry in task["baselines"]),
        ])
        if task["task"] == "first_submission":
            baseline_ap = next(
                entry["metrics"]["averagePrecision"]
                for entry in task["baselines"] if entry["id"] == "active_bins_rank"
            )
            delta = task["metrics"]["averagePrecision"] - baseline_ap
            lines.extend(["", f"AP difference from ranking by active edit bins: **{delta:+.4f}**."])
        if "classroomProbes" in task:
            lines.extend(["", "Authored classroom probes, separate from the public holdout:", ""])
            for name, counts in task["classroomProbes"].items():
                lines.append(f"- {name.replace('_', ' ')}: {counts['flagged']}/{counts['total']} flagged.")
        lines.extend(["", *(f"- {limit}" for limit in task["limits"])])
    return "\n".join(lines) + "\n"


def split_description(split: dict, key: str) -> str:
    partition = split[key]
    description = f"{partition['rows']:,} rows, {partition['positive']:,} positive"
    if "groups" in partition:
        description += f", {partition['groups']:,} {split['groupUnit']}"
    return description


def metric_row(name: str, metrics: dict) -> str:
    values = [f"{metrics[key]:.4f}" if key in metrics else "—" for key in ("averagePrecision", "precision", "recall", "f1")]
    counts = metrics.get("counts", {})
    values.extend(str(counts.get(key, "—")) for key in ("tp", "fp", "tn", "fn"))
    return "| " + " | ".join([name, *values]) + " |"


def write_reports(report: dict, output: Path) -> None:
    rendered = {
        "evaluation.json": json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        "evaluation.md": markdown(report),
    }
    output.mkdir(parents=True, exist_ok=True)
    lock = output / ".evaluation.lock"
    try:
        with lock.open("x"):
            pass
    except FileExistsError as error:
        raise OSError(f"Another evaluation is publishing reports in {output}.") from error
    try:
        with TemporaryDirectory(dir=output) as working:
            staging = Path(working)
            for name, body in rendered.items():
                (staging / name).write_text(body, encoding="utf-8")
            publish_reports(staging, output)
    finally:
        lock.unlink()


def publish_reports(staging: Path, output: Path) -> None:
    structured = output / "evaluation.json"
    backup = staging / "previous.json"
    if structured.exists():
        copyfile(structured, backup)
    (staging / structured.name).replace(structured)
    try:
        (staging / "evaluation.md").replace(output / "evaluation.md")
    except OSError:
        if backup.exists():
            backup.replace(structured)
        else:
            structured.unlink()
        raise
