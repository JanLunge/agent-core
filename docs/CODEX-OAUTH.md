# Codex OAuth Provider

Agent Core can use OpenAI/ChatGPT OAuth through the official Codex CLI instead of storing API keys in Agent Core config.

## Boundary

Agent Core does **not** read `.env` files, Codex auth files, OAuth token files, or raw credentials. The `codex-cli` provider shells out to `codex exec`; the Codex CLI owns OAuth login, refresh, and token storage.

## One-time setup owned by Jan

Run this yourself in a terminal:

```bash
codex login
```

Follow the browser/device OAuth flow. After that, Agent Core can use the existing Codex CLI login.

## Current project config

`config.yaml` uses:

```yaml
providers:
  - name: codex
    type: codex-cli
    command: codex
    default_model: gpt-5.5
default_provider: codex
default_model: gpt-5.5
```

`roles/companion.yaml` defaults Mira to `gpt-5.5`.

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
