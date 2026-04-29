# Codex Runtime Strategy

`agent-core` distinguishes two Codex integrations because they have different permission properties.

## `openai-codex` provider — preferred normal runtime

Use this for the normal Mira/agent runtime once implemented end-to-end.

- Transport style: API/tool-loop provider.
- Auth route: ChatGPT/Codex subscription OAuth route, conceptually matching OpenClaw's `openai-codex` provider.
- Model examples: `openai-codex/gpt-5.5` / `gpt-5.5` depending on config layer.
- Agent-core owns tool schemas, exact args, allow/ask/deny decisions, approvals, execution, and audit.

This is the right boundary for approval-sensitive work.

## `codex-cli` provider — harness/worker only

Use this only as a delegated coding harness or sandboxed worker.

- Transport style: CLI subprocess / harness.
- Codex owns its internal planning and file/shell attempts.
- Agent-core cannot reliably inspect every proposed operation before Codex tries it.
- Good for patch proposals or isolated coding tasks.
- Bad as the default live assistant runtime when permissions are core.

## Current implementation state

`src/llm/openai-codex-provider.ts` currently defines the provider shell and canonical Codex subscription route:

- API: `openai-codex-responses`
- Base URL: `https://chatgpt.com/backend-api/codex`

The next implementation step is OAuth credential resolution compatible with Jan's existing OpenClaw login, without logging or copying raw secrets.
