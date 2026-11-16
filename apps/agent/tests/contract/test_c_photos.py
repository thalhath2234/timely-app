"""Photo and Sensitive chats on the agent engine (phase 8, Q7; PROTOCOL.md section 15).

- A ``run.start`` with ``images`` reaches the model as image content: the turn's user message is a
  list of content parts with one ``image_url`` (a ``data:`` URL) per photo.
- A Sensitive chat is always no-persist: ``flags.sensitive`` alone (no ``no_persist`` anywhere,
  no environment switch) leaves the account home unchanged, photos included.
- A model Go did not mark ``supports_vision`` fails the run with a reason, before any model call.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import harness

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_c_no_persist import changed, session_rows, snapshot  # noqa: E402

# A 1x1 PNG.
PNG = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
SECRET = "heronquill-photo-8812"


def vision_model(stub) -> dict:
    return {**harness.model_cfg(stub), "supports_vision": True}


def posts_with(stub, tag: str) -> list[dict]:
    return [r for r in stub.requests if r["method"] == "POST" and tag in json.dumps(r["body"].get("messages"))]


def last_user(request: dict):
    return [m for m in request["body"]["messages"] if m.get("role") == "user"][-1]["content"]


def test_photos_reach_the_model_as_image_content(stub):
    a = harness.Agent(harness.new_root("cph"))
    w, ready = harness.ready_worker(a, hello={"timely_tools": harness.timely_tools()})
    try:
        assert ready["self_test"]["ok"], ready["self_test"]
        jpeg = base64.b64encode(b"\xff\xd8\xff\xe0" + b"0" * 64).decode()
        images = [{"mime": "image/png", "data_b64": PNG}, {"mime": "image/jpeg", "data_b64": jpeg}]
        w.send(harness.run_start(a, stub, run_id="cph-1", conversation="c-ph", text="what is this tag-cph-1",
                                 budgets={}, toolsets=["timely", "todo"], model=vision_model(stub), images=images,
                                 flags={"sensitive": True}))
        done, _ = harness.drive(w, a.account, "cph-1")
        assert done["completed"] is True and "error" not in done, done
        sent = posts_with(stub, "tag-cph-1")
        assert sent, "the turn never reached the model"
        content = last_user(sent[0])
        assert isinstance(content, list), content
        assert content[0] == {"type": "text", "text": "what is this tag-cph-1"}, content[0]
        urls = [p["image_url"]["url"] for p in content if p.get("type") == "image_url"]
        assert urls == [f"data:image/png;base64,{PNG}", f"data:image/jpeg;base64,{jpeg}"], urls
    finally:
        w.close()


def test_a_sensitive_chat_with_photos_leaves_the_home_unchanged(stub):
    """No ``no_persist`` flag and no environment switch: ``flags.sensitive`` alone makes the run
    no-persist. A warm home (the account's ordinary chat served the endpoint first) is unchanged
    after two Sensitive turns with a photo and a tool call: no state.db row, memory, skill or log."""
    a = harness.Agent(harness.new_root("cph-np"))
    w, ready = harness.ready_worker(a, hello={"timely_tools": harness.timely_tools()})
    try:
        assert ready["self_test"]["ok"], ready["self_test"]
        w.send(harness.run_start(a, stub, run_id="cphn-warm", conversation="c-warm", text="hello there", budgets={},
                                 toolsets=["timely", "todo", "memory"], flags={"learning_writes": True}))
        harness.drive(w, a.account, "cphn-warm")
        rows = session_rows(a.home)
        before = snapshot(a.home)
        history: list[dict] = []
        todo = json.dumps({"todos": [{"id": "1", "content": f"{SECRET} receipt", "status": "in_progress"}]})
        seen_all: list[dict] = []
        for i, text in enumerate((f"CALL todo_list {todo}", f"read the photo {SECRET}")):
            w.send(harness.run_start(a, stub, run_id=f"cphn{i}", conversation="c-sens", text=text, budgets={},
                                     toolsets=["timely", "todo"], model=vision_model(stub),
                                     images=[{"mime": "image/png", "data_b64": PNG}],
                                     flags={"sensitive": True}, history=list(history)))
            done, seen = harness.drive(w, a.account, f"cphn{i}")
            assert done["completed"] is True and "error" not in done, done
            assert done["history_seeded"] is False
            seen_all += seen
            history += [{"role": "user", "content": text}, {"role": "assistant", "content": done["final_response"]}]
        after = snapshot(a.home)
        assert changed(before, after) == [], changed(before, after)
        assert session_rows(a.home) == rows
        assert not [m for m in seen_all if m.get("type") == "learning"], "a Sensitive run reported learning"
        assert not [p for p in a.home.rglob("*") if p.is_file()
                    and SECRET in p.read_text("utf-8", errors="replace")], "the chat's text is in the home"
    finally:
        w.close()


def test_a_sensitive_chat_takes_only_the_no_persist_toolsets(stub):
    a = harness.Agent(harness.new_root("cph-ts"))
    w, ready = harness.ready_worker(a)
    try:
        w.send(harness.run_start(a, stub, run_id="cphts", conversation="c-cphts", toolsets=["timely", "todo", "memory"],
                                 flags={"sensitive": True}))
        err, _ = w.until("error")
        assert err["code"] == "bad_message" and err.get("run") == "cphts" and "no-persist" in err["message"], err
    finally:
        w.close()


def test_a_model_without_vision_fails_the_run_with_a_reason(stub):
    a = harness.Agent(harness.new_root("cph-nv"))
    w, ready = harness.ready_worker(a)
    try:
        before = len(stub.requests)
        for i, model in enumerate((harness.model_cfg(stub), {**harness.model_cfg(stub), "supports_vision": False})):
            w.send(harness.run_start(a, stub, run_id=f"cphv{i}", conversation=f"c-nv{i}", text="tag-cphv",
                                     toolsets=["timely", "todo"], model=model, flags={"sensitive": True},
                                     images=[{"mime": "image/png", "data_b64": PNG}]))
            done, _ = harness.drive(w, a.account, f"cphv{i}")
            assert done["completed"] is False and done["error_kind"] == "no_vision", done
            assert "can't read photos" in done["error"], done
        assert not posts_with(stub, "tag-cphv") and len(stub.requests) == before, "a model call was made"
    finally:
        w.close()


def test_malformed_images_are_refused(stub):
    a = harness.Agent(harness.new_root("cph-bad"))
    w, ready = harness.ready_worker(a)
    try:
        png = {"mime": "image/png", "data_b64": PNG}
        for i, images in enumerate(([png] * 5, [{"mime": "image/svg+xml", "data_b64": PNG}],
                                    [{"mime": "image/png", "data_b64": "not base64!"}], "x")):
            w.send(harness.run_start(a, stub, run_id=f"cphb{i}", conversation=f"c-b{i}", toolsets=["timely", "todo"],
                                     model=vision_model(stub), images=images, flags={"sensitive": True}))
            err, _ = w.until("error")
            assert err["code"] == "bad_message" and err.get("run") == f"cphb{i}" and "images" in err["message"], err
    finally:
        w.close()
