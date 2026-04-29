# Agent-Core Rolling Roadmap

This roadmap is intentionally never "finished". Each completed slice must leave a validated next slice behind, so Mira can report current progress and continue on heartbeats without waiting for Jan to restate the plan.

## Operating Rule

Every work session should end with:

1. a committed, pushed, verified change if anything meaningful changed;
2. an updated local `HEARTBEAT-STATE.md` entry;
3. at least one concrete next step;
4. a user-visible check-in if the active queue is empty/below 3, product direction is unclear, or work has drifted away from the fastest usable runtime;
5. no claim that the project is "done" unless Jan explicitly pauses it.

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
- [x] Add Slice 30 LocalHeaperMemory runtime wiring.
- [x] Add Slice 31 route/session store integration in orchestrator.
- [x] Add Slice 32 approval request integration in tool boundary.
- [x] Add Slice 33 notification intents in runtime outcome.
- [x] Add Slice 34 blocker persistence on runtime failures.
- [x] Add Slice 35 persona config integration into router/model defaults.
- [x] Add Slice 36 background worker uses LocalHeaperMemory.
- [x] Add Slice 37 daily continuity writes from completed runtime turns.
- [x] Add Slice 38 real-run audit export command.
- [x] Add Slice 39 runtime audit export CLI fixture for Telegram spike stores.
- [x] Add Slice 40 audit trail redaction policy tests for secret-like fields.
- [x] Add Slice 41 resumable approval application flow.
- [x] Add Slice 42 task-to-runtime continuation bridge.
- [x] Add Slice 43 persona daily continuity startup injection.
- [x] Add Slice 44 route handoff scoring notes and scaffold.
- [x] Add Slice 45 durable notification outbox blocks.
- [x] Add Slice 46 local audit compaction/snapshot command.
- [x] Add Slice 47 runtime health/status command over local memory.
- [x] Add Slice 48 Heaper adapter migration checklist and contract gaps.
- [x] Add Slice 49 Heaper migration checklist contract test references.
- [x] Add Slice 50 notification outbox integration in runtime and continuation worker.
- [x] Add Slice 51 audit export support for notification outbox refs.
- [x] Add Slice 52 runtime-status JSON output mode.
- [x] Add Slice 53 task resume command for approval-resume tasks.
- [x] Add Slice 54 typed link relation design note.
- [x] Add Slice 55 semantic time-range translation helper.
- [x] Add Slice 56 pagination-safe memory scan wrapper.
- [x] Add Slice 57 permission policy adapter boundary tests.
- [x] Add Slice 58 Heaper adapter skeleton behind feature flag.
- [x] Beta Slice 0 product-path audit and fake/stub blocker list.
- [x] Beta Slice 1 dogfood runtime command with real provider seam.


## Product Phase Change — Beta Slice 0 starts 2026-04-29

Jan clarified that all completed slices up to Slice 58 were the **alpha stage**: useful scaffolding, contracts, and exploratory plumbing, but not enough by itself. The project is now in **beta**, and beta slices start again from **Beta Slice 0**.

Beta goal:

> Build a dogfoodable working version of agent-core that is easy to debug and develop on, while always optimizing toward an actual finished product.

Beta rules:

- Product-manager rule: requirements are only fulfilled when the end-user path works, not when internal scaffolding/tests/badges pass. Each beta slice must name the user-visible capability it improves and the end-user acceptance check that proves it.
- Every beta slice must move a real product path forward, not merely add plausible architecture.
- Prefer vertical integration over isolated modules.
- The primary target is a working Telegram/runtime path with durable routing, session/memory, real agent/provider execution, tool/approval safety, notifications, and audit/status/debuggability.
- Fake stubs/test doubles are allowed only as temporary development aids. They must be explicitly listed as blockers/debt and converted into real implementations via named beta tasks.
- A test passing against a fake/stub does not count as product validation. Beta verification should use real runtime paths, real provider boundaries where possible, fixture replay, CLI smoke runs, and inspectable stores/logs.
- If the next slice would add more scaffolding while a fake/stub remains on the product path, stop and replace the fake/stub first or list it as an explicit blocker with a task.
- If product direction is unclear, check in with Jan instead of filling the queue with infrastructure work.

