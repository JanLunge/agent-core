# Agent-Core Rolling Roadmap

This roadmap is intentionally never "finished". Each completed slice must leave a validated next slice behind, so Mira can report current progress and continue on heartbeats without waiting for Jan to restate the plan.

## Operating Rule

Every work session should end with:

1. a committed, pushed, verified change if anything meaningful changed;
2. an updated local `HEARTBEAT-STATE.md` entry;
3. at least one concrete next step;
4. no claim that the project is "done" unless Jan explicitly pauses it.

Use `docs/BUILD-ORDER.md` for phase-level acceptance tests and this file for rolling implementation slices.

## Current Progress

- [x] Capture Heaper-compatible architecture and safety/runtime decisions.
- [x] Define initial Heaper block/domain types.
- [x] Define heap permission decisions for `human/*`, `agent/*`, and `persona/*`.
- [x] Add local in-memory `HeaperMemory` scaffold with tests.

## Active Slice Queue

### Slice 1 — Session summary blocks

Goal: connect existing conversation/session persistence to the Heaper-shaped memory layer without replacing storage wholesale.

Validation:
- create a session summary block in `agent/*` or `persona/<name>/*`;
- link it to a daily entry;
- test that today's daily entry can retrieve the linked summary.

### Slice 2 — Normalized event type

Goal: define the interface-layer event shape for chat, TUI, voice, API, and background triggers.

Validation:
- construct events from at least chat and background inputs;
- route sensitivity/mode/persona hints into typed fields;
- test deterministic routing metadata extraction.

### Slice 3 — Router planning decision

Goal: make the router produce an explicit decision before invoking the agent: session id, persona, mode, sensitivity, and model policy hint.

Validation:
- same channel resumes the same session;
- addressed persona selects the persona heap;
- sensitive input sets sensitive mode;
- background input does not request live response by default.

### Slice 4 — Command guard boundary

Goal: centralize allow/deny/ask decisions for shell, API, and file writes.

Validation:
- denies `.env`/secret-like reads;
- asks for risky writes;
- blocks external calls in sensitive mode;
- emits auditable decision objects.

### Slice 5 — Tool output blocks

Goal: store full tool outputs as Heaper blocks and return bounded summaries/references to the agent.

Validation:
- small output can pass directly;
- large output is stored and summarized;
- full output can be retrieved by reference;
- search within stored output works through memory API.

## Reporting Template

When Jan asks for progress, report:

- latest pushed commit;
- tests/typecheck status;
- completed slice;
- active slice;
- next 1-3 planned slices;
- blockers, if any.
