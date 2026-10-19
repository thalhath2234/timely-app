// coverage ties the AgentRunApply model to the Go code it describes.
//
// It does three things, using only the standard library:
//  1. Reads each guard the model has as a boolean constant from an anchor
//     string in the code, and writes a TLC config with those values. A guard
//     whose anchor is gone is modelled as absent, so TLC shows what removing
//     it would allow.
//  2. Checks the assumptions the model has no switch for (row locks, the
//     claim predicate, Stop clearing the lease, ...). A missing assumption
//     means the model no longer describes the code: exit 2.
//  3. Fingerprints every covered function (comments and formatting ignored)
//     and compares with coverage.lock. A changed function means the model
//     needs another look: exit 3 (TLC still runs).
//
// Usage (run.sh calls it):
//
//	go run coverage.go -repo ROOT -lock coverage.lock -template model/AgentRunApply.cfg -out OUT.cfg
//	go run coverage.go -repo ROOT -lock coverage.lock -resync COMMIT
package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const (
	runner  = "apps/api/internal/features/chat/runner.go"
	service = "apps/api/internal/features/chat/service.go"
	receipt = "apps/api/internal/features/chat/receipts.go"
	deps    = "apps/api/cmd/agent_deps.go"
	mainGo  = "apps/api/cmd/main.go"
)

// covered lists the functions the model describes. Any change to one of
// them (outside comments and formatting) is drift.
var covered = []struct{ File, Func string }{
	{runner, "(*Service).work"},
	{runner, "(*Service).keepLease"},
	{runner, "(*Service).apply"},
	{runner, "retrySerializable"},
	{runner, "serializationFailure"},
	{service, "(*Service).change"},
	{service, "(*Service).send"},
	{service, "(*Service).approve"},
	{service, "(*Service).stop"},
	{service, "(*Service).reject"},
	{service, "(*Service).remove"},
	{service, "(*Service).retry"},
	{service, "(*Service).checkpoint"},
	{service, "busy"},
	{receipt, "(*Service).discardReview"},
	{deps, "chatCatalog"},
}

// An anchor is code text that must appear in a function (whitespace is
// collapsed before comparing). Flag names the model constant it sets; an
// empty Flag marks an assumption the model has no switch for.
type anchor struct {
	Flag, File, Func, Text, Why string
}