## Beta Active Slice Queue

### Beta Slice 0 — Product-path audit and fake/stub blocker list ✅

Goal: inventory the current alpha codebase from the perspective of dogfooding: what is real, what is fake/stubbed, what blocks a working Telegram/runtime product path, and what can be reused.

Validation:
- produces a concise beta audit document;
- lists every known fake/stub on the product path;
- turns each fake/stub into a blocker or beta task;
- identifies the shortest vertical path to a dogfoodable runtime.

Status: completed in `docs/BETA-0-AUDIT.md`. The audit identifies seven product-path blockers, including fake-agent responders, placeholder model ids, the runtime default responder, Telegram still using the old path, fixture tools, non-functional Heaper adapter, and tool-call fallback stubs.

### Beta Slice 1 — Dogfood runtime command with real provider seam ✅

Goal: create or adapt a single command that runs one local Telegram-like conversation through the actual runtime path and makes provider choice explicit.

Validation:
- accepts a Telegram-shaped input fixture or CLI args;
- writes to a durable local store;
- uses a real provider when configured, otherwise fails with a clear blocker instead of silently using a fake;
- prints debug pointers: session id, route decision, memory blocks, audit refs, notification intents.

Status: completed with `runtime-dogfood`, `src/cli/runtime-dogfood.ts`, and `src/runtime/provider-responder.ts`. The command runs a Telegram-replay-shaped turn through `runRuntimeEvent`, durable LocalHeaperMemory, model routing, session/daily memory, and a provider-backed responder seam. Missing configured credentials return an explicit blocker instead of fake output.

End-user acceptance follow-up: after Jan hit `rm /Users/ulflunge/Desktop/a.md` falling through to Codex read-only, the normal Telegram direct-approval bridge now recognizes `rm` plus absolute/tilde Desktop paths and intercepts them before the Codex CLI path can attempt a read-only shell command. This is still a bridge, not the final runtime unification; the remaining product task is to route normal Telegram through the beta runtime/tool approval path.

### Beta Slice 2 — Replace fake agent on dogfood path

Goal: ensure the dogfood path invokes a real agent/provider boundary rather than `FakeAgent` or deterministic text responses.

Validation:
- real provider adapter is selected/configurable;
- missing credentials/config become explicit blockers;
- fake agent remains only in unit tests and is labelled as such.

Status: active.

### Beta Slice 3 — Debuggable store inspector for one run

Goal: make one dogfood run easy to inspect without spelunking JSON manually.

Validation:
- command shows session, route history, messages, memory blocks, tool decisions, approvals, notifications, and blockers for a run;
- output is human-readable and optionally JSON.

Status: planned.

### Beta Slice 4 — Real Telegram adapter dry-run/replay

Goal: replay Telegram-shaped updates through the same adapter boundary used by production Telegram input, without requiring live message sending.

Validation:
- fixture update flows into normalized event and runtime orchestration;
- channel/chat ids persist consistently;
- output can be audited from the store.

Status: planned.

### Beta Slice 5 — Minimal live Telegram dogfood checkpoint

Goal: define and run the smallest safe live Telegram test once local replay works.

Validation:
- clear config requirements;
- no fake provider on path;
- one inbound message produces one real response or an explicit approval/blocker;
- logs/store make the run debuggable.

Status: planned; requires Jan checkpoint before any external/live messaging.

## Alpha Slice Archive

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

### Slice 30 — LocalHeaperMemory runtime wiring ✅

Goal: make runtime scaffolding able to use `LocalHeaperMemory` through configuration rather than test-only constructors.

Validation:
- config selects in-memory or local durable memory;
- local path is created safely if missing;
- existing storage is loaded without migration/destruction;
- runtime smoke can be run twice and see prior blocks.

