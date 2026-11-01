package chat

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Model answers about receipts are read leniently: a paid answer with 3.00
// instead of "3.00", "true" instead of true, a code fence or a sentence around
// the JSON is still used.

// flexString reads a JSON string, number or boolean as text. null leaves the
// value as it was, as encoding/json does for a string.
type flexString string

func (s *flexString) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	switch {
	case string(data) == "null":
		return nil
	case len(data) > 0 && data[0] == '"':
		var v string
		if err := json.Unmarshal(data, &v); err != nil {
			return err
		}
		*s = flexString(v)
	case string(data) == "true" || string(data) == "false":
		*s = flexString(data)
	default:
		var n json.Number
		if err := json.Unmarshal(data, &n); err != nil {
			return fmt.Errorf("expected text or a number")
		}
		*s = flexString(n.String())
	}
	return nil
}

// flexBool reads true/false, also written as a string, yes/no or 1/0.
type flexBool bool

func (b *flexBool) UnmarshalJSON(data []byte) error {
	switch strings.ToLower(strings.Trim(strings.TrimSpace(string(data)), `"`)) {
	case "null":
	case "true", "yes", "1":
		*b = true
	case "false", "no", "0", "":
		*b = false
	default:
		return fmt.Errorf("expected true or false")
	}
	return nil
}

// flexList reads a list of texts, or a single text as a list of one.
type flexList []string

func (l *flexList) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if len(data) > 0 && data[0] == '[' {
		var items []flexString
		if err := json.Unmarshal(data, &items); err != nil {
			return err
		}
		*l = flexList{}
		for _, item := range items {
			*l = append(*l, string(item))
		}
		return nil
	}
	var one flexString
	if err := json.Unmarshal(data, &one); err != nil {
		return err
	}
	if one != "" {
		*l = flexList{string(one)}
	}
	return nil
}

func (it *ReceiptItem) UnmarshalJSON(data []byte) error {
	in := struct {
		Description flexString `json:"description"`
		Quantity    flexString `json:"quantity"`
		UnitPrice   flexString `json:"unitPrice"`
		Amount      flexString `json:"amount"`
		Category    flexString `json:"category"`
	}{flexString(it.Description), flexString(it.Quantity), flexString(it.UnitPrice), flexString(it.Amount), flexString(it.Category)}
	if err := json.Unmarshal(data, &in); err != nil {
		return err
	}
	*it = ReceiptItem{Description: string(in.Description), Quantity: string(in.Quantity), UnitPrice: string(in.UnitPrice), Amount: string(in.Amount), Category: string(in.Category)}
	return nil
}

// UnmarshalJSON decodes onto the draft's current values: a field the JSON
// leaves out (or sets to null) keeps its value, and items or issues are
// replaced only when the JSON lists them.
func (r *ReceiptDraft) UnmarshalJSON(data []byte) error {
	in := struct {
		Merchant         flexString     `json:"merchant"`
		Date             flexString     `json:"date"`
		Currency         flexString     `json:"currency"`
		Category         flexString     `json:"category"`
		Subtotal         flexString     `json:"subtotal"`
		Tax              flexString     `json:"tax"`
		Tip              flexString     `json:"tip"`
		Discount         flexString     `json:"discount"`
		Total            flexString     `json:"total"`
		DiscountIncluded flexBool       `json:"discountIncluded"`
		TaxIncluded      flexBool       `json:"taxIncluded"`
		Items            *[]ReceiptItem `json:"items"`
		Issues           *flexList      `json:"issues"`
	}{
		Merchant: flexString(r.Merchant), Date: flexString(r.Date), Currency: flexString(r.Currency), Category: flexString(r.Category),
		Subtotal: flexString(r.Subtotal), Tax: flexString(r.Tax), Tip: flexString(r.Tip), Discount: flexString(r.Discount), Total: flexString(r.Total),
		DiscountIncluded: flexBool(r.DiscountIncluded), TaxIncluded: flexBool(r.TaxIncluded),
	}
	if err := json.Unmarshal(data, &in); err != nil {
		return err
	}
	r.Merchant, r.Date, r.Currency, r.Category = string(in.Merchant), string(in.Date), string(in.Currency), string(in.Category)
	r.Subtotal, r.Tax, r.Tip, r.Discount, r.Total = string(in.Subtotal), string(in.Tax), string(in.Tip), string(in.Discount), string(in.Total)
	r.DiscountIncluded, r.TaxIncluded = bool(in.DiscountIncluded), bool(in.TaxIncluded)
	if in.Items != nil {
		r.Items = *in.Items
	}
	if in.Issues != nil {
		r.Issues = []string(*in.Issues)
	}
	return nil
}

