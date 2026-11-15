package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/bots"
)

func proposalAlert(t *testing.T, w *threadWorld, alertID, proposal string) {
	t.Helper()
	a := bots.Alert{ID: alertID, BotID: "bot_1", UserID: "user-a", Kind: "alert", Title: "Pixel at 84999", Body: "Under your line", URL: "https://shop.example/p",
		ProposalState: bots.ProposalPending, Proposal: json.RawMessage(proposal), CreatedAt: time.Now().UTC()}
	if err := w.s.db.Create(&a).Error; err != nil {
		t.Fatal(err)
	}
}

func review(t *testing.T, w *threadWorld, alertID, action string) (int, ReviewResult) {
	t.Helper()
	code, body := serve(t, w.s, "POST", "/chat/bot-alerts/"+alertID+"/review", fmt.Sprintf(`{"action":%q}`, action))
	var res ReviewResult
	_ = json.Unmarshal(body, &res)
	return code, res
}

func tasks(w *threadWorld) int64 {
	var n int64
	w.s.db.Model(&testItem{}).Count(&n)
	return n
}

func stateOf(w *threadWorld, alertID string) string {
	var a bots.Alert
	if err := w.s.db.First(&a, "id = ?", alertID).Error; err != nil {
		w.t.Fatal(err)
	}
	return a.ProposalState
}

const addTask = `{"summary":"Add the task","steps":[{"tool":"create_task","summary":"Buy the Pixel","arguments":{"name":"Buy the Pixel"}}]}`

// Approve applies the proposal through the model-free apply with a receipt and
// Undo; a second approve is a no-op; Undo moves the card to undone.
func TestIntegrationReviewApproveAppliesOnceWithReceiptAndUndo(t *testing.T) {
	w := newThreadWorld(t)
	proposalAlert(t, w, "balert_1", addTask)
	if tasks(w) != 0 {
		t.Fatal("the proposal applied before approval")
	}
	code, res := review(t, w, "balert_1", "approve")
	if code != 200 || res.State != bots.ProposalApplied || res.ConversationID == "" || res.MessageID == "" {
		t.Fatalf("approve %d %+v", code, res)
	}
	if tasks(w) != 1 || stateOf(w, "balert_1") != bots.ProposalApplied {
		t.Fatalf("%d tasks, state %s", tasks(w), stateOf(w, "balert_1"))
	}
	// The receipt: a chat tainted by the Bot, its plan done and its proposal
	// message undoable.
	var receipt Conversation
	if err := w.s.db.First(&receipt, "id = ?", res.ConversationID).Error; err != nil {
		t.Fatal(err)
	}
	if receipt.FromBotID == nil || *receipt.FromBotID != "bot_1" || len(receipt.TaintedSources) != 1 || receipt.TaintedSources[0].Kind != "bot" || receipt.TaintedSources[0].BotID != "bot_1" {
		t.Fatalf("receipt provenance: %+v %+v", receipt.FromBotID, receipt.TaintedSources)
	}
	if receipt.Status != "idle" || len(receipt.Plan) != 1 || receipt.Plan[0].Status != "done" {
		t.Fatalf("receipt %s %+v", receipt.Status, receipt.Plan)
	}
	proposalMessage := latestProposal(receipt.Messages)
	if proposalMessage == nil || !proposalMessage.AutoApplied || proposalMessage.ID != res.MessageID || proposalMessage.UndoReads == nil {
		t.Fatalf("the receipt's change is not undoable: %+v", proposalMessage)
	}
	// A second approve changes nothing.
	if code, again := review(t, w, "balert_1", "approve"); code != 200 || again.State != bots.ProposalApplied || tasks(w) != 1 {
		t.Fatalf("second approve %d %+v, %d tasks", code, again, tasks(w))
	}
	// Discarding what is applied is refused: Undo is the way back.
	if code, _ := review(t, w, "balert_1", "discard"); code != 409 || tasks(w) != 1 {
		t.Fatalf("discard of an applied card gave %d", code)
	}
	// Undo through the chat's own route.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go w.s.work(ctx)
	code, body := serve(t, w.s, "POST", "/chats/"+res.ConversationID+"/undo", fmt.Sprintf(`{"messageId":%q}`, res.MessageID))
	if code != 200 {
		t.Fatalf("undo %d %s", code, body)
	}
	for deadline := time.Now().Add(10 * time.Second); tasks(w) != 0 && time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
	}
	if tasks(w) != 0 {
		t.Fatal("the undo did not remove the task")
	}
	cards := itemsOf(w.threadAfterPost("balert_1"), "alert")
	if len(cards) != 1 || cards[0].Review == nil || cards[0].Review.State != bots.ProposalUndone || stateOf(w, "balert_1") != bots.ProposalUndone {
		t.Fatalf("the card reads %+v, state %s", cards, stateOf(w, "balert_1"))
	}
	// Undone, an approve is a no-op too.
	if code, again := review(t, w, "balert_1", "approve"); code != 200 || again.State != bots.ProposalUndone || tasks(w) != 0 {
		t.Fatalf("approve after undo %d %+v", code, again)
	}
}

func (w *threadWorld) threadAfterPost(alertID string) ThreadView {
	w.t.Helper()
	if err := w.s.PostAlert(context.Background(), "user-a", "bot_1", alertID); err != nil {
		w.t.Fatal(err)
	}
	return w.view("bot_1")
}

