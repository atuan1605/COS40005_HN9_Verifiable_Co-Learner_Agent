# Local ML demo and research

## Run the local demo

From the repository root, use Python 3.13 in an activated virtual environment:

```sh
python -m pip install -r AI/requirements.txt
python AI/serve-models.py
```

Open [the local demo](http://127.0.0.1:8765). Enter an English prompt and choose **Classify prompt**. The result shows the historical self-harm content label, model score, threshold and model version. The model details show where the evaluation came from. The score describes the submitted text under the historical label. It has no calibration for student traffic.

The process loads the committed numeric exports using the task and SHA-256 in each manifest. It starts from CPU parameters already trained offline. Serving requires no training, dataset download, model provider or application credentials. Requests remain on loopback. The service neither logs submitted text nor stores inputs. If the port is in use, run `python AI/serve-models.py --port 8766` and open the printed address.

### Classify editor activity

Choose **Start live observation**, then type, delete or paste in the demo editor. After two minutes, choose **Classify activity**. The request uses the latest 24 complete five-second bins. **Reset observation** clears the counts and restarts the clock. Switching away from the tab discards the observation to preserve complete coverage. Choose a labelled **Synthetic sample** to try a complete window immediately.

| Operation in the demo editor | Counts |
|---|---|
| Committed insertion or deletion | One edit per inserted or removed span. A removal also counts as one correction. |
| Selected text replaced by different text | One insertion and one removal. The removal counts as a correction. |
| Paste | One paste. Selection replacement within that paste shares the same count. |
| IME composition | One committed change when composition ends. Intermediate input stays outside the counts. |
| Undo or redo | The committed change follows the insertion and removal rules. |
| Cursor movement, selection and sample load | No live edit. |

Activity classification sends counts for each bin. Source text stays in the demo editor's page memory. The model uses total edits, the number of bins with edits, the longest streak of edit-free bins in seconds, corrections divided by total edits and total pastes. The labels describe patterns in the simulated activity dataset. A quiet window can include learning activities such as reading or planning.

### Forecast the first submission

**Classify activity** also checks the same window with the experimental CS1 submission model. The forecast panel reports a score, threshold and model version for the first recorded submission on the exercise in the next ten minutes. This event means code was sent for assessment. The score is uncalibrated for live demo or classroom traffic.

To see a forecast immediately, load **Sustained edits** and classify the window. To see the no-change state, load **Quiet window**. **Mark demo exercise submitted** sets a flag in the page so later forecasts are withheld for that exercise. Choosing another sample or restarting the clock with **Start live observation** keeps the flag. Use **Reset observation** to start a fresh exercise. The button changes only the demo's state.

The historical CS1 evaluation used opt-in IDE logs with insert, remove and paste records linked to exercise submissions. It filtered for windows with a full future observation horizon before the deadline and last observed activity. Browser editing transactions and authored demo samples have different coverage and input semantics. On the held-out CS1 data the model's average precision was **0.4910** compared with **0.5206** from simply ranking by active edit bins. See the [real CS1 evaluation](CS1-SUBMISSION-RESEARCH.md).

### API

Send `POST /api/classify/prompt` with `Content-Type: application/json` and a JSON object:

```json
{"prompt":"Why does my Python loop skip an item?","language":"en"}
```

The service uses `language` as the caller's declaration. It accepts up to 4,000 characters per prompt and 64 KiB per request. A scored response contains the task, label, score, threshold, model and feature versions, experimental status and input source. `GET /api/models` returns metadata and availability for all three models.

Send `POST /api/classify/activity` with an aggregate window. This example shows a partially observed window:

```json
{
  "source": "live",
  "window": {
    "featureVersion": "editor-window-v1",
    "binSeconds": 5,
    "observedSeconds": 5,
    "bins": [[2, 1, 0]]
  }
}
```

For a complete window use 120 seconds and 24 bins ordered oldest first. Each bin is `[edits, corrections, pastes]`. Counts are integers between 0 and 10,000. Corrections count as edits. A partial window supplies one bin per five seconds observed, rounding up to include a partial bin. Valid partial windows return `insufficient_history` with status `unavailable`. A complete window with zero edits remains scoreable.

Send `POST /api/predict/submission` with the same `source` and `window` plus a top-level JSON boolean `alreadySubmitted`. For a valid request and an available export, the response adds `horizonSeconds: 600`. Eligibility is checked in this order:

| Input state | Forecast outcome |
|---|---|
| Exercise already submitted | `unavailable` with reason `already_submitted` |
| Less than 120 seconds observed | `unavailable` with reason `insufficient_history` |
| Full window with zero edits and zero pastes | `unavailable` with reason `no_editor_change` |
| Complete window with at least one edit or paste | `scored` with the CS1 model's threshold and label |

Unavailable responses omit score, threshold and label. Each carries a reason and message.

| Situation | Response |
|---|---|
| Invalid JSON or unexpected request fields | 400 with an error code and message |
| Missing content length or body over 64 KiB | 411 or 413 |
| Non-JSON content type | 415 |
| Blank or overlong prompt, unsupported language, invalid editor window, or invalid `alreadySubmitted` flag | 422 |
| Missing, changed or incompatible model export | 503 with `model_unavailable` |

### Verify the demo

Run the HTTP tests from the repository root. For browser checks, install the web dependencies first, then run Playwright from `web/`.

```sh
python -m unittest discover -s AI/tests
cd web
pnpm exec playwright install chromium
pnpm exec playwright test --config playwright.ml.config.ts
```

The browser suite starts its own local inference process on port 8765. Stop a running demo on that port before running the suite.
It covers live counts, paste, reset and the composition event sequence. For a manual IME check, start a live observation and enter one committed word using your system IME. Confirm the counter increments on commit.

### Reproduce the evaluation report

From the repository root, with the Python 3.13 requirements installed:

```sh
python AI/evaluate-models.py --output AI/results
```

Read `AI/results/evaluation.md` for the comparisons and `AI/results/evaluation.json` for the complete run record. The command verifies the pinned English benchmark archive and reuses or downloads the pinned CS1 sample. It reconstructs the notebook splits and thresholds, fits the reference pipelines, then scores the holdouts with the same artifact loaders used by the demo. The 112 MB CS1 sample is cached in the operating system's temporary directory.

The report records artifact and dataset checksums, split populations, threshold policies, confusion counts, AP and baseline metrics. A parity check uses absolute tolerance `1e-10` and relative tolerance `1e-8` and requires identical labels on each holdout row. Any input or parity failure exits nonzero before writing the report. The command produces aggregate results and leaves the published exports in place.

The `ml-demo` CI job runs small HTTP, evaluation fixture and Chromium checks. It uses authored examples and the committed exports. Full public dataset evaluation runs on demand.

### Short presentation rehearsal

1. Open the local demo, submit an English programming prompt and show its label, score, threshold and version.
2. Select **Sustained edits** and choose **Classify activity** to see the activity classification and 10-minute forecast from the same sample. Start a live observation to show the counts for typing, deleting and pasting.
3. Try **Quiet window** to see a valid activity classification alongside an unavailable forecast. Mark the demo exercise submitted, then reset to start a new observation.
4. Open the model evaluation details and the generated report. Compare the historical CS1 forecast to the active-bin baseline and explain the three dataset populations.

To automate this walkthrough, run `pnpm exec playwright test --config playwright.ml.config.ts rehearsal.spec.ts` from `web/`. The test advances the browser clock for the live window.

## Offline self-harm content experiment

This research experiment scores English prompts for the historical OpenAI moderation label `SH`. It reads one prompt at a time and uses a CPU model. The [research note](RESEARCH.md) explains the label, data source and limits.

The companion [editor activity experiment](KEYSTROKE-RESEARCH.md) includes its own executed notebook and model export.

The [real CS1 log follow-up](CS1-SUBMISSION-RESEARCH.md) evaluates a separate model that forecasts an exercise's first recorded submission.

## Results

The benchmark has 1,444 unique prompts with a known label. The fixed split holds out 289 prompts, including 10 positives. Five-fold development predictions selected the threshold of 0.413605 before the holdout was scored.

| Holdout metric | Result |
| --- | ---: |
| Average precision | 0.659 |
| Average precision for a constant score | 0.035 |
| Precision | 53.3% |
| Recall | 80.0% |
| F1 | 0.640 |
| True positives / false positives | 8 / 7 |
| True negatives / false negatives | 272 / 2 |

In the independent synthetic classroom check, the model flagged 3 of 5 first-person signals, 0 of 5 ordinary course prompts, and 0 of 5 prompts that mention the topic about someone else or in an academic setting. These small groups illustrate behavior on specific phrasings. Scores are uncalibrated for student traffic, and the experiment evaluates English only. Keep the artifact for offline research.

## Reproduce or try the export

From this directory, use Python 3.13 in an activated virtual environment and run:

```sh
python -m pip install -r requirements.txt
python -m nbconvert --to notebook --execute --inplace self-harm-prompts.ipynb
python prompt_model.py "Why is my Python loop skipping items?"
```

Re-running the [notebook](self-harm-prompts.ipynb) downloads the pinned benchmark into memory, verifies its checksum, and updates the notebook outputs and [model export](self-harm-text-model.npz). The export stores numeric parameters in a compressed NumPy archive. The final notebook cell reloads the archive and verifies that it reproduces all 289 holdout scores.
