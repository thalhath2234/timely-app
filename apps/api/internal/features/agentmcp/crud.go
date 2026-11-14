package agentmcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"timely-api/internal/agenthost"
)

// CatalogField is a value the person gives when adding a catalog server (a
// client id or secret, an instance address).
type CatalogField struct {
	Name     string `json:"name"`
	Prompt   string `json:"prompt"`
	Secret   bool   `json:"secret"`
	Required bool   `json:"required"`
}

// CatalogItem is one curated server, as the worker's mcp.catalog lists it.
type CatalogItem struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	URL         string         `json:"url"`
	Category    string         `json:"category"`
	Flag        string         `json:"flag"`
	Auth        string         `json:"auth"`
	Description string         `json:"description"`
	Entry       map[string]any `json:"entry"`
	Fields      []CatalogField `json:"fields"`
	Note        string         `json:"note"`
}

// CatalogRow is a catalog item and whether the account has it.
type CatalogRow struct {
	CatalogItem
	Added bool `json:"added"`
}

// View is one of the account's servers as the Settings screens show it.
type View struct {
	Name      string   `json:"name"`
	Source    string   `json:"source"`
	CatalogID string   `json:"catalogId"`
	Transport string   `json:"transport"` // remote | command
	URL       string   `json:"url,omitempty"`
	Command   string   `json:"command,omitempty"`
	Args      []string `json:"args,omitempty"`
	EnvNames  []string `json:"envNames,omitempty"`
	Mode      string   `json:"mode"`
	// Status: ready, needs_sign_in, waiting_for_ok (a command server), not_approved (its host card was
	// denied or ran out of time: offer Ask again), unavailable (not rendered, see Warning).
	Status      string `json:"status"`
	SignsIn     bool   `json:"signsIn"`
	SignedIn    bool   `json:"signedIn"`
	Category    string `json:"category,omitempty"`
	Flag        string `json:"flag,omitempty"`
	Description string `json:"description,omitempty"`
	Warning     string `json:"warning,omitempty"`
	LastError   string `json:"lastError,omitempty"`
	// Tools is what the last probe saw (nil before one).
	Tools     []ToolInfo `json:"tools"`
	CreatedAt time.Time  `json:"createdAt"`
}

// AddInput is a new server: a catalog id (with the values it asks for), a
// remote address, or a command. Mode defaults to Ask me first.
type AddInput struct {
	CatalogID string            `json:"catalogId"`
	Name      string            `json:"name"`
	URL       string            `json:"url"`
	SignIn    bool              `json:"signIn"`
	Command   string            `json:"command"`
	Args      []string          `json:"args"`
	Env       map[string]string `json:"env"`
	Values    map[string]string `json:"values"`
	Mode      string            `json:"mode"`
}

// UpdateInput changes a server: its mode, or (a custom server) its entry.
// In a command server's env, "${NAME}" keeps the value already stored.
type UpdateInput struct {
	Mode    *string            `json:"mode"`
	URL     *string            `json:"url"`
	SignIn  *bool              `json:"signIn"`
	Command *string            `json:"command"`
	Args    *[]string          `json:"args"`
	Env     *map[string]string `json:"env"`
}

var validModes = []string{ModeUse, ModeAsk, ModeOff}

func validMode(m string) bool { return slices.Contains(validModes, m) }

// Catalog lists the curated servers (every one Hermes ships, messaging
// category included, flagged) and whether the account added each.
func (s *Service) Catalog(ctx context.Context, uid string) ([]CatalogRow, error) {
	items, err := s.catalogItems(ctx, uid)
	if err != nil {
		return nil, err
	}
	rows, err := s.rows(ctx, uid)
	if err != nil {
		return nil, err
	}
	have := map[string]bool{}
	for _, r := range rows {
		if r.CatalogID != "" {
			have[r.CatalogID] = true
		}
	}
	out := make([]CatalogRow, 0, len(items))
	for _, it := range items {
		out = append(out, CatalogRow{CatalogItem: it, Added: have[it.ID]})
	}
	return out, nil
}

var catalogTimeout = 45 * time.Second

