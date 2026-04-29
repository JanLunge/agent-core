# Codex API Provider

Agent Core's normal assistant runtime must use an API-style provider, not the Codex CLI harness. This keeps tool execution, approvals, and audit inside Agent Core.

## Boundary

Agent Core does **not** let Codex CLI execute normal assistant/tool-capable turns. `codex-cli` is a harness for delegated coding work only. The normal Mira runtime should use `openai-codex` or another function-calling API provider so Agent Core owns the model/tool loop.

## Current project config

`config.yaml` uses the API-style Codex route:

```yaml
providers:
  - name: codex-api
    type: openai-codex
    api_key_env: OPENAI_CODEX_ACCESS_TOKEN
    default_model: gpt-5.5
  - name: codex-cli-harness
    type: codex-cli
    command: codex
    default_model: gpt-5.5
default_provider: codex-api
default_model: gpt-5.5
```

`roles/companion.yaml` defaults Mira to `gpt-5.5`.

If `OPENAI_CODEX_ACCESS_TOKEN` is missing, startup fails loudly rather than falling back to Codex CLI.

## Verify

Build/test first:

```bash
pnpm test
pnpm typecheck
pnpm build
node dist/index.js status -d .
```

Then run a live provider check, which invokes Codex CLI OAuth without exposing secrets:

```bash
pnpm exec tsx scripts/live-codex-check.ts
```

If OAuth is missing or expired, Codex will fail and Jan should rerun `codex login`.
