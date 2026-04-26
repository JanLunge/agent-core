# Decision 0001 — Agent-Centric OS with Heaper-Compatible Memory Boundary

Date: 2026-04-27
Status: accepted

## Context

Jan clarified that `agent-core` should move stepwise toward a new agent-centric operating system. The final system should later combine with Heaper, but the immediate task is not to implement Heaper itself. The agent runtime should be designed so Heaper can become the memory/source-of-truth layer without rewriting the agent architecture.

Current direction:

- one persistent agent/persona layer decides where each conversation or task needs to go;
- sessions are explicit, durable, resumable objects rather than ephemeral chat slices;
- memory is scoped by heap/namespace and retrieved as recent working context plus relevant search;
- personas have isolated memory but can collaborate through explicit references;
- human data is protected by permissions and proposal/approval flows.

## Decision

`agent-core` will treat memory as a Heaper-compatible block interface, even while the early implementation may use local SQLite/files internally.

The agent runtime should depend on semantic operations, not storage details:

- `search(query, filters)`
- `get_block(id)`
- `create_block(data, heap)`
- `update_block(id, changes)`
- `link_blocks(a, b)`
- `get_daily_entry(date, heap)`
- `append_to_daily_entry(content, heap)`
- `get_related_blocks(id)`
- `semantic_slice(query, time_range, tags)`

Heap namespaces are part of the domain model:

- `human/*` — Jan's personal archive; agent read access, write only through approval or pre-approved rules.
- `agent/*` — shared system/workflow/task memory.
- `persona/<name>/*` — isolated persona memory.

The first routing/memory features should be built against this boundary. Local databases are scaffolding, not the final conceptual owner of memory.

## Consequences

- Module names and types should use `Block`, `Heap`, `Session`, `Persona`, `Conversation`, `Reference`, and `Permission` concepts rather than DB-specific language.
- Agent collaboration should pass block references/links instead of copied hidden state.
- Heartbeat/background work should update session/task/daily blocks and notify only on meaningful events.
- Any direct SQLite implementation should be wrapped so it can later be swapped for Heaper API calls.

## Next implementation slice

Define the TypeScript memory boundary and core domain types, then adapt existing memory/session code toward it in small steps.
