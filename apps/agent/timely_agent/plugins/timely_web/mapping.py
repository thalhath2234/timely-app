"""Go's answers to the ``timely`` backend's calls, mapped to Hermes' web provider result shapes.

The shapes are ``plugins/web/_common.py``'s (``search_ok`` / ``web_hit`` / ``document`` /
``page_error``), rebuilt here without importing Hermes so the pytest process can check them;
``tests/test_timely_web.py`` compares them with Hermes' own helpers in a worker-side interpreter.
Key order is part of the contract: the dicts reach the model as JSON.
"""

from __future__ import annotations

from typing import Any

TEXT_CAP = 200_000  # one page's content (Go caps pages at 90,000 bytes; this only bounds a bad answer)
NO_PAGE = "Timely returned no page for this link"
BAD_ANSWER = "Timely's answer to {name} had an unexpected shape"


def search_ok(web_results: list[dict[str, Any]]) -> dict[str, Any]:
    return {"success": True, "data": {"web": web_results}}


def search_fail(error: str) -> dict[str, Any]:
    return {"success": False, "error": error}


def web_hit(url: str, title: str, description: str, position: int) -> dict[str, Any]:
    return {"url": url, "title": title, "description": description, "position": position}


def document(url: str, title: str, content: str) -> dict[str, Any]:
    return {"url": url, "title": title, "content": content, "raw_content": content,
            "metadata": {"sourceURL": url, "title": title}}


def page_error(url: str, error: str) -> dict[str, Any]:
    return {"url": url, "title": "", "content": "", "error": error}


def _str(value: Any, cap: int = TEXT_CAP) -> str:
    return value[:cap] if isinstance(value, str) else ""


def _http(url: Any) -> bool:
    return isinstance(url, str) and url.strip().lower().startswith(("http://", "https://"))


def search(result: Any, limit: int) -> dict[str, Any]:
    """``{answer, results: [{url, title, description}]}`` -> ``{success, data: {web: [...], answer?}}``.

    Rows without an http(s) URL are dropped, at most ``limit`` rows are kept, positions are
    1-based. A non-empty ``answer`` (the chat provider's own search writes one, Q-3.8) is kept
    beside the rows as ``data.answer``. ``{error}`` becomes ``{success: false, error}``."""
    if not isinstance(result, dict):
        return search_fail(BAD_ANSWER.format(name="web_search"))
    if result.get("error"):
        return search_fail(str(result["error"]))
    rows = result.get("results") if isinstance(result.get("results"), list) else []
    try:
        limit = max(int(limit), 1)
    except (TypeError, ValueError):
        limit = 5
    hits: list[dict[str, Any]] = []
    for row in rows:
        if len(hits) >= limit:
            break
        if isinstance(row, dict) and _http(row.get("url")):
            hits.append(web_hit(row["url"].strip(), _str(row.get("title"), 500),
                                _str(row.get("description"), 2000), len(hits) + 1))
    out = search_ok(hits)
    answer = _str(result.get("answer"), 20_000).strip()
    if answer:
        out["data"]["answer"] = answer
    return out


def extract(urls: list[str], result: Any) -> list[dict[str, Any]]:
    """``{pages: [{url, title, content, error}]}`` -> one Hermes extract entry per requested URL,
    in request order. A page is matched to its URL by ``url``, else by position; a page with
    ``error`` is a per-URL failure (its content kept, as Hermes' vendors keep an error page); a
    URL Go left out gets ``NO_PAGE``. ``{error}`` fails every URL with that text."""
    if not isinstance(result, dict):
        return [page_error(u, BAD_ANSWER.format(name="web_extract")) for u in urls]
    if result.get("error"):
        return [page_error(u, str(result["error"])) for u in urls]
    pages = [p for p in result.get("pages") or [] if isinstance(p, dict)] \
        if isinstance(result.get("pages"), list) else []
    by_url = {p["url"]: p for p in pages if isinstance(p.get("url"), str)}
    out = []
    for i, url in enumerate(urls):
        page = by_url.get(url)
        if page is None and i < len(pages) and not isinstance(pages[i].get("url"), str):
            page = pages[i]
        if page is None:
            out.append(page_error(url, NO_PAGE))
            continue
        title, content = _str(page.get("title"), 500), _str(page.get("content"))
        if page.get("error"):
            entry = page_error(url, str(page["error"]))
            entry["content"] = content
            out.append(entry)
        else:
            out.append(document(url, title, content))
    return out
