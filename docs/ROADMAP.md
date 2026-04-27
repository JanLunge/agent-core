# Agent-Core Rolling Roadmap

This roadmap is intentionally never "finished". Each completed slice must leave a validated next slice behind, so Mira can report current progress and continue on heartbeats without waiting for Jan to restate the plan.

## Operating Rule

Every work session should end with:

1. a committed, pushed, verified change if anything meaningful changed;
2. an updated local `HEARTBEAT-STATE.md` entry;
3. at least one concrete next step;
4. no claim that the project is "done" unless Jan explicitly pauses it.

Use `docs/BUILD-ORDER.md` for phase-level acceptance tests and this file for rolling implementation slices.

## Overnight / Long-Run Rule

Before Jan is likely to be away or asleep, maintain at least **10 concrete slices of headroom** or an explicit feedback checkpoint. If fewer than 10 actionable slices remain, pause implementation planning long enough to extend this roadmap before continuing.

It is fine to have no task when genuinely blocked or when Jan has paused the project. Otherwise, prefer working through the queue in order, committing/pushing each coherent slice.

## Feedback Checkpoints

Stop and ask Jan before continuing if any of these become the active decision:

1. **Heaper API shape conflict** — if the local scaffold wants operations that do not fit Jan's Heaper concept of blocks/heaps/links.
2. **Permission semantics ambiguity** — if implementation needs a policy for writing to `human/*` beyond explicit approval / `#bot-editable`.
3. **Persona behavior product decision** — if routing requires deciding how personas should feel or speak, not just technical isolation.
4. **External data movement** — if a slice would send private/sensitive data to remote APIs or require new credentials.
5. **Destructive migration** — if moving existing memory/session data would require deletion or irreversible schema changes.
6. **UI/product workflow choice** — if there are multiple visible UX directions and no obvious safe default.

If a feedback checkpoint is reached during the night, write the question into local `HEARTBEAT-STATE.md`, commit/push any safe preparatory work, and stop that branch. Then continue on unrelated safe slices when available rather than stopping all work.

## Current Progress

- [x] Capture Heaper-compatible architecture and safety/runtime decisions.
- [x] Define initial Heaper block/domain types.
- [x] Define heap permission decisions for `human/*`, `agent/*`, and `persona/*`.
- [x] Add local in-memory `HeaperMemory` scaffold with tests.
- [x] Add Slice 1 session summary blocks linked to daily entries.
- [x] Add Slice 2 normalized event type and chat/background factories.
- [x] Add Slice 3 explicit router planning decisions.
- [x] Add Slice 4 auditable command/file/API guard decisions.
- [x] Add Slice 5 tool output blocks with bounded agent summaries.
- [x] Add Slice 6 daily continuity reader.

## Active Slice Queue

### Slice 1 — Session summary blocks ✅

Goal: connect existing conversation/session persistence to the Heaper-shaped memory layer without replacing storage wholesale.

Validation:
- create a session summary block in `agent/*` or `persona/<name>/*`;
- link it to a daily entry;
- test that today's daily entry can retrieve the linked summary.

Status: implemented in `src/conversation/session-summary.ts` with tests in `src/conversation/session-summary.test.ts`.

### Slice 2 — Normalized event type ✅

Goal: define the interface-layer event shape for chat, TUI, voice, API, and background triggers.

Validation:
- construct events from at least chat and background inputs;
- route sensitivity/mode/persona hints into typed fields;
- test deterministic routing metadata extraction.

Status: implemented in `src/events/normalized-event.ts` with tests in `src/events/normalized-event.test.ts`.

### Slice 3 — Router planning decision ✅

Goal: make the router produce an explicit decision before invoking the agent: session id, persona, mode, sensitivity, and model policy hint.

Validation:
- same channel resumes the same session;
- addressed persona selects the persona heap;
- sensitive input sets sensitive mode;
- background input does not request live response by default.

