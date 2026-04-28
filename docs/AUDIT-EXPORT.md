# Audit Export

`agent-core audit-export` inspects a LocalHeaperMemory store from a single block ref and prints a deterministic linked audit trail. It is meant for local debugging of runtime sessions/tasks without deleting or compacting any underlying blocks.

## Export an existing local store

```bash
agent-core audit-export agent/sessions#tgspike-2 --store ./memory.json --depth 6
```

Expected inspection pattern:

- start from a session/task ref such as `agent/sessions#...` or `agent/tasks#...`;
- look for labelled refs: `[event]`, `[route]`, `[model]`, `[guard]`, `[approval]`, `[tool]`, `[tool-output]`, `[blocker]`, `[message]`, `[daily]`;
- follow the printed `links:` lines when you need to drill into source blocks;
- treat redacted values (`[REDACTED]`) as intentional safety behavior, not missing data.

## Build a deterministic Telegram-spike fixture

Use the fixture command when you need a representative runtime store with routing, memory, guards, approvals, tool output, blockers, and daily continuity refs:

```bash
agent-core audit-export-fixture --store /tmp/agent-core-audit-fixture.json --depth 6
```

The fixture prints:

1. the store path it created;
2. the session start ref;
3. the exact `agent-core audit-export ...` command to re-run;
4. four synthetic Telegram turns;
5. the audit trail output.

The generated trail should include:

- `agent/sessions#... [session]` for the durable Telegram conversation;
- `agent/audit#... [event]`, `[route]`, `[model]`, and `[guard]` for runtime decisions;
- `agent/audit#... [approval]` for the write-note request that requires approval;
- `agent/audit#... [tool]` and `agent/tool-output#... [tool-output]` for the allowed status tool;
- `agent/audit#... [blocker]` for the denied sensitive/external path;
- `agent/sessions#... [message]` for persisted user/assistant turns;
- `agent/daily#... [daily]` for continuity written by completed live turns.
