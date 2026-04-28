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
- [x] Add Slice 7 working-memory selector.
- [x] Add Slice 8 persona heap resolver.
- [x] Add Slice 9 task block model.
- [x] Add Slice 10 background continuation worker skeleton.
- [x] Add Slice 11 model routing policy types.
- [x] Add Slice 12 sensitive-mode runtime enforcement.
- [x] Add Slice 13 human heap write proposal flow.
- [x] Add Slice 14 interface adapters as event factories.
- [x] Add Slice 15 progress reporter.
- [x] Add Slice 16 runtime orchestration skeleton.
- [x] Add Slice 17 deterministic fake agent harness.
- [x] Add Slice 18 typed tool registry and execution boundary.
- [x] Add Slice 19 Heaper-backed session store adapter.
- [x] Add Slice 20 router persistence and route history.
- [x] Add Slice 21 durable approval-request model.
- [x] Add Slice 22 notification policy layer.
- [x] Add Slice 23 error and blocker taxonomy.
- [x] Add Slice 24 local durable HeaperMemory storage adapter.
- [x] Add Slice 25 Heaper adapter contract tests.
- [x] Add Slice 26 persona configuration loader.
- [x] Add Slice 27 delegation/reference workflow.
- [x] Add Slice 28 end-to-end smoke scenario.
- [x] Add Slice 29 runtime CLI smoke command.
- [ ] Add Slice 30 LocalHeaperMemory runtime wiring.
- [ ] Add Slice 31 route/session store integration in orchestrator.
- [ ] Add Slice 32 approval request integration in tool boundary.
- [ ] Add Slice 33 notification intents in runtime outcome.
- [ ] Add Slice 34 blocker persistence on runtime failures.
- [ ] Add Slice 35 persona config integration into router/model defaults.
- [ ] Add Slice 36 background worker uses LocalHeaperMemory.
- [ ] Add Slice 37 daily continuity writes from completed runtime turns.
- [ ] Add Slice 38 real-run audit export command.

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

### Slice 7 — Session working-memory selector ✅

Goal: combine recent session messages with relevant HeaperMemory retrieval into a bounded working-memory bundle.

Validation:
- recent messages are preserved in order;
- relevant search results are deduplicated;
- token/size limits are applied deterministically.

Status: implemented in `src/conversation/working-memory.ts` with tests in `src/conversation/working-memory.test.ts`.

### Slice 8 — Persona heap resolver ✅

Goal: map agent/persona names to default heaps and enforce that persona-private memory stays isolated by default.

Validation:
- Mira resolves to `persona/mira/*` defaults;
- shared system work resolves to `agent/*`;
- another persona cannot read Mira-private blocks unless linked/shared.

Status: implemented in `src/heaper/persona-resolver.ts` with tests in `src/heaper/persona-resolver.test.ts`.

### Slice 9 — Task block model ✅

Goal: represent async/background work as Heaper-compatible task blocks with status, owner, origin session, and result links.

Validation:
- create pending task;
- transition to running/done/blocked;
- link result blocks;
- query resumable tasks.

Status: implemented in `src/heaper/task-blocks.ts` with tests in `src/heaper/task-blocks.test.ts`.

### Slice 10 — Background continuation worker skeleton ✅

Goal: process resumable task blocks without depending on real cron or Heaper integration yet.

Validation:
- selects pending/resumable tasks;
- skips blocked tasks;
- writes progress/result blocks;
- returns notification intent only for milestones/blockers.

Status: implemented in `src/heartbeat/continuation-worker.ts` with tests in `src/heartbeat/continuation-worker.test.ts`.

### Slice 11 — Model routing policy types ✅

Goal: define model-selection inputs/outputs around task type, persona, sensitivity, complexity, and availability.

Validation:
- sensitive tasks require local model;
- non-sensitive complex tasks can request stronger remote model;
- persona defaults are respected.

Status: implemented in `src/llm/model-routing.ts` with tests in `src/llm/model-routing.test.ts`.

### Slice 12 — Sensitive-mode enforcement tests ✅

Goal: prove sensitive mode constrains model routing and tools at the runtime boundary, not via agent prompt instructions.

Validation:
- external API tools denied;
- local-only model required;
- allowed local/read-only tools still work;
- violations produce auditable denial reasons.

Status: implemented in `src/runtime/sensitive-mode.ts` with tests in `src/runtime/sensitive-mode.test.ts`.

### Slice 13 — Proposal flow for human heap writes ✅

Goal: agent attempts to mutate `human/*` become proposal blocks unless approval/pre-approved tags allow direct write.

Validation:
- unapproved write creates proposal;
- approved write applies update;
- proposal links target block and originating session/task.

Status: implemented in `src/heaper/human-proposals.ts` with tests in `src/heaper/human-proposals.test.ts`.

### Slice 14 — Interface adapters as event factories ✅

Goal: normalize chat/TUI/API/background input into the same event shape without invoking the full runtime.

Validation:
- each adapter produces equivalent core fields;
- surface-specific metadata is preserved separately;
- routing is independent of input surface.

Status: implemented in `src/events/adapters.ts` with tests in `src/events/adapters.test.ts`.

