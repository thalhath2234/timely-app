package chat

import (
	"context"
	"errors"
	"fmt"
	"log"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/agenthost"
)

// Question cards (phase 4, Q-4.3, PROTOCOL.md section 11.2): the agent's
// clarify tool asks the person one to five questions and its run waits for
// the answer. Go keeps the card on the row (question) while the run stays
// 'running', so the claim, the lease, Stop, Delete and Lost treat the wait as
// any live run (work packages decision 1). The answer is fenced on the run
// that asked (questionOpen, decision 2): it commits only while that run is
// live, clears the card in the same transaction, and only then reaches the
// worker (clarify.answer). A typed message while a card waits answers it
// (decision 4). Every way the wait ends keeps the card in the thread as a
// "question" message, so history seeds and the apps show what was asked.

// Limits of a question card (Hermes' clarify: 1-5 questions, up to 4
// choices; the apps add a typed "Other" answer to every question).
const (
	maxQuestions      = 5
	maxQuestionChoice = 4
	maxQuestionRunes  = 2000
	maxAnswerRunes    = 2000
	// defaultClarifyTimeout is run.start's clarify_timeout_s (decision 3):
	// after it the run goes on without the answer.
	defaultClarifyTimeout = 10 * time.Minute
)

// How a question card's wait ended (AnsweredQuestion.Outcome). submitted,
// cancelled (Skip), timed_out and undelivered are Hermes' outcomes;
// stopped is Go's: Stop, or a run that failed or was lost while it waited.
const (
	outcomeSubmitted   = "submitted"
	outcomeCancelled   = "cancelled"
	outcomeTimedOut    = "timed_out"
	outcomeUndelivered = "undelivered"
	outcomeStopped     = "stopped"
)

// questionClosed is the 409 for an answer to a card that no longer waits:
// errCardClosed before the answer committed, errAnswerUndelivered when the
// worker no longer waited for it.
const questionClosed = "This question was already closed"

var (
	errCardClosed        = echo.NewHTTPError(409, questionClosed)
	errAnswerUndelivered = echo.NewHTTPError(409, questionClosed)
	// errAnswerNotSent: the worker did not reply, the card is back.
	errAnswerNotSent = echo.NewHTTPError(503, "Your answer did not reach the assistant. Try again.")
)

// QuestionItem is one question of a card. Choices nil is an open question;
// Recommended is the index of the choice the agent recommends.
type QuestionItem struct {
	QID         string   `json:"qid"`
	Question    string   `json:"question"`
	Choices     []string `json:"choices"`
	Recommended *int     `json:"recommended"`
	MultiSelect bool     `json:"multiSelect"`
}

// ChatQuestion is the card a live agent run waits on (Conversation.Question),
// zero ({}) when none waits. Run is the agent run that asked.
type ChatQuestion struct {
	RequestID string         `json:"requestId,omitempty"`
	Run       string         `json:"run,omitempty"`
	Questions []QuestionItem `json:"questions,omitempty"`
	AskedAt   *time.Time     `json:"askedAt,omitempty"`
	ExpiresAt *time.Time     `json:"expiresAt,omitempty"`
}

// AnsweredQuestion is a "question" message's card once its wait ended.
// Answers map a qid to a string (a choice or typed text), a list of strings
// (a multi-select question) or nothing (skipped).
type AnsweredQuestion struct {
	RequestID string         `json:"requestId"`
	Questions []QuestionItem `json:"questions"`
	Answers   map[string]any `json:"answers"`
	Outcome   string         `json:"outcome"`
}

// questionOpen reports whether requestID is the card the row's live agent
// run waits on: the run is still running, the row still names the run
// that asked, and the request matches. Stop, Delete, Retry, a lost or
// failed run and the end of the wait all fail it.
func questionOpen(row *Conversation, requestID string) bool {
	return row.Status == "running" && row.AgentRunID != "" && row.Question.Run == row.AgentRunID && row.Question.RequestID != "" && row.Question.RequestID == requestID
}

