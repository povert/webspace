import os
import sys
import json
import shutil
import subprocess
import time
import yaml
import pty
import select
import struct
import fcntl
import termios
import threading
import asyncio
from pathlib import Path
from flask import Flask, request, jsonify, Response, send_from_directory, render_template
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

BASE_DIR = Path(__file__).parent.resolve()
WORKSPACES_DIR = BASE_DIR / "workspace"

def ensure_workspaces():
    WORKSPACES_DIR.mkdir(exist_ok=True)

def safe_path(path_str):
    try:
        resolved = Path(path_str).resolve()
        workspace_root = WORKSPACES_DIR.resolve()
        if not str(resolved).startswith(str(workspace_root)):
            return None
        return resolved
    except Exception:
        return None

def get_workspace_dirs(ws_name):
    ws = WORKSPACES_DIR / ws_name
    return {
        "root": ws,
        "data": ws / "data",
        "scripts": ws / "scripts",
        "reports": ws / "reports"
    }

def file_info(filepath, relative_to=None):
    stat = filepath.stat()
    size = stat.st_size
    mtime = time.strftime("%Y/%m/%d %H:%M", time.localtime(stat.st_mtime))
    name = filepath.name
    is_dir = filepath.is_dir()
    return {
        "name": name,
        "path": str(filepath.relative_to(relative_to)) if relative_to else str(filepath),
        "isDir": is_dir,
        "size": size,
        "sizeStr": f"{size/1024:.1f} KB" if size >= 1024 else f"{size} B" if not is_dir else "",
        "modified": mtime,
    }

def count_files_recursive(directory):
    count = 0
    if directory.exists():
        for item in directory.iterdir():
            if item.is_file():
                count += 1
            elif item.is_dir():
                count += count_files_recursive(item)
    return count

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/view")
def view_file():
    file_path = request.args.get("path", "")
    ws = request.args.get("workspace", "Default")
    full_path = safe_path(str(WORKSPACES_DIR / ws / file_path))
    if not full_path or not full_path.exists() or full_path.is_dir():
        return "File not found", 404
    try:
        content = full_path.read_text(encoding="utf-8", errors="replace")
        ext = full_path.suffix.lower()
        if ext == ".csv":
            return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{full_path.name}</title>