### Slice 15 — Progress reporter ✅

Goal: generate a concise progress report from git + roadmap + test status so Jan can ask "where are we?" and get a grounded answer.

Validation:
- includes latest commit;
- includes test/typecheck status;
- includes completed/current/next slices;
- includes blockers/feedback checkpoints.

Status: implemented in `src/reporting/progress.ts` with tests in `src/reporting/progress.test.ts`.

### Slice 16 — Runtime orchestration skeleton ✅

Goal: connect normalized events, router decisions, working memory, model routing, guarded tool planning, and result persistence into one testable runtime function without requiring real model calls yet.

Validation:
- accepts a normalized event and returns a runtime outcome;
- writes session/user/assistant message blocks or summaries to the correct heap;
- includes bounded working memory in the prepared agent context;
- records guard/model decisions as auditable refs.

Status: implemented in `src/runtime/orchestrator.ts` with tests in `src/runtime/orchestrator.test.ts`.

### Slice 17 — Deterministic fake agent harness ✅

Goal: add a fake model/agent harness for end-to-end tests so the runtime can validate behavior without external APIs.

Validation:
- fake agent receives context and returns scripted replies/tool intents;
- runtime handles a plain reply;
- runtime handles a guarded tool denial;
- tests are deterministic and do not require credentials.

Status: implemented in `src/runtime/fake-agent.ts` with tests in `src/runtime/fake-agent.test.ts`.

### Slice 18 — Tool registry and execution boundary ✅

Goal: introduce a typed tool registry that checks guard decisions before executing local/internal tool handlers.

Validation:
- registered tools declare kind, sensitivity, and required permissions;
- execution is blocked when guard denies or asks;
- allowed local read-only tool returns bounded output refs;
- audit trail links tool intent, decision, and result block.

Status: implemented in `src/tools/boundary.ts` with tests in `src/tools/boundary.test.ts`.

### Slice 19 — Session store adapter ✅

Goal: provide a session store abstraction backed by HeaperMemory so sessions can be created, resumed, summarized, and searched consistently.

Validation:
- create/resume by routed session id;
- append user/assistant/tool messages;
- produce summary blocks;
- retrieve recent slice independent of input surface.

Status: implemented in `src/conversation/heaper-session-store.ts` with tests in `src/conversation/heaper-session-store.test.ts`.

### Slice 20 — Router persistence and route history ✅

Goal: persist routing decisions as blocks so later agents can explain why a conversation went to a session/persona/mode.

Validation:
- each route decision is stored with event ref and session ref;
- repeated channel/session routing is explainable from history;
- sensitive/model/persona decisions are queryable;
- route records are bounded and do not copy full private context.

Status: implemented in `src/router/route-history.ts` with tests in `src/router/route-history.test.ts`.

### Slice 21 — Approval request model ✅

Goal: represent ask/approval decisions as durable approval-request blocks that can later be surfaced in UI or chat.

Validation:
- risky file/API/shell decisions create approval request refs;
- request captures exact proposed operation;
- approval/denial transitions are auditable;
- applying approval resumes or unblocks the originating task/session.

Status: implemented in `src/tools/approval-requests.ts` with tests in `src/tools/approval-requests.test.ts`.

### Slice 22 — Notification policy layer ✅

Goal: centralize when the system should notify Jan versus stay quiet for live, async, heartbeat, and background modes.

Validation:
- blockers and completed milestones request notification;
- ordinary background progress stays silent;
- live chat returns a direct response;
- notification intents include concise reason and linked refs.

Status: implemented in `src/notifications/policy.ts` with tests in `src/notifications/policy.test.ts`.

### Slice 23 — Error and blocker taxonomy ✅

Goal: define structured runtime errors/blockers so failures become resumable task/session state instead of lost exceptions.

Validation:
- classify missing credentials, denied permission, test failure, tool failure, and feedback checkpoint;
- worker stores blocker details and next action;
- progress reporter includes active blockers;
- sensitive details are redacted in summaries.

Status: implemented in `src/runtime/blockers.ts` with tests in `src/runtime/blockers.test.ts`; progress reporting accepts active blocker summaries.

### Slice 24 — Local durable storage adapter ✅

Goal: add a simple durable local storage implementation for HeaperMemory semantics, likely file-backed JSONL or SQLite, while preserving the future Heaper interface.

Validation:
- blocks survive process restart in tests;
- links and daily entries round-trip;
- search/filter behavior matches in-memory scaffold fixtures;
- no destructive migration of existing data is required.

Status: implemented in `src/heaper/local-storage.ts` with tests in `src/heaper/local-storage.test.ts`.

### Slice 25 — Heaper adapter contract tests ✅

Goal: extract shared conformance tests that any HeaperMemory implementation must pass, preparing for real Heaper integration later.

Validation:
- in-memory adapter passes conformance suite;
- durable local adapter passes conformance suite;
- tests cover blocks, links, permissions-facing behavior, daily entries, search, and semantic slices;
- future Heaper adapter can reuse the same suite.

Status: implemented in `src/heaper/adapter-contract.test.ts` with a reusable `describeHeaperMemoryContract` helper covering both in-memory and local durable adapters.

