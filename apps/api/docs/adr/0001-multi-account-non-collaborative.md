# ADR 0001: Multi-account, non-collaborative personal application

- Status: Accepted
- Date: 2026-09-12

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
