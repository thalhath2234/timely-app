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
//	go run coverage.go -repo ROOT -lock coverage.lock -template A.cfg,B.cfg -out OUTA.cfg,OUTB.cfg
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
	engine  = "apps/api/internal/features/chat/engine.go"
	worker  = "apps/api/internal/features/chat/engine_agent.go"
	turn    = "apps/api/internal/features/chat/toolcall.go"
	modes   = "apps/api/internal/features/chat/permission_mode.go"
)

// coveredFiles lists every file a covered function or anchor lives in;
// run.sh --resync refuses while one has uncommitted changes (-files).
var coveredFiles = []string{runner, service, receipt, deps, mainGo, engine, worker, turn, modes}

// covered lists the functions the model describes. Any change to one of
// them (outside comments and formatting) is drift.
var covered = []struct{ File, Func string }{
	{runner, "(*Service).work"},
	{runner, "(*Service).runClassic"},
	{runner, "(*Service).keepLease"},
	{runner, "(*Service).apply"},
	{runner, "retrySerializable"},
	{runner, "serializationFailure"},
	{service, "(*Service).change"},
	{service, "(*Service).save"},
	{service, "(*Service).send"},
	{service, "(*Service).approve"},
	{service, "(*Service).stop"},
	{service, "(*Service).reject"},
	{service, "(*Service).remove"},
	{service, "(*Service).retry"},
	{service, "(*Service).checkpoint"},
	{service, "(*Service).configure"},
	{service, "(*Service).steer"},
	{service, "busy"},
	{receipt, "(*Service).discardReview"},
	{deps, "chatCatalog"},
	{engine, "runEngine"},
	{engine, "(*Service).startAgentRun"},
	{engine, "(*Service).lostAgentRun"},
	{turn, "(*Service).toolCall"},
	{turn, "(*Service).finishTurn"},
	{turn, "endRun"},
	{turn, "(*Service).renewLease"},
	{modes, "proposalStatus"},
	{modes, "holdReason"},
	{worker, "(*WorkerEngine).Start"},
	{worker, "(*WorkerEngine).clearRun"},
	{worker, "(*WorkerEngine).Lost"},
	{worker, "(*WorkerEngine).Stop"},
	{worker, "(*WorkerEngine).loop"},
	{worker, "(*WorkerEngine).save"},
	{worker, "(*WorkerEngine).renew"},
	{worker, "(*WorkerEngine).done"},
	{worker, "(*WorkerEngine).stopped"},
	{worker, "(*WorkerEngine).fail"},
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
		`chat.New(db, func(tx *gorm.DB) agent.Catalog { return chatCatalog(tx, live, providerService.EmbedCredentials, botService) }`,
		"the chat catalog is built on the transaction it is given"},
	{"ApplySkipsDone", runner, "(*Service).apply",
		`for i := range c.Plan { if c.Plan[i].Status == "done" ||`,
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
		`for i := range row.Plan { if row.Plan[i].Status != "done" && row.Plan[i].Status != "discarded" { row.Plan[i].Status = "pending"`,
		"Retry sends only unfinished steps back to pending"},
	{"HoldsSupervised", modes, "holdReason",
		`mode, err := agent.ParseMode(row.Permission) if err != nil || mode == agent.Supervised { return heldSupervised }`,
		"a Supervised chat (or an unreadable mode) holds every proposal"},
	{"HoldsSupervised", modes, "proposalStatus",
		`if holdReason(row, steps, notes) != "" { return "approval" } return "queued"`,
		"a held proposal waits for Approve"},
	{"HoldsSupervised", turn, "(*Service).finishTurn",
		`row.Status = proposalStatus(row, row.Plan, p.Direct, pending.notes)`,
		"the turn's end decides from the stored row's mode"},

	// Assumptions: the model is built on these; no switch.
	{"", runner, "(*Service).work",
		`c.Status = "running" c.Lease = id("lease_") c.LeaseUntil = &lease return tx.Save(&c).Error`,
		"a claim mints a fresh lease and saves it in the claim transaction"},
	{"", runner, "(*Service).work",
		`if c.Status == "queued" { c.RunEngine = runEngine(tx, &c) c.AgentRunID, c.AgentInstance = "", "" }`,
		"a fresh claim picks the engine and starts with no agent run; a resumed one keeps both"},
	{"", runner, "(*Service).work",
		`if resumed && c.AgentRunID != "" { err = s.lostAgentRun(ctx, &c) } else if c.RunEngine == engineAgent && c.Phase == "plan" { err = s.startAgentRun(ctx, &c, providerErr) } else { err = s.runClassic(ctx, &c, providerErr) }`,
		"work() dispatches to Lost, the agent engine's Start, or runClassic"},
	{"", runner, "(*Service).runClassic",
		`s.keepLease(runCtx, cancel, uid, cid, lease, 5*time.Second)`,
		"a classic run renews its lease while the lane runs it"},
	{"", runner, "(*Service).runClassic",
		`} else if c.Phase == "apply" { err = s.apply(runCtx, c) } else { err = s.plan(runCtx, c) }`,
		"apply and plan turns run in the lane"},
	{"", engine, "runEngine",
		`if c.Sensitive || c.Phase != "plan" { return engineClassic }`,
		"apply, photo phases and Sensitive chats always run classic"},
	{"", engine, "(*Service).startAgentRun",
		`return s.engine.Start(ctx, c)`,
		"an agent plan turn goes to the engine's Start"},
	{"", engine, "(*Service).lostAgentRun",
		`return s.engine.Lost(ctx, c)`,
		"a re-claimed agent run goes to the engine's Lost"},
	{"", worker, "(*WorkerEngine).Start",
		`if err := e.s.checkpoint(ctx, c, func(tx *gorm.DB, row *Conversation) error { if language != "" { row.Language = language } row.AgentRunID, row.AgentInstance = r.id, r.instance`,
		"Start names the run on the row in a fenced checkpoint before run.start"},
	{"", worker, "(*WorkerEngine).Start",
		`r.conv, r.lease = *c, c.Lease`,
		"the follower takes the lane's lease"},
	{"", worker, "(*WorkerEngine).clearRun",
		`_ = e.s.checkpoint(ctx, c, func(tx *gorm.DB, row *Conversation) error { row.AgentRunID, row.AgentInstance = "", ""`,
		"clearRun takes the run off the row in a fenced checkpoint"},
	{"", worker, "(*WorkerEngine).Lost",
		`if r != nil && r.cid == c.ID && r.instance == c.AgentInstance && !exited(r.worker) { r.mu.Lock() r.lease = c.Lease`,
		"Lost re-attaches only the run the row names, in this process, to the new lease"},
	{"", worker, "(*WorkerEngine).Lost",
		`e.clearRun(ctx, c) return errors.New(tr(c.Language, txtAgentLost))`,
		"otherwise Lost clears the run and fails it (Try again)"},
	{"", worker, "(*WorkerEngine).loop",
		`e.renew(r)`,
		"the follower renews the lease on its timer"},
	{"", worker, "(*WorkerEngine).renew",
		`if e.s.renewLease(context.Background(), r.uid, r.cid, lease) { return }`,
		"the follower renews with its current lease"},
	{"", turn, "(*Service).renewLease",
		`Where("id = ? AND user_id = ? AND lease = ? AND status = 'running'", cid, uid, lease). UpdateColumn("lease_until"`,
		"the follower's renewal touches only its own running lease"},
	{"", worker, "(*WorkerEngine).save",
		`r.conv.Lease = r.lease r.mu.Unlock() err := e.s.checkpoint(context.Background(), &r.conv, fn)`,
		"every follower write is a fenced checkpoint under the run's current lease"},
	{"", worker, "(*WorkerEngine).done",
		`r.conv.Lease = r.lease r.mu.Unlock() if err := e.s.finishTurn(context.Background(), &r.conv, final, r.pending, r.tools); err != nil && !fenced(err) {`,
		"the follower ends the turn with finishTurn under the run's current lease"},
	{"", worker, "(*WorkerEngine).stopped",
		`_ = e.save(r, func(tx *gorm.DB, row *Conversation) error { mergeTaint(row, taint) endRun(row, r.tools) row.Status = "stopped"`,
		"a run the worker interrupted is recorded through the fenced save"},
	{"", worker, "(*WorkerEngine).fail",
		`_ = e.save(r, func(tx *gorm.DB, row *Conversation) error { mergeTaint(row, taint) endRun(row, r.tools) row.Status = "failed"`,
		"a failed agent run is recorded through the fenced save"},
	{"", turn, "(*Service).finishTurn",
		`return s.checkpoint(ctx, c, func(tx *gorm.DB, row *Conversation) error { endRun(row, run)`,
		"the turn ends in one fenced checkpoint that clears the agent run"},
	{"", turn, "endRun",
		`row.AgentRunID, row.AgentInstance = "", ""`,
		"ending a turn clears the agent run"},
	{"", turn, "(*Service).toolCall",
		`} else if isReadTool(name) && run.catalog[name].Call != nil {`,
		"a turn's tool calls run read tools"},
	{"", turn, "(*Service).toolCall",
		`} else if isWriteTool(name) { err = fmt.Errorf(`,
		"a turn never runs a write tool: changes go through a proposal"},
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
		`result, err := catalog[row.Plan[i].Tool].Call(stepCtx, row.UserID, raw(value))`,
		"the write tool runs inside the step transaction"},
	{"", runner, "(*Service).apply",
		`if !isWriteTool(row.Plan[i].Tool) && (!row.Plan[i].Undo || !agent.UndoTool(row.Plan[i].Tool)) { return fmt.Errorf("Action not permitted") }`,
		"a plan step runs only a write tool (or, in an undo plan, the deletes its inverses need)"},
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
		`return s.save(c, func(tx *gorm.DB, row *Conversation) error {`,
		"person actions go through save"},
	{"", service, "(*Service).save",
		`if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), user(c), c.Param("id"), &row); err != nil {`,
		"person actions lock the row"},
	{"", service, "(*Service).stop",
		`if busy(row) || row.Status == "approval" { row.Status = "stopped" row.Lease = ""`,
		"Stop ends the run and clears the lease"},
	{"", service, "(*Service).stop",
		`runID, row.AgentRunID, row.AgentInstance = row.AgentRunID, "", ""`,
		"Stop clears the agent run in the same transaction"},
	{"", service, "(*Service).retry",
		`row.AgentRunID, row.AgentInstance = "", ""`,
		"Retry clears the agent run"},
	{"", service, "(*Service).steer",
		`if row.Status != "running" || row.AgentRunID == "" { return echo.NewHTTPError(409, "Nothing is running in this chat") }`,
		"steer only adds a message to a live agent run"},
	{"", service, "(*Service).configure",
		`if in.Permission != nil { row.Permission = *in.Permission }`,
		"a permission change edits only the mode"},
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
	files := flag.Bool("files", false, "print the covered files and exit")
	flag.Parse()
	if *files {
		fmt.Println(strings.Join(coveredFiles, "\n"))
		return
	}

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
		templates, outs := strings.Split(*template, ","), strings.Split(*out, ",")
		if len(templates) != len(outs) {
			fail(2, "-template and -out need the same number of files")
		}
		for i := range templates {
			writeConfig(templates[i], outs[i], flags)
		}
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