Status: implemented in `src/runtime/memory-config.ts` with tests in `src/runtime/memory-config.test.ts`; `runtime_memory` config now selects in-memory or local durable storage.

### Slice 31 — Route/session store integration in orchestrator ✅

Goal: replace ad-hoc session message writes in the orchestrator with `HeaperSessionStore` and route history helpers.

Validation:
- runtime persists route records via `storeRouteDecision`;
- session create/resume uses `HeaperSessionStore`;
- user/assistant/tool messages remain linked to event/route/model/tool refs;
- existing orchestrator/e2e tests still pass.

Status: implemented in `src/runtime/orchestrator.ts`; runtime now creates/resumes sessions through `HeaperSessionStore`, persists route records via `storeRouteDecision`, and links session messages through the session block plus event/route/model/guard refs.

### Slice 32 — Approval request integration in tool boundary ✅

Goal: when guarded tool execution returns `ask`, create a durable approval-request block rather than only returning a skipped result.

Validation:
- ask decisions create approval request refs with exact proposed operation;
- deny decisions remain denials without approval blocks;
- allow decisions execute normally;
- approval refs link intent, guard decision, session/task origin refs.

Status: implemented in `src/tools/boundary.ts`; ask decisions now create `approval-request` proposal refs with exact guard request/args and links to tool intent, guard decision, and origin refs, while deny/allow paths stay unchanged.

### Slice 33 — Notification intents in runtime outcome ✅

Goal: have runtime/orchestrator produce notification intents using the notification policy instead of leaving callers to infer chat vs background behavior.

Validation:
- live chat yields direct-response intent;
- background ordinary progress stays silent;
- blockers/approval requests request notification;
- intents include reason and refs.

Status: implemented in `src/runtime/orchestrator.ts`; runtime outcomes now include a `notificationIntent` from the central notification policy, with linked event/route/model/message/guard refs and approval-required escalation for ask decisions.

### Slice 34 — Blocker persistence on runtime failures ✅

Goal: convert runtime/tool/model failures into durable blocker blocks so work can resume instead of losing exceptions.

Validation:
- model unavailable creates missing-credential or tool-failure blocker as appropriate;
- denied permission can become blocked task/session state;
- blocker refs appear in progress reports;
- sensitive details are redacted.

Status: implemented in `src/runtime/orchestrator.ts` and `src/runtime/blockers.ts`; model-routing and responder failures now persist redacted runtime-blocker blocks before throwing `RuntimeBlockedError`, denied guard decisions create blocker refs linked into the session trail, and notification intents surface blockers for human attention.

### Slice 35 — Persona config integration into router/model defaults ✅

Goal: feed loaded persona config into routing, heap selection, and model defaults deterministically.

Validation:
- explicit persona loads config before route/model decision;
- persona default heaps select session/tool/memory heaps;
- persona model defaults affect model routing;
- invalid config fails closed with a blocker/diagnostic.

Status: implemented in `src/runtime/orchestrator.ts`; runtime can load persona config blocks before model routing, use persona session/shared heaps for working memory, merge persona model defaults into routing policy, and persist a blocker when config validation fails.

### Slice 36 — Background worker uses LocalHeaperMemory ✅

Goal: allow the continuation worker to process durable local task blocks across process restarts.

Validation:
- pending task survives restart and is processed;
- result/progress blocks are linked to task;
- notification policy controls whether Jan is interrupted;
- blocked tasks persist blocker refs.

Status: implemented in `src/heartbeat/continuation-worker.ts`; continuation worker now works across `LocalHeaperMemory` restarts, uses notification policy intents, and persists blocker refs for blocked tasks.

### Slice 37 — Daily continuity writes from completed runtime turns ✅

Goal: write concise daily continuity entries or linked summaries after completed runtime turns.

Validation:
- completed live/async turn appends a bounded daily entry;
- daily entry links session/route/result refs;
- repeated turns append without deleting prior content;
- sensitive content is summarized or ref-linked safely.

