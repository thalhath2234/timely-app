package provider

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// boardCheckData is an account with two Client work tasks, two events this
// week and a budget sheet, as the apps' REST calls return them.
var boardCheckData = json.RawMessage(`{
	"projects": [{"id": "p1", "title": "Client work"}],
	"tasks": [
		{"id": "t1", "name": "Send invoice", "kind": "task", "deadline": "2026-10-20T10:00:00Z", "project": {"id": "p1", "title": "Client work"}},
		{"id": "t2", "name": "Plan week", "kind": "task", "deadline": "2026-11-20T10:00:00Z", "project": {"id": "p1", "title": "Client work"}}
	],
	"events": [
		{"id": "e1", "kind": "event", "eventId": "e1", "title": "Gym", "start": "2026-10-29T12:30:00Z", "end": "2026-10-29T13:30:00Z"},
		{"id": "e2", "kind": "event", "eventId": "e2", "title": "Late call", "start": "2026-10-29T20:00:00Z", "end": "2026-10-29T21:15:00Z"}
	],
	"sheets": [{"id": "s1", "title": "Budget", "updatedAt": "2026-10-28T10:00:00Z", "tabs": [{"id": "tab1", "name": "October",
		"columns": [{"id": "c1", "name": "Item", "type": "text", "width": 120}, {"id": "c2", "name": "Amount", "type": "currency", "width": 120, "format": {"currency": "USD"}}],
		"rows": [{"id": "r1", "cells": {"c1": "Rent", "c2": "80000"}}, {"id": "r2", "cells": {"c1": "Food", "c2": "1234.5"}}]}]}]
}`)

// 13:30 on Thursday 29 October in Colombo.
var boardCheckNow = time.Date(2026, 10, 29, 8, 0, 0, 0, time.UTC)

func TestCheckBoardShowsWhatTheAppsDraw(t *testing.T) {
	program := `root = Panel("Client work", [nums, list, next, chart])
late = @Data({source: "tasks", project: "Client work", overdue: true})
week = @Data({source: "events", date: "start", range: "next7", sort: "start"})
spend = @Cells({sheet: "Budget", tab: "October", label: "Item", value: "Amount"})
nums = Stats([Stat("Overdue", late.text), Stat("Spent", spend.text)])
list = List(@Each(late.rows, "t", TaskRow(t.id, t.title, t.day, t.note)), "Nothing overdue")
next = List(@Each(week.rows, "e", EventRow(e.time, e.title, e.day + " · " + e.length)), "Nothing coming up")
chart = BarChart("Spending", spend.labels, spend.values)`
	got, err := checkBoard(program, boardCheckData, boardCheckNow, "Asia/Colombo")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Problems) != 0 {
		t.Errorf("problems = %q", got.Problems)
	}
	shows := strings.Join(got.Shows, "\n")
	for _, want := range []string{
		`Panel title: "Client work"`,
		`Stat label: "Overdue", value: "1"`,
		`TaskRow taskId: "t1", title: "Send invoice", time: "20 Oct", note: "Client work"`,
		// Times and days in the Working hours zone, which the VM has no Intl for.
		`EventRow time: "18:00", title: "Gym", length: "Today · 1 h"`,
		`EventRow time: "01:30", title: "Late call", length: "Fri · 1 h 15 min"`,
		// Grouped thousands, which the VM's toLocaleString can't write. The
		// apps write $ where the VM, without Intl, writes the code.
		`Stat label: "Spent", value: "USD 81,234.50"`,
		`BarChart title: "Spending", labels: ["Rent", "Food"], values: [80000, 1234.5]`,
	} {
		if !strings.Contains(shows, want) {
			t.Errorf("shows lacks %s:\n%s", want, shows)
		}
	}
}

func TestCheckBoardNamesTheProblems(t *testing.T) {
	program := `root = Panel("Client work", [nums, chart])
late = @Data({source: "tasks", project: "Clients work", overdue: true})
spend = @Cells({sheet: "Budget", tab: "October", label: "Item", value: "Amount", where: "Item", is: "Rentt"})
nums = Stats([Stat("Overdue", late.text), Stat("Due", soon.text)])
chart = BarChart("Spending", spend.labels, spend.values)
spare = Text("Not shown")`
	got, err := checkBoard(program, boardCheckData, boardCheckNow, "Asia/Colombo")
	if err != nil {
		t.Fatal(err)
	}
	problems := strings.Join(got.Problems, "\n")
	for _, want := range []string{
		"No project is called “Clients work”. The closest is “Client work”.",
		"has no Item called “Rentt”. The closest is “Rent”.",
		"soon is used but never defined.",
		"spare is defined but no block shows it",
	} {
		if !strings.Contains(problems, want) {
			t.Errorf("problems lack %q:\n%s", want, problems)
		}
	}
	if _, err := checkBoard("root = Reply([c])", boardCheckData, boardCheckNow, ""); err != nil {
		t.Fatal(err)
	}
	got, _ = checkBoard("not a program", nil, boardCheckNow, "Nowhere/Zone")
	if len(got.Problems) == 0 || !strings.Contains(got.Problems[0], "root = Panel") {
		t.Errorf("a program without a Panel says so: %q", got.Problems)
	}
}

func TestZonePartsKnowsZones(t *testing.T) {
	got := zoneParts(float64(boardCheckNow.UnixMilli()), "Asia/Colombo")
	want := []any{2026, 10, 29, 13, 30, 0, 4}
	parts, ok := got.([]any)
	if !ok || len(parts) != len(want) {
		t.Fatalf("got %v", got)
	}
	for i := range want {
		if parts[i] != want[i] {
			t.Fatalf("got %v, want %v", parts, want)
		}
	}
	for _, zone := range []string{"", "Local", "Nowhere/Zone"} {
		if zoneParts(0, zone) != nil {
			t.Errorf("%q should be unknown", zone)
		}
	}
}
