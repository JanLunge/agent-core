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
2. Read `docs/ROADMAP.md` and check for an active product checkpoint before taking another small slice.
3. Prefer the fastest vertical path to a working, dogfoodable runtime over infrastructure-only work. A slice must either move the Telegram/runtime path closer to real use, remove a concrete blocker, or explicitly document a decision Jan needs.
4. If the active queue is empty, below 3 slices, or has drifted into scaffolding without a visible product milestone, stop and notify Jan instead of silently continuing or ending with `NO_REPLY`.
5. Do the work: edit docs, implement a small module, add a test, fix a failure, run a real smoke path, or write a decision record. Avoid generating code just because a slice exists.
6. Verify with the strongest small gate available. Unit tests are not enough for runtime-facing slices; include a CLI/runtime smoke or fixture replay when possible.
7. Update the local ignored heartbeat state file with timestamp, files touched, verification, next step, and blockers.
8. If a roadmap slice is completed, mark it and add/clarify the next slice before stopping. Never leave the roadmap with no concrete next step.
9. Commit and push coherent changes when the change is worth keeping.
10. Notify Jan for empty/low roadmap, product-direction drift, milestones, blockers, risky decisions, or meaningful failures. Otherwise use `NO_REPLY`.

## Overnight Planning Rule

Before Jan is likely away or asleep, keep at least **10 actionable roadmap slices** ready in `docs/ROADMAP.md`, plus explicit feedback checkpoints. If the queue drops below 10, extend the roadmap before doing more implementation **only when the product direction is already clear**. If the next choices would affect product direction, UX, real-agent behavior, or what should be dogfooded next, ask Jan instead of filling the queue with plausible infrastructure work. If a feedback checkpoint is reached, write the question into local `HEARTBEAT-STATE.md`, commit/push safe preparatory work, and switch to an unrelated safe slice only if it still serves the active product milestone.

## Beta Product Rule

As of 2026-04-29, completed slices up to Slice 58 are alpha scaffolding. New work is **beta** and starts again from **Beta Slice 0**.

Beta work must aim at a dogfoodable working product that is easy to debug and develop on. Every beta slice should move a real runtime path forward, remove a concrete blocker, or make the product easier to inspect/debug.

Product-manager responsibility: do not count internal tests, scaffolds, commits, or green checkmarks as success unless they fulfill an end-user requirement. For each beta slice, identify the user-visible behavior and the acceptance check that proves a person can actually use it.

Fake stubs/test doubles are not product progress by themselves. If a fake/stub appears on the dogfood path, list it as a blocker/debt item and create a beta task to replace it. Fake agents are allowed in unit tests only when explicitly labelled as test doubles.

## Product Check-in Trigger

Reach out immediately when any of these happen:

- beta active roadmap queue is empty or below 3 slices;
- no slice has exercised a real Telegram/runtime path in the last meaningful work block;
- tests rely only on fake agents/harnesses for behavior Jan specifically said needs real agents/questions;
- the next work would be scaffold-only while a fake/stub remains on the dogfood product path;
- a slice discovers that current architecture may not produce a usable thing quickly.

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

Roadmap continuity matters: do not finish the last visible task without writing down what comes next. Self-development journaling is secondary. If useful, write at most one concrete sentence to the external heartbeat log after productive work.
