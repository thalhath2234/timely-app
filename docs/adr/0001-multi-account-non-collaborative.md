# ADR 0001: Multi-account, non-collaborative personal application

- Status: Accepted
- Date: 2026-09-12

> Proposed amendment (2026-11-08): ADR 0026 adds a host-trusted account. The
> person running the host may let one account run approved commands on it.
> That is not a role and grants no access to other accounts through Timely,
> but such a command runs as the host's OS user and can read other accounts'
> files there, so at most one account may be host-trusted on the local
> terminal backend. Until ADR 0026 is accepted, the text below stands as
> written.

## Context

Timely lets more than one person register. Each account is a private personal
environment. The product must never grow team workspaces, invitations, shared
docs, assignments, or other collaboration features.

## Decision

Timely is a **multi-account, single-user** application:

- Every user-owned row belongs to exactly one account.
- A user may have several personal workspaces (Work, Personal, Learning) and
  may sign in on several devices.
- A user can access and manage only their own data. Cross-account reads,
  writes, search, scheduling, MCP tools, and notifications return not-found
  and must not reveal whether another account’s resource exists.
- Account emails are unique and stored in lowercase, trimmed form.
- Authentication exists so one person can use desktop, native mobile, and
  remote access. Sessions are per-device and revocable.

The following are permanently out of scope:

- Team workspaces, members, invitations, roles, guests, or resource ACLs
- Shared docs/sheets, public links, collaborative editing, or presence
- Team reporting, assignments, approvals, or organization administration
- Per-seat billing, SSO for organization account management, user directories

## Consequences

- Ownership is enforced in backend queries and services, not only in clients.
- HTTP and MCP share the same domain services so they cannot diverge.
- New features are judged by whether they help one person privately capture,
  decide, schedule, execute, or review their own work.

## Amendment (2026-11-14, agent phase 5): host-allowed accounts

The in-app agent can run commands and read files on the host (ADR 0026). Whether
an account may do that is a decision of whoever runs the host, made outside
Timely's account system: in the desktop window, through an action only that
window can call, or on a server with `TIMELY_AGENT_HOST_ACCOUNTS`. Nobody is
host-allowed by default.

- **Several accounts may be host-allowed at once**, each turned on separately,
  with no cap (the owner's Q-5.2). The earlier text, at most one account on the
  local terminal backend, is replaced.
- Being host-allowed is not a role. It grants no access to another account
  through Timely's API, which still answers not-found for cross-account reads,
  and the chat-only agent features stay open to every account.
- The limit is real and stays: an approved command of a host-allowed account
  runs as the host's OS user on the real home, so it can read what that user
  reads, including other accounts' agent homes, the database files and other
  workers' environments. Settings → Server says so when an account is turned on.
