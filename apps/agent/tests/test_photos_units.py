"""Phase 8 (Q7) unit tests without Hermes: ``run.start.images`` shapes and content parts, the
vision check, and the rule that a Sensitive chat is always no-persist."""

from __future__ import annotations

import base64

from timely_agent import images, no_persist
from timely_agent.run_chat import no_persist as run_is_no_persist
from timely_agent.worker import run_start_problem

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode()
OK = {"toolsets": ["timely", "todo"], "model": {"provider": "custom", "supports_vision": True}}


def test_images_shapes():
    one = {"mime": "image/png", "data_b64": PNG}
    assert images.problem(None) is None
    assert images.problem([]) is None
    assert images.problem([one] * images.MAX_IMAGES) is None
    big = base64.b64encode(b"0" * (images.MAX_BYTES + 1)).decode()
    for bad in ("x", [one] * (images.MAX_IMAGES + 1), ["x"], [{"mime": "image/svg+xml", "data_b64": PNG}],
                [{"mime": "image/png"}], [{"mime": "image/png", "data_b64": ""}],
                [{"mime": "image/png", "data_b64": "@@@"}], [{"mime": "image/png", "data_b64": big}]):
        assert images.problem(bad), bad
    exact = base64.b64encode(b"0" * images.MAX_BYTES).decode()
    assert images.problem([{"mime": "image/webp", "data_b64": exact}]) is None


def test_user_content_is_text_then_one_part_per_photo():
    assert images.user_content("hi", []) == "hi"
    parts = images.user_content("hi", [{"mime": "image/png", "data_b64": PNG}, {"mime": "image/gif", "data_b64": "R0"}])
    assert parts == [{"type": "text", "text": "hi"},
                     {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{PNG}"}},
                     {"type": "image_url", "image_url": {"url": "data:image/gif;base64,R0"}}]
    assert images.user_content("", [{"mime": "image/png", "data_b64": PNG}])[0]["type"] == "image_url"


def test_vision_check_needs_go_to_say_the_model_reads_images():
    photo = [{"mime": "image/png", "data_b64": PNG}]
    assert images.vision_problem({"model": {"supports_vision": True}, "images": photo}) is None
    assert images.vision_problem({"model": {}, "images": []}) is None  # no photos, no check
    for model in ({}, {"supports_vision": False}, {"supports_vision": "true"}, None):
        assert images.vision_problem({"model": model, "images": photo}) == images.VISION_MISSING, model


def test_vouch_is_per_agent_and_taken_back():
    class Agent:
        def _model_supports_vision(self):
            return False

    agent = Agent()
    images.vouch(agent, True)
    assert agent._model_supports_vision() is True and Agent()._model_supports_vision() is False
    images.vouch(agent, False)
    assert agent._model_supports_vision() is False
    images.vouch(agent, False)  # nothing to take back


def test_a_sensitive_chat_is_always_no_persist():
    assert no_persist.wanted({"flags": {"sensitive": True}})
    assert no_persist.wanted({"flags": {"no_persist": True}})
    assert no_persist.wanted({"no_persist": True, "flags": {}})
    assert not no_persist.wanted({"flags": {"sensitive": False, "no_persist": False}})
    assert not no_persist.wanted({})
    msg = {"flags": {"sensitive": True, "web": False}}
    assert no_persist.mark(msg) is True and msg["flags"] == {"sensitive": True, "web": False, "no_persist": True}
    plain = {"flags": {"web": True}}
    assert no_persist.mark(plain) is False and plain == {"flags": {"web": True}}
    top = {"no_persist": True}
    assert no_persist.mark(top) and top["flags"] == {"no_persist": True}
    assert run_is_no_persist({"flags": {"sensitive": True}})


def test_run_start_checks_images_and_sensitive_toolsets():
    photo = [{"mime": "image/png", "data_b64": PNG}]
    assert run_start_problem({**OK, "images": photo, "flags": {"sensitive": True}}) is None
    assert run_start_problem({**OK, "no_persist": True}) is None
    assert "images" in run_start_problem({**OK, "images": photo * 5})
    assert run_start_problem({**OK, "no_persist": "yes"}) == "no_persist must be a bool"
    for flags, extra in (({"sensitive": True}, {}), ({}, {"no_persist": True})):
        problem = run_start_problem({**OK, **extra, "toolsets": ["timely", "todo", "skills"], "flags": flags})
        assert problem and "no-persist" in problem, (flags, extra)
    # a chat that is not Sensitive keeps its toolsets
    assert run_start_problem({**OK, "toolsets": ["timely", "todo", "skills"], "flags": {"sensitive": False}}) is None
