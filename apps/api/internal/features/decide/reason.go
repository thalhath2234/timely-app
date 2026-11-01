package decide

import (
	"context"
	"errors"
	"net"
	"strings"
)

// Reasons a call was not made. Each wraps ErrOff, so callers that only ask
// "is there a suggestion?" keep treating them as off, while Reason can say why.
var (
	// ErrBusy: the account already has perUserCalls calls in flight and the
	// caller's time ran out waiting for a slot.
	ErrBusy = wrapOff("busy with other requests")
	// ErrKeyRefused: TypeSafe refused the saved key and no other key is set.
	ErrKeyRefused = wrapOff("the saved TypeSafe key was refused")
	// ErrKeyUnreadable: the saved TypeSafe key cannot be decrypted (the
	// server's encryption key changed) and no other key is set.
	ErrKeyUnreadable = wrapOff("the saved TypeSafe key cannot be read")
	// ErrCooling: the provider was rate limited or down a moment ago, so the
	// account waits before asking again. It is joined with that failure.
	ErrCooling = errors.New("decide: waiting after a provider error")
)

func wrapOff(why string) error { return &offError{why: why} }

type offError struct{ why string }

func (e *offError) Error() string { return "suggestions are off: " + e.why }
func (e *offError) Unwrap() error { return ErrOff }

// TooBigError is a request Ask refused to send because its state is over
// MaxStateBytes or a question has too many options. Callers trim before
// asking; this is the last guard.
type TooBigError struct{ msg string }

func (e *TooBigError) Error() string { return e.msg }

// Reason is a short line for the person on why suggestions did not come
// back, or "" when they were simply off. It never repeats the provider's own
// text, which can hold markup, ids or a key; that stays in the server log.
// When the fix is a key, it points to Settings → Agent.
func Reason(err error) string {
	msg, fix := reason(err)
	if fix != "" {
		return msg + " " + fix
	}
	return msg
}

// SettingsReason is Reason for Settings → Agent itself, without the pointer
// back to it.
func SettingsReason(err error) string {
	msg, _ := reason(err)
	return msg
}

const checkKey = "Check your key in Settings → Agent."

func reason(err error) (msg, fix string) {
	switch {
	case err == nil || err == ErrOff:
		return "", ""
	case errors.Is(err, ErrBusy):
		return "Smart suggestions are busy with other requests. Try again in a moment.", ""
	case errors.Is(err, ErrKeyRefused):
		return "TypeSafe refused your saved key.", "Replace it in Settings → Agent."
	case errors.Is(err, ErrKeyUnreadable):
		return "Timely can't read your saved TypeSafe key.", "Enter it again in Settings → Agent."
	}
	var big *TooBigError
	if errors.As(err, &big) {
		return "There was too much to read at once, so smart suggestions were skipped.", ""
	}
	last := lastErr(err)
	var se *StatusError
	if errors.As(last, &se) {
		name := providerName(se.Provider)
		switch {
		case se.Code == 401 || se.Code == 403:
			return name + " refused your key.", checkKey
		case se.Code == 402:
			return name + " says your account is out of credit.", ""
		case se.Code == 408 || se.Code == 504:
			return "Smart suggestions took too long to answer.", ""
		case se.Code == 429:
			return name + " is limiting requests right now. Try again in a minute.", ""
		case se.Code == 400 || se.Code == 413 || se.Code == 422:
			return name + " could not read this request.", ""
		case se.Code >= 500:
			return name + " is unavailable right now. Try again later.", ""
		}
		return name + " could not answer right now.", ""
	}
	if timedOut(last) || timedOut(err) {
		return "Smart suggestions took too long to answer.", ""
	}
	if errors.Is(last, errNoAnswers) || errors.Is(last, errUnreadable) {
		return "Smart suggestions sent an answer Timely could not read.", ""
	}
	return "Smart suggestions could not be reached. Try again later.", ""
}

// permanent reports whether err is a request the provider will refuse every
// time (a malformed or oversized body), so trying it again later is no use.
func permanent(err error) bool {
	var big *TooBigError
	if errors.As(err, &big) {
		return true
	}
	var se *StatusError
	return errors.As(lastErr(err), &se) && (se.Code == 400 || se.Code == 413 || se.Code == 422)
}

// lastErr is the last failure of a joined error that is not ErrOff: with
// TypeSafe and OpenRouter both tried, the one the person is left with.
func lastErr(err error) error {
	multi, ok := err.(interface{ Unwrap() []error })
	if !ok {
		return err
	}
	errs := multi.Unwrap()
	for i := len(errs) - 1; i >= 0; i-- {
		if errs[i] != nil && errs[i] != ErrOff && errs[i] != ErrCooling {
			return lastErr(errs[i])
		}
	}
	return err
}

func timedOut(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

func providerName(p string) string {
	switch p {
	case ProviderTypeSafe:
		return "TypeSafe"
	case ProviderOpenRouter:
		return "OpenRouter"
	}
	if p == "" {
		return "Smart suggestions"
	}
	return strings.ToUpper(p[:1]) + p[1:]
}
