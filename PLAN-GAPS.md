# PLAN-GAPS.md — What Claude's Plan Missed

> Audit of PLAN.md against "what do we need for a usable OpenClaw replacement?"

## The Core Problem: Timeline is Backwards

Claude put Telegram (primary surface) in Phase 4 and tool execution in Phase 2. The result: you can't use anything meaningful until week 16. A usable MVP needs to move.

## What's Missing

### 1. Telegram Connector — Must Move to Phase 1
**Current:** Phase 4 (~16 weeks)
**Should be:** Phase 1

Without Telegram, there's no usable surface. Everything else is secondary. The plan should be:
- Config + Identity + Prompt + LLM + Telegram + basic tool execution = working bot in Phase 1
- Everything else builds on top

### 2. No Interactive TUI / CLI Chat Interface
**Status:** Not mentioned
**Need:** A terminal-based chat interface (like a simple TUI) for direct interaction when not using Telegram. Think `blessed`, `ink`, `terminal-kit` — something that shows:
- Message history in a scrollable area
- Input line at bottom
- `/command` support
- Agent typing/streaming indicators

### 3. Tool Execution Engine Not Specified
**Current:** Phase 2 covers *permissions* only
**Missing:**
- Tool registry with actual implementations (read, write, exec, web_search, web_fetch, etc.)
- Tool invocation loop (LLM decides → tool runs → result captured → fed back)
- Tool result formatting (how results get injected back into the prompt)
- Tool error handling (what happens when exec fails, read permission denied, etc.)

These are the **core capability primitives** — without them, the agent can't DO anything. They need to exist before Phase 2.

### 4. /commands and Skill System Underspecified
**Current:** "skill loading" mentioned in prompt assembly, no routing logic
**Missing:**
- Command parser (detect `/command args`)
- Command routing (which skill handles which command)
- Tool integration for command responses (commands can also call tools)
- Dynamic skill discovery and loading lifecycle
- Skill conflict resolution (what if two skills match the same trigger)

### 5. Session State Manager Scattered
**Current:** "basic session loop" in Phase 1, "episode detection" in Phase 2
**Missing:**
- Explicit session state object (conversation history, agent context, tool state)
- Session persistence between turns (save/restore)
- Session lifecycle (create, pause, resume, reset)
- Multi-session support per agent (Telegram chat A vs B)

### 6. Heartbeat / Proactive Behavior Too Late
**Current:** Phase 4
**Should be:** Phase 2

Basic heartbeat timer is simple to implement — should be early for the agent to be useful without constant prompting.

### 7. LLM Client Not Explicitly Planned
**Current:** Referenced vaguely as "call model"
**Missing:**
- LLM client abstraction (OpenAI-compatible API, streaming, function calling/tool calls)
- Provider switching (OpenRouter, Anthropic, local)
- Auth/profile management per provider
- Streaming handling (SSE/text-event-stream)
- Rate limit handling + retry logic
- Cost tracking

### 8. Message Pipeline Not Described
**Missing:**
- How a message flows from surface → parser → prompt builder → LLM → tool call → result → reply → surface
- Formatting layer (Markdown on Telegram, no tables on Discord, etc.)
- Reply tag handling (`[[reply_to_current]]`)
- Group chat filtering (when to respond vs HEARTBEAT_OK)

---

## Revised Phase 1 — "Working Agent" (4-5 weeks)

What Phase 1 SHOULD be to have something actually usable:

| Task | Complexity |
|------|------------|
| Config schema + loader + CLI | M |
| Agent identity (SOUL, IDENTITY, USER) | S |
| LLM client abstraction (OpenAI-compatible, streaming) | M |
| Prompt assembler (modular, token budget) | M |
| Tool registry + core tool implementations (read, write, exec, web_search, web_fetch, sessions_spawn, memory_search) | M |
| Tool execution loop + result injection | M |
| File-based memory (daily files + MEMORY.md, same as current) | S |
| Session state manager (turn state, persistence, lifecycle) | M |
| /command parser and routing | S |
| Telegram connector | M |
| CLI/TUI for direct chat (simple terminal interface) | M |
| Basic heartbeat timer | S |
| Group chat behavior rules (when to respond/HEARTBEAT_OK) | S |
| Platform formatting layer | S |
| Reply tag handling | S |

**Exit criteria:** Mira runs on Telegram, has a CLI/TUI for direct chat, can use tools, remembers context, supports /commands, and fires heartbeats. Essentially a working OpenClaw clone for the core features.

## Revised Phase 2 — "Smarter Agent" (3-4 weeks)

| Task | Complexity |
|------|------------|
| Vector memory (sqlite-vec) + semantic search | M |
| History compaction (episodes → summaries) | M |
| Memory distillation pipeline | M |
| Tool result compaction (adaptive formatting) | S |
| Tool permission engine (wildcard allow/deny/approval) | M |
| Heartbeat full features (sticky notes, email/calendar checks) | M |
| Skill system (full lifecycle, dynamic loading, conflict resolution) | M |

**Exit criteria:** Memory has semantic recall. Long chats don't degrade. Tool calls are gated by permissions.

## Revised Phase 3 — "Safety" (2-3 weeks)

| Task | Complexity |
|------|------------|
| Encrypted vault (age) | M |
| Approval flow (gated tools → human via Telegram) | M |
| Cross-agent isolation | M |
| Audit trails (config, secret access) | S |

## Revised Phase 4 — "Multi-Agent" (3-4 weeks)

| Task | Complexity |
|------|------------|
| Multi-agent orchestrator | M |
| Agent spawner | M |
| Discord connector | M |
| Webhook adapter | S |
| WebSocket gateway + HTTP API | M |

## Revised Phase 5 — "Handoff" (4-5 weeks)

| Task | Complexity |
|------|------------|
| Coding agent handoff protocol | M |
| Claude Code integration | M |
| Workspace sandbox (git worktree) | M |
| Session-mode persistent coding | M |
| Diff review pipeline | M |

**Total: ~16-21 weeks instead of 26-30 weeks**, with a **usable agent at week 4-5 instead of week 16**.