<style>body{{font-family:monospace;background:#1a1a2e;color:#e0e0e0;padding:20px}}
table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #333;padding:6px 10px;text-align:left}}
th{{background:#16213e;color:#4fc3f7;position:sticky;top:0}}</style></head>
<body><h2>{full_path.name}</h2><pre>{_render_csv_as_table(content)}</pre></body></html>"""
        elif ext == ".json":
            try:
                formatted = json.dumps(json.loads(content), indent=2, ensure_ascii=False)
            except:
                formatted = content
            return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{full_path.name}</title>
<style>body{{font-family:monospace;background:#1a1a2e;color:#e0e0e0;padding:20px;white-space:pre-wrap}}</style></head>
<body><h2>{full_path.name}</h2><pre>{formatted}</pre></body></html>"""
        else:
            return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{full_path.name}</title>
<style>body{{font-family:monospace;background:#1a1a2e;color:#e0e0e0;padding:20px;white-space:pre-wrap}}</style></head>
<body><h2>{full_path.name}</h2><pre>{content}</pre></body></html>"""
    except Exception as e:
        return f"Error: {e}", 500

def _render_csv_as_table(content):
    lines = content.strip().split("\n")
    if not lines:
        return ""
    headers = lines[0].split(",")
    rows = [line.split(",") for line in lines[1:] if line.strip()]
    html = "<table><thead><tr>" + "".join(f"<th>{h}</th>" for h in headers) + "</tr></thead><tbody>"
    for row in rows[:100]:
        html += "<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>"
    if len(rows) > 100:
        html += f'<tr><td colspan="{len(headers)}" style="text-align:center;color:#999">... 显示前 100 行，共 {len(rows)} 行</td></tr>'
    html += "</tbody></table>"
    return html

# Workspace routes
@app.route("/api/workspaces", methods=["GET"])
def list_workspaces():
    ensure_workspaces()
    workspaces = []
    for item in sorted(WORKSPACES_DIR.iterdir()):
        if item.is_dir():
            workspaces.append({
                "name": item.name,
                "dataCount": count_files_recursive(item / "data"),
                "scriptsCount": count_files_recursive(item / "scripts"),
                "reportsCount": count_files_recursive(item / "reports"),
            })
    if not workspaces:
        ws = WORKSPACES_DIR / "Default"
        ws.mkdir(exist_ok=True)
        (ws / "data").mkdir(exist_ok=True)
        (ws / "scripts").mkdir(exist_ok=True)
        (ws / "reports").mkdir(exist_ok=True)
        workspaces.append({"name": "Default", "dataCount": 0, "scriptsCount": 0, "reportsCount": 0})
    return jsonify(workspaces)

@app.route("/api/workspaces", methods=["POST"])
def create_workspace():
    data = request.json
    name = data.get("name", "").strip()
    if not name or "/" in name or "\\" in name:
        return jsonify({"error": "Invalid name"}), 400
    ws = WORKSPACES_DIR / name
    if ws.exists():
        return jsonify({"error": "Workspace already exists"}), 409
    ws.mkdir(parents=True)
    (ws / "data").mkdir()
    (ws / "scripts").mkdir()
    (ws / "reports").mkdir()
    return jsonify({"name": name}), 201

@app.route("/api/workspaces/<name>", methods=["DELETE"])
def delete_workspace(name):
    ws = safe_path(str(WORKSPACES_DIR / name))
    if not ws or not ws.exists():
        return jsonify({"error": "Not found"}), 404
    shutil.rmtree(ws)
    return jsonify({"ok": True})

@app.route("/api/workspaces/<name>", methods=["PUT"])
def rename_workspace(name):
    data = request.json
    new_name = data.get("name", "").strip()
    if not new_name or "/" in new_name:
        return jsonify({"error": "Invalid name"}), 400
    old_ws = safe_path(str(WORKSPACES_DIR / name))
    new_ws = WORKSPACES_DIR / new_name
    if not old_ws or not old_ws.exists():
        return jsonify({"error": "Not found"}), 404
    if new_ws.exists():
        return jsonify({"error": "Target already exists"}), 409
    old_ws.rename(new_ws)
    return jsonify({"name": new_name})

@app.route("/api/workspace/tree", methods=["GET"])
def workspace_tree():
    ws_name = request.args.get("workspace", "Default")
    ws = WORKSPACES_DIR / ws_name
    if not ws.exists():
        return jsonify({"error": "Not found"}), 404
    result = {}
    for folder in ["data", "scripts"]:
        folder_path = ws / folder
        if folder_path.exists():
            result[folder] = []
            for item in sorted(folder_path.iterdir()):
                info = file_info(item, ws)
                result[folder].append(info)
    return jsonify(result)

@app.route("/api/workspace/refresh", methods=["POST"])
def workspace_refresh():
    return jsonify({"ok": True})

# File routes
@app.route("/api/file/list", methods=["GET"])
def file_list():
    ws_name = request.args.get("workspace", "Default")
    sub_path = request.args.get("path", "")
    category = request.args.get("category", "data")
    full_dir = safe_path(str(WORKSPACES_DIR / ws_name / category / sub_path))
    if not full_dir:
        return jsonify({"error": "Invalid path"}), 400
    if not full_dir.exists():
        full_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for item in sorted(full_dir.iterdir()):
        if category == "reports" and item.suffix.lower() == ".json" and item.name.endswith(".meta.json"):
            continue
        info = file_info(item, WORKSPACES_DIR / ws_name / category)
        items.append(info)
    return jsonify(items)

@app.route("/api/file/preview", methods=["GET"])
def file_preview():
    ws_name = request.args.get("workspace", "Default")
    sub_path = request.args.get("path", "")
    category = request.args.get("category", "data")
    full_path = safe_path(str(WORKSPACES_DIR / ws_name / category / sub_path))
    if not full_path or not full_path.exists() or full_path.is_dir():
        return jsonify({"error": "File not found"}), 404
    try:
        size = full_path.stat().st_size
        content = full_path.read_text(encoding="utf-8", errors="replace")
        if size > 5 * 1024 * 1024:
            content = content[:1024 * 1024]
            truncated = True
        else:
            truncated = False
        return jsonify({
            "name": full_path.name,
            "content": content,
            "size": size,
            "truncated": truncated,
            "extension": full_path.suffix.lower(),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/file/save", methods=["POST"])
def file_save():
    data = request.json
    ws_name = data.get("workspace", "Default")
    sub_path = data.get("path", "")
    category = data.get("category", "scripts")
    content = data.get("content", "")
    full_path = safe_path(str(WORKSPACES_DIR / ws_name / category / sub_path))
    if not full_path:
        return jsonify({"error": "Invalid path"}), 400
    try:
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content, encoding="utf-8")
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/file/delete", methods=["POST"])
def file_delete():
    data = request.json
    ws_name = data.get("workspace", "Default")
    sub_path = data.get("path", "")
    category = data.get("category", "data")
    full_path = safe_path(str(WORKSPACES_DIR / ws_name / category / sub_path))
    if not full_path or not full_path.exists():
        return jsonify({"error": "Not found"}), 404
    try:
        if full_path.is_dir():
            shutil.rmtree(full_path)
        else:
            full_path.unlink()
            if category == "reports":
                meta_path = full_path.parent / f"{full_path.stem}.meta.json"
                if meta_path.exists():
                    meta_path.unlink()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/file/rename", methods=["POST"])
def file_rename():
    data = request.json
    ws_name = data.get("workspace", "Default")
    sub_path = data.get("path", "")
    category = data.get("category", "data")
    new_name = data.get("newName", "").strip()
    if not new_name:
        return jsonify({"error": "Invalid name"}), 400
    full_path = safe_path(str(WORKSPACES_DIR / ws_name / category / sub_path))
    if not full_path or not full_path.exists():
        return jsonify({"error": "Not found"}), 404
    new_path = full_path.parent / new_name
    if new_path.exists():
        return jsonify({"error": "Target exists"}), 409
    full_path.rename(new_path)
    return jsonify({"ok": True})

@app.route("/api/file/move", methods=["POST"])
def file_move():
    data = request.json
    ws_name = data.get("workspace", "Default")
    src_category = data.get("category", "data")
    src_path = data.get("path", "")
    dest_category = data.get("destCategory", "data")
    dest_path = data.get("destPath", "")
    src = safe_path(str(WORKSPACES_DIR / ws_name / src_category / src_path))
    dest_dir = safe_path(str(WORKSPACES_DIR / ws_name / dest_category / dest_path))
    if not src or not dest_dir or not src.exists():
        return jsonify({"error": "Invalid path"}), 400
    dest = dest_dir / src.name
    try:
        shutil.move(str(src), str(dest))
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/file/mkdir", methods=["POST"])
def file_mkdir():
    data = request.json
    ws_name = data.get("workspace", "Default")
    sub_path = data.get("path", "")
    name = data.get("name", "").strip()
    category = data.get("category", "data")
    if not name:
        return jsonify({"error": "Invalid name"}), 400
    full_path = safe_path(str(WORKSPACES_DIR / ws_name / category / sub_path / name))
    if not full_path:
        return jsonify({"error": "Invalid path"}), 400
    if full_path.exists():
        return jsonify({"error": "Already exists"}), 409
    full_path.mkdir(parents=True, exist_ok=True)
    return jsonify({"ok": True})

@app.route("/api/file/create", methods=["POST"])
def file_create():
    data = request.json
    ws_name = data.get("workspace", "Default")
    sub_path = data.get("path", "")
    name = data.get("name", "").strip()
    category = data.get("category", "data")
    if not name:
        return jsonify({"error": "Invalid name"}), 400
    full_path = safe_path(str(WORKSPACES_DIR / ws_name / category / sub_path / name))
    if not full_path:
        return jsonify({"error": "Invalid path"}), 400
    if full_path.exists():
        return jsonify({"error": "Already exists"}), 409
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.touch()
    return jsonify({"ok": True})

# Script routes
@app.route("/api/script/meta", methods=["GET"])
def script_meta():
    ws_name = request.args.get("workspace", "Default")
    sub_path = request.args.get("path", "")
    full_path = safe_path(str(WORKSPACES_DIR / ws_name / "scripts" / sub_path))
    if not full_path or not full_path.exists():
        return jsonify({"error": "Not found"}), 404
    try:
        content = full_path.read_text(encoding="utf-8", errors="replace")
        meta = {"params": [], "description": ""}
        lines = content.split("\n")
        start_idx = 0
        if lines and lines[0].startswith("#!"):
            start_idx = 1
        trimmed = "\n".join(lines[start_idx:])
        if trimmed.lstrip().startswith('"""') or trimmed.lstrip().startswith("'''"):
            ltrimmed = trimmed.lstrip()
            quote = ltrimmed[:3]
            end = ltrimmed.find(quote, 3)
            if end != -1:
                docstring = ltrimmed[3:end].strip()
                meta["description"] = docstring
                try:
                    parsed = yaml.safe_load(docstring)
                    if isinstance(parsed, dict):
                        meta["description"] = parsed.get("description", docstring)
                        meta["params"] = parsed.get("params", [])
                except Exception:
                    pass
        return jsonify(meta)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def _collect_files(ws_dirs, script_path, params):
    files = [f"scripts/{script_path}"]
    for key, value in params.items():
        if value and isinstance(value, str) and (value.startswith("data/") or value.startswith("scripts/")):
            if value not in files:
                files.append(value)
    return files

@app.route("/api/script/execute", methods=["POST"])
def script_execute():
    data = request.json
    ws_name = data.get("workspace", "Default")
    script_path = data.get("path", "")
    params = data.get("params", {})
    full_path = safe_path(str(WORKSPACES_DIR / ws_name / "scripts" / script_path))
    if not full_path or not full_path.exists():
        return jsonify({"error": "Script not found"}), 404

    ws_dirs = get_workspace_dirs(ws_name)
    output_dir = ws_dirs["reports"]
    output_dir.mkdir(parents=True, exist_ok=True)
    report_name = f"report_{time.strftime('%Y%m%d_%H%M%S')}.html"
    output_path = output_dir / report_name

    python_exe = str(BASE_DIR / ".venv" / "bin" / "python")
    if not os.path.exists(python_exe):
        python_exe = sys.executable
    cmd = [python_exe, str(full_path)]
    cmd.extend(["--output", str(output_path)])
    for key, value in params.items():
        if key == "--output":
            continue
        cmd.extend([key, str(value)])

    def generate():
        yield f"data: {json.dumps({'msg': f'▶ 开始执行: scripts/{script_path}', 'progress': 0}, ensure_ascii=False)}\n\n"
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=str(ws_dirs["root"]),
                timeout=120,
            )
            progress = 0.5
            output = (result.stdout or "") + (result.stderr or "")
            for line in output.splitlines():
                line = line.rstrip("\n")
                if not line:
                    continue
                try:
                    msg_data = json.loads(line)
                    if msg_data.get("status") == "success":
                        report_file = msg_data.get("report", report_name)
                        meta_data = {
                            "cmd": " ".join(cmd),
                            "files": _collect_files(ws_dirs, script_path, params),
                            "script": script_path,
                            "params": params,
                            "report": report_file,
                            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                        }
                        meta_path = output_dir / f"{Path(report_file).stem}.meta.json"
                        try:
                            meta_path.write_text(json.dumps(meta_data, ensure_ascii=False, indent=2), encoding="utf-8")
                        except Exception:
                            pass
                        yield f"data: {json.dumps({'progress': 1.0, 'msg': f'✅ 报表已生成: {report_file}', 'status': 'success', 'report': report_file}, ensure_ascii=False)}\n\n"
                    elif msg_data.get("status") == "error":
                        error_msg = msg_data.get("msg", "Unknown")
                        yield f"data: {json.dumps({'msg': f'❌ 错误: {error_msg}', 'status': 'error'}, ensure_ascii=False)}\n\n"
                    else:
                        yield f"data: {json.dumps({'msg': msg_data.get('msg', line), 'progress': msg_data.get('progress', progress)}, ensure_ascii=False)}\n\n"
                except json.JSONDecodeError:
                    progress = min(progress + 0.05, 0.95)
                    yield f"data: {json.dumps({'msg': line, 'progress': progress}, ensure_ascii=False)}\n\n"
            if result.returncode != 0:
                yield f"data: {json.dumps({'msg': f'⚠ 进程退出码: {result.returncode}', 'status': 'error'}, ensure_ascii=False)}\n\n"
            elif progress < 1.0:
                report_file = report_name
                meta_data = {
                    "cmd": " ".join(cmd),
                    "files": _collect_files(ws_dirs, script_path, params),
                    "script": script_path,
                    "params": params,
                    "report": report_file,
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                }
                meta_path = output_dir / f"{Path(report_file).stem}.meta.json"
                try:
                    meta_path.write_text(json.dumps(meta_data, ensure_ascii=False, indent=2), encoding="utf-8")
                except Exception:
                    pass
                yield f"data: {json.dumps({'progress': 1.0, 'msg': '✅ 执行完成', 'status': 'success', 'report': report_name}, ensure_ascii=False)}\n\n"
        except subprocess.TimeoutExpired:
            yield f"data: {json.dumps({'msg': '⏰ 执行超时 (120s)，已终止', 'status': 'error'}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'msg': f'❌ 异常: {str(e)}', 'status': 'error'}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.route("/api/script/stop", methods=["POST"])
def script_stop():
    return jsonify({"ok": True, "msg": "Stop signal sent"})

# Report routes
@app.route("/api/reports", methods=["GET"])
def list_reports():
    ws_name = request.args.get("workspace", "Default")
    sub_path = request.args.get("path", "")
    reports_dir = safe_path(str(WORKSPACES_DIR / ws_name / "reports" / sub_path))
    if not reports_dir:
        return jsonify({"error": "Invalid path"}), 400
    if not reports_dir.exists():
        reports_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for item in sorted(reports_dir.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if item.suffix.lower() == ".json" and item.name.endswith(".meta.json"):
            continue
        info = file_info(item, WORKSPACES_DIR / ws_name / "reports")
        if item.suffix.lower() == ".html":
            meta_path = item.parent / f"{item.stem}.meta.json"
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    info["meta"] = meta
                except Exception:
                    pass
        items.append(info)
    return jsonify(items)

@app.route("/api/report/meta", methods=["GET"])
def report_meta():
    ws_name = request.args.get("workspace", "Default")
    sub_path = request.args.get("path", "")
    full_path = safe_path(str(WORKSPACES_DIR / ws_name / "reports" / sub_path))
    if not full_path or not full_path.exists():
        return jsonify({"error": "Not found"}), 404
    meta_path = full_path.parent / f"{full_path.stem}.meta.json"
    if meta_path.exists():
        try:
            return jsonify(json.loads(meta_path.read_text(encoding="utf-8")))
        except Exception:
            pass
    return jsonify({})

@app.route("/api/report/view", methods=["GET"])
def view_report():
    ws_name = request.args.get("workspace", "Default")
    sub_path = request.args.get("path", "")
    full_path = safe_path(str(WORKSPACES_DIR / ws_name / "reports" / sub_path))
    if not full_path or not full_path.exists():
        return "Not found", 404
    try:
        ext = full_path.suffix.lower()
        content = full_path.read_text(encoding="utf-8", errors="replace")
        if ext == ".html":
            return content, 200, {"Content-Type": "text/html; charset=utf-8"}
        elif ext == ".csv":
            lines = content.strip().split("\n")
            if not lines:
                return content, 200, {"Content-Type": "text/plain; charset=utf-8"}
            headers = lines[0].split(",")
            rows = [line.split(",") for line in lines[1:] if line.strip()]
            html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{full_path.name}</title>
<style>body{{font-family:-apple-system,sans-serif;background:#0d1117;color:#e6edf3;padding:30px}}
h2{{color:#58a6ff;margin-bottom:16px}}
table{{border-collapse:collapse;width:100%}}
th{{background:#161b22;color:#58a6ff;padding:10px 14px;text-align:left;border-bottom:2px solid #30363d;font-size:13px;text-transform:uppercase}}
td{{padding:10px 14px;border-bottom:1px solid #21262d;font-size:14px}}
tr:hover{{background:#161b22}}</style></head><body>
<h2>{full_path.name}</h2>
<table><thead><tr>{"".join(f"<th>{h}</th>" for h in headers)}</tr></thead><tbody>
{"".join("<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in rows[:500])}
{f'<tr><td colspan="{len(headers)}" style="text-align:center;color:#8b949e">... 共 {len(rows)} 行</td></tr>' if len(rows) > 500 else ""}
</tbody></table></body></html>"""
            return html, 200, {"Content-Type": "text/html; charset=utf-8"}
        elif ext == ".json":
            try:
                formatted = json.dumps(json.loads(content), indent=2, ensure_ascii=False)
            except Exception:
                formatted = content
            html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{full_path.name}</title>
<style>body{{font-family:"Cascadia Code","Fira Code",monospace;background:#0d1117;color:#e6edf3;padding:30px}}
pre{{white-space:pre-wrap;word-break:break-all;line-height:1.6}}</style></head><body>
<h2 style="color:#58a6ff">{full_path.name}</h2><pre>{formatted}</pre></body></html>"""
            return html, 200, {"Content-Type": "text/html; charset=utf-8"}
        else:
            html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{full_path.name}</title>
<style>body{{font-family:"Cascadia Code","Fira Code",monospace;background:#0d1117;color:#e6edf3;padding:30px}}
pre{{white-space:pre-wrap;word-break:break-all;line-height:1.6}}</style></head><body>
<h2 style="color:#58a6ff">{full_path.name}</h2><pre>{content}</pre></body></html>"""
            return html, 200, {"Content-Type": "text/html; charset=utf-8"}
    except Exception as e:
        return f"Error: {e}", 500

@app.route("/api/report/delete", methods=["POST"])
def delete_report():
    data = request.json
    ws_name = data.get("workspace", "Default")
    sub_path = data.get("path", "")
    full_path = safe_path(str(WORKSPACES_DIR / ws_name / "reports" / sub_path))
    if not full_path or not full_path.exists():
        return jsonify({"error": "Not found"}), 404
    try:
        full_path.unlink()
        meta_path = full_path.parent / f"{full_path.stem}.meta.json"
        if meta_path.exists():
            meta_path.unlink()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/linked-reports", methods=["GET"])
def linked_reports():
    ws_name = request.args.get("workspace", "Default")
    query = request.args.get("query", "")
    query_type = request.args.get("type", "")
    reports_dir = WORKSPACES_DIR / ws_name / "reports"
    if not reports_dir.exists():
        return jsonify([])
    results = []
    for meta_file in sorted(reports_dir.glob("*.meta.json")):
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        report_name = meta_file.stem.replace(".meta", "")
        report_path = f"{report_name}.html"
        report_full = reports_dir / report_path
        if not report_full.exists():
            continue
        match = False
        if query_type == "script" and meta.get("script") == query:
            match = True
        elif query_type == "file":
            files = meta.get("files") or []
            if query in files:
                match = True
            else:
                for v in (meta.get("params") or {}).values():
                    if isinstance(v, str) and v == query:
                        match = True
                        break
        if match:
            data_files = [f for f in (meta.get("files") or []) if f.startswith("data/")]
            if not data_files:
                for v in (meta.get("params") or {}).values():
                    if isinstance(v, str) and v.startswith("data/") and v not in data_files:
                        data_files.append(v)
            results.append({
                "report": report_name,
                "path": report_path,
                "script": meta.get("script", ""),
                "params": meta.get("params", {}),
                "timestamp": meta.get("timestamp", ""),
                "files": meta.get("files", []),
                "data_files": data_files,
            })
    return jsonify(results)


# AI Terminal WebSocket
async def handle_ai_terminal(websocket):
    import queue
    config = {}
    try:
        data = await asyncio.wait_for(websocket.recv(), timeout=5)
        if data:
            config = json.loads(data)
    except Exception as e:
        print(f"[AI Terminal] receive config error: {e}", file=sys.stderr, flush=True)

    workspace = config.get("workspace", "Default")
    command = config.get("command", "") or os.environ.get("AI_CLI_COMMAND", "claude")
    ws_dir = str(WORKSPACES_DIR / workspace)
    if not os.path.isdir(ws_dir):
        ws_dir = str(WORKSPACES_DIR)

    env = {**os.environ, "TERM": "xterm-256color"}
    cmd_parts = command.split()

    print(f"[AI Terminal] Starting: command={command}, workspace={workspace}, cwd={ws_dir}", file=sys.stderr, flush=True)

    master_fd, slave_fd = pty.openpty()
    try:
        pid = os.fork()
    except OSError as e:
        print(f"[AI Terminal] fork failed: {e}", file=sys.stderr, flush=True)
        await websocket.send(json.dumps({"type": "error", "msg": "fork failed"}))
        return

    if pid == 0:
        os.close(master_fd)
        os.setsid()
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        os.chdir(ws_dir)
        os.execvpe(cmd_parts[0], cmd_parts, env)
    else:
        os.close(slave_fd)
        closed = threading.Event()

        def pty_to_ws():
            try:
                while not closed.is_set():
                    r, _, _ = select.select([master_fd], [], [], 0.2)
                    if r:
                        try:
                            data = os.read(master_fd, 8192)
                            if not data:
                                break
                            asyncio.run_coroutine_threadsafe(
                                websocket.send(data.decode("utf-8", errors="replace")),
                                loop
                            )
                        except OSError:
                            break
            except Exception:
                pass
            closed.set()

        loop = asyncio.get_event_loop()
        reader = threading.Thread(target=pty_to_ws, daemon=True)
        reader.start()

        try:
            while not closed.is_set():
                try:
                    msg = await asyncio.wait_for(websocket.recv(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                except Exception:
                    break
                if msg is None:
                    break
                try:
                    obj = json.loads(msg)
                    if obj.get("type") == "input":
                        os.write(master_fd, obj["data"].encode("utf-8"))
                    elif obj.get("type") == "resize":
                        rows = obj.get("rows", 24)
                        cols = obj.get("cols", 80)
                        winsize = struct.pack("HHHH", rows, cols, 0, 0)
                        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                except json.JSONDecodeError:
                    os.write(master_fd, msg.encode("utf-8"))
        except Exception:
            pass
        finally:
            closed.set()
            try:
                os.close(master_fd)
            except Exception:
                pass
            try:
                os.kill(pid, 9)
                os.waitpid(pid, os.WNOHANG)
            except Exception:
                pass


if __name__ == "__main__":
    ensure_workspaces()
    print("🚀 数据分析工作台已启动: http://localhost:5120")
    print("🖥️  AI 终端 WebSocket: ws://localhost:5121")

    import websockets

    async def run_servers():
        ws_server = await websockets.serve(handle_ai_terminal, "0.0.0.0", 5121)
        await ws_server.wait_closed()

    def start_ws():
        asyncio.run(run_servers())

    ws_thread = threading.Thread(target=start_ws, daemon=True)
    ws_thread.start()

    app.run(host="0.0.0.0", port=5120, debug=True)
