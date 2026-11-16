package chat

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"timely-api/internal/agenthost"
	"timely-api/internal/features/bots"
)

func TestLearningResult(t *testing.T) {
	msg := func(body string) agenthost.Message {
		var m agenthost.Message
		if err := json.Unmarshal([]byte(body), &m); err != nil {
			t.Fatal(err)
		}
		m.Raw = json.RawMessage(body)
		return m
	}
	data, err := learningResult(msg(`{"type":"learning.result","id":"go-1","ok":true,"data":{"pending_ids":["p1"]}}`), nil)
	if err != nil || !strings.Contains(string(data), "p1") {
		t.Fatalf("ok: %s %v", data, err)
	}
	if _, err := learningResult(msg(`{"type":"learning.result","id":"go-1","ok":false,"data":{"message":"model failed"}}`), nil); !errors.Is(err, errReviewFailed) || !strings.Contains(err.Error(), "model failed") {
		t.Fatalf("failed: %v", err)
	}
	if _, err := learningResult(msg(`{"type":"pong","id":"go-1"}`), nil); err == nil {
		t.Fatal("a pong was a result")
	}
}

// Without the worker's own messages a tick keeps Go's record of it: the
// prompt and data it was handed, what it did and reported, and its reply.
func TestBotMessages(t *testing.T) {
	spec := botSpec{fields: map[string]any{"prompt": "Watch GPU prices", "data": map[string]any{"notes": map[string]string{"last": "499"}}}}
	res := bots.AgentResult{Response: "Price fell", Trace: []bots.ToolTrace{{Tool: "web_extract", Host: "shop.example", Outcome: "ok", Summary: "read the page"}},
		Reports: []bots.Report{{Title: "GPU at 449", Body: "Down 10%"}}}
	msgs := botMessages(spec, res)
	if len(msgs) != 3 {
		t.Fatalf("messages %s", msgs)
	}
	var first, second, last map[string]string
	_ = json.Unmarshal(msgs[0], &first)
	_ = json.Unmarshal(msgs[1], &second)
	_ = json.Unmarshal(msgs[2], &last)
	if first["role"] != "user" || !strings.HasPrefix(first["content"], "Watch GPU prices") || !strings.Contains(first["content"], `"last":"499"`) {
		t.Fatalf("user %v", first)
	}
	if second["role"] != "assistant" || !strings.Contains(second["content"], "web_extract (shop.example): ok") || !strings.Contains(second["content"], "Reported: GPU at 449") {
		t.Fatalf("did %v", second)
	}
	if last["role"] != "assistant" || last["content"] != "Price fell" {
		t.Fatalf("reply %v", last)
	}
}

// bot.run carries the Bot's skill slug and taught seed, never lessons; a
// bot.done's skill_created and messages reach the tick's result.
func TestBotRunSkillFields(t *testing.T) {
	a := &BotAgent{e: &WorkerEngine{}}
	spec, err := a.spec(t.Context(), "u1", bots.RunInput{CheckID: "chk", Bot: bots.Bot{ID: "bot_1", Prompt: "Watch"}, SkillSlug: "watch", TaughtSeed: "Only big"})
	if err != nil {
		t.Fatal(err)
	}
	if spec.fields["skill_slug"] != "watch" || spec.fields["taught_seed"] != "Only big" {
		t.Fatalf("fields %v", spec.fields)
	}
	if _, ok := spec.fields["lessons"]; ok {
		t.Fatal("bot.run still sends lessons")
	}
	var d botDone
	if err := json.Unmarshal([]byte(`{"skill_created":true,"messages":[{"role":"user","content":"x"}]}`), &d); err != nil {
		t.Fatal(err)
	}
	res := d.result(&botTick{}, false)
	if !res.SkillCreated || len(res.Messages) != 1 {
		t.Fatalf("result %+v", res)
	}
}