func (s *Service) catalogItems(ctx context.Context, uid string) ([]CatalogItem, error) {
	s.mu.Lock()
	have := s.catalog
	s.mu.Unlock()
	if len(have) > 0 {
		return have, nil
	}
	var out struct {
		Servers []CatalogItem `json:"servers"`
	}
	if err := s.ask(ctx, uid, "mcp.catalog", map[string]any{}, &out); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.catalog = out.Servers
	s.mu.Unlock()
	return out.Servers, nil
}

// ask sends a helper request to the account's worker (started when needed)
// and decodes the mcp.result's data.
func (s *Service) ask(ctx context.Context, uid, typ string, fields map[string]any, into any) error {
	if s.o.Workers == nil {
		return ErrUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, catalogTimeout)
	defer cancel()
	w, err := s.o.Workers.Requester(ctx, uid, true)
	if err != nil {
		return err
	}
	if w == nil {
		return ErrUnavailable
	}
	return s.askWith(ctx, w, typ, fields, into)
}

// askWith sends one helper request to a worker and decodes the mcp.result's data.
func (s *Service) askWith(ctx context.Context, w Requester, typ string, fields map[string]any, into any) error {
	reply, err := w.Request(ctx, typ, fields)
	if err != nil {
		var re *agenthost.ReplyError
		if errors.As(err, &re) && re.Code == "bad_message" {
			return invalid("%s", re.Message)
		}
		return err
	}
	var body struct {
		OK   bool            `json:"ok"`
		Data json.RawMessage `json:"data"`
	}
	if err := reply.Decode(&body); err != nil {
		return err
	}
	if into != nil {
		return json.Unmarshal(body.Data, into)
	}
	return nil
}

// List is the account's servers with their problems, newest names last.
func (s *Service) List(ctx context.Context, uid string) ([]View, error) {
	rows, err := s.rows(ctx, uid)
	if err != nil {
		return nil, err
	}
	envs, _, err := s.secrets(ctx, uid, secretEnv)
	if err != nil {
		return nil, err
	}
	tokens, _, err := s.secrets(ctx, uid, secretToken)
	if err != nil {
		return nil, err
	}
	var cat map[string]CatalogItem
	s.mu.Lock()
	if len(s.catalog) > 0 {
		cat = make(map[string]CatalogItem, len(s.catalog))
		for _, it := range s.catalog {
			cat[it.ID] = it
		}
	}
	s.mu.Unlock()
	host := s.o.HostAllowed(ctx, uid)
	out := make([]View, len(rows))
	var wg sync.WaitGroup
	for i, row := range rows {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, signed := tokens[row.Name]
			out[i] = s.view(ctx, row, host, envs, signed, cat)
		}()
	}
	wg.Wait()
	return out, nil
}

func (s *Service) view(ctx context.Context, row Server, host bool, envs map[string]string, signed bool, cat map[string]CatalogItem) View {
	v := View{Name: row.Name, Source: row.Source, CatalogID: row.CatalogID, Mode: row.Mode, SignedIn: signed,
		LastError: row.LastError, CreatedAt: row.CreatedAt}
	if it, ok := cat[row.CatalogID]; ok {
		v.Category, v.Flag, v.Description = it.Category, it.Flag, it.Description
	}
	s.mu.Lock()
	v.Tools = slices.Clone(s.tools[toolsKey(row.UserID, row.Name)])
	s.mu.Unlock()
	raw, err := entryMap(row.Entry)
	if err != nil {
		v.Status, v.Warning = "unavailable", "The saved entry is not readable. Remove the server and add it again."
		return v
	}
	if isCommand(raw) {
		v.Transport = "command"
		v.Command, _ = raw["command"].(string)
		if args, ok := raw["args"].([]any); ok {
			for _, a := range args {
				if t, ok := a.(string); ok {
					v.Args = append(v.Args, t)
				}
			}
		}
		if env, ok := raw["env"].(map[string]any); ok {
			v.EnvNames = sortedNames(env)
		}
	} else {
		v.Transport = "remote"
		v.URL, _ = raw["url"].(string)
		v.SignsIn = signsIn(raw)
	}
	p := s.prepare(ctx, row, host, envs)
	switch {
	case p.refused:
		v.Status, v.Warning = "not_approved", p.problem
	case p.pending:
		v.Status, v.Warning = "waiting_for_ok", p.problem
	case !p.renders:
		v.Status, v.Warning = "unavailable", p.problem
	case v.SignsIn && !signed:
		v.Status = "needs_sign_in"
	default:
		v.Status = "ready"
	}
	return v
}

