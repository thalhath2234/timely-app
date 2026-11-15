package chat

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
)

func TestChatHoldingMakesBotAcquireFail(t *testing.T) {
	l := NewBrowserLease()
	if !l.TryAcquireBot("u", "c1") || l.Holder("u") != BotHolder("c1") {
		t.Fatal("a free browser is not taken by a bot")
	}
	l.Release("u", BotHolder("c1"))
	if pre := l.AcquireChat("u", "r1"); !pre.None() {
		t.Fatalf("preempted %+v", pre)
	}
	if l.TryAcquireBot("u", "c2") || !l.Busy("u") || !l.ChatHolds("u") || l.Holder("u") != ChatHolder("r1") {
		t.Fatal("a chat holding does not win")
	}
	// Another account is not affected.
	if !l.TryAcquireBot("other", "c3") {
		t.Fatal("another account was blocked")
	}
	l.Release("u", ChatHolder("r1"))
	if !l.TryAcquireBot("u", "c2") {
		t.Fatal("not free after the chat released")
	}
}

func TestChatPreemptsABotHolder(t *testing.T) {
	l := NewBrowserLease()
	l.TryAcquireBot("u", "c1")
	pre := l.AcquireChat("u", "r1")
	if pre != BotHolder("c1") {
		t.Fatalf("preempted %+v", pre)
	}
	if l.Holder("u") != ChatHolder("r1") || !l.Preempted("u", "c1") {
		t.Fatal("chat does not hold, or the bot is not marked preempted")
	}
	// The preempted Check stays refused after the chat leaves, until it releases.
	l.Release("u", ChatHolder("r1"))
	if l.TryAcquireBot("u", "c1") {
		t.Fatal("a preempted check got the browser back")
	}
	l.Release("u", BotHolder("c1"))
	if l.Preempted("u", "c1") || !l.TryAcquireBot("u", "c2") {
		t.Fatal("not free after the preempted check released")
	}
}

func TestBotHoldIsExclusiveAmongBots(t *testing.T) {
	l := NewBrowserLease()
	if !l.TryAcquireBot("u", "c1") || !l.TryAcquireBot("u", "c1") {
		t.Fatal("the holder cannot ask again")
	}
	if l.TryAcquireBot("u", "c2") {
		t.Fatal("a second Check took a held browser")
	}
	if !l.Busy("u") || l.ChatHolds("u") {
		t.Fatal("busy/chat reading wrong")
	}
}

func TestSeveralChatsShareTheBrowser(t *testing.T) {
	l := NewBrowserLease()
	l.AcquireChat("u", "r1")
	l.AcquireChat("u", "r2")
	l.AcquireChat("u", "r1")
	l.Release("u", ChatHolder("r1"))
	if !l.ChatHolds("u") || l.TryAcquireBot("u", "c") {
		t.Fatal("the second chat lost the browser")
	}
	l.Release("u", ChatHolder("r2"))
	if l.Busy("u") {
		t.Fatal("still busy")
	}
}

func TestReleaseIsIdempotent(t *testing.T) {
	l := NewBrowserLease()
	l.Release("nobody", ChatHolder("r"))
	l.Release("nobody", BrowserHolder{})
	l.AcquireChat("u", "r1")
	l.Release("u", ChatHolder("r1"))
	l.Release("u", ChatHolder("r1"))
	l.Release("u", BotHolder("c9"))
	if l.Busy("u") || !l.Holder("u").None() {
		t.Fatal("busy after release")
	}
	// A release of a holder that is not the holder does not free the real one.
	l.TryAcquireBot("u", "c1")
	l.Release("u", BotHolder("c2"))
	l.Release("u", ChatHolder("c1"))
	if l.Holder("u") != BotHolder("c1") {
		t.Fatal("a stranger's release freed the holder")
	}
	l.Release("u", BotHolder("c1"))
	l.Release("u", BotHolder("c1"))
	if l.Busy("u") {
		t.Fatal("busy")
	}
	if len(l.held) != 0 {
		t.Fatalf("leaked state: %d accounts", len(l.held))
	}
}

// Under -race: many bots race for one free browser and exactly one wins; a
// chat acquiring afterwards is always the holder; chats and bots together
// leave no state behind.
func TestConcurrentAcquiresKeepOneHolder(t *testing.T) {
	l := NewBrowserLease()
	var wins atomic.Int32
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if l.TryAcquireBot("u", fmt.Sprintf("c%d", i)) {
				wins.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()
	if wins.Load() != 1 {
		t.Fatalf("%d bots hold the browser", wins.Load())
	}
	l.AcquireChat("u", "r1")
	if l.Holder("u") != ChatHolder("r1") {
		t.Fatal("the chat did not win")
	}

	l2 := NewBrowserLease()
	start = make(chan struct{})
	for i := range 40 {
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			l2.AcquireChat("u", fmt.Sprintf("r%d", i))
			l2.Release("u", ChatHolder(fmt.Sprintf("r%d", i)))
		}()
		go func() {
			defer wg.Done()
			<-start
			id := fmt.Sprintf("c%d", i)
			l2.TryAcquireBot("u", id)
			l2.Busy("u")
			l2.Holder("u")
			l2.Release("u", BotHolder(id))
		}()
	}
	close(start)
	wg.Wait()
	if l2.Busy("u") || len(l2.held) != 0 {
		t.Fatalf("state left behind: busy=%v accounts=%d", l2.Busy("u"), len(l2.held))
	}
}