Status: implemented in `src/router/router.ts` with tests in `src/router/router.test.ts`.

### Slice 4 — Command guard boundary ✅

Goal: centralize allow/deny/ask decisions for shell, API, and file writes.

Validation:
- denies `.env`/secret-like reads;
- asks for risky writes;
- blocks external calls in sensitive mode;
- emits auditable decision objects.

Status: implemented in `src/tools/guard.ts` with tests in `src/tools/guard.test.ts`.

### Slice 5 — Tool output blocks ✅

Goal: store full tool outputs as Heaper blocks and return bounded summaries/references to the agent.

Validation:
- small output can pass directly;
- large output is stored and summarized;
- full output can be retrieved by reference;
- search within stored output works through memory API.

Status: implemented in `src/tools/output-blocks.ts` with tests in `src/tools/output-blocks.test.ts`.

### Slice 6 — Daily continuity reader ✅

Goal: provide a small API that reads today + yesterday daily entries for a heap and returns bounded startup context.

Validation:
- empty days return an empty context object;
- today/yesterday entries are ordered predictably;
- linked session summaries can be included by reference.

Status: implemented in `src/conversation/daily-continuity.ts` with tests in `src/conversation/daily-continuity.test.ts`.

### Slice 7 — Session working-memory selector

Goal: combine recent session messages with relevant HeaperMemory retrieval into a bounded working-memory bundle.

Validation:
- recent messages are preserved in order;
- relevant search results are deduplicated;
- token/size limits are applied deterministically.

### Slice 8 — Persona heap resolver

Goal: map agent/persona names to default heaps and enforce that persona-private memory stays isolated by default.

Validation:
- Mira resolves to `persona/mira/*` defaults;
- shared system work resolves to `agent/*`;
- another persona cannot read Mira-private blocks unless linked/shared.

### Slice 9 — Task block model

Goal: represent async/background work as Heaper-compatible task blocks with status, owner, origin session, and result links.

Validation:
- create pending task;
- transition to running/done/blocked;
- link result blocks;
- query resumable tasks.

### Slice 10 — Background continuation worker skeleton

Goal: process resumable task blocks without depending on real cron or Heaper integration yet.

Validation:
- selects pending/resumable tasks;
- skips blocked tasks;
- writes progress/result blocks;
- returns notification intent only for milestones/blockers.

### Slice 11 — Model routing policy types

Goal: define model-selection inputs/outputs around task type, persona, sensitivity, complexity, and availability.

Validation:
- sensitive tasks require local model;
- non-sensitive complex tasks can request stronger remote model;
- persona defaults are respected.

### Slice 12 — Sensitive-mode enforcement tests

Goal: prove sensitive mode constrains model routing and tools at the runtime boundary, not via agent prompt instructions.

Validation:
- external API tools denied;
- local-only model required;
- allowed local/read-only tools still work;
- violations produce auditable denial reasons.

### Slice 13 — Proposal flow for human heap writes

Goal: agent attempts to mutate `human/*` become proposal blocks unless approval/pre-approved tags allow direct write.

Validation:
- unapproved write creates proposal;
- approved write applies update;
- proposal links target block and originating session/task.

### Slice 14 — Interface adapters as event factories

Goal: normalize chat/TUI/API/background input into the same event shape without invoking the full runtime.

Validation:
- each adapter produces equivalent core fields;
- surface-specific metadata is preserved separately;
- routing is independent of input surface.

### Slice 15 — Progress reporter

Goal: generate a concise progress report from git + roadmap + test status so Jan can ask "where are we?" and get a grounded answer.

Validation:
- includes latest commit;
- includes test/typecheck status;
- includes completed/current/next slices;
- includes blockers/feedback checkpoints.

## Reporting Template

When Jan asks for progress, report:

- latest pushed commit;
- tests/typecheck status;
- completed slice;
- active slice;
- next 1-3 planned slices;
- blockers or feedback checkpoints, if any.