func (s *Service) one(ctx context.Context, uid, name string) (View, error) {
	list, err := s.List(ctx, uid)
	if err != nil {
		return View{}, err
	}
	for _, v := range list {
		if v.Name == name {
			return v, nil
		}
	}
	return View{}, ErrNotFound
}

// Add stores a server. pending is true for a command server: it waits for the
// person's OK on a host card (a 202 on the wire).
func (s *Service) Add(ctx context.Context, uid string, in AddInput) (v View, pending bool, err error) {
	if in.Mode == "" {
		in.Mode = ModeAsk
	}
	if !validMode(in.Mode) {
		return View{}, false, invalid("mode must be use, ask or off")
	}
	var (
		entry     map[string]any
		source    = SourceCustom
		catalogID string
		name      = strings.TrimSpace(in.Name)
		envValues = map[string]string{}
	)
	switch {
	case in.CatalogID != "":
		items, err := s.catalogItems(ctx, uid)
		if err != nil {
			return View{}, false, err
		}
		i := slices.IndexFunc(items, func(c CatalogItem) bool { return c.ID == in.CatalogID })
		if i < 0 {
			return View{}, false, ErrNotFound
		}
		item := items[i]
		if name == "" {
			name = item.Name
		}
		entry, envValues, err = fillCatalog(item, in.Values)
		if err != nil {
			return View{}, false, err
		}
		source, catalogID = SourceCatalog, item.ID
	case in.Command != "":
		if !s.o.HostAllowed(ctx, uid) {
			return View{}, false, fmt.Errorf("%w: Only an account that can use this computer can add a command server", ErrForbidden)
		}
		entry = map[string]any{"command": in.Command}
		if len(in.Args) > 0 {
			args := make([]any, len(in.Args))
			for i, a := range in.Args {
				args[i] = a
			}
			entry["args"] = args
		}
		if len(in.Env) > 0 {
			env := map[string]any{}
			for k, val := range in.Env {
				if !envNameR.MatchString(k) {
					return View{}, false, invalid("env %q is not valid", k)
				}
				env[k] = "${" + k + "}"
				envValues[k] = val
			}
			entry["env"] = env
		}
	case in.URL != "":
		entry = map[string]any{"url": strings.TrimSpace(in.URL)}
		if in.SignIn {
			entry["auth"] = "oauth"
		}
	default:
		return View{}, false, invalid("Give a catalog server, an address or a command")
	}
	if !nameRe.MatchString(name) {
		return View{}, false, invalid("Name it with letters, numbers, - and _ (up to %d characters)", maxNameLen)
	}
	entry, err = cleanEntry(entry)
	if err != nil {
		return View{}, false, err
	}
	if err := s.checkNew(ctx, entry, envValues); err != nil {
		return View{}, false, err
	}
	raw, _ := json.Marshal(entry)
	row := Server{ID: uuid.NewString(), UserID: uid, Name: name, Source: source, CatalogID: catalogID,
		Entry: raw, Mode: in.Mode, CreatedAt: s.now(), UpdatedAt: s.now()}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var n int64
		if err := tx.Model(&Server{}).Where("user_id = ?", uid).Count(&n).Error; err != nil {
			return err
		}
		if n >= maxServers {
			return invalid("An account can have up to %d servers", maxServers)
		}
		if err := tx.Create(&row).Error; err != nil {
			if isUnique(err) {
				return ErrConflict
			}
			return err
		}
		for k, val := range envValues {
			if err := s.putSecret(ctx, tx, uid, secretEnv, envName(name, k), val); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return View{}, false, err
	}
	s.changed(ctx, uid)
	v, err = s.one(ctx, uid, name)
	if err != nil {
		return View{}, false, err
	}
	if isCommand(entry) {
		s.raisePending(ctx, uid, row, entry, envValues)
		return v, true, nil
	}
	return v, false, nil
}

func isUnique(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "23505") || strings.Contains(strings.ToLower(err.Error()), "duplicate key"))
}

