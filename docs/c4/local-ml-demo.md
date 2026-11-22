# C4 views for the local ML demo

> [C4 index](README.md) / Local ML demo

## Containers

```mermaid
flowchart LR
  classDef person fill:#0b3d73,stroke:#082b52,color:#ffffff
  classDef comp fill:#1f6fd0,stroke:#164f96,color:#ffffff
  presenter([Presenter]):::person
  subgraph demo["Local ML demo"]
    browser["Demo page<br/>HTML, CSS and JavaScript"]:::comp
    python["Inference service<br/>Python 3.13"]:::comp
  end
  presenter ==>|"Enters a prompt or tries the demo editor"| browser
  browser ==>|"Loads assets and submits text or aggregate editor bins over loopback HTTP"| python
```

One Python process serves the page and API on `127.0.0.1`. A browser loads the page from that origin and submits a prompt or a window of editor counts when the presenter classifies it. The editor's contents stay in the page. The deployment is the presenter's machine. The process loads three numeric model exports at startup and keeps the parameters in memory.

## Components of the inference service

```mermaid
flowchart LR
  classDef comp fill:#1f6fd0,stroke:#164f96,color:#ffffff
  classDef near fill:#4a5568,stroke:#2d3748,color:#ffffff
  classDef db fill:#0f766e,stroke:#0a4f4a,color:#ffffff
  browser["Demo page"]:::near
  subgraph service["Python inference service"]
    inference["Inference<br/>HTTP, classification, artifact loading"]:::comp
  end
  export[("Committed model manifests and exports")]:::db
  browser ==>|"GET /api/models<br/>POST /api/classify/prompt<br/>POST /api/classify/activity<br/>POST /api/predict/submission"| inference
  inference ==>|"Read once at startup and verify SHA-256"| export
```

The Inference component lives in `AI/inference/`. Its files divide the work as follows.

| File | Responsibility |
|---|---|
| `server.py` | Binds to loopback, serves named assets and limits incoming JSON bodies. Returns structured errors. The demo stylesheet gets its color tokens from the repository's shared web palette. |
| `service.py` | Validates prompt and window requests. Checks first-submission eligibility using observation coverage, editor changes and the demo submission flag. Applies each task's threshold and reports the model version. |
| `artifacts.py` | Uses each task's manifest to select and verify its archive. Reports the task unavailable if the artifact check fails. |
| `windows.py` | Validates aggregate bins and applies the research feature extraction to complete windows. |

Inference reuses the prompt research scorer and the numeric window scorer. The activity and submission tasks have distinct manifests and artifacts. In the browser, `collector.js` keeps the latest editor counts in a bounded ring. It splits them into five-second bins using the observation clock. The activity and forecast requests share a snapshot of the latest 24 complete bins or a labelled synthetic sample. The forecast request adds the demo's transient submission flag.

The API tests run the server over loopback with the committed models or a temporary artifact directory. The browser tests drive the forms and inspect the requests to verify aggregate input, observation coverage and forecast eligibility. [Start and test the demo](../../AI/README.md).
