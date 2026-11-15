"""MCP OAuth token files in the account home (phase 5, decision 14; PROTOCOL.md section 12).

Go keeps an account's MCP OAuth tokens encrypted in Postgres (``agent_secrets``) and sends them in
the account settings (``mcp_tokens {server: token json}``). ``render-account`` writes them where
Hermes reads them, ``HERMES_HOME/mcp-tokens/<server>.json`` (owner-only), with the client info and
server metadata files next to them when Go has those. Hermes refreshes a token in place; the worker
reads changed files back (``mcp.tokens``) on its maintenance tick and every file at shutdown, and
deletes the folder when it exits. The folder is never in an agent-state zip (``backup.py``).

A token json is ``{"tokens": {...}, "client_info": {...}?, "meta": {...}?}`` (Hermes' three files,
``tools/mcp_oauth.py`` ``HermesTokenStorage``); a bare object without ``tokens`` is taken as the
tokens file itself.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any, Mapping

DIRNAME = "mcp-tokens"
# Hermes' suffixes for one server's files, by the key a token json uses for each.
FILES = {"tokens": ".json", "client_info": ".client.json", "meta": ".meta.json"}


def safe_name(name: str) -> str:
    """Hermes' file name for a server (``tools/mcp_oauth.py`` ``_safe_filename``)."""
    return re.sub(r"[^\w\-]", "_", name).strip("_")[:128] or "default"


def token_dir(home: os.PathLike | str) -> Path:
    return Path(home) / DIRNAME


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _dump(value: Any) -> bytes:
    return json.dumps(value, indent=2, sort_keys=True).encode("utf-8")


def _parts(token: Any) -> dict[str, Any]:
    if not isinstance(token, Mapping):
        return {}
    if "tokens" in token:
        return {k: token[k] for k in FILES if isinstance(token.get(k), Mapping)}
    return {"tokens": dict(token)}


def write(home: os.PathLike | str, tokens: Any, keep: set[str]) -> dict[str, str]:
    """Write the token files of the servers in ``keep`` (the rendered MCP servers) and remove
    every other file in the folder. Returns ``{file name: sha256}`` of what was written, so the
    worker can tell which files Hermes changed since."""
    folder = token_dir(home)
    written: dict[str, str] = {}
    wanted: dict[str, bytes] = {}
    for server, token in (tokens.items() if isinstance(tokens, Mapping) else []):
        if str(server) not in keep:
            continue
        for key, value in _parts(token).items():
            wanted[safe_name(str(server)) + FILES[key]] = _dump(value)
    if folder.is_dir():
        for path in folder.iterdir():
            if path.name not in wanted:
                if path.is_dir() and not path.is_symlink():
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    path.unlink(missing_ok=True)
    if not wanted:
        return written
    folder.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(folder, 0o700)
    except OSError:
        pass
    from timely_agent.config_render import write_atomic
    for name, data in sorted(wanted.items()):
        written[name] = write_atomic(folder / name, data, mode=0o600)
    return written


def _server_of(file_name: str) -> tuple[str, str]:
    """``(server file stem, key)`` for one of Hermes' files, else ``("", "")``."""
    for key, suffix in sorted(FILES.items(), key=lambda kv: -len(kv[1])):
        if file_name.endswith(suffix):
            return file_name[: -len(suffix)], key
    return "", ""


def read_back(home: os.PathLike | str, changed_only: bool) -> dict[str, dict[str, Any]]:
    """``{server: token json}`` for the servers whose files differ from what render-account wrote
    (every server with a file when ``changed_only`` is false). Server names are Hermes' file stems
    (the server name with anything but letters, digits, ``_`` and ``-`` replaced by ``_``)."""
    from timely_agent.config_render import account_state
    folder = token_dir(home)
    if not folder.is_dir():
        return {}
    rendered = account_state(home).get("mcp_token_files") or {}
    rendered = rendered if isinstance(rendered, dict) else {}
    out: dict[str, dict[str, Any]] = {}
    changed: set[str] = set()
    for path in sorted(folder.iterdir()):
        stem, key = _server_of(path.name)
        if not stem or not path.is_file() or path.is_symlink():
            continue
        try:
            data = path.read_bytes()
            value = json.loads(data.decode("utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(value, dict):
            continue
        out.setdefault(stem, {})[key] = value
        if rendered.get(path.name) != _sha(data):
            changed.add(stem)
    for name in rendered:  # a file Hermes deleted (signed out) counts as a change
        stem, _ = _server_of(str(name))
        if stem and not (folder / str(name)).exists():
            changed.add(stem)
            out.setdefault(stem, {})
    if changed_only:
        out = {k: v for k, v in out.items() if k in changed}
    if changed_only and out:
        _remember(home, folder)
    return out


def _remember(home: os.PathLike | str, folder: Path) -> None:
    """After a report: the files as they are now count as known, so the next tick reports only
    what changed again."""
    from timely_agent.config_render import ACCOUNT_STATE, account_state, write_atomic
    state = account_state(home)
    if not state:
        return
    state["mcp_token_files"] = {p.name: _sha(p.read_bytes()) for p in sorted(folder.iterdir())
                                if p.is_file() and not p.is_symlink() and _server_of(p.name)[0]}
    write_atomic(Path(home) / ACCOUNT_STATE, (json.dumps(state, indent=2, sort_keys=True) + "\n").encode())


def remove(home: os.PathLike | str) -> None:
    """Delete the token folder (worker exit): tokens live in the home only while a worker runs."""
    folder = token_dir(home)
    if folder.is_dir() and not folder.is_symlink():
        shutil.rmtree(folder, ignore_errors=True)
    elif folder.is_symlink():
        folder.unlink(missing_ok=True)