Status: implemented in `src/conversation/daily-continuity.ts` and `src/runtime/orchestrator.ts`; completed live/async runtime turns can append bounded continuity entries, link event/route/model/message/guard/blocker refs, reuse the same daily entry across turns, and omit sensitive reply content.

### Slice 38 — Real-run audit export command ✅

Goal: add a local inspection command that exports a readable audit trail for a session/task from linked Heaper blocks.

Validation:
- export starts from session/task ref;
- includes event, route, model, guard, approval, tool, blocker, and result refs when linked;
- redacts sensitive blocker/credential details;
- output is deterministic for tests.

Status: implemented in `src/cli/audit-export.ts`; `agent-core audit-export <heap#id> --store <path>` traverses linked and reverse-linked Heaper blocks, labels runtime audit artifacts, and redacts secret-like blocker data.

### Slice 39 — Runtime audit export CLI fixture for Telegram spike stores ✅

Goal: add a documented fixture/script that runs the audit exporter against a deterministic Telegram-spike-like LocalHeaperMemory store.

Validation:
- fixture creates representative Telegram runtime blocks;
- command output includes session, event, route, model, guard, approval, tool, blocker, daily refs;
- docs show exact command and expected inspection pattern.

Status: implemented in `src/cli/audit-export-fixture.ts`; `agent-core audit-export-fixture --store <path> --depth 6` creates deterministic Telegram-spike runtime turns, writes daily continuity, locates the persisted session ref, and prints both the rerunnable audit export command and the linked trail. Docs live in `docs/AUDIT-EXPORT.md`.

### Slice 40 — Audit trail redaction policy tests for secret-like fields ✅

Goal: harden audit export redaction beyond blockers so credential-looking data never appears in readable exports.

Validation:
- redacts token/api_key/password/Authorization fields in metadata/tool/proposal blocks;
- preserves non-sensitive operational context;
- deterministic tests cover nested values and arrays.

Status: implemented in `src/cli/audit-export.ts`; audit export now recursively redacts sensitive keys and secret-looking string values before deterministic rendering, with coverage in `src/cli/audit-export.test.ts` for nested metadata, tool args, proposal operations, objects, and arrays.

### Slice 41 — Resumable approval application flow ✅

Goal: connect approved approval-request blocks to a safe resume/apply path rather than only storing decisions.

Validation:
- approved request can produce a resumable task/ref;
- denied/cancelled requests do not resume;
- applied state links approval, task/session, and result refs.

Status: implemented in `src/tools/approval-requests.ts`; approved requests can now create `approval-resume` task blocks, transition to applied with resume refs, and link session/result refs while denied/cancelled requests remain non-resumable.

### Slice 42 — Task-to-runtime continuation bridge ✅

Goal: let background tasks invoke the runtime orchestrator with task/session refs instead of custom handlers only.

Validation:
- task content becomes a background normalized event;
- runtime outcome result refs link back to task;
- blocked runtime errors persist task blocker refs.

Status: implemented in `src/heartbeat/continuation-worker.ts`; `createRuntimeContinuationHandler` converts task blocks into background runtime events, stores runtime refs in task-result blocks, links those refs back to the result/task, and attaches runtime blocker refs when orchestration blocks.

### Slice 43 — Persona daily continuity startup injection ✅

Goal: feed daily continuity context into runtime working memory for personas at startup/first turn.

Validation:
- reads yesterday/today persona daily heap;
- includes bounded continuity text in working memory;
- linked summaries remain refs, not copied hidden state.

Status: implemented in `src/runtime/orchestrator.ts` and `src/conversation/working-memory.ts`; runtime reads yesterday/today daily continuity when a daily heap is configured, injects bounded continuity into working memory before responding, and carries linked session summaries as refs only.

### Slice 44 — Route handoff scoring notes and scaffold ✅

Goal: replace sticky/default-only routing with an inspectable handoff scoring scaffold.

Validation:
- scoring reasons are durable route metadata;
- explicit persona still wins;
- fallback remains deterministic when scores tie.