// fillCatalog turns a catalog item and the values the person gave into the
// stored entry: a non-secret value is written into it, a secret stays a ${VAR}
// reference and its value is kept sealed (returned as envValues).
func fillCatalog(item CatalogItem, given map[string]string) (map[string]any, map[string]string, error) {
	entry := map[string]any{}
	for k, v := range item.Entry {
		entry[k] = v
	}
	if len(given) > maxFieldValues {
		return nil, nil, invalid("Too many values")
	}
	known := map[string]CatalogField{}
	for _, f := range item.Fields {
		known[f.Name] = f
	}
	for k := range given {
		if _, ok := known[k]; !ok {
			return nil, nil, invalid("%s does not take %q", item.Name, k)
		}
	}
	envValues := map[string]string{}
	var cur any = entry
	for _, f := range item.Fields {
		val := strings.TrimSpace(given[f.Name])
		if val == "" {
			if f.Required {
				return nil, nil, invalid("%s is needed", f.Prompt)
			}
			continue
		}
		if f.Secret {
			envValues[f.Name] = val
			continue
		}
		cur, _ = fill(cur, map[string]string{f.Name: val})
	}
	return cur.(map[string]any), envValues, nil
}

// checkNew vets a new or changed entry before it is stored: the shape, every
// ${VAR} a value for, and a remote address that is public now.
func (s *Service) checkNew(ctx context.Context, entry map[string]any, envValues map[string]string) error {
	for _, r := range refs(entry) {
		if _, ok := envValues[r]; !ok && !isCommand(entry) {
			// a secret reference of a catalog server has its value; any other is a left-over placeholder
			return invalid("%s needs a value", r)
		}
	}
	if isCommand(entry) {
		return nil
	}
	problem, err := checkRemote(ctx, s.o.Resolver, entry)
	if err != nil {
		return err
	}
	if problem != "" {
		return invalid("%s", problem)
	}
	return nil
}

func (s *Service) raisePending(ctx context.Context, uid string, row Server, entry map[string]any, envValues map[string]string) {
	if s.o.OnStdioPending == nil {
		return
	}
	filled, _ := fill(entry, envValues)
	f := filled.(map[string]any)
	p := PendingStdio{Name: row.Name, Hash: entryHash(f)}
	p.Command, _ = f["command"].(string)
	if args, ok := f["args"].([]any); ok {
		for _, a := range args {
			if t, ok := a.(string); ok {
				p.Args = append(p.Args, t)
			}
		}
	}
	if env, ok := entry["env"].(map[string]any); ok {
		p.EnvNames = sortedNames(env)
	}
	s.o.OnStdioPending(ctx, uid, p)
}

// AskAgain raises a new host card for a command server whose card was not
// approved (Ask again on its row). pending is true: the card waits for the
// person's OK.
func (s *Service) AskAgain(ctx context.Context, uid, name string) (v View, err error) {
	row, err := s.row(ctx, uid, name)
	if err != nil {
		return View{}, err
	}
	entry, err := entryMap(row.Entry)
	if err != nil || !isCommand(entry) {
		return View{}, invalid("%s is not a command server", name)
	}
	if !s.o.HostAllowed(ctx, uid) {
		return View{}, fmt.Errorf("%w: Only an account that can use this computer can run a command server", ErrForbidden)
	}
	envs, _, err := s.secrets(ctx, uid, secretEnv)
	if err != nil {
		return View{}, err
	}
	p := s.prepare(ctx, row, true, envs)
	if p.needsKey || p.hash == "" {
		return View{}, invalid("%s can't be started: %s", name, p.problem)
	}
	if row.ApprovedHash == p.hash {
		return s.one(ctx, uid, name) // already approved
	}
	if err := s.db.WithContext(ctx).Model(&Server{}).Where("id = ?", row.ID).
		Updates(map[string]any{"refused_hash": "", "updated_at": s.now()}).Error; err != nil {
		return View{}, err
	}
	s.raisePending(ctx, uid, row, entry, values(envs, row.Name))
	return s.one(ctx, uid, name)
}

