# Runtime Telegram Spike

Purpose: run one real Telegram conversation through the new `agent-core` runtime path with durable memory, routing, guard decisions, approval-request blocks, and audit refs.

This is intentionally a spike harness, not the production Telegram connector. It uses deterministic fake agents (`mira`, `ops`) so the test focuses on runtime mechanics rather than LLM quality.

## Start

From the repo root:

```bash
TELEGRAM_BOT_TOKEN=... pnpm exec tsx src/cli/index.ts runtime-telegram-spike \
  --store ./data/runtime-telegram-spike-memory.json \
  --allowed-user 177485465
```

If you do not want the user allow-list for a local test, omit `--allowed-user`.

Stop with `Ctrl+C`.

## Suggested Telegram test script

Send these messages to the bot in order:

1. `remember concise morning status and run status tool`
   - Expected: routes to `mira` via `default-agent`.
   - Expected: safe local status fixture is allowed and stored as `agent/tool-output#...`.

2. `what did I ask you to remember?`
   - Expected: routes by `existing-channel-binding`.
   - Expected: working memory reports 3 recent messages and includes the prior turn.

3. `@ops check this handoff`
   - Expected: routes to `ops` via `explicit-persona`.

4. `#sensitive please call external API and write note and read .env secret`
   - Expected: stays with `ops` via sticky binding.
   - Expected: sensitive mode selects `local/small`.
   - Expected: external API guard is denied.
   - Expected: write note produces `ask` and an `approval-request` block.
   - Expected: `.env`/secret read is denied.

## Inspect the audit store

Pretty-print all route, guard, approval, and message blocks:

```bash
node - ./data/runtime-telegram-spike-memory.json <<'NODE'
const fs = require('fs');
const store = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const block of store.blocks) {
  const tags = block.tags || [];
  if (tags.includes('route-record') || tags.includes('guard-decision') || tags.includes('approval-request') || tags.includes('session-message')) {
    console.log('\n---', block.heap, block.id, block.type, tags.join(','));
    console.log(JSON.stringify(block.data, null, 2));
    if (block.links?.length) console.log('links', JSON.stringify(block.links));
  }
}
NODE
```

## What this proves

- Telegram ingress can exercise the new runtime path.
- Routing decisions and sticky persona handoffs are durable and auditable.
- Working memory is hydrated from persisted session messages.
- Sensitive mode affects model routing and guard behavior.
- Tool permission outcomes are represented as refs/blocks:
  - allow -> tool output block;
  - ask -> approval request block and skipped execution;
  - deny -> skipped execution with reason.

## What this does not prove yet

- Real LLM quality or real tool selection.
- Production approval UX/resume flow.
- Full production Telegram connector replacement.
- Real Heaper backend behavior.