// closeQuestion moves the row's card into the thread as a "question"
// message with the answers and outcome, and clears it. It returns the
// message id ("" when no card waited).
func closeQuestion(row *Conversation, answers map[string]any, outcome string) string {
	q := row.Question
	if q.RequestID == "" {
		return ""
	}
	if answers == nil {
		answers = map[string]any{}
	}
	m := message("assistant", questionText(q.Questions, answers, outcome))
	m.Kind = "question"
	m.Question = &AnsweredQuestion{RequestID: q.RequestID, Questions: q.Questions, Answers: answers, Outcome: outcome}
	if q.Run != "" {
		m.Engine, m.AgentRun = engineAgent, q.Run
	}
	row.Messages = append(row.Messages, m)
	row.Question = ChatQuestion{}
	return m.ID
}

// questionText is a question message's content: what was asked and what
// came back, for history seeds (a system notice to the model) and apps
// that do not draw the card.
func questionText(questions []QuestionItem, answers map[string]any, outcome string) string {
	var b strings.Builder
	b.WriteString("Timely asked:")
	for _, q := range questions {
		b.WriteString("\n- ")
		b.WriteString(q.Question)
		b.WriteString("\n  Answer: ")
		switch v := answers[q.QID].(type) {
		case string:
			b.WriteString(v)
		case []string:
			b.WriteString(strings.Join(v, ", "))
		default:
			switch outcome {
			case outcomeTimedOut, outcomeUndelivered:
				b.WriteString("(not answered in time)")
			case outcomeStopped:
				b.WriteString("(stopped before an answer)")
			default:
				b.WriteString("(skipped)")
			}
		}
	}
	return b.String()
}

// askedQuestion is the card a clarify.request event asks for, cleaned up
// for the row: at most five questions of four choices, text clipped and
// without NUL. ok is false for an event without a request or a question.
func askedQuestion(run string, ev workerEvent, now time.Time, fallback time.Duration) (ChatQuestion, bool) {
	p := ev.Payload
	if p.RequestID == "" || len(p.Questions) == 0 {
		return ChatQuestion{}, false
	}
	q := ChatQuestion{RequestID: clip(dropNUL(p.RequestID), 100), Run: run}
	for i, in := range p.Questions {
		if i == maxQuestions {
			break
		}
		item := QuestionItem{QID: clip(dropNUL(in.QID), 20), Question: clip(dropNUL(in.Question), maxQuestionRunes), MultiSelect: in.MultiSelect}
		if item.QID == "" {
			item.QID = fmt.Sprintf("q%d", i)
		}
		for j, choice := range in.Choices {
			if j == maxQuestionChoice {
				break
			}
			item.Choices = append(item.Choices, clip(dropNUL(choice), maxQuestionRunes))
		}
		if in.Recommended != nil && *in.Recommended >= 0 && *in.Recommended < len(item.Choices) {
			n := *in.Recommended
			item.Recommended = &n
		}
		q.Questions = append(q.Questions, item)
	}
	timeout := fallback
	if p.TimeoutS > 0 {
		timeout = time.Duration(p.TimeoutS) * time.Second
	}
	asked, expires := now.UTC(), now.UTC().Add(timeout)
	q.AskedAt, q.ExpiresAt = &asked, &expires
	return q, true
}