// Update changes a server's mode, or a custom server's entry. Any change to a
// command server's entry clears its approval (a new card); a changed address
// of a signing-in server drops its saved sign-in, which belonged to the old one.
func (s *Service) Update(ctx context.Context, uid, name string, in UpdateInput) (v View, pending bool, err error) {
	row, err := s.row(ctx, uid, name)
	if err != nil {
		return View{}, false, err
	}
	set := map[string]any{"updated_at": s.now()}
	if in.Mode != nil {
		if !validMode(*in.Mode) {
			return View{}, false, invalid("mode must be use, ask or off")
		}
		set["mode"] = *in.Mode
	}
	var (
		newEntry  map[string]any
		envValues = map[string]string{}
		dropToken bool
	)
	if in.URL != nil || in.SignIn != nil || in.Command != nil || in.Args != nil || in.Env != nil {
		if row.Source != SourceCustom {
			return View{}, false, invalid("A catalog server's address can't be changed. Remove it and add it again.")
		}
		old, err := entryMap(row.Entry)
		if err != nil {
			return View{}, false, err
		}
		switch {
		case isCommand(old):
			if in.URL != nil || in.SignIn != nil {
				return View{}, false, invalid("This is a command server")
			}
			if !s.o.HostAllowed(ctx, uid) {
				return View{}, false, fmt.Errorf("%w: Only an account that can use this computer can change a command server", ErrForbidden)
			}
			newEntry, envValues, err = s.editCommand(ctx, uid, name, old, in)
			if err != nil {
				return View{}, false, err
			}
		default:
			if in.Command != nil || in.Args != nil || in.Env != nil {
				return View{}, false, invalid("This is a remote server")
			}
			newEntry = map[string]any{}
			for k, val := range old {
				newEntry[k] = val
			}
			if in.URL != nil {
				newEntry["url"] = strings.TrimSpace(*in.URL)
			}
			if in.SignIn != nil {
				if *in.SignIn {
					newEntry["auth"] = "oauth"
				} else {
					delete(newEntry, "auth")
					delete(newEntry, "oauth")
				}
			}
			if newEntry["url"] != old["url"] || signsIn(old) != signsIn(newEntry) {
				dropToken = true
			}
		}
		newEntry, err = cleanEntry(newEntry)
		if err != nil {
			return View{}, false, err
		}
		if err := s.checkNew(ctx, newEntry, envValues); err != nil {
			return View{}, false, err
		}
		raw, _ := json.Marshal(newEntry)
		set["entry"] = raw
		set["last_error"] = ""
		if isCommand(newEntry) {
			set["approved_hash"], set["refused_hash"] = "", ""
		}
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Server{}).Where("id = ?", row.ID).Updates(set).Error; err != nil {
			return err
		}
		if newEntry != nil && isCommand(newEntry) {
			for k, val := range envValues {
				if err := s.putSecret(ctx, tx, uid, secretEnv, envName(name, k), val); err != nil {
					return err
				}
			}
			keep := map[string]bool{}
			if env, ok := newEntry["env"].(map[string]any); ok {
				for k := range env {
					keep[k] = true
				}
			}
			var stale []string
			stored, _, _ := s.secrets(ctx, uid, secretEnv)
			for k := range values(stored, name) {
				if !keep[k] {
					stale = append(stale, envName(name, k))
				}
			}
			if err := s.delSecrets(ctx, tx, uid, secretEnv, stale...); err != nil {
				return err
			}
		}
		if dropToken {
			return s.delSecrets(ctx, tx, uid, secretToken, name)
		}
		return nil
	})
	if err != nil {
		return View{}, false, err
	}
	if newEntry != nil {
		s.forgetTools(uid, name)
		s.signIns.forget(uid, name)
	}
	s.changed(ctx, uid)
	v, err = s.one(ctx, uid, name)
	if err != nil {
		return View{}, false, err
	}
	if newEntry != nil && isCommand(newEntry) {
		fresh, _ := s.row(ctx, uid, name)
		stored, _, _ := s.secrets(ctx, uid, secretEnv)
		s.raisePending(ctx, uid, fresh, newEntry, values(stored, name))
		return v, true, nil
	}
	return v, false, nil
}