var anchors = []anchor{
	// Guards: each sets one constant in AgentRunApply.cfg.
	{"ClaimLocksRow", runner, "(*Service).work",
		`tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Where("status = 'queued' OR (status = 'running' AND lease_until < ?)", now)`,
		"the claim locks the row it reads until tx.Save(&c) commits"},
	{"StepFenced", runner, "(*Service).apply",
		`if row.Status != "running" || row.Lease != c.Lease { return context.Canceled }`,
		"a step commits only under the worker's own live lease"},
	{"WritesInStepTx", runner, "(*Service).apply",
		`catalog := s.factory(tx)`,
		"write tools run on the step transaction"},
	{"WritesInStepTx", mainGo, "main",
		`chat.New(db, func(tx *gorm.DB) agent.Catalog { return chatCatalog(tx, live, providerService.EmbedCredentials) }`,
		"the chat catalog is built on the transaction it is given"},
	{"ApplySkipsDone", runner, "(*Service).apply",
		`for i := range c.Plan { if c.Plan[i].Status == "done" { continue }`,
		"a resumed run skips steps already done"},
	{"CheckpointFenced", service, "(*Service).checkpoint",
		`if latest.Lease != c.Lease || latest.Status != "running" { return context.Canceled }`,
		"a checkpoint commits only under the worker's own live lease"},
	{"CheckpointReadsLatest", service, "(*Service).checkpoint",
		`if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), c.UserID, c.ID, &latest); err != nil {`,
		"the checkpoint re-reads the row under a lock"},
	{"CheckpointReadsLatest", service, "(*Service).checkpoint",
		`if err := fn(tx, &latest); err != nil {`,
		"the checkpoint edits the stored row, not the worker's copy"},
	{"CheckpointReadsLatest", service, "(*Service).checkpoint",
		`if err := tx.Save(&latest).Error; err != nil {`,
		"the checkpoint saves the stored row, not the worker's copy"},
	{"RetryKeepsDone", service, "(*Service).retry",
		`for i := range row.Plan { if row.Plan[i].Status != "done" { row.Plan[i].Status = "pending"`,
		"Retry sends only unfinished steps back to pending"},

	// Assumptions: the model is built on these; no switch.
	{"", runner, "(*Service).work",
		`c.Status = "running" c.Lease = id("lease_") c.LeaseUntil = &lease return tx.Save(&c).Error`,
		"a claim mints a fresh lease and saves it in the claim transaction"},
	{"", runner, "(*Service).work",
		`saveErr := s.checkpoint(ctx, &c, func(tx *gorm.DB, row *Conversation) error { row.Status = "failed"`,
		"a failed run is recorded through the fenced checkpoint"},
	{"", runner, "(*Service).keepLease",
		`Where("id = ? AND user_id = ? AND lease = ? AND status = 'running'", cid, uid, lease). UpdateColumn("lease_until"`,
		"renewal touches only the worker's own running lease"},
	{"", runner, "(*Service).apply",
		`if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), c.UserID, c.ID, &row); err != nil {`,
		"each step transaction locks and re-reads the row first"},
	{"", runner, "(*Service).apply",
		`result, err := catalog[row.Plan[i].Tool].Call(ctx, row.UserID, raw(value))`,
		"the write tool runs inside the step transaction"},
	{"", runner, "(*Service).apply",
		`row.Plan[i].Status = "done"`,
		"the step is marked done in the same transaction as its write"},
	{"", runner, "(*Service).apply",
		`row.Revision++ if err := tx.Save(&row).Error; err != nil { return err } next = row return nil }, &sql.TxOptions{Isolation: sql.LevelSerializable})`,
		"the done mark is saved before the step transaction commits"},
	{"", runner, "(*Service).apply",
		`*c = next if c.Status != "running" { return nil }`,
		"the worker adopts the stored row only after commit"},
	{"", service, "(*Service).change",
		`if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), user(c), c.Param("id"), &row); err != nil {`,
		"person actions lock the row"},
	{"", service, "(*Service).stop",
		`if busy(row) || row.Status == "approval" { row.Status = "stopped" row.Lease = ""`,
		"Stop ends the run and clears the lease"},
	{"", service, "(*Service).approve",
		`if row.Status != "approval" || row.Revision != in.Revision {`,
		"Approve needs a proposal waiting at that revision"},
	{"", service, "(*Service).retry",
		`if row.Status != "failed" && row.Status != "stopped" {`,
		"Retry is only for failed or stopped runs"},
	{"", service, "(*Service).retry",
		`if row.Phase == "apply" && len(row.Plan) > 0 { row.Status = "approval"`,
		"Retry of an apply goes back to approval"},
	{"", service, "(*Service).send",
		`if busy(row) {`,
		"a new message waits for the current run"},
	{"", service, "(*Service).send",
		`archivePlan(row)`,
		"a new message archives the plan"},
	{"", service, "(*Service).remove",
		`if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), user(c), c.Param("id"), &row); err != nil {`,
		"delete locks the row"},
	{"", service, "busy",
		`return c.Status == "queued" || c.Status == "running"`,
		"queued and running are the busy statuses"},
	{"", receipt, "(*Service).discardReview",
		`row.Status = "idle" row.Phase = "plan" row.Lease = ""`,
		"discarding a receipt review ends the run and clears the lease"},
}

var flagLine = regexp.MustCompile(`^(\s*)([A-Za-z]+)(\s*=\s*)(TRUE|FALSE)\s*$`)

func main() {
	repo := flag.String("repo", ".", "repo root")
	lock := flag.String("lock", "", "coverage.lock path")
	template := flag.String("template", "", "TLC config to copy")
	out := flag.String("out", "", "TLC config to write")
	resync := flag.String("resync", "", "write coverage.lock for this commit and exit")
	flag.Parse()

	funcs, missing := load(*repo)
	if *resync != "" {
		if len(missing) > 0 {
			fail(2, "cannot resync, covered code not found:\n  "+strings.Join(missing, "\n  "))
		}
		writeLock(*lock, *resync, funcs)
		fmt.Printf("coverage.lock now records %d functions at %s\n", len(covered), *resync)
		return
	}

	code := 0
	flags := map[string]bool{}
	var broken []string
	for _, a := range anchors {
		body, ok := funcs[key(a.File, a.Func)]
		present := ok && strings.Contains(body, collapse(a.Text))
		if a.Flag == "" {
			if !present {
				broken = append(broken, fmt.Sprintf("%s %s: %s\n      expected: %s", short(a.File), a.Func, a.Why, a.Text))
			}
			continue
		}
		if prev, seen := flags[a.Flag]; seen {
			flags[a.Flag] = prev && present
		} else {
			flags[a.Flag] = present
		}
		if !present {
			fmt.Printf("guard missing: %s (%s %s: %s)\n", a.Flag, short(a.File), a.Func, a.Why)
		}
	}
	names := make([]string, 0, len(flags))
	for n := range flags {
		names = append(names, n)
	}
	sort.Strings(names)
	fmt.Println("guards read from the code:")
	for _, n := range names {
		fmt.Printf("  %-22s %s\n", n, tla(flags[n]))
	}
	if len(missing) > 0 || len(broken) > 0 {
		fmt.Println("MODEL MISMATCH: the model's assumptions no longer hold in the code.")
		for _, m := range missing {
			fmt.Println("  not found: " + m)
		}
		for _, b := range broken {
			fmt.Println("  assumption gone: " + b)
		}
		code = 2
	}

	sync, recorded := readLock(*lock)
	var drift []string
	for _, c := range covered {
		k := key(c.File, c.Func)
		body, ok := funcs[k]
		if !ok {
			continue
		}
		if recorded[k] != digest(body) {
			drift = append(drift, short(c.File)+" "+c.Func)
		}
	}
	if len(drift) > 0 {
		fmt.Printf("DRIFT: covered functions changed since sync commit %s:\n", sync)
		for _, d := range drift {
			fmt.Println("  " + d)
		}
		if code == 0 {
			code = 3
		}
	} else {
		fmt.Printf("covered functions match sync commit %s\n", sync)
	}

	if *template != "" && *out != "" {
		writeConfig(*template, *out, flags)
	}
	os.Exit(code)
}