// Discard applies nothing; after it, approve is refused and a second discard
// is a no-op.
func TestIntegrationReviewDiscardAppliesNothing(t *testing.T) {
	w := newThreadWorld(t)
	proposalAlert(t, w, "balert_1", addTask)
	code, res := review(t, w, "balert_1", "discard")
	if code != 200 || res.State != bots.ProposalDismissed || tasks(w) != 0 || res.ConversationID != "" {
		t.Fatalf("discard %d %+v, %d tasks", code, res, tasks(w))
	}
	if code, _ := review(t, w, "balert_1", "approve"); code != 409 || tasks(w) != 0 {
		t.Fatalf("approve after discard gave %d", code)
	}
	if code, again := review(t, w, "balert_1", "discard"); code != 200 || again.State != bots.ProposalDismissed {
		t.Fatalf("second discard %d %+v", code, again)
	}
	if stateOf(w, "balert_1") != bots.ProposalDismissed {
		t.Fatalf("state %s", stateOf(w, "balert_1"))
	}
	var chats int64
	w.s.db.Model(&Conversation{}).Where("id = ?", reviewChatID("balert_1")).Count(&chats)
	if chats != 0 {
		t.Fatal("a discarded proposal made an apply chat")
	}
}

// A proposal that cannot stand (an unknown tool) fails the card, and nothing
// applies.
func TestIntegrationReviewFailsAProposalThatCannotApply(t *testing.T) {
	w := newThreadWorld(t)
	proposalAlert(t, w, "balert_1", `{"tool":"drop_everything","args":{"x":1}}`)
	code, res := review(t, w, "balert_1", "approve")
	if code != 200 || res.State != bots.ProposalFailed || res.Error == "" || tasks(w) != 0 {
		t.Fatalf("approve %d %+v", code, res)
	}
	if code, _ := review(t, w, "balert_1", "approve"); code != 409 {
		t.Fatalf("a failed card approved again gave %d", code)
	}
	if code, _ := review(t, w, "missing", "approve"); code != 404 {
		t.Fatalf("an unknown alert gave %d", code)
	}
	if code, _ := review(t, w, "balert_1", "bogus"); code != 400 && code != 409 {
		t.Fatalf("a bad action gave %d", code)
	}
}

// Two taps at once apply the proposal once.
func TestIntegrationReviewConcurrentApprovesApplyOnce(t *testing.T) {
	w := newThreadWorld(t)
	proposalAlert(t, w, "balert_1", addTask)
	done := make(chan ReviewResult, 2)
	for i := 0; i < 2; i++ {
		go func() {
			res, err := w.s.ReviewAlert(context.Background(), "user-a", "balert_1", reviewApprove)
			if err != nil {
				res.Error = err.Error()
			}
			done <- res
		}()
	}
	a, b := <-done, <-done
	if tasks(w) != 1 || (a.State != bots.ProposalApplied && b.State != bots.ProposalApplied) {
		t.Fatalf("%d tasks, results %+v %+v", tasks(w), a, b)
	}
}

// "Do this in chat" makes a separate chat from the alert, tainted by the Bot
// and seeded with the request.
func TestIntegrationDoInChatSeedsATaintedChat(t *testing.T) {
	w := newThreadWorld(t)
	proposalAlert(t, w, "balert_1", addTask)
	code, body := serve(t, w.s, "POST", "/chat/bot-alerts/balert_1/do-in-chat", `{"request":"Order it for me","requestId":"req_1"}`)
	var out struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal(body, &out)
	if code != 201 || out.ConversationID == "" {
		t.Fatalf("do in chat %d %s", code, body)
	}
	var chat Conversation
	if err := w.s.db.First(&chat, "id = ?", out.ConversationID).Error; err != nil {
		t.Fatal(err)
	}
	if chat.Kind != KindChat || chat.FromBotID == nil || *chat.FromBotID != "bot_1" || chat.BotID != nil {
		t.Fatalf("kind %s from %v bot %v", chat.Kind, chat.FromBotID, chat.BotID)
	}
	if len(chat.TaintedSources) != 1 || chat.TaintedSources[0] != (TaintSource{Kind: "bot", BotID: "bot_1"}) {
		t.Fatalf("tainted %+v", chat.TaintedSources)
	}
	if chat.Status != "queued" || len(chat.Messages) != 1 || chat.Messages[0].Role != "user" {
		t.Fatalf("chat %s %+v", chat.Status, chat.Messages)
	}
	seed := chat.Messages[0].Content
	for _, want := range []string{"Order it for me", "Pixel at 84999", "Under your line"} {
		if !strings.Contains(seed, want) {
			t.Errorf("the seed lacks %q: %s", want, seed)
		}
	}
	// The same request id gives the same chat.
	_, again := serve(t, w.s, "POST", "/chat/bot-alerts/balert_1/do-in-chat", `{"request":"Order it for me","requestId":"req_1"}`)
	var second struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal(again, &second)
	if second.ConversationID != out.ConversationID {
		t.Fatalf("a repeat made another chat: %s vs %s", second.ConversationID, out.ConversationID)
	}
	if code, _ := serve(t, w.s, "POST", "/chat/bot-alerts/missing/do-in-chat", `{}`); code != 404 {
		t.Fatalf("an unknown alert gave %d", code)
	}
	// It is a normal chat in the chat list.
	_, list := serve(t, w.s, "GET", "/chats", "")
	if !strings.Contains(string(list), out.ConversationID) {
		t.Fatalf("the chat is not listed: %s", list)
	}
}
