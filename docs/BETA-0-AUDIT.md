# Beta Slice 0 — Product-Path Audit

Date: 2026-04-29

## Summary

Alpha produced useful contracts and plumbing, but the dogfoodable product path is not yet real enough. The shortest beta path is not more isolated modules; it is one debuggable vertical runtime that takes a Telegram-shaped message, routes it through durable runtime state, invokes a real agent/provider, records guard/tool/approval/audit artifacts, and can be inspected after the run.

## Target Dogfood Path

```text
Telegram-shaped input or local replay
  -> normalized event
  -> router decision + durable route/session
  -> working memory + daily continuity
  -> real agent/provider execution
  -> guarded tool boundary / approval request when needed
  -> assistant reply or explicit blocker
  -> durable audit/status/debug refs
```

A live Telegram send is intentionally not Beta Slice 1. First the local/replay path must be debuggable and free of fake product-path behavior. Live Telegram dogfooding needs a Jan checkpoint because it sends external messages.

## What Is Real and Reusable

- `src/channel/telegram/connector.ts`: real Telegram connector for the original `agent.processMessage` route, including streaming edits, whitelist checks, and approval buttons.
- `src/llm/openai-provider.ts`, `src/llm/openai-codex-provider.ts`, `src/llm/codex-cli-provider.ts`: real provider implementations or provider seams already exist.
- `src/agent/agent.ts` + `src/conversation/loop.ts`: real agent loop exists for configured agents/providers/tools.
- `src/runtime/orchestrator.ts`: good durable runtime skeleton: event block, route block, session store, working memory, model decision, guard decisions, blocker persistence, daily continuity, notification intent/outbox.
- `src/heaper/local-storage.ts`: usable local durable JSON store for beta dogfooding.
- `src/cli/runtime-status.ts`, `src/cli/audit-export.ts`, `src/cli/task-resume.ts`: useful debugging/inspection surfaces.
- `src/tools/boundary.ts`, `src/tools/guard.ts`, `src/tools/approval-requests.ts`: reusable guarded tool/approval artifacts for runtime path.

## Product-Path Blockers and Required Beta Tasks

| ID | Blocker | Evidence | Required beta task |
| --- | --- | --- | --- |
| B0-1 | Dogfood runtime commands use `FakeAgent` / scripted responders instead of real agent/provider execution. | `src/cli/runtime-smoke.ts`, `src/cli/runtime-telegram-spike.ts`, `src/runtime/fake-agent.ts` | Beta Slice 2: replace fake agent on dogfood path with a real provider-backed responder/agent adapter. Keep `FakeAgent` only in unit tests. |
| B0-2 | `runRuntimeEvent` has a `defaultResponder` that returns prepared-context text if no responder is supplied. This can hide missing provider wiring. | `src/runtime/orchestrator.ts` | Beta Slice 1/2: require an explicit responder for runtime dogfood commands; missing responder/provider should fail as a blocker, not produce a fake reply. |
| B0-3 | Runtime model decisions select placeholder ids like `remote/default` and `local/small`; selection is audited but not connected to provider execution in runtime dogfood path. | `src/cli/runtime-smoke.ts`, `src/cli/runtime-telegram-spike.ts` | Beta Slice 1: make provider/model configuration explicit and visible; fail clearly if unavailable. |
| B0-4 | Telegram production connector still uses the old router -> `agent.processMessage` path, not the durable runtime orchestrator path. | `src/channel/telegram/connector.ts` vs `src/runtime/orchestrator.ts` | Beta Slice 4/5: add replay/dry-run through the real Telegram adapter boundary, then live connector integration after Jan checkpoint. |
| B0-5 | Spike tools are deterministic fixtures (`spike.status`, `spike.write-note`, `spike.read-secret`) rather than real product tools. | `src/cli/runtime-telegram-spike.ts` | Beta Slice 1/3: mark fixture tools as test-only; dogfood path should either expose real core tools through guard boundary or list missing tools as blockers. |
| B0-6 | Real Heaper adapter is intentionally non-functional. Local JSON store is acceptable for beta, but Heaper cannot be claimed. | `src/heaper/heaper-client.ts` | Keep as known post-dogfood blocker unless dogfood requires real Heaper. Do not let `kind: heaper` silently run. |
| B0-7 | Conversation loop contains a fallback stub response for tool calls when no registry/context exists. | `src/conversation/loop.ts` | For product paths, require registry/context or fail with explicit blocker for tool-capable runs. Unit tests may still cover fallback behavior separately. |

## Shortest Path to Dogfoodable Beta

1. **Beta Slice 1 — Dogfood runtime command with real provider seam**
   - Adapt or replace `runtime-smoke` so it can run one local Telegram-shaped turn through `runRuntimeEvent` with explicit provider/model config.
   - If provider credentials/config are missing, write a blocker and fail clearly; do not use fake agent output.
   - Print debug refs: store path, event, route, model, session/user/assistant, blockers, notifications, audit command.

2. **Beta Slice 2 — Replace fake agent on dogfood path**
   - Add a runtime responder that calls the configured `LLMProvider` with assembled working-memory context.
   - Keep `FakeAgent` exported only for tests and rename docs to make it test-only.

3. **Beta Slice 3 — Debug one run without spelunking JSON**
   - Add/extend inspector output so one run shows session, route history, messages, memory blocks, guard/tool decisions, approvals, notifications, and blockers.

4. **Beta Slice 4 — Telegram adapter replay through runtime path**
   - Replay Telegram-shaped updates through the same normalization/channel metadata that live Telegram uses, but without sending messages externally.

5. **Beta Slice 5 — Live Telegram checkpoint**
   - After local replay works and fake blockers are removed from the dogfood path, ask Jan before running a live Telegram bot/message test.

## Validation Standard Going Forward

- End-user acceptance beats internal proof. A slice is not done until there is a believable user-facing scenario, a command/replay/live check that exercises it, or an explicit blocker explaining why the user path cannot yet work.
- Unit tests with fakes validate mechanics only.
- Product progress requires at least one of:
  - real provider boundary execution;
  - local Telegram-shaped fixture replay through runtime path;
  - CLI smoke producing durable refs and inspectable audit/status output;
  - explicit blocker files/blocks when real execution cannot proceed.

## Decision

Start Beta implementation with Beta Slice 1. Do not add more general-purpose architecture until B0-1, B0-2, and B0-3 are resolved or explicitly blocked by missing credentials/config.
