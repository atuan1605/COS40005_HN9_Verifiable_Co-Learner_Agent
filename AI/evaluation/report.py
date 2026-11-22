from datetime import UTC, datetime
from importlib.metadata import version
import json
from pathlib import Path
import platform
from tempfile import TemporaryDirectory


REQUIRED_BASELINES = {
    "prompt_content": {"Constant score, always predict other content"},
    "editor_activity": {"At least three active edit bins"},
    "first_submission": {"Ranking by active edit bins", "Constant score, always predict submission"},
}


def build_report(results: list[dict]) -> dict:
    if len(results) != len(REQUIRED_BASELINES) or {item["task"] for item in results} != REQUIRED_BASELINES.keys():
        raise ValueError("The report needs one result for each of the three served tasks.")
    for item in results:
        task = item["task"]
        holdout = item["split"]["holdout"]
        if {entry["name"] for entry in item["baselines"]} != REQUIRED_BASELINES[task]:
            raise ValueError(f"The report is missing a required baseline for {task}.")
        if "counts" not in item["metrics"]:
            raise ValueError(f"The served model needs confusion counts for {task}.")
        for metrics in [item["metrics"], *(entry["metrics"] for entry in item["baselines"])]:
            if not 0 <= metrics.get("averagePrecision", -1) <= 1:
                raise ValueError(f"The report is missing valid AP for {task}.")
            if "counts" in metrics:
                counts = metrics["counts"]
                if (
                    set(counts) != {"tp", "fp", "tn", "fn"}
                    or any(type(count) is not int or count < 0 for count in counts.values())
                    or sum(counts.values()) != holdout["rows"]
                    or counts["tp"] + counts["fn"] != holdout["positive"]
                    or any(not 0 <= metrics.get(name, -1) <= 1 for name in ("precision", "recall", "f1"))
                ):
                    raise ValueError(f"The confusion counts do not match the holdout for {task}.")
        if item["parity"]["holdoutCount"] != holdout["rows"] or not item["parity"]["labelsMatch"]:
            raise ValueError(f"Artifact parity has not been verified for every holdout row of {task}.")
        if task != "prompt_content" and item["split"].get("groupsDisjoint") is not True:
            raise ValueError(f"Group separation has not been verified for {task}.")
    return {
        "schemaVersion": 1,
        "generatedAtUtc": datetime.now(UTC).isoformat(),
        "environment": {
            "python": platform.python_version(),
            **{name: version(name) for name in ("numpy", "scipy", "scikit-learn", "polars")},
        },
        "tasks": results,
    }


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
                for entry in task["baselines"] if entry["name"] == "Ranking by active edit bins"
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
    with TemporaryDirectory(dir=output) as working:
        staging = Path(working)
        for name, body in rendered.items():
            (staging / name).write_text(body, encoding="utf-8")
        for name in rendered:
            (staging / name).replace(output / name)
