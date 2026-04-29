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
    # Optional: pin an OpenClaw auth profile. Omit to use the best unexpired openai-codex profile.
    # openclaw_auth_profile: openai-codex:default
    default_model: gpt-5.5
  - name: codex-cli-harness
    type: codex-cli
    command: codex
    default_model: gpt-5.5
default_provider: codex-api
default_model: gpt-5.5
```

`roles/companion.yaml` defaults Mira to `gpt-5.5`.

Credential resolution order is: agent-core vault/env `OPENAI_CODEX_ACCESS_TOKEN`, then the OpenClaw auth profile named by `openclaw_auth_profile` or the best unexpired `openai-codex` profile when no profile is pinned. The OpenClaw token is read at runtime and is not copied into agent-core config or vault.

If neither credential source is available, startup fails loudly rather than falling back to Codex CLI.

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
