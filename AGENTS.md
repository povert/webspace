# AGENTS.md

Local personal data analysis workbench. Flask backend + vanilla JS frontend, file-system as database.

## Quick Start

```bash
uv venv
uv pip install -r requirements.txt
python app.py
# → http://localhost:5120
# AI terminal WebSocket → ws://localhost:5121
```

## Architecture

Single-file backend `app.py` (~776 lines). No blueprints, no ORM, no build step.

- **HTTP routes** (`app.py`): Flask REST API for workspace/file/script/report CRUD
- **WebSocket** (`app.py`): `websockets` library on port 5121 for AI terminal PTY bridge
- **Frontend** (`static/app.js`, `static/style.css`, `templates/index.html`): Vanilla JS SPA, no framework, no bundler

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 5120 | HTTP | Flask web app |
| 5121 | WebSocket | AI terminal PTY (claude CLI) |

## Key Gotchas

- **`json.dumps` must use `ensure_ascii=False`** for Chinese characters in SSE streaming. Without it, Chinese displays as `\uxxxx`.
- **Script execution** uses `subprocess.run` with `capture_output=True` (batch output, not streaming) because Python buffering prevents real-time streaming.
- **Report meta.json** links reports to scripts/data. The `linked-reports` API scans these. Deleting a report must also delete its `.meta.json`.
- **File paths in meta.json** use `data/` prefix (e.g., `data/sales_data.csv`). Frontend must prepend `data/` when querying linked reports for data files.
- **PTY WebSocket** uses `websockets` library (not `flask-sock`). `simple-websocket` has browser compatibility issues ("Invalid frame header").

## Script Protocol

Scripts in `scripts/` must:
1. Declare params via YAML docstring (parsed by `/api/script/meta`)
2. Accept `--output` argument for report path
3. Print JSON progress to stdout: `{"progress": 0.5, "msg": "..."}`
4. Print success signal: `{"status": "success", "report": "filename.html"}`

Shebang lines (`#!/usr/bin/env python3`) are skipped during meta parsing.

## File Structure

```
workspace/<name>/
├── data/       # User data files
├── scripts/    # Python scripts (.py)
└── reports/    # Generated HTML reports + .meta.json
```

`workspace/` directory is gitignored. Created on first run.
