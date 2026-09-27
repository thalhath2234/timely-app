# Clarify creates new Work or a Reminder and consumes the Inbox item

- Status: Accepted
- Date: 2026-09-27

Clarify is not an in-place kind change on the Inbox item. It creates new Work or a new Reminder and the Inbox item is gone (new id). Hermes, HTTP, and the create form call Clarify once so create-and-consume cannot split across clients.

## Considered Options

- **In-place update** (same `tsk_` id): keeps comments and activity. Rejected: the human path is the create form, which creates; pairing that with a separate delete races and already diverges from Hermes.
- **Create and leave the Inbox item**: rejected; that is not Clarify.
