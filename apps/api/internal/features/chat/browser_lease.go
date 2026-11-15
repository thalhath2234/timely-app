package chat

import (
	"slices"
	"sync"
)

// The per-account browser lease (Q-B2: a chat holding the browser wins). The
// person has one signed-in browser, so a chat run and a bot Check never use it
// at once. A chat always takes it, preempting a bot; a bot only takes it free.
// A bot Check that needs the browser while a chat holds it is skipped and
// recorded as "browser busy"; a Check a chat preempted has its next browser
// call refused the same way, for the rest of the tick.

// Holders of the browser lease.
const (
	HolderChat = "chat"
	HolderBot  = "bot"
)

// BrowserHolder is who holds the browser: a chat run (ID: the run id) or a
// bot Check (ID: the check id). The zero value is nobody.
type BrowserHolder struct {
	Kind string
	ID   string
}

// ChatHolder is the holder for a chat run.
func ChatHolder(runID string) BrowserHolder { return BrowserHolder{Kind: HolderChat, ID: runID} }

// BotHolder is the holder for a bot Check.
func BotHolder(checkID string) BrowserHolder { return BrowserHolder{Kind: HolderBot, ID: checkID} }

// None reports whether h is nobody.
func (h BrowserHolder) None() bool { return h.Kind == "" }

// accountLease is one account's lease. Several chat runs may hold it (they
// share the person's attention); one bot Check holds it only while no chat does.
type accountLease struct {
	chats     []string
	bot       string
	preempted map[string]bool
}

func (a *accountLease) empty() bool {
	return len(a.chats) == 0 && a.bot == "" && len(a.preempted) == 0
}

// BrowserLease is every account's browser lease, in memory: a restart frees
// all of them (the browser itself restarts with the worker).
type BrowserLease struct {
	mu   sync.Mutex
	held map[string]*accountLease
}

// NewBrowserLease is an empty lease table.
func NewBrowserLease() *BrowserLease {
	return &BrowserLease{held: map[string]*accountLease{}}
}

func (l *BrowserLease) account(uid string) *accountLease {
	a := l.held[uid]
	if a == nil {
		a = &accountLease{}
		l.held[uid] = a
	}
	return a
}

func (l *BrowserLease) trim(uid string, a *accountLease) {
	if a.empty() {
		delete(l.held, uid)
	}
}

// AcquireChat takes the browser for a chat run. A chat always wins: a bot
// Check holding it is preempted and returned (zero when there was none), and
// stays refused until it releases. Taking it again for the same run is a no-op.
func (l *BrowserLease) AcquireChat(uid, runID string) (preempted BrowserHolder) {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.account(uid)
	if !slices.Contains(a.chats, runID) {
		a.chats = append(a.chats, runID)
	}
	if a.bot != "" {
		preempted = BotHolder(a.bot)
		if a.preempted == nil {
			a.preempted = map[string]bool{}
		}
		a.preempted[a.bot] = true
		a.bot = ""
	}
	return preempted
}

// TryAcquireBot takes the browser for a bot Check when no chat holds it and no
// other Check does. The Check that holds it already gets true again; a Check a
// chat preempted gets false until it releases.
func (l *BrowserLease) TryAcquireBot(uid, checkID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.account(uid)
	defer l.trim(uid, a)
	switch {
	case a.preempted[checkID], len(a.chats) > 0:
		return false
	case a.bot == checkID:
		return true
	case a.bot != "":
		return false
	}
	a.bot = checkID
	return true
}

// Release lets go of the lease for one holder. It is safe to call twice, for a
// holder that never held it, and for a Check that was preempted (it also clears
// that mark, so the id is free to be asked again).
func (l *BrowserLease) Release(uid string, h BrowserHolder) {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.held[uid]
	if a == nil {
		return
	}
	switch h.Kind {
	case HolderChat:
		a.chats = slices.DeleteFunc(a.chats, func(id string) bool { return id == h.ID })
	case HolderBot:
		if a.bot == h.ID {
			a.bot = ""
		}
		delete(a.preempted, h.ID)
	}
	l.trim(uid, a)
}

// Busy reports whether anybody holds the account's browser, so a bot Check
// that needs it is skipped. (bots.Agent.BrowserBusy.)
func (l *BrowserLease) Busy(uid string) bool { return !l.Holder(uid).None() }

// ChatHolds reports whether a chat run holds the account's browser.
func (l *BrowserLease) ChatHolds(uid string) bool { return l.Holder(uid).Kind == HolderChat }

// Preempted reports whether a chat took the browser from this Check during
// its tick.
func (l *BrowserLease) Preempted(uid, checkID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.held[uid]
	return a != nil && a.preempted[checkID]
}

// Holder is who holds the account's browser: a chat run (the first to take it)
// before a bot Check, or nobody.
func (l *BrowserLease) Holder(uid string) BrowserHolder {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.held[uid]
	switch {
	case a == nil:
		return BrowserHolder{}
	case len(a.chats) > 0:
		return ChatHolder(a.chats[0])
	case a.bot != "":
		return BotHolder(a.bot)
	}
	return BrowserHolder{}
}
