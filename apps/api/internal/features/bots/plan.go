package bots

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// checkPlan is what a check decided before its save: which fired items go
// on to other Bots, and the judge's verdict on the rest, or why AI did not
// judge them.
type checkPlan struct {
	taken      map[itemKey][]linkTarget
	judgedKeys []string // eventKeys of what the judge was asked about, sorted
	verdict    *Verdict
	aiState    string // "", aiJudged or aiUnchecked
	aiNote     string // why it is unchecked
	aiInput    json.RawMessage
}

// asked reports whether AI was asked about this check (or would have been).
func (p checkPlan) asked() bool { return p.aiState != "" }

// planCheck runs, between the reads and the save, what must not run inside
// the save's transaction: which fired items the Bot's links take (decided
// here, deterministically, so the save applies the same), and for an
// AI-judged Bot whose rules fired on a dry run on items no link took, one
// judge call within the caps. Only database errors are returned. The claim
// fence keeps the rule state fixed until the save, which applies the
// verdict only to the same set of fired rules.
func (s *Service) planCheck(ctx context.Context, c *checkRun) error {
	b := c.bot
	db := s.db.WithContext(ctx)
	var links []linkTarget
	if c.depth+1 <= ChainSteps {
		var err error
		if links, err = passLinks(db, b); err != nil {
			return err
		}
	}
	if b.JudgeMode != JudgeAI && len(links) == 0 {
		return nil
	}
	fired := dryRun(c.reads)
	if len(fired) == 0 {
		return nil
	}
	c.plan.taken = takeItems(fired, links, c.depth)
	fired = untaken(fired, c.plan.taken)
	if b.JudgeMode != JudgeAI || len(fired) == 0 {
		return nil
	}
	now := s.now().UTC()
	lessons, last, at, err := judgeContext(db, b, now)
	if err != nil {
		return err
	}
	in := buildJudgeInput(b, lessons, last, fired, nil, at)
	timeout := JudgeTimeout
	if c.trigger == TriggerAsk {
		timeout = AskJudgeTimeout
	}
	return s.judgeInto(ctx, &c.plan, b, c.chainID, eventKeys(fired), in, timeout, now)
}

// judgeInto asks the judge about in for b within the caps, and records in p
// what came of it: the verdict, or why AI did not judge (with the input
// kept for a re-judge when asking again can help). The doc or sheet is read
// only here, for a judge call, and only as data.
func (s *Service) judgeInto(ctx context.Context, p *checkPlan, b Bot, chainID string, keys []string, in JudgeInput, timeout time.Duration, now time.Time) error {
	p.judgedKeys = keys
	p.aiState = aiUnchecked
	if s.judge == nil {
		p.aiNote = noteNoProvider
		return nil
	}
	callID, err := s.reserveAI(ctx, b, chainID, purposeJudge, now)
	switch {
	case errors.Is(err, errAICap):
		p.aiNote = noteUsedUp
		return nil
	case err != nil:
		return err
	}
	if k := s.readKnowledge(ctx, b); k != nil {
		in.Knowledge = k
		in = clipJudgeInput(in, judgeMaxInput)
	}
	v, err := s.callJudge(ctx, b.UserID, in, timeout)
	s.markAI(callID, err == nil, !errors.Is(err, ErrJudgeOff))
	switch {
	case err == nil:
		p.verdict, p.aiState = &v, aiJudged
	case errors.Is(err, ErrJudgeOff):
		p.aiNote = s.offNote(ctx, b.UserID)
	default:
		p.aiNote = noteLater
		raw, merr := json.Marshal(JudgeJob{ChainID: chainID, Input: in})
		if merr != nil {
			return merr
		}
		p.aiInput = raw
	}
	return nil
}

// dryRun evaluates every clean reading as the save will, without saving:
// the rules that would fire. Watches recording a baseline, a 304 and
// watches never read are skipped, as the save skips them.
func dryRun(reads []watchRead) []firedEvent {
	var fired []firedEvent
	for _, r := range reads {
		if r.err != nil || r.notMod || r.w.BaselinePending || r.w.LastReading == nil {
			continue
		}
		evs, _, _ := evaluateWatch(r.w, clipReading(r.reading, MaxReadingBytes))
		fired = append(fired, evs...)
	}
	return fired
}
