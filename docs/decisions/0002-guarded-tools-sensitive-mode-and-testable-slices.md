# Decision 0002 — Guarded Tools, Sensitive Mode, Model Routing, and Testable Slices

Date: 2026-04-27
Status: accepted

## Context

Jan expanded the agent-core direction with non-negotiable safety and validation requirements. The new system should be agent-centric, but the agent must not be trusted as the enforcement layer. Guards, routing, and storage boundaries enforce behavior before data reaches the model or tools.

## Decision

agent-core will treat security, model routing, tool execution, and output handling as router/runtime responsibilities, not agent personality instructions.

### Secrets boundary

Agents never see raw credentials:

- no `.env` exposure;
- no tokens in prompts, memory, traces, tool outputs, or summaries;
- tools receive secrets by internal injection only;
- secret requests are audited.

### Command guard

Before shell execution, API calls, and file writes, a command guard returns one of:

- `allow`
- `deny`
- `ask`

The guard must enforce:

- no secret access;
- no uncontrolled writes;
- no external leaks for sensitive tasks;
- permission checks for heap writes, especially `human/*`.

### Tool output handling

Full tool outputs are stored in the agent heap as blocks. The agent receives a bounded summary plus a reference. It may request the full output or search within it later.

This prevents context flooding and makes large tool results inspectable without stuffing them directly into the prompt.

### Sensitive mode

Tasks may carry `sensitive: true`. If set, enforcement happens in the router/runtime:

- local model only;
- no external API calls;
- restricted tools only;
- no data leaves the system.

The agent may explain or request approval, but it cannot override sensitive-mode enforcement.

### Model routing

The router chooses models based on:

- task type;
- persona;
- sensitivity;
- complexity;
- available local/remote models.

Examples:

- local small model for private/simple data;
- strong remote model for non-sensitive complex reasoning;
- specialized model for coding or transcription.

### Interface layer

All inputs normalize into events before reaching the agent harness:

- chat;
- TUI;
- voice/transcription;
- API;
- background triggers.

Events are routed into sessions, personas, and heaps consistently.

### Daily continuity

Everything important funnels into daily entries:

- human logs;
- agent work logs;
- session summaries;
- background results;
- next-day continuation context.

Daily entries are the shared continuity layer. The agent should read today + yesterday and continue naturally.

## Minimal build order

1. Heaper-compatible API: blocks, heaps, search, links.
2. Event ingestion and session routing.
3. Agent harness: basic loop + tool calls.
4. Persona system with heap separation.
5. Daily entry system.
6. Tool execution + guard.
7. Async/background tasks.
8. Model routing + sensitive mode.
9. UI: chat, TUI, voice.

If the first four are built properly, the system is already powerful enough to validate the architecture.

## Testability rule

Every implementation slice must include an internal validation path: unit tests, integration tests, typechecks, or deterministic fixtures. The user should not be required to manually test whether a slice works.