// firstJSONObject returns the first complete top-level JSON object in a model
// answer, skipping code fences and prose around it, or nil when there is none.
func firstJSONObject(answer string) []byte {
	for i := 0; i < len(answer); {
		start := strings.IndexByte(answer[i:], '{')
		if start < 0 {
			return nil
		}
		start += i
		end := objectEnd(answer[start:])
		if end == 0 {
			// Cut off: every later brace is inside this object.
			return nil
		}
		if candidate := []byte(answer[start : start+end]); json.Valid(candidate) {
			return candidate
		}
		i = start + end
	}
	return nil
}

// objectEnd returns the length of the balanced {...} that s starts with, or 0.
func objectEnd(s string) int {
	depth, inString, escaped := 0, false, false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case inString:
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				inString = false
			}
		case c == '"':
			inString = true
		case c == '{':
			depth++
		case c == '}':
			depth--
			if depth == 0 {
				return i + 1
			}
		}
	}
	return 0
}

var errRevise = errors.New("Couldn't revise this receipt. Edit the fields directly or try again")

var draftKeys = []string{"merchant", "date", "currency", "category", "subtotal", "tax", "tip", "discount", "total", "taxIncluded", "discountIncluded", "items"}

// reviseDraft applies a revise answer to a copy of the current draft. Fields
// the answer leaves out keep their values, so {"total":"3.50"} changes only the
// total, and an extraction's {"text","receipt"} wrapper is unwrapped. An answer
// with no JSON object in it (null, prose) is refused, so a bad answer never
// blanks the draft. changed is false when no field or item differs.
func reviseDraft(current ReceiptDraft, answer string) (ReceiptDraft, bool, error) {
	object := firstJSONObject(answer)
	var keys map[string]json.RawMessage
	if object == nil || json.Unmarshal(object, &keys) != nil {
		return current, false, errRevise
	}
	if inner, wrapped := keys["receipt"]; wrapped && !hasAnyKey(keys, draftKeys) {
		inner = bytes.TrimSpace(inner)
		keys = nil
		if len(inner) == 0 || inner[0] != '{' || json.Unmarshal(inner, &keys) != nil {
			return current, false, errRevise
		}
		object = inner
	}
	draft := current
	draft.Items = append([]ReceiptItem(nil), current.Items...)
	draft.Issues = nil
	if _, sent := keys["issues"]; !sent {
		// Keep open questions, but not the checks code computed for the old
		// values; normalizeReceipt computes them again for the new ones.
		computed := map[string]bool{}
		for _, issue := range receiptIssues(current) {
			computed[issue] = true
		}
		for _, issue := range current.Issues {
			if !computed[issue] {
				draft.Issues = append(draft.Issues, issue)
			}
		}
	}
	if err := json.Unmarshal(object, &draft); err != nil {
		return current, false, errRevise
	}
	normalizeReceipt(&draft)
	return draft, draftFields(draft) != draftFields(current), nil
}

func hasAnyKey(m map[string]json.RawMessage, keys []string) bool {
	for _, k := range keys {
		if _, ok := m[k]; ok {
			return true
		}
	}
	return false
}

// draftFields is the draft without its issues, for telling whether a revision
// changed anything.
func draftFields(r ReceiptDraft) string {
	r.Issues = nil
	if len(r.Items) == 0 {
		r.Items = nil
	}
	return string(raw(r))
}
