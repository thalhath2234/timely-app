package chat

import (
	_ "embed"
	"strings"
)

// genuiPrompt teaches the model reply cards: OpenUI Lang programs in a fenced
// block that the apps draw with their own components. It is generated from
// packages/contract/src/genui.ts by `make gen-genui-prompt`; edit that file,
// not this text.
//
//go:embed genui_prompt.txt
var genuiPrompt string

// genuiCapability is what an app sends as `ui` when it can draw reply cards
// (GENUI_CAPABILITY in the contract).
const genuiCapability = "openui-1"

// genuiFence is the code fence language of a reply card program (GENUI_FENCE).
const genuiFence = "openui-lang"

// replyCards is the system prompt's reply-card section. Apps that would show
// a program as raw text get none, and a plain-text rule when earlier replies
// in the conversation carried cards the model might copy.
func replyCards(on bool, messages []Message) string {
	if on {
		return "\n\n" + genuiPrompt
	}
	for _, m := range messages {
		if m.Role == "assistant" && strings.Contains(m.Content, "```"+genuiFence) {
			return "\nThis app can't draw reply cards: answer in plain text, without ```" + genuiFence + " blocks, even where earlier replies had them."
		}
	}
	return ""
}
