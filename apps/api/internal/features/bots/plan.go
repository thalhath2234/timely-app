package bots

import (
	"context"
	"encoding/json"
	"errors"
)

// checkPlan is what a check decided before its save: the judge's verdict on
// the rules that fired, or why AI did not judge them.
type checkPlan struct {
	judgedKeys []string // eventKeys of what the judge was asked about, sorted
	verdict    *Verdict
	aiState    string // "", aiJudged or aiUnchecked
	aiNote     string // why it is unchecked
	aiInput    json.RawMessage
}

// asked reports whether AI was asked about this check (or would have been).
func (p checkPlan) asked() bool { return p.aiState != "" }

// planCheck runs, between the reads and the save, what must not run inside
// the save's transaction: for an AI-judged Bot whose rules fired on a dry
// run, one judge call within the caps. Only database errors are returned.
// The claim fence keeps the rule state fixed until the save, which applies
// the verdict only to the same set of fired rules.
func (s *Service) planCheck(ctx context.Context, c *checkRun) error {
	b := c.bot
	if b.JudgeMode != JudgeAI {
		return nil
	}
	fired := dryRun(c.reads)
	if len(fired) == 0 {
		return nil
	}
	now := s.now().UTC()
	db := s.db.WithContext(ctx)
	lessons, last, at, err := judgeContext(db, b, now)
	if err != nil {
		return err
	}
	c.plan.judgedKeys = eventKeys(fired)
	c.plan.aiState = aiUnchecked
	if s.judge == nil {
		c.plan.aiNote = noteNoProvider
		return nil
	}
	callID, err := s.reserveAI(ctx, b, c.chainID, purposeJudge, now)
	switch {
	case errors.Is(err, errAICap):
		c.plan.aiNote = noteUsedUp
		return nil
	case err != nil:
		return err
	}
	// The doc or sheet is read only for a judge call, and only as data.
	in := buildJudgeInput(b, lessons, last, fired, s.readKnowledge(ctx, b), at)
	timeout := JudgeTimeout
	if c.trigger == TriggerAsk {
		timeout = AskJudgeTimeout
	}
	v, err := s.callJudge(ctx, b.UserID, in, timeout)
	s.markAI(callID, err == nil, !errors.Is(err, ErrJudgeOff))
	switch {
	case err == nil:
		c.plan.verdict, c.plan.aiState = &v, aiJudged
	case errors.Is(err, ErrJudgeOff):
		c.plan.aiNote = s.offNote(ctx, b.UserID)
	default:
		c.plan.aiNote = noteLater
		raw, merr := json.Marshal(JudgeJob{ChainID: c.chainID, Input: in})
		if merr != nil {
			return merr
		}
		c.plan.aiInput = raw
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