// editCommand applies a command-server edit to the old entry. An env value of
// "${NAME}" keeps the stored value; any other is the new value.
func (s *Service) editCommand(ctx context.Context, uid, name string, old map[string]any, in UpdateInput) (map[string]any, map[string]string, error) {
	next := map[string]any{}
	for k, v := range old {
		next[k] = v
	}
	if in.Command != nil {
		next["command"] = *in.Command
	}
	if in.Args != nil {
		args := make([]any, len(*in.Args))
		for i, a := range *in.Args {
			args[i] = a
		}
		next["args"] = args
	}
	envValues := map[string]string{}
	if in.Env != nil {
		env := map[string]any{}
		for k, val := range *in.Env {
			if !envNameR.MatchString(k) {
				return nil, nil, invalid("env %q is not valid", k)
			}
			env[k] = "${" + k + "}"
			if val != "${"+k+"}" {
				envValues[k] = val
			}
		}
		if len(env) == 0 {
			delete(next, "env")
		} else {
			next["env"] = env
		}
		stored, _, err := s.secrets(ctx, uid, secretEnv)
		if err != nil {
			return nil, nil, err
		}
		have := values(stored, name)
		for k := range env {
			if _, given := envValues[k]; !given {
				if _, ok := have[k]; !ok {
					return nil, nil, invalid("env %q has no stored value to keep", k)
				}
			}
		}
	}
	return next, envValues, nil
}

// Remove deletes a server, its sign-in and its values.
func (s *Service) Remove(ctx context.Context, uid, name string) error {
	row, err := s.row(ctx, uid, name)
	if err != nil {
		return err
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ?", row.ID).Delete(&Server{}).Error; err != nil {
			return err
		}
		if err := s.delSecrets(ctx, tx, uid, secretToken, name); err != nil {
			return err
		}
		stored, _, _ := s.secrets(ctx, uid, secretEnv)
		var names []string
		for k := range values(stored, name) {
			names = append(names, envName(name, k))
		}
		return s.delSecrets(ctx, tx, uid, secretEnv, names...)
	})
	if err != nil {
		return err
	}
	s.forgetTools(uid, name)
	s.signIns.forget(uid, name)
	s.changed(ctx, uid)
	return nil
}

// Tools asks the account's worker for the server's tools (a probe), keeps
// them for the gate's classification and for the screen, and records a
// failure on the row. A remote address is checked again first; a command
// server is probed only once approved, for an account that may use this computer.
func (s *Service) Tools(ctx context.Context, uid, name string) ([]ToolInfo, error) {
	row, err := s.row(ctx, uid, name)
	if err != nil {
		return nil, err
	}
	envs, _, err := s.secrets(ctx, uid, secretEnv)
	if err != nil {
		return nil, err
	}
	p := s.prepare(ctx, row, s.o.HostAllowed(ctx, uid), envs)
	if !p.renders {
		return nil, invalid("%s", p.problem)
	}
	var out struct {
		Tools []struct {
			Name        string      `json:"name"`
			Description string      `json:"description"`
			Annotations Annotations `json:"annotations"`
		} `json:"tools"`
		Error       string `json:"error"`
		NeedsSignIn bool   `json:"needs_sign_in"`
	}
	if err := s.ask(ctx, uid, "mcp.probe", map[string]any{"name": name, "entry": p.entry}, &out); err != nil {
		return nil, err
	}
	msg := out.Error
	if out.NeedsSignIn {
		msg = "Sign in to this server first."
	}
	if msg != row.LastError {
		_ = s.db.WithContext(ctx).Model(&Server{}).Where("id = ?", row.ID).Updates(map[string]any{"last_error": msg, "updated_at": s.now()}).Error
	}
	tools := make([]ToolInfo, 0, len(out.Tools))
	for _, t := range out.Tools {
		tools = append(tools, ToolInfo{Name: t.Name, Description: t.Description, Annotations: t.Annotations, Class: Class(t.Name, t.Annotations)})
	}
	if msg != "" {
		s.forgetTools(uid, name)
		return nil, &ProbeError{Message: msg, NeedsSignIn: out.NeedsSignIn}
	}
	s.mu.Lock()
	s.tools[toolsKey(uid, name)] = tools
	s.mu.Unlock()
	return tools, nil
}

// ProbeError is a server that did not answer a probe; the screen shows why.
type ProbeError struct {
	Message     string
	NeedsSignIn bool
}

func (e *ProbeError) Error() string { return e.Message }
