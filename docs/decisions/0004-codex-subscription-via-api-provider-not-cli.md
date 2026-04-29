# Decision 0004 — Codex Subscription as API Provider, Codex CLI as Harness Only

Date: 2026-04-29
Status: accepted

## Context

Jan clarified that permission and approval control is core to `agent-core`. The recent Telegram tests exposed a structural mismatch:

- API-style providers return tool calls to `agent-core`; the runtime can inspect exact arguments, guard them, ask for approval, execute, and audit the result.
- The Codex CLI harness owns its own internal loop; it receives free text and may attempt file/shell operations inside its own sandbox. `agent-core` mostly sees final text/stdout, not a reliable structured operation proposal stream.

This means Codex CLI is a poor fit for the normal Mira runtime when approval correctness matters. It can bypass or conflict with the `agent-core` operation/approval model, even if sandboxed read-only.

OpenClaw has a separate `openai-codex` / ChatGPT OAuth route that behaves like an API provider using the Codex subscription route (`openai-codex-responses`, e.g. `openai-codex/gpt-5.5`). That route is a better fit for `agent-core` because the application can own the model/tool loop.

## Decision

`agent-core` should treat the Codex subscription as an API-style provider, not primarily as the Codex CLI harness.

- Normal live assistant runtime should use an API/tool-loop provider when approvals are important.
- A future `openai-codex` provider should use the ChatGPT OAuth/Codex subscription route in the same conceptual style as OpenClaw's `openai-codex` provider.
- Codex CLI (`codex-cli`) remains available only as a worker/harness boundary for coding tasks, patch proposals, or sandboxed delegation.
- Codex CLI should not be the default normal Mira runtime for operations that require exact approval control.

## Consequences

- Approval attaches to exact executable operations/tool calls, not to Codex CLI free-text attempts.
- `agent-core` owns tool schemas, guard decisions, approval rendering, execution, and audit records.
- Harnesses such as Codex CLI, Claude Code, etc. should return proposals/artifacts or operate in a clearly separated trust boundary.
- Direct mutation by harnesses should be explicitly delegated and sandboxed, not implicit in normal chat.

## Implementation direction

1. Add an `openai-codex` provider type alongside existing `openai-compatible`, `local`, and `codex-cli` providers.
2. Implement it as an API-style `LLMProvider` capable of returning tool calls to the normal `runTurn` loop.
3. Reuse Jan's existing ChatGPT/Codex OAuth setup where possible; do not copy or expose raw secrets in logs.
4. Move normal configuration from `codex-cli` to `openai-codex` once the provider works.
5. Keep `codex-cli` documented as a harness/worker, not the approval-sensitive runtime.
