package chat

import _ "embed"

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

// replyCards is the system prompt's reply-card section, empty for apps that
// would show the program as raw text.
func replyCards(on bool) string {
	if !on {
		return ""
	}
	return "\n\n" + genuiPrompt
}