Status: implemented in `src/router/router.ts` and `src/router/route-history.ts`; route decisions now carry candidate scores and reasons, explicit persona matches outrank sticky bindings/defaults, deterministic score/name ordering is covered by tests, and top candidates are stored as durable route metadata/tags.

### Slice 45 — Durable notification outbox blocks ✅

Goal: persist notification intents before delivery so interruptions are auditable and retryable.

Validation:
- runtime/worker intents can be stored as outbox blocks;
- delivery state transitions are explicit;
- silent intents are optionally summarized but not delivered.

Status: implemented in `src/notifications/outbox.ts`; notification intents can be persisted as `notification-outbox` blocks, queued/summarized/delivered/failed/cancelled states are explicit, refs are linked for audit, and silent intents are summarized rather than queued for delivery.

### Slice 46 — Local audit compaction/snapshot command ✅

Goal: produce bounded snapshots from verbose audit trails without deleting underlying blocks.

Validation:
- snapshot block links source refs;
- raw blocks remain untouched;
- export can include snapshot plus refs.

Status: implemented in `src/cli/audit-export.ts`; `agent-core audit-snapshot <heap#id> --store <path> --heap <heap>` creates bounded `audit-snapshot` metadata blocks with linked source refs, preserves raw blocks, and snapshots are visible through normal audit export.

### Slice 47 — Runtime health/status command over local memory ✅

Goal: add a local command summarizing active sessions, tasks, blockers, approvals, and recent daily continuity.

Validation:
- reads only configured local memory store;
- counts active/pending/blocked artifacts;
- includes refs for drill-down via audit export.

Status: implemented in `src/cli/runtime-status.ts`; `agent-core runtime-status --store <path>` summarizes sessions, task states, active blockers, pending approvals, notification outbox items, recent daily entries, and emits `audit-export` drill-down commands for each ref.

### Slice 48 — Heaper adapter migration checklist and contract gaps ✅

Goal: document remaining differences between local memory scaffold and future Heaper tools before deeper integration.

Validation:
- maps each memory method to intended Heaper operation;
- lists known gaps/assumptions;
- identifies any feedback checkpoint for Jan.

Status: documented in `docs/HEAPER-MIGRATION.md`; the checklist maps every `HeaperMemory` method to the intended Heaper operation, records local scaffold assumptions/gaps, and identifies non-blocking feedback checkpoints before real adapter integration.

### Slice 49 — Heaper migration checklist contract test references ✅

Goal: connect the migration checklist to executable contract tests so future adapters know exactly what to run.

Validation:
- checklist names `describeHeaperMemoryContract`;
- docs show how a real adapter imports/runs the suite;
- no production code changes required.

Status: documented in `docs/HEAPER-MIGRATION.md`; future adapters can import `describeHeaperMemoryContract` from `src/heaper/adapter-contract.test.ts`, run it with `pnpm test -- src/heaper/adapter-contract.test.ts`, and add adapter-specific auth/permission/retry/conflict tests around it.

### Slice 50 — Notification outbox integration in runtime and continuation worker ✅

Goal: persist runtime and worker notification intents automatically instead of only exposing outbox helpers.

Validation:
- runtime outcome can include persisted outbox ref when configured;
- continuation worker persists notification intents before returning them;
- silent intents become summarized outbox blocks, not queued delivery items.

Status: implemented with optional `notificationOutboxHeap` on runtime and continuation worker inputs. Runtime outcomes now expose `notificationOutboxRef` when configured; runtime blocked errors can carry a persisted outbox ref; continuation worker processed entries expose `notificationOutboxRef`; worker silent progress is persisted as summarized outbox blocks while non-silent intents are still returned for delivery.

### Slice 51 — Audit export support for notification outbox refs ✅

Goal: make notification outbox trails easier to inspect.

Validation:
- outbox blocks receive a `[notification]` label in audit export;
- exported data includes delivery state and source refs;
- redaction still applies to message content.

Status: implemented in `src/cli/audit-export.ts`; blocks tagged `notification-outbox` now render with the `[notification]` audit label, include status/source/delivery target/source refs in exported data, and continue to use the existing redaction path for notification message content.

