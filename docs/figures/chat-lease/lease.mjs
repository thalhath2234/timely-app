// The chat run lease from apps/api/internal/features/chat/runner.go, in model seconds.
// A worker claims a run that is queued or whose lease has run out, holds it for
// LEASE seconds and renews it every RENEW seconds while it works. Every idle
// worker polls once per POLL second. A renewal only checks that the lease id is
// still its own, so a late renewal succeeds as long as nobody has claimed the run.
export const LEASE = 180;
export const RENEW = 5;
export const POLL = 1;
export const SPEED = 10;

export function createLease() {
  return {
    t: 0,
    holder: "A",
    lease: 7,
    until: LEASE,
    renewing: true,
    up: { A: true, B: true },
    renewAt: RENEW,
    pollAt: { A: POLL, B: POLL * 0.5 },
  };
}

// Advances the model by dt seconds and returns what happened, in order.
export function advance(state, dt) {
  const events = [];
  const end = state.t + dt;
  for (;;) {
    const due = [];
    if (state.renewing) due.push(["renew", state.holder, state.renewAt]);
    for (const who of ["A", "B"]) {
      if (state.up[who] && !(state.renewing && state.holder === who)) due.push(["poll", who, state.pollAt[who]]);
    }
    due.sort((a, b) => a[2] - b[2]);
    const next = due[0];
    if (!next || next[2] > end) break;
    const [kind, who, at] = next;
    state.t = at;
    if (kind === "renew") {
      state.until = at + LEASE;
      state.renewAt = at + RENEW;
      events.push({ kind, who, at });
      continue;
    }
    state.pollAt[who] = at + POLL;
    if (state.until < at) {
      state.holder = who;
      state.lease += 1;
      state.until = at + LEASE;
      state.renewing = true;
      state.renewAt = at + RENEW;
      events.push({ kind: "claim", who, at });
    }
  }
  state.t = end;
  for (const who of ["A", "B"]) if (!state.up[who]) state.pollAt[who] = end + POLL;
  return events;
}

// A crashed worker stops renewing; restarted, it only polls, because the run it
// held lived in the memory of the process that died.
export function setUp(state, who, up) {
  state.up[who] = up;
  if (!up && state.holder === who) state.renewing = false;
  if (up) state.pollAt[who] = state.t + POLL;
}

export const left = (state) => Math.max(0, state.until - state.t);

const clock = (seconds) => {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function describe(state) {
  const n = state.lease;
  if (state.renewing) return `${state.holder} renews lease ${n} · ${clock(left(state))} left`;
  if (left(state) > 0) return `${state.holder} down · lease ${n} ends in ${clock(left(state))}`;
  if (state.up.A || state.up.B) return `lease ${n} ran out · claimed on next poll`;
  return `lease ${n} ran out · no worker polling`;
}
