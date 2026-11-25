# ML Lab Classroom Demo

ML Lab is a standalone browser demo for the Verifiable Co-Learner project. It runs three trained models locally: English prompt classification, editor activity classification, and an experimental first-submission forecast. The Python server loads the committed model exports at startup. Training takes place separately in the notebooks.

## Set up before class

Install Python **3.13** and run these commands in PowerShell on the laptop that will present. A fresh clone into its own folder is the simplest setup.

```powershell
git clone --single-branch --branch codex/ml-classroom-demo https://github.com/atuan1605/COS40005_HN9_Verifiable_Co-Learner_Agent.git colearner-ml-demo
cd colearner-ml-demo
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r AI/requirements.txt
.\.venv\Scripts\python.exe AI/serve-models.py
```

Leave that terminal running and open [ML Lab](http://127.0.0.1:8765/). If the port is in use, add `--port 8766` to the last command and open [port 8766](http://127.0.0.1:8766/). On macOS or Linux, use `.venv/bin/python` for the last two commands. Once the dependencies are installed, the walkthrough runs offline.

Open [the editor activity notebook](AI/notebooks/keystroke-activity.ipynb) in VS Code or GitHub before class. Its cells already contain the metrics and export output.

## Walkthrough for a three minute demo

1. **Classify an English prompt.** Paste `How does a for loop work in Python?` and click **Classify prompt**. Expect **Other content** with score **0.1169**. Then enter `I feel like hurting myself and need support.` and expect **Self-harm content signal** with score **0.7562**. The threshold is **0.4136**. Explain that the label describes the submitted text under the dataset’s historical self-harm category. A future chatbot could use this signal to choose a safety-oriented response.
2. **Classify editor activity.** Choose **Sustained edits** and click **Classify activity**. Expect **Editing pattern · Synthetic sample** with score **0.9999**. The sample represents two minutes of editor activity. Explain that the model uses aggregate counts and that a quiet editor can also mean someone is reading or planning.
3. **Show the submission forecast.** The same click produces a separate result for first submission within ten minutes. In this sample the forecast scores **0.4289** above its **0.2318** threshold. Click **Mark demo exercise submitted** to show that the forecast becomes unavailable for an exercise with a recorded submission. The point of the experiment is to see whether recent editing can provide an early signal. A reminder tied to the **Submit** button can use the click itself.
4. **Show where the model came from.** Open the prepared notebook, scroll to its held-out results, then show the final cell that exports the model. The link between training and the demo is the `.npz` file. It stores the fitted parameters that Python uses to score new inputs.

For another editor example, select **Reset observation → Quiet window → Classify activity**. The activity model returns **Other activity pattern** and the forecast explains that the window had no edits or pastes. For live input, click **Start live observation**, keep the tab visible, type or delete, and wait for a full two-minute window before scoring.

## Data and training

### English prompt classification

[self-harm-prompts.ipynb](AI/notebooks/self-harm-prompts.ipynb) reuses [OpenAI’s public moderation benchmark](https://github.com/openai/moderation-api-release). It keeps explicit `SH` labels and removes duplicate prompts, leaving **1,444** examples from the original 1,680. The held-out test set contains **289 prompts**, including **10 positives**.

The notebook hashes groups of 3–5 characters, applies **TF-IDF**, then trains class-weighted **logistic regression**. Five development folds select the threshold using F2, which weights recall more than precision. The holdout average precision was **0.659**, compared with **0.035** for a constant score. At the chosen threshold the model detected **8 of 10 positives** and flagged **7 other prompts**. The historical label applies to the text. The evaluation supports an experimental English text classifier.

### Editor activity classification

[keystroke-activity.ipynb](AI/notebooks/keystroke-activity.ipynb) trains on **3,600 simulated two-minute windows** from **120 synthetic profiles**. The simulator generates scenarios such as editing, reading, idling and pasting with few edits. Evaluating on whole profiles held out from training gives a test set of **720 windows from 24 profiles**.

The model uses five numeric features: total edits, the number of 5-second bins with edits, longest pause between edits, the share of edits that are deletions, and total pastes. **StandardScaler** expresses each feature as its distance from the training mean in standard deviations. **Logistic regression** learns from these inputs. On the simulated holdout, F1 was **0.815**, compared with **0.770** for a rule that checks for edits in at least three bins. Similar counts can come from different activities, so describe the label as an editing pattern.

### First submission forecast

[cs1-submission-prediction.ipynb](AI/notebooks/cs1-submission-prediction.ipynb) uses [historical IDE logs from a public introductory programming course](https://zenodo.org/records/6903968). The sampled logs cover **38 learners** and yield **26,436 eligible windows**. The held-out test set contains **4,757 windows from 8 learners**. A window is labelled positive when the same learner’s first submission on that exercise occurs in the following ten minutes.

It uses the same five feature types, with its own fitted **StandardScaler and logistic regression**. Four development folds grouped by learner select the threshold. Average precision was **0.4910**, compared with **0.5206** for ranking windows by the number of bins with edits. The forecast demonstrates an experiment. Its target is the submission event, and its value would depend on a clear reason to act ahead of that event.

## Find the files

- [AI/notebooks](AI/notebooks/) holds the three executed notebooks. Show the saved results and the last cell.
- [AI/models](AI/models/) holds the three `.npz` exports and their JSON manifests. Each manifest identifies the model version, threshold and artifact checksum.
- [AI/demo](AI/demo/) serves the page and editor. [AI/inference](AI/inference/) loads the exports and provides the local API.
- [AI/research](AI/research/) contains the data loaders, classroom examples and shared training protocol used by the notebooks.

If asked about the numbers on screen, the **model score** is the value the model assigns to the current input. The **threshold** determines its label. The **model version** identifies the export that produced it. Average precision compares how well scores rank positive examples across thresholds. F1 balances precision and recall at a chosen threshold.