// validAnswers checks the person's answers against the card: every key is
// a question of it; a string answers any question (one of its choices, or
// typed text); a list answers only a multi-select question with choices,
// each item one of them except for one typed answer; null or an empty list
// skips the question. Typed text is at most 2,000 characters.
func validAnswers(q ChatQuestion, answers map[string]any) (map[string]any, error) {
	out := map[string]any{}
	for qid, v := range answers {
		i := slices.IndexFunc(q.Questions, func(item QuestionItem) bool { return item.QID == qid })
		if i < 0 {
			return nil, echo.NewHTTPError(400, fmt.Sprintf("This card has no question %q", clip(qid, 40)))
		}
		item := q.Questions[i]
		switch v := v.(type) {
		case nil:
			out[qid] = nil
		case string:
			text := strings.TrimSpace(dropNUL(v))
			if utf8.RuneCountInString(text) > maxAnswerRunes {
				return nil, echo.NewHTTPError(400, "An answer can be at most 2,000 characters")
			}
			if text == "" {
				out[qid] = nil
			} else {
				out[qid] = text
			}
		case []any:
			if !item.MultiSelect || len(item.Choices) == 0 {
				return nil, echo.NewHTTPError(400, "Pick one answer to this question")
			}
			picked, typed := []string{}, 0
			for _, x := range v {
				s, ok := x.(string)
				if !ok {
					return nil, echo.NewHTTPError(400, "Invalid answer")
				}
				s = strings.TrimSpace(dropNUL(s))
				if s == "" || slices.Contains(picked, s) {
					continue
				}
				if !slices.Contains(item.Choices, s) {
					typed++
					if typed > 1 || utf8.RuneCountInString(s) > maxAnswerRunes {
						return nil, echo.NewHTTPError(400, "Pick from this question's choices")
					}
				}
				picked = append(picked, s)
			}
			if len(picked) == 0 {
				out[qid] = nil
			} else {
				out[qid] = picked
			}
		default:
			return nil, echo.NewHTTPError(400, "Invalid answer")
		}
	}
	return out, nil
}

// textAnswers is a typed message as the answer to every question of the
// card (decision 4: Hermes reads a string as the typed "Other" answer).
func textAnswers(text string) func(ChatQuestion) (map[string]any, error) {
	return func(q ChatQuestion) (map[string]any, error) {
		out := map[string]any{}
		for _, item := range q.Questions {
			out[item.QID] = text
		}
		return out, nil
	}
}

// errAnswerByMessage tells send and steer that a card waits: the message
// is its answer (answerByMessage).
var errAnswerByMessage = errors.New("a question card waits for this message")

// answer is POST /chats/:id/answer {requestId, answers, skip}: the person's
// answer to the card the run waits on. 409 when the card no longer waits.
func (s *Service) answer(c *echo.Context) error {
	var in struct {
		RequestID string         `json:"requestId"`
		Answers   map[string]any `json:"answers"`
		// Skip ends the wait without answers (Hermes' "cancelled").
		Skip bool `json:"skip"`
	}
	if err := c.Bind(&in); err != nil || in.RequestID == "" || len(in.RequestID) > 100 || len(in.Answers) > maxQuestions {
		return echo.NewHTTPError(400, "Invalid answer")
	}
	outcome := outcomeSubmitted
	answers := func(q ChatQuestion) (map[string]any, error) { return validAnswers(q, in.Answers) }
	if in.Skip {
		outcome = outcomeCancelled
		answers = func(ChatQuestion) (map[string]any, error) { return map[string]any{}, nil }
	}
	row, err := s.answerQuestion(c.Request().Context(), user(c), c.Param("id"), in.RequestID, answers, outcome, "")
	if err != nil {
		return err
	}
	s.fillImages(&row)
	return c.JSON(200, row)
}

