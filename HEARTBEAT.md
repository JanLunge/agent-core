# Agent-Core Heartbeat Tasks

Heartbeats for this project should make practical progress on `agent-core`, Jan's agent-centric replacement for the current OpenClaw-style runtime.

## North Star

Build a durable agent-centric operating system:

- one persistent agent/persona layer decides where conversations and tasks should go;
- sessions are first-class, durable, and resumable;
- memory is structured, searchable, permissioned, and eventually backed by Heaper;
- personas have isolated memory but can collaborate through explicit references;
- background work continues tasks and writes results without becoming noisy.

## Current Architectural Direction

Final memory layer should be Heaper, not a separate agent DB. Until Heaper is ready, local storage can implement the same interface as a scaffold.

Future Heaper namespaces:

- `human/*` — Jan's archive; agent read-only unless approved or pre-approved by rules such as `#bot-editable`.
- `agent/*` — shared agent system state, tools, workflows, outputs.
- `persona/<name>/*` — isolated persona memory, e.g. `persona/mira/*`.

Core memory operations to design around:

- `search(query, filters)`
- `get_block(id)`
- `create_block(data, heap)`
- `update_block(id, changes)`
- `link_blocks(a, b)`
- `get_daily_entry(date, heap)`
- `append_to_daily_entry(content, heap)`
- `get_related_blocks(id)`
- `semantic_slice(query, time_range, tags)`

## Per-Heartbeat Procedure

1. Read the local ignored heartbeat state file (`HEARTBEAT-STATE.md`) if it exists.
2. Pick one small productive step from the next-step list or project backlog.
3. Do the work: edit docs, implement a small module, add a test, fix a failure, or write a decision record.
4. Verify with the smallest meaningful gate (`pnpm test`, `pnpm typecheck`, targeted test, or direct inspection).
5. Update the local ignored heartbeat state file with timestamp, files touched, verification, next step, and blockers.
6. Notify Jan only for milestones, blockers, risky decisions, or meaningful failures. Otherwise use `NO_REPLY`.

## Product Backlog

1. Agent-centric conversation router.
2. Session and working-memory model.
3. Heaper-compatible memory interface.
   - Keep slices testable with unit/integration tests or deterministic fixtures; Jan should not need to manually validate core behavior.
4. Heap/namespace permissions and proposal flow.
5. Persona model and isolated memory.
6. Collaboration via task/reference blocks.
7. Trigger/heartbeat worker for backlog processing and continuation.
8. Tool output storage/summarization so full output lives in agent heap and the agent sees bounded summaries.
9. Command guard for shell/API/file writes with allow/deny/ask.
10. Sensitive mode enforced by router/runtime: local model only, restricted tools, no external leaks.
11. Model routing by task type, persona, sensitivity, and complexity.
12. Interface normalization for chat, TUI, voice, API, and background triggers.

Self-development journaling is secondary. If useful, write at most one concrete sentence to the external heartbeat log after productive work.