### Slice 26 — Persona configuration loader ✅

Goal: load persona metadata/config from Heaper-compatible blocks or local files and feed it into routing, heap resolution, and model defaults.

Validation:
- loads persona id/name/default heaps/model preferences;
- invalid config fails closed with useful diagnostics;
- persona-private config is not exposed to other personas by default;
- router can use loaded persona config deterministically.

Status: implemented in `src/heaper/persona-config.ts` with tests in `src/heaper/persona-config.test.ts`.

### Slice 27 — Delegation/reference workflow ✅

Goal: model agent-to-agent delegation through task blocks and shared refs rather than hidden copied context.

Validation:
- create delegation task with origin refs;
- delegated worker sees only permitted refs;
- result links back to origin session/task;
- private persona blocks are not silently copied.

Status: implemented in `src/heaper/delegation.ts` with tests in `src/heaper/delegation.test.ts`.

### Slice 28 — End-to-end smoke scenario ✅

Goal: add one integration test for the intended loop: chat event -> route -> context -> fake agent -> guarded tool/output -> memory/session write -> progress report.

Validation:
- no external services or credentials;
- covers normal mode and one sensitive-mode variant;
- verifies all important artifacts are linked by refs;
- progress reporter can summarize the run.

Status: implemented in `src/runtime/e2e-smoke.test.ts`.

### Slice 29 — Runtime CLI smoke command ✅

Goal: add a local CLI command that exercises the deterministic runtime smoke path without external services.

Validation:
- command accepts a message and persona hint;
- uses fake agent/model fixtures only;
- writes event/route/session/audit/tool-output blocks to a temp or configured local store;
- prints linked refs and concise reply.

Status: implemented in `src/cli/runtime-smoke.ts` with tests in `src/cli/runtime-smoke.test.ts`; exposed as `agent-core runtime-smoke <message>`.

### Slice 30 — LocalHeaperMemory runtime wiring

Goal: make runtime scaffolding able to use `LocalHeaperMemory` through configuration rather than test-only constructors.

Validation:
- config selects in-memory or local durable memory;
- local path is created safely if missing;
- existing storage is loaded without migration/destruction;
- runtime smoke can be run twice and see prior blocks.

### Slice 31 — Route/session store integration in orchestrator

Goal: replace ad-hoc session message writes in the orchestrator with `HeaperSessionStore` and route history helpers.

Validation:
- runtime persists route records via `storeRouteDecision`;
- session create/resume uses `HeaperSessionStore`;
- user/assistant/tool messages remain linked to event/route/model/tool refs;
- existing orchestrator/e2e tests still pass.

### Slice 32 — Approval request integration in tool boundary

Goal: when guarded tool execution returns `ask`, create a durable approval-request block rather than only returning a skipped result.

Validation:
- ask decisions create approval request refs with exact proposed operation;
- deny decisions remain denials without approval blocks;
- allow decisions execute normally;
- approval refs link intent, guard decision, session/task origin refs.

### Slice 33 — Notification intents in runtime outcome

Goal: have runtime/orchestrator produce notification intents using the notification policy instead of leaving callers to infer chat vs background behavior.

Validation:
- live chat yields direct-response intent;
- background ordinary progress stays silent;
- blockers/approval requests request notification;
- intents include reason and refs.

### Slice 34 — Blocker persistence on runtime failures

Goal: convert runtime/tool/model failures into durable blocker blocks so work can resume instead of losing exceptions.

Validation:
- model unavailable creates missing-credential or tool-failure blocker as appropriate;
- denied permission can become blocked task/session state;
- blocker refs appear in progress reports;
- sensitive details are redacted.

### Slice 35 — Persona config integration into router/model defaults

Goal: feed loaded persona config into routing, heap selection, and model defaults deterministically.

Validation:
- explicit persona loads config before route/model decision;
- persona default heaps select session/tool/memory heaps;
- persona model defaults affect model routing;
- invalid config fails closed with a blocker/diagnostic.

### Slice 36 — Background worker uses LocalHeaperMemory

Goal: allow the continuation worker to process durable local task blocks across process restarts.

Validation:
- pending task survives restart and is processed;
- result/progress blocks are linked to task;
- notification policy controls whether Jan is interrupted;
- blocked tasks persist blocker refs.

### Slice 37 — Daily continuity writes from completed runtime turns

Goal: write concise daily continuity entries or linked summaries after completed runtime turns.

Validation:
- completed live/async turn appends a bounded daily entry;
- daily entry links session/route/result refs;
- repeated turns append without deleting prior content;
- sensitive content is summarized or ref-linked safely.

### Slice 38 — Real-run audit export command

Goal: add a local inspection command that exports a readable audit trail for a session/task from linked Heaper blocks.

Validation:
- export starts from session/task ref;
- includes event, route, model, guard, approval, tool, blocker, and result refs when linked;
- redacts sensitive blocker/credential details;
- output is deterministic for tests.

## Reporting Template

When Jan asks for progress, report:

- latest pushed commit;
- tests/typecheck status;
- completed slice;
- active slice;
- next 1-3 planned slices;
- blockers or feedback checkpoints, if any.