// answerQuestion is the fenced answer (decision 2): under the row lock it
// checks the card still waits on the run that asked (requestID "" takes
// the card that waits), keeps the answer in the thread and clears the card
// in one transaction; only then does clarify.answer go to the worker. A
// worker that no longer waits (the card timed out, the run ended meanwhile)
// leaves the message marked undelivered and answers 409.
func (s *Service) answerQuestion(ctx context.Context, uid, cid, requestID string, answers func(ChatQuestion) (map[string]any, error), outcome, messageRequest string) (Conversation, error) {
	var row Conversation
	if s.engine == nil {
		if err := s.find(s.db, uid, cid, &row); err != nil {
			return row, err
		}
		return row, errCardClosed
	}
	var runID, messageID string
	var sent map[string]any
	var asked ChatQuestion
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &row); err != nil {
			return err
		}
		if requestID == "" {
			requestID = row.Question.RequestID
		}
		if !questionOpen(&row, requestID) {
			return errCardClosed
		}
		var err error
		if sent, err = answers(row.Question); err != nil {
			return err
		}
		runID, asked = row.AgentRunID, row.Question
		messageID = closeQuestion(&row, sent, outcome)
		row.Messages[len(row.Messages)-1].RequestID = messageRequest
		row.Revision++
		return tx.Save(&row).Error
	})
	if err != nil {
		return row, err
	}
	// The answer is committed, so it is sent whatever happens to the
	// person's request (a phone that drops the connection must not lose it);
	// Answer bounds the send with its own timeout.
	err = s.engine.Answer(context.WithoutCancel(ctx), uid, cid, runID, requestID, sent, outcome)
	switch {
	case err == nil:
		return row, nil
	case answerRefused(err):
		// The worker said the card no longer waits (or the run is gone).
		if uerr := s.markUndelivered(uid, cid, messageID); uerr != nil && !errors.Is(uerr, gorm.ErrRecordNotFound) {
			log.Printf("chat answer: marking an undelivered answer: %v", uerr)
		}
		return row, errAnswerUndelivered
	default:
		// No reply from the worker: it may still wait. The card goes back
		// so the person can answer again; if the worker did get the answer,
		// its clarify.closed ends the card as it ends any other.
		if rerr := s.restoreQuestion(uid, cid, runID, messageID, asked); rerr != nil && !errors.Is(rerr, gorm.ErrRecordNotFound) {
			log.Printf("chat answer: putting a card back: %v", rerr)
		}
		return row, errAnswerNotSent
	}
}

// answerRefused is an Answer error that says the worker saw the answer and
// refused it: the card no longer waits there, or the run is not live here.
func answerRefused(err error) bool {
	var reply *agenthost.ReplyError
	return errors.Is(err, errNotFollowing) || errors.As(err, &reply)
}

// restoreQuestion puts a card back on the row after its answer could not be
// sent, when the same run still owns the row and nothing took the card's
// place: the answer message leaves the thread.
func (s *Service) restoreQuestion(uid, cid, runID, messageID string, asked ChatQuestion) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &row); err != nil {
			return err
		}
		if row.Status != "running" || row.AgentRunID != runID || row.Question.pending() {
			return nil
		}
		i := slices.IndexFunc(row.Messages, func(m Message) bool { return m.ID == messageID && m.Question != nil })
		if i < 0 {
			return nil
		}
		row.Messages = slices.Delete(row.Messages, i, i+1)
		row.Question = asked
		row.Revision++
		return tx.Save(&row).Error
	})
}

// markUndelivered records that an answer never reached the run.
func (s *Service) markUndelivered(uid, cid, messageID string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &row); err != nil {
			return err
		}
		for i := range row.Messages {
			if m := &row.Messages[i]; m.ID == messageID && m.Question != nil {
				m.Question.Outcome = outcomeUndelivered
				m.Content = questionText(m.Question.Questions, m.Question.Answers, outcomeUndelivered)
				row.Revision++
				return tx.Save(&row).Error
			}
		}
		return nil
	})
}

// answerByMessage answers the waiting card with a message the person typed
// (send or steer while a card waits, decision 4). stale is true when the
// card closed before the answer committed: the caller then handles the
// message as it would without a card.
func (s *Service) answerByMessage(c *echo.Context, text, messageRequest string) (row Conversation, stale bool, err error) {
	row, err = s.answerQuestion(c.Request().Context(), user(c), c.Param("id"), "", textAnswers(strings.TrimSpace(text)), outcomeSubmitted, messageRequest)
	return row, errors.Is(err, errCardClosed), err
}

func (q ChatQuestion) pending() bool { return q.RequestID != "" }
