#!/usr/bin/env python3
"""Upload a local file as a Dida365 (滴答清单) / TickTick task attachment via the web API.

Upload only: this script never edits task content. Write the markdown
`![image](<attachmentId>/<fileName>)` with the official MCP/Open API `update_task`
and pass back startDate/dueDate/isAllDay/timeZone (and parentId) unchanged.

Auth (web session cookie `t`, optional `_csrf_token`), first match wins:
  1. env DIDA_COOKIE_T (+ DIDA_CSRF)
  2. --secrets PATH, or env DIDA_SESSION_FILE: JSON {"t": "...", "_csrf_token": "..."}
API host: env DIDA_API_BASE (default https://api.dida365.com; TickTick: https://api.ticktick.com).

Never prints cookie/token values.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

API_BASE = os.environ.get("DIDA_API_BASE", "https://api.dida365.com").rstrip("/")
WEB_ORIGIN = API_BASE.replace("://api.", "://")


def _new_object_id() -> str:
    return f"{int(time.time()):08x}{os.urandom(8).hex()}"


def _load_auth(secrets_path: Path | None) -> tuple[str, str | None]:
    t = os.environ.get("DIDA_COOKIE_T") or ""
    csrf = os.environ.get("DIDA_CSRF") or ""
    if t:
        return t, (csrf or None)
    env_path = os.environ.get("DIDA_SESSION_FILE")
    path = secrets_path or (Path(env_path) if env_path else None)
    if path and path.is_file():
        data = json.loads(path.read_text())
        t = data.get("t") or data.get("DIDA_COOKIE_T") or ""
        csrf = data.get("_csrf_token") or data.get("csrf") or ""
        if t:
            return t, (csrf or None)
    raise SystemExit("missing auth: set DIDA_COOKIE_T, or DIDA_SESSION_FILE / --secrets pointing to JSON with key 't'")


def _headers(t: str, csrf: str | None) -> dict[str, str]:
    cookie = f"t={t}"
    if csrf:
        cookie += f"; _csrf_token={csrf}"
    h = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ),
        "Origin": WEB_ORIGIN,
        "Referer": WEB_ORIGIN + "/",
        "Accept": "application/json, text/plain, */*",
        "Cookie": cookie,
        "x-requested-with": "XMLHttpRequest",
    }
    if csrf:
        h["x-csrf-token"] = csrf
    return h


def _multipart(field_name: str, filename: str, content: bytes, content_type: str) -> tuple[bytes, str]:
    boundary = f"----didaAttach{os.urandom(8).hex()}"
    disposition = (
        f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"'
    )
    parts = [
        f"--{boundary}\r\n{disposition}\r\nContent-Type: {content_type}\r\n\r\n".encode(),
        content,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    body = b"".join(parts)
    return body, f"multipart/form-data; boundary={boundary}"


def api_json(method: str, path: str, headers: dict[str, str], data: bytes | None = None) -> tuple[int, Any]:
    req = Request(API_BASE + path, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=120) as resp:
            raw = resp.read()
            if not raw:
                return resp.status, None
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, {"_nonjson_len": len(raw)}
    except HTTPError as e:
        raw = e.read() if e.fp else b""
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"_nonjson_len": len(raw), "_head": raw[:120].decode("utf-8", "replace")}


def upload_task_attachment(
    *,
    project_id: str,
    task_id: str,
    file_path: Path,
    attachment_id: str | None = None,
    secrets_path: Path | None = None,
    field_name: str = "file",
) -> dict[str, Any]:
    t, csrf = _load_auth(secrets_path)
    headers = _headers(t, csrf)
    att_id = attachment_id or _new_object_id()
    content = file_path.read_bytes()
    filename = file_path.name
    # crude content-type
    suffix = file_path.suffix.lower()
    ctype = {
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }.get(suffix, "application/octet-stream")

    body, ct = _multipart(field_name, filename, content, ctype)
    up_headers = dict(headers)
    up_headers["Content-Type"] = ct

    path = f"/api/v1/attachment/upload/{project_id}/{task_id}/{att_id}"
    status, resp = api_json("POST", path, up_headers, data=body)
    result: dict[str, Any] = {
        "ok": False,
        "http_status": status,
        "upload_path": path,
        "attachment_id": att_id,
        "file_name": filename,
        "file_size": len(content),
    }
    if status != 200 or not isinstance(resp, dict) or not resp.get("id"):
        result["error"] = resp if isinstance(resp, dict) else {"raw": str(resp)[:200]}
        return result

    result["upload"] = {
        k: resp.get(k)
        for k in ("id", "refId", "fileName", "fileType", "size", "path", "createdTime")
        if k in resp
    }

    # Prefer response fileName / id for markdown
    resp_id = resp.get("id") or att_id
    resp_name = resp.get("fileName") or filename
    if isinstance(resp_id, str):
        att_id = resp_id
        result["attachment_id"] = att_id
    if isinstance(resp_name, str):
        filename = resp_name
        result["file_name"] = filename

    # verify on task
    st2, task = api_json("GET", f"/api/v2/task/{task_id}", headers)
    result["task_get_status"] = st2
    if isinstance(task, dict):
        atts = task.get("attachments") or []
        ids = [a.get("id") for a in atts if isinstance(a, dict)]
        result["associated"] = att_id in ids or resp.get("id") in ids
        result["attachment_count"] = len(atts)
        match = next((a for a in atts if isinstance(a, dict) and a.get("id") in (att_id, resp.get("id"))), None)
        if match:
            result["task_attachment"] = {
                k: match.get(k) for k in ("id", "fileName", "fileType", "size", "createdTime") if k in match
            }
            if match.get("fileName"):
                filename = match["fileName"]
                result["file_name"] = filename
    else:
        result["associated"] = None

    result["ok"] = bool(result.get("associated"))

    return result


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Upload a Dida365/TickTick task attachment (upload only, content untouched).")
    p.add_argument("--project-id", required=True)
    p.add_argument("--task-id", required=True)
    p.add_argument("--file", required=True, type=Path)
    p.add_argument("--attachment-id", default=None, help="24-hex id; auto-generated if omitted")
    p.add_argument("--secrets", type=Path, default=None, help="JSON with key t (and optional _csrf_token)")
    p.add_argument("--json", action="store_true", help="print full result JSON")
    args = p.parse_args(argv)
    if not args.file.is_file():
        print(f"FAIL file not found: {args.file}", file=sys.stderr)
        return 2
    result = upload_task_attachment(
        project_id=args.project_id, task_id=args.task_id, file_path=args.file,
        attachment_id=args.attachment_id, secrets_path=args.secrets,
    )
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif result.get("ok"):
        u = result.get("upload") or {}
        print("OK", f"attachment_id={result.get('attachment_id')}", f"fileName={result.get('file_name')}",
              f"size={u.get('size') or result.get('file_size')}", f"attachment_count={result.get('attachment_count')}")
    else:
        err = result.get("error") or {}
        print("FAIL", f"http={result.get('http_status')}", f"associated={result.get('associated')}", file=sys.stderr)
        if isinstance(err, dict):
            safe = {k: err.get(k) for k in ("errorCode", "errorId") if k in err}
            if safe:
                print(json.dumps(safe), file=sys.stderr)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