### Slice 52 — Runtime-status JSON output mode ✅

Goal: add machine-readable status output for scripts/cron.

Validation:
- CLI accepts `--json`;
- output matches `RuntimeStatusSummary`;
- text mode remains unchanged.

Status: implemented with `agent-core runtime-status --store <path> --json`, which emits the full `RuntimeStatusSummary` shape for scripts/cron while preserving the existing text output path by default.

### Slice 53 — Task resume command for approval-resume tasks ✅

Goal: add a local command to inspect and mark approval-resume tasks ready for continuation.

Validation:
- lists pending `approval-resume` tasks;
- shows approval/task refs and exact operation summary;
- does not execute unsafe work without explicit approval path.

Status: implemented with `agent-core task-resume --store <path> [--mark-ready]`. The command lists pending approval-resume tasks, resolves their approval refs and exact proposed operations, and can mark tasks ready for continuation by tagging/updating the task without executing the approved operation.

### Slice 54 — Typed link relation design note ✅

Goal: decide how untyped local links map to future typed Heaper relations.

Validation:
- documents candidate relation names;
- maps current link use sites;
- identifies migration-safe default for untyped legacy links.

Status: documented in `docs/LINK-RELATIONS.md`; the design keeps `links?: BlockRef[]` as the compatibility field, imports legacy links as `related`, proposes typed relation names, maps current runtime/task/approval/tool/delegation/audit use sites, and outlines a migration plan that preserves existing traversal behavior.

### Slice 55 — Semantic time-range translation helper ✅

Goal: implement a small helper translating labels like `today`, `yesterday`, and `last-7-days` into explicit time ranges.

Validation:
- helper is deterministic under injected clock;
- `semanticSlice` callers can pass translated ranges;
- local adapter still works with explicit `timeRange`.

Status: implemented in `src/heaper/time-range.ts`; `today`, `yesterday`, and `last-7-days` translate to explicit UTC ranges under an injected clock, explicit `timeRange` wins over labels, and both local memory adapters now apply translated filters in `semanticSlice`.

### Slice 56 — Pagination-safe memory scan wrapper ✅

Goal: avoid future production commands assuming unbounded `search('', { limit: Infinity })`.

Validation:
- wrapper expresses bounded scans with future cursor placeholder;
- runtime-status/audit helpers can migrate to it;
- docs mark local-only full scans clearly.

Status: implemented in `src/heaper/scan.ts`; broad command scans now use `scanMemory`, which applies a bounded default limit, rejects unbounded/invalid limits, and returns `cursor-unavailable` when the limit is hit. Runtime-status and task-resume now use it; audit export remains ref-traversal based rather than whole-store scanning.

### Slice 57 — Permission policy adapter boundary tests ✅

Goal: add tests proving human/persona/agent heap write policy remains above or around the memory adapter.

Validation:
- human write proposal flow remains required;
- agent/persona writes remain allowed where expected;
- tests document whether adapter or caller enforces policy.

Status: implemented in `src/heaper/permission-boundary.test.ts`; tests document that local memory adapters are storage-only, human heap protection is enforced by the policy/proposal layer above the adapter, and agent/persona heaps remain writable where policy allows.

### Slice 58 — Heaper adapter skeleton behind feature flag ✅

Goal: add a non-functional adapter skeleton showing where real Heaper client wiring will live.

Validation:
- skeleton implements constructor/config shape but fails closed for operations;
- runtime config can select local adapter by default;
- docs explain what credentials/client are still missing.

Status: implemented in `src/heaper/heaper-client.ts`; runtime memory config accepts `kind: heaper` only with explicit `heaper_enabled: true`, constructs the skeleton, and fails closed for all operations until a real Heaper client is wired. Local/default adapters remain the runtime path.

## Reporting Template

When Jan asks for progress, report:

- latest pushed commit;
- tests/typecheck status;
- completed slice;
- active slice;
- next 1-3 planned slices;
- blockers or feedback checkpoints, if any.