// load parses the covered files and returns each function's normalized
// source (no comments, whitespace collapsed), keyed by file and name.
func load(repo string) (map[string]string, []string) {
	files := map[string]bool{mainGo: true}
	for _, c := range covered {
		files[c.File] = true
	}
	for _, a := range anchors {
		files[a.File] = true
	}
	funcs := map[string]string{}
	var missing []string
	for f := range files {
		fset := token.NewFileSet()
		parsed, err := parser.ParseFile(fset, filepath.Join(repo, f), nil, 0)
		if err != nil {
			missing = append(missing, f+": "+err.Error())
			continue
		}
		for _, d := range parsed.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok {
				continue
			}
			var buf bytes.Buffer
			if err := printer.Fprint(&buf, fset, fd); err != nil {
				fail(2, err.Error())
			}
			funcs[key(f, name(fd))] = collapse(buf.String())
		}
	}
	want := map[string]bool{}
	for _, c := range covered {
		want[key(c.File, c.Func)] = true
	}
	for _, a := range anchors {
		want[key(a.File, a.Func)] = true
	}
	for k := range want {
		if _, ok := funcs[k]; !ok {
			missing = append(missing, k)
		}
	}
	sort.Strings(missing)
	return funcs, missing
}

func name(fd *ast.FuncDecl) string {
	if fd.Recv == nil || len(fd.Recv.List) == 0 {
		return fd.Name.Name
	}
	switch t := fd.Recv.List[0].Type.(type) {
	case *ast.StarExpr:
		if id, ok := t.X.(*ast.Ident); ok {
			return "(*" + id.Name + ")." + fd.Name.Name
		}
	case *ast.Ident:
		return "(" + t.Name + ")." + fd.Name.Name
	}
	return fd.Name.Name
}

func key(file, fn string) string { return file + " " + fn }
func short(file string) string   { return strings.TrimPrefix(file, "apps/api/") }
func collapse(s string) string   { return strings.Join(strings.Fields(s), " ") }
func digest(s string) string     { return fmt.Sprintf("%x", sha256.Sum256([]byte(s)))[:16] }
func tla(b bool) string {
	if b {
		return "TRUE"
	}
	return "FALSE"
}

func readLock(path string) (string, map[string]string) {
	recorded := map[string]string{}
	f, err := os.Open(path)
	if err != nil {
		fail(2, "read "+path+": "+err.Error())
	}
	defer f.Close()
	sync := "?"
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Fields(line)
		if parts[0] == "sync" && len(parts) == 2 {
			sync = parts[1]
			continue
		}
		if len(parts) == 3 {
			recorded[key(parts[0], parts[1])] = parts[2]
		}
	}
	return sync, recorded
}

func writeLock(path, commit string, funcs map[string]string) {
	var b strings.Builder
	b.WriteString("# Fingerprints of the code AgentRunApply describes (comments and formatting ignored).\n")
	b.WriteString("# Regenerate only with `run.sh --resync`, after confirming the model matches the code.\n")
	fmt.Fprintf(&b, "sync %s\n", commit)
	for _, c := range covered {
		fmt.Fprintf(&b, "%s %s %s\n", c.File, c.Func, digest(funcs[key(c.File, c.Func)]))
	}
	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		fail(2, err.Error())
	}
}

func writeConfig(template, out string, flags map[string]bool) {
	raw, err := os.ReadFile(template)
	if err != nil {
		fail(2, err.Error())
	}
	lines := strings.Split(string(raw), "\n")
	for i, l := range lines {
		m := flagLine.FindStringSubmatch(l)
		if m == nil {
			continue
		}
		if v, ok := flags[m[2]]; ok {
			lines[i] = m[1] + m[2] + m[3] + tla(v)
		}
	}
	if err := os.WriteFile(out, []byte(strings.Join(lines, "\n")), 0o644); err != nil {
		fail(2, err.Error())
	}
}

func fail(code int, msg string) {
	fmt.Fprintln(os.Stderr, "coverage: "+msg)
	os.Exit(code)
}
