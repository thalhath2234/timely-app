// Command agentqa runs the agent QA scenarios on the classic engine, the
// agent engine or both against a running Timely API, and writes each
// engine's results as JSON plus a side-by-side Markdown report (plan
// section 13, phase 2: the parity run).
//
//	make agent-parity ENGINE=both PROVIDER=<id> MODEL=<id> SCENARIOS=<file> OUT=<dir> [ONLY=<ids>]
//
// The API comes from TIMELY_API (default http://localhost:8081, the worktree
// API; never the main checkout's 8080). The provider key comes only from
// TIMELY_PARITY_KEY in the caller's environment, never from .env or a flag,
// and is never printed or written. Each engine gets its own disposable
// account. With -stub (or the model "stub-model") each scenario's stub
// directive for apps/agent/tests/stub_openai.py goes into the stub shim's
// phrase table (-stub-phrases or TIMELY_PARITY_STUB_PHRASES), or is appended
// to the message when there is none (classic only).
package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
	engine := flag.String("engine", "both", "classic, agent or both")
	provider := flag.String("provider", "", "provider id, as Settings → Agent names it (e.g. openrouter, anthropic, ollama, or claude and codex, the host's signed-in CLIs, which need no key)")
	model := flag.String("model", "", "model id")
	scenariosPath := flag.String("scenarios", "", "scenarios JSON file")
	out := flag.String("out", "", "directory for <engine>.json and report.md")
	only := flag.String("only", "", "comma-separated scenario ids or categories")
	permission := flag.String("permission", "supervised", "the chats' permission mode: supervised, auto or full")
	stub := flag.Bool("stub", false, "append each scenario's stub directive (implied by -model stub-model)")
	timeout := flag.Duration("timeout", 4*time.Minute, "longest wait for one run to end")
	phrases := flag.String("stub-phrases", "", "the stub shim's phrase table to write directives into; default $TIMELY_PARITY_STUB_PHRASES")
	dsn := flag.String("dsn", "", "optional Postgres DSN (with the API's search_path) to read classic's tool trace; default $TIMELY_PARITY_DSN")
	flag.Parse()

	if *provider == "" || *model == "" || *scenariosPath == "" || *out == "" {
		fail("usage: agentqa -engine classic|agent|both -provider ID -model ID -scenarios FILE -out DIR [-only IDS]")
	}
	engines := map[string][]string{"classic": {"classic"}, "agent": {"agent"}, "both": {"classic", "agent"}}[*engine]
	if engines == nil {
		fail("-engine must be classic, agent or both")
	}
	if *permission != "supervised" && *permission != "auto" && *permission != "full" {
		fail("-permission must be supervised, auto or full")
	}
	key := os.Getenv("TIMELY_PARITY_KEY")
	if key == "" && !hostCLI(*provider) {
		fail("export TIMELY_PARITY_KEY in your shell (any non-empty value for a stub model); it is never read from .env")
	}
	api := os.Getenv("TIMELY_API")
	if api == "" {
		api = "http://localhost:8081"
	}
	all, err := LoadScenarios(*scenariosPath)
	if err != nil {
		fail(err.Error())
	}
	picked, err := Pick(all, *only)
	if err != nil {
		fail(err.Error())
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		fail(err.Error())
	}
	cfg := Config{API: api, Provider: *provider, Model: *model, Key: key, Permission: *permission,
		Stub: *stub || *model == "stub-model", Timeout: *timeout, Poll: 400 * time.Millisecond, Logf: log.Printf}
	if *phrases == "" {
		*phrases = os.Getenv("TIMELY_PARITY_STUB_PHRASES")
	}
	cfg.StubPhrases = *phrases
	if *dsn == "" {
		*dsn = os.Getenv("TIMELY_PARITY_DSN")
	}
	if *dsn != "" {
		db, err := sql.Open("pgx", *dsn)
		if err != nil {
			fail("dsn: " + err.Error())
		}
		defer db.Close()
		cfg.DB = db
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	var runs []EngineRun
	for _, e := range engines {
		run := EngineRun{Engine: e, API: api, Provider: cfg.Provider, Model: cfg.Model, Permission: cfg.Permission, Stub: cfg.Stub, Started: time.Now().UTC()}
		c, email, unavailable, err := Signup(ctx, cfg, e)
		if err != nil {
			fail(e + ": " + err.Error())
		}
		run.Account, run.Unavailable = email, unavailable
		log.Printf("%s: account %s, %d scenarios", e, email, len(picked))
		if unavailable != "" {
			log.Printf("%s: the engine is unavailable (%s); its runs will fail with Use classic", e, unavailable)
		}
		for _, s := range picked {
			r := RunScenario(ctx, cfg, c, e, s)
			run.Results = append(run.Results, r)
			mark := "PASS"
			if !r.Pass {
				mark = "FAIL"
			}
			log.Printf("%s %-14s %s %s (%.1f s)", e, s.ID, mark, outcome(r), r.Seconds)
			if ctx.Err() != nil {
				break
			}
		}
		run.Seconds = time.Since(run.Started).Seconds()
		path, err := WriteJSON(*out, run)
		if err != nil {
			fail(err.Error())
		}
		log.Printf("%s: %d/%d passed, %s", e, run.Passed(), len(run.Results), path)
		runs = append(runs, run)
	}
	report := filepath.Join(*out, "report.md")
	if err := os.WriteFile(report, []byte(Markdown(runs, picked)), 0o644); err != nil {
		fail(err.Error())
	}
	fmt.Println(report)
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "agentqa: "+msg)
	os.Exit(2)
}
