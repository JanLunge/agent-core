# Agent Core — Implementation Plan

> Node.js / TypeScript. Monorepo. Ground-up rewrite of OpenClaw.
>
> Written 2026-04-01. Revised 2026-04-01. Based on SPEC.md, analysis of the running OpenClaw system, gap analysis (PLAN-GAPS.md), and entity model brainstorm.

---

## 0. Design Constraint: Usable Early

The #1 failure mode of this plan is building infrastructure nobody can use. OpenClaw runs today on Telegram — that's the primary surface. Phase 1 must produce a working Telegram bot with tool execution, memory, and /commands. The entity model (agent/conversation/channel/role) is in place from day one, but kept simple — one agent, one channel, no switching. Everything else builds on top of that.

---

## 1. Entity Model — Agents Are People

The system has four core concepts. Everything else is implementation detail.

### The Four Entities

**Agent** — a person. Has a name, personality, memory, skills. One brain. Can hold multiple conversations at once. Everything they experience feeds back into who they are.

**Conversation** — a chat thread. An agent can have many open at once. Each has its own flow and focus (working context), but the agent remembers across all of them. When a conversation ends, the important bits distill into the agent's memory.

**Channel** — where you talk. Telegram, voice, terminal, WebSocket. A conversation can happen across multiple channels (start on Telegram, continue on terminal). A channel feeds one conversation at a time.

**Role** — a template for creating agents. Like a job description. "Companion," "Researcher," "Planner," "Coder." You pick a role, give it a name, and you have an agent. No configuring from scratch.

### How They Relate

```
Role (template, reusable)
  "companion", "researcher", "coder", "planner"
    │
    │ instantiates
    ▼
Agent (persistent identity, one brain)
  name, personality, memory, skills, status
    │
    │ has many
    ▼
Conversation (chat thread, has its own focus)
  participants, history, working context, mode
    │
    │ connected via (M:N)
    ▼
Channel (dumb I/O pipe)
  telegram bot, terminal, voice, websocket
```

**Key relationships:**
- One agent can run multiple conversations concurrently (like a person with multiple chat windows)
- One conversation can span multiple channels (start on phone, continue on desktop)
- One channel feeds one conversation at a time (this Telegram chat → this conversation)
- Channels can be rebound (switch which conversation a channel points to)

### Agent Configuration

Creating an agent feels like introducing someone:

```yaml
# agents/mira.yaml
name: Mira
role: companion
model: claude-sonnet-4
personality: ./SOUL.md
knows_about: ./USER.md
skills: [web-search, code-review, calendar]
```

Roles define sensible defaults:

```yaml
# roles/researcher.yaml
name: Researcher
description: Digs deep into topics, returns structured findings
default_model: claude-sonnet-4
skills: [web-search, web-fetch, memory-search]
tools:
  allow: [read:*, exec:rg*, web_search, web_fetch]
  deny: [write:*, exec:rm*]
```

### Memory: One Brain

An agent has one memory, not per-conversation memory. This is what makes them feel like a person.

```
Agent Memory (singular)
├── long-term: accumulated knowledge across ALL conversations
├── per-conversation "focus": working context for that thread
└── when a conversation ends: important bits distill upward
    when a delegation returns: agent absorbs the findings
```

Each conversation has a **focus** — the working context for that specific thread. But the agent's memory is singular. When you ask Mira something in conversation B that she learned in conversation A, she just knows it.

The underlying mechanics are still the tiered memory system from the spec (working/short-term/long-term/identity). The abstraction is: one brain.

### Agent Self-Awareness

An agent has tools to be aware of its own activity:

```typescript
my_conversations()       // list active conversations, topics, channels
peek(conversationId)     // check what's happening in another thread
tell(conversationId, msg) // send a message to another conversation
```

This means you can be in one conversation with Mira and ask "what are you working on in that other thread?" and she can check.

### Agent-to-Agent: Human Verbs

Agents interact using simple verbs, not protocol names:

| Verb | What it means | Under the hood |
|------|--------------|----------------|
| **ask** | Get help, wait for answer | Spawn agent from role, delegate task, receive structured result. Requester's context stays clean — only gets the summary, not the back-and-forth. |
| **hand off** | Transfer this conversation to another agent | Rebind channel to new agent's conversation. Context transfer is configurable: clean slate, summary, or full. |
| **check in** | Peek at what someone's doing | Read another agent's current conversation state. |
| **share** | Post to a team's board | Write to shared team state. |

The **ask** pattern is especially important: Mira asks a planner to interview the user about requirements. The planner goes 20 turns deep. Mira gets back a structured document. Her context window is clean.

### Agent Lifecycle

Two natural modes, no configuration needed:

- **Long-lived agents** (like Mira): always running, accumulate memory, have ongoing conversations. These are "the team."
- **Task agents**: spun up by another agent via **ask**, do their job, return results, archive. Their useful findings merge into the requesting agent's memory.

The system handles this automatically — a long-lived agent is just one that keeps getting talked to.

### Teams and Boards

When agents work together on a shared objective:

```yaml
# teams/project-alpha.yaml
name: Project Alpha
goal: Build the auth system
members: [mira, researcher, coder]
lead: mira
board: ./boards/project-alpha/
```

The **board** is shared state — not a chat log, but a notebook. Mira writes the plan, researcher adds findings, coder posts the PR link. Any member can read the board.

```typescript
board_read(team, key?)          // read shared state
board_write(team, key, value)   // update shared state
board_subscribe(team, key)      // get notified on changes
```

### Journal: Inspectable Records

Every agent keeps a **journal** — a structured record of what they did. Not for the agent's daily use (that's memory), but for review and self-improvement.

```
journals/
  mira/
    2026-04-01/
      conversation-abc.trace   # per-turn: input, prompt, LLM call, tool calls, result
      conversation-def.trace
```

Each turn in a journal records:
- Input (who said what, which channel)
- Prompt assembled (which sections, token counts)
- LLM call (model, tokens in/out)
- Tool calls (tool, args, result, duration, success/failure)
- Annotations (retries, user corrections, error recovery)

Stored in SQLite for querying:
- "Show me conversations where tool X failed"
- "What tools does Mira use most?"
- "Find turns where the user corrected the agent" (improvement candidates)

The self-improvement loop: review journals, find patterns where agents struggle, improve instructions or tool descriptions. Both human-driven and automated.

### The Router

The **router** is the component that connects everything. It sits between channels and conversations:

- Maps channel + chat_id → conversation → active agent
- Handles agent switching (all modes: clean, with context, delegation with return)
- Manages multi-channel conversation binding
- Decides what context transfers on switch

This is the new critical component that the original plan didn't have.

---

## 2. Tech Stack Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Language** | TypeScript (Node.js 22+) | OpenClaw already runs on Node 22. Ecosystem advantage for LLM tooling, Telegram/Discord libs, SQLite bindings. TS is the pragmatic call. |
| **Vector store** | sqlite-vec | Single-file deployment, no external service. Embeds via `better-sqlite3` + `sqlite-vec` extension. Keeps the "just copy the folder" deployment model. |
| **Encryption** | age (via `age-encryption` npm) | Simpler than libsodium for file-level encryption. CLI-friendly, composable with OS keychain. |
| **Messaging transport** | Rewrite with adapter pattern | Thin adapter interface, reimplement Telegram first (known working), add Discord/webhooks later. |
| **Embeddings** | Local first (Ollama / LM Studio), cloud API optional | Use local embedding models via Ollama or LM Studio (e.g. nomic-embed-text, mxbai-embed-large). Cloud API (OpenAI, etc.) available as optional fallback. Configurable per-agent. |
| **Config format** | YAML (with JSON Schema validation) | Human-readable for nested structures. JSON Schema gives validation + IDE autocomplete. |
| **Runtime** | Node.js 22 LTS, ESM-only | Native ESM, `node:` prefix imports, built-in test runner for unit tests. No CommonJS. |
| **Build** | tsup (for libs), tsx (for dev) | Fast, zero-config. No webpack/rollup complexity. |
| **Package manager** | pnpm with workspaces | Strict dependency isolation, fast installs, good monorepo support. |

---

## 3. Monorepo Structure

```
agent-core/
  pnpm-workspace.yaml
  tsconfig.base.json
  package.json                    # root scripts: build, test, lint

  packages/
    config/                       # Config schema, loader, validator, CLI
      src/
        schema.ts                 # Zod schemas for agent.yaml, role.yaml, master.yaml, team.yaml
        loader.ts                 # YAML parsing + validation + hot-reload watcher
        cli.ts                    # `agent-config` CLI (validate, set, diff, etc.)
      package.json

    llm/                          # LLM client abstraction (internal, not user-facing)
      src/
        client.ts                 # Core LLM client interface + factory
        providers/
          openai.ts               # OpenAI-compatible provider (OpenRouter, Anthropic via proxy)
          anthropic.ts            # Native Anthropic API provider
          local.ts                # LMStudio / Ollama / local model provider
        streaming.ts              # SSE/streaming response handler
        function-calling.ts       # Tool/function call schema builder + response parser
        auth.ts                   # Provider auth profiles, key rotation
        rate-limit.ts             # Rate limiter + retry logic (token bucket)
        cost.ts                   # Token usage tracking, cost estimation per-model
        types.ts                  # Shared types: Message, ToolCall, Usage, etc.
      package.json

    prompt/                       # Prompt assembly engine
      src/
        assembler.ts              # Build prompt from sections, enforce token budgets
        sections/                 # Section builders (identity, skills, memory, tools)
        budget.ts                 # Token counting + allocation
      package.json

    memory/                       # Agent memory — "one brain"
      src/
        brain.ts                  # Unified memory interface per agent (one brain abstraction)
        focus.ts                  # Per-conversation working context (scoped, ephemeral)
        tiers/
          short-term.ts           # SQLite FTS for recent events
          long-term.ts            # sqlite-vec embeddings for distilled knowledge
          identity.ts             # Plain text file loader (SOUL.md, personality)
        search.ts                 # Unified query across tiers, rank + merge
        writer.ts                 # Write path: event logging, distillation upward
        absorb.ts                 # Merge findings from delegations/task agents into agent memory
        pruning.ts                # Usage-frequency scoring, archival
        embeddings.ts             # Embedding provider abstraction (local / API)
        db.ts                     # SQLite + sqlite-vec setup, migrations
      package.json

    history/                      # History compaction
      src/
        episodes.ts               # Episode detection (group messages into logical convos)
        compactor.ts              # Episode -> structured summary
        archive.ts                # Original messages to disk, retrieval by ID
        window.ts                 # Rolling window manager (full detail vs compacted)
      package.json

    secrets/                      # Encrypted vault
      src/
        vault.ts                  # age-encrypted file read/write
        manifest.ts               # Secret metadata (label, scope, rotation date)
        resolver.ts               # Label -> decrypted value (never logged)
        audit.ts                  # Access audit log
        keychain.ts               # Master key from env var or OS keychain
      package.json

    tools/                        # What agents can do
      src/
        registry.ts               # Tool definitions, metadata, discovery
        executor.ts               # Tool execution loop (LLM decides → run → capture → feed back)
        result.ts                 # Tool result formatting + injection into prompt
        error.ts                  # Tool error handling (exec fail, permission denied, timeout)
        mcp-client.ts             # MCP client: connect to MCP servers, load tool definitions, proxy calls
        sandbox.ts                # Container sandbox for exec tool (Docker / Apple Container, Phase 3)
        self-author.ts            # Agent creates new tool implementations from journal patterns (Phase 2)
        implementations/
          read.ts                 # File read tool
          write.ts                # File write tool
          exec.ts                 # Shell command execution
          web-search.ts           # Web search tool
          web-fetch.ts            # URL fetch tool
          memory-search.ts        # Memory search tool (queries agent's brain)
          memory-write.ts         # Memory write tool (agent writes to brain)
          my-conversations.ts     # List agent's active conversations
          peek.ts                 # Check another conversation's state
          tell.ts                 # Send message to another conversation
          ask.ts                  # Delegate task to another agent (spawn + wait + absorb)
          hand-off.ts             # Transfer conversation to another agent
          board-read.ts           # Read team board
          board-write.ts          # Write to team board
        permissions.ts            # Pattern matching (glob on tool namespace)
        policy.ts                 # Per-agent policy: allow/deny/require_approval
        approval.ts               # Human approval flow (routes to messaging surface)
        compaction.ts             # Tool result compaction (small/medium/large tiers)
      package.json

    agent/                        # The "person" — identity, lifecycle, self-awareness
      src/
        agent.ts                  # Agent runtime: create from role, start, stop, status
        role.ts                   # Role templates: load, validate, instantiate
        lifecycle.ts              # Long-lived vs task agents, archival on completion
        awareness.ts              # Agent's view of its own conversations and state
      package.json

    conversation/                 # Chat threads — history, focus, turn loop
      src/
        conversation.ts           # Conversation state (history, focus, participants, mode)
        persistence.ts            # Save/restore between turns (SQLite-backed)
        lifecycle.ts              # Create, pause, resume, end, archive
        focus.ts                  # Per-conversation working context management
        loop.ts                   # Core turn loop: receive → prompt → LLM → tools → reply
      package.json

    router/                       # Connects channels <-> conversations <-> agents
      src/
        router.ts                 # Channel + chat_id -> conversation -> active agent
        switch.ts                 # Agent switching: clean, with-context, delegation+return
        binding.ts                # Channel <-> conversation binding (attach, detach, rebind)
        context-transfer.ts       # What context moves on switch (none, summary, full)
      package.json

    channel/                      # I/O surfaces — dumb pipes
      src/
        adapter.ts                # Channel adapter interface
        formatting.ts             # Platform formatting rules (Telegram markdown, Discord limits, etc.)
        reply-tags.ts             # Reply tag handling ([[reply_to_current]], etc.)
        group-chat.ts             # Group chat behavior: when to respond, HEARTBEAT_OK, mention detection
        telegram/
          connector.ts            # grammy-based Telegram bot
          auth.ts                 # Allowlist + pairing flow
          format.ts               # Telegram-specific formatting (MarkdownV2 escaping, message splitting)
        whatsapp/
          connector.ts            # Baileys-based WhatsApp connector (Phase 4)
          auth.ts                 # QR pairing flow
        discord/                  # Discord connector (Phase 4)
        webhook/                  # Generic webhook (Phase 4)
        voice/
          input.ts                # Whisper transcription (local or API) (Phase 2)
          output.ts               # TTS (ElevenLabs, system TTS) (Phase 2)
          adapter.ts              # Voice as a channel — continuous or push-to-talk
      package.json

    team/                         # Group work, shared boards
      src/
        team.ts                   # Team lifecycle: create, members, lead
        board.ts                  # Shared state (read, write, subscribe)
      package.json

    journal/                      # Inspectable records for review and self-improvement
      src/
        trace.ts                  # Per-turn structured trace (input, prompt, LLM, tools, result)
        store.ts                  # SQLite storage for traces, queryable
        query.ts                  # Query interface: find failures, patterns, improvement candidates
        review.ts                 # Self-improvement: flag patterns, suggest instruction updates
      package.json

    commands/                     # /command parser and routing
      src/
        parser.ts                 # Detect and parse /command args from message text
        router.ts                 # Route commands to handlers (skills, built-ins)
        builtins.ts               # Built-in commands: /help, /status, /reset, /history, /memory, /switch, /agent
        types.ts                  # Command types, handler interface
      package.json

    handoff/                      # Coding agent delegation (specialized form of "ask")
      src/
        registry.ts               # Coding agent registry (Claude Code, Codex, etc.)
        handoff.ts                # Structured handoff protocol (prepare, spawn, review)
        sandbox.ts                # Working directory isolation for coding agents
        session.ts                # Persistent coding sessions (multi-step)
        review.ts                 # Diff review pipeline (structured results back to main)
      package.json

    heartbeat/                    # Periodic agent activity
      src/
        scheduler.ts              # Cron-like scheduler with quiet hours
        runner.ts                 # Heartbeat execution (checks, sticky notes, etc.)
      package.json

    tui/                          # Terminal-based chat interface
      src/
        app.ts                    # Main TUI application (ink or terminal-kit)
        chat.ts                   # Scrollable message history panel
        input.ts                  # Input line with /command completion
        status.ts                 # Agent status bar (typing, streaming, model info)
        stream.ts                 # Streaming token display
      package.json

    gateway/                      # WebSocket gateway + HTTP server
      src/
        server.ts                 # WS + HTTP listener
        routes.ts                 # HTTP API for agents, conversations, journals
        webhooks.ts               # Webhook ingress: POST triggers agent conversations (Phase 2)
        health.ts                 # Health checks, graceful shutdown
      package.json

    dashboard/                    # Vue-based debugging & observability web UI
      src/
        app.ts                    # Vue app entry, served by gateway's Fastify
        views/
          traces.vue              # Journal trace browser — per-turn prompt, LLM, tools
          conversations.vue       # Active conversations, history, focus
          memory.vue              # Agent brain inspector — search, view, score
          tools.vue               # Tool call log, success/fail rates, durations
          agents.vue              # Agent status, config, active channels
        components/
          prompt-viewer.vue       # Rendered assembled prompt with section highlighting
          tool-call.vue           # Single tool call: args, result, timing
          memory-entry.vue        # Memory entry with score, tier, recency
      package.json

    cli/                          # Main CLI entry point
      src/
        index.ts                  # `agent-core` CLI (start, stop, status, config, chat, etc.)
      package.json

  e2e/                            # End-to-end tests (separate from unit tests)
    config.test.ts
    memory.test.ts
    conversation.test.ts
    tools.test.ts
    agent.test.ts
    router.test.ts
    handoff.test.ts
```

**Why this split:**
- Each package has a single responsibility and clear API boundary
- Packages can be developed and tested independently
- Dependency graph flows downward: `conversation` → `llm`, `tools`, `prompt`, `memory` → `config`
- No circular dependencies by construction
- **User-facing packages** use human words: `agent`, `conversation`, `channel`, `role`, `team`, `journal`
- **Internal packages** stay technical: `llm`, `config`, `prompt`
- New packages vs original plan: `agent` (was `agents`, now includes roles), `conversation` (was `session`), `router` (new — the critical glue between channels/conversations/agents), `journal` (new — inspectability), `team` (new — shared boards), `dashboard` (new — Vue-based debugging/observability web UI, served by gateway)
- **MCP is the extension model.** Rather than building 200+ integrations like OpenClaw, we support MCP as a client in Phase 1. Any MCP server (Home Assistant, Playwright, databases, etc.) plugs in without custom code. This is how we get OpenClaw's breadth without OpenClaw's codebase size.

---

## 4. Message Pipeline

How a message flows through the system end-to-end. The **router** is the new critical layer between channels and conversations.

```
┌─────────────┐
│  Channel     │  Telegram, TUI, WebSocket, Voice, CLI
│  (input)     │  Dumb pipe — just receives raw input
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Router      │  Channel + chat_id → which conversation?
│              │  Which agent owns this conversation?
│              │  Handle /switch, /agent commands here
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Command     │  Detect /commands → route to handler
│  Parser      │  If not a command, continue pipeline
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Conversation│  Load conversation state, add message to history
│  Manager     │  Check if history needs compaction
│              │  Load conversation focus (working context)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Prompt      │  Assemble sections: identity, skills, memory
│  Assembler   │  (from agent's brain), tools, history, focus.
│              │  Enforce token budgets.
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  LLM        │  Send prompt to provider (streaming).
│  Client      │  Parse response: text + tool calls.
└──────┬──────┘
       │
       ├── text response ──────────────┐
       │                               │
       ▼                               │
┌─────────────┐                        │
│  Tool        │  If tool calls:       │
│  Executor    │  Check permissions    │
│              │  Execute tool          │
│              │  Format result         │
│              │  Feed back to LLM      │
│              │  (loop until done)     │
│              │                        │
│  Special tools handled by router:    │
│  ask() → spawn task agent + wait     │
│  hand_off() → rebind channel         │
│  peek() → read another conversation  │
│  tell() → post to another convo      │
└──────┬──────┘                        │
       │                               │
       ▼                               │
┌─────────────┐                        │
│  Journal     │  Record structured    │
│  (trace)     │  trace for this turn  │
└──────┬──────┘                        │
       │                               │
       ▼                               ▼
┌─────────────┐
│  Formatting  │  Apply platform rules (Telegram MarkdownV2,
│  Layer       │  message splitting, reply tags, etc.)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Channel     │  Deliver formatted response
│  (output)    │  Update conversation state
└─────────────┘
```

**Key behaviors:**
- **Router:** All messages pass through the router first. It resolves which agent and conversation should handle the input. Agent switching (`/switch`, `hand_off()`) happens here.
- **One brain:** Prompt assembly pulls from the agent's unified memory (brain), not per-conversation storage. The conversation provides focus (working context), the agent provides knowledge.
- **Reply tags:** `[[reply_to_current]]` resolved by the formatting layer before delivery.
- **Group chat filtering:** Channel adapter checks mention/reply rules before entering pipeline. Non-relevant messages get `HEARTBEAT_OK` or are silently ignored.
- **Tool execution loop:** LLM may request multiple sequential tool calls. Executor runs each, injects results, re-prompts LLM until it produces a final text response or hits the iteration limit. Special tools (`ask`, `hand_off`, `peek`, `tell`) route through the router for cross-conversation/cross-agent operations.
- **Journal:** Every turn is traced — input, prompt, LLM response, tool calls, result. Stored in SQLite for later querying and self-improvement review.
- **Streaming:** LLM client streams tokens. TUI renders them live. Telegram batches into edits (configurable interval, e.g., every 500ms).
- **Delegation flow:** When an agent calls `ask("researcher", task)`, the router spawns a task agent from the "researcher" role, creates a new conversation, and the task agent works (possibly interacting with the user). When done, results return to the requesting agent and relevant findings are absorbed into the agent's memory.

---

## 5. Phase-by-Phase Breakdown

### Phase 1 — Working Agent

**Goal:** A usable OpenClaw replacement. Mira runs on Telegram, responds to /commands, executes tools, persists memory, has a TUI for direct chat, and keeps a journal. The entity model (agent/conversation/channel/role) is in place from day one even if multi-agent features come later.

Phase 1 is split into three milestones so there's something testable at each stage:

#### Phase 1a — Echo Loop (~1 week)

**Goal:** Talk to an agent in the terminal. Proves the core pipeline works end-to-end.

| Task | Package | Complexity | Notes |
|------|---------|------------|-------|
| Zod schemas for all config files | config | M | agent.yaml, role.yaml, master.yaml. Must match entity model. |
| YAML loader with hot-reload | config | L | `yaml` + `chokidar` for file watching. Validate on load. Hot-reload applies to the *next* turn, never interrupts in-progress turns. Conversation holds a config snapshot at turn start. |
| Role template system | agent | M | Load role definitions, validate, instantiate agents from roles. |
| Agent directory scaffolding | config | L | Create agent dirs from role template. |
| LLM client interface + OpenAI-compatible provider | llm | M | Streaming (SSE), message types, error handling (malformed responses, rate limits, timeouts → structured errors, retry once, then surface to user). OpenRouter works through this. |
| Provider auth profiles | llm | L | Load API keys from config/env. Support multiple providers. |
| Function/tool calling schema builder | llm | M | Convert tool registry definitions to OpenAI function calling format. Parse tool call responses. Handle malformed tool calls: retry once with error context, then return parse failure to conversation. |
| Prompt section builders | prompt | M | Each section (identity, skills, memory, tools) returns text + token count. |
| Token budget allocator | prompt | M | tiktoken for counting. Per-section budgets. Drop lowest-priority if over budget. |
| Prompt assembler | prompt | L | Stitch sections, respect budgets. Agent's brain provides knowledge, conversation provides focus. |
| Identity file loader (SOUL.md, personality) | memory | L | Always-loaded tier. Token-budgeted. Part of the "one brain" interface. |
| Conversation state object | conversation | M | History, focus, participants, mode. SQLite-backed persistence. |
| Conversation lifecycle | conversation | L | Create, pause, resume, end. Multi-conversation keyed by agent + chat ID. |
| Core turn loop | conversation | M | Receive → assemble prompt (brain + focus) → call LLM → handle tool calls → produce reply. The beating heart. |
| Router (channel → conversation → agent) | router | M | Maps channel + chat_id to conversation and active agent. Single-agent for now, but the abstraction is ready for switching. State derived from config on startup, not persisted separately — channel→conversation bindings re-established on restart from agent config + active conversation list. |
| TUI chat interface | tui | M | Terminal-based chat: scrollable history, input line, /command support, streaming display. ink or terminal-kit. |
| Structured logging | cli | L | Leveled logging (debug/info/warn/error). `--verbose` flag dumps full assembled prompt and LLM response to stderr. Invaluable during development. |
| Graceful shutdown handler | cli | L | SIGTERM/SIGINT → flush pending memory writes, save conversation state, close SQLite connections, close channel connections. Prevents data loss on restart. |
| `agent-core` CLI (basic) | cli | L | `agent-core start`, `agent-core chat` (launches TUI), `agent-core status`. |

**Exit criteria:** You can run `agent-core chat`, talk to an agent powered by an LLM, and get responses. No tools, no Telegram, no memory persistence yet. The core pipeline (config → agent → router → conversation → prompt → LLM → reply) works.

#### Phase 1b — Capable Agent (~2 weeks)

**Goal:** The agent can do things (tools), remember things (brain), and be inspected (journal).

| Task | Package | Complexity | Notes |
|------|---------|------------|-------|
| Agent brain (unified memory interface) | memory | M | Single interface for all memory operations per agent. Focus per conversation, knowledge shared. File-based first (daily markdown + curated long-term). SQLite-backed index for search. |
| Conversation focus (working context) | memory | L | Per-conversation scoped context. Ephemeral — distills into brain when conversation ends. |
| Memory keyword search (FTS5) | memory | L | SQLite FTS5 on short-term. Keyword match on long-term. Placeholder for vector search. |
| Memory write semantics | memory | M | Two write paths, configurable per agent: (1) explicit `memory_write` tool — agent decides what to remember, (2) automatic distillation at conversation end — LLM extracts key facts. Both enabled by default. Dedup: exact match check for Phase 1, cosine similarity threshold in Phase 2. |
| Tool registry + metadata | tools | M | Tool definitions, parameter schemas, descriptions. Tools register themselves. |
| Core tool implementations | tools | M | `read`, `write`, `exec`, `web_search`, `web_fetch`, `memory_search`, `memory_write`. Port logic from OpenClaw where applicable. |
| MCP client support | tools | M | Connect to MCP servers for external tool access. Load tool definitions from MCP, expose to agent as regular tools. Config per-agent which MCP servers are available. This is how Home Assistant, databases, and other integrations plug in without custom code. |
| Tool execution loop | tools | M | LLM response → parse tool calls → permission check (basic allow/deny) → execute (local or MCP) → format result → feed back → loop. Error recovery: exec failures, permission denied, timeout → structured error messages back to LLM. Process crash during tool execution → conversation state already persisted pre-execution, restartable. |
| Tool result formatting | tools | L | Inject results into conversation. Basic size limits (truncate >20KB for now, compaction comes Phase 2). |
| /command parser | commands | L | Detect `/command args` in message text. Route to handler. |
| Built-in commands | commands | L | `/help`, `/status`, `/reset`, `/history`, `/memory`, `/model`. |
| Journal trace recording (SQLite) | journal | M | Per-turn structured traces: input, prompt assembled, LLM call, tool calls, result. All stored in SQLite from day one — same DB infrastructure as memory/conversation. Schema designed for queryability (query interface comes Phase 2, but schema is ready). |
| Journal debug views | journal | L | `--verbose` mode shows journal entries in real-time. `/debug` command dumps last turn's full trace (assembled prompt, LLM response, tool calls). Foundation for the web dashboard in Phase 2. |
| `agent-config` CLI | config | M | Commands: validate, diff, set, add skill, tools allow/deny. |
| Integration testing | e2e | M | Full loop: config → agent → router → conversation → prompt → LLM → tools → memory → reply. |

**Exit criteria:** Agent can execute tools (read files, run commands, search web, call MCP servers), remember across conversations, respond to /commands. Journal captures every turn in SQLite. Debug tooling works.

#### Phase 1c — Connected Agent (~1-2 weeks)

**Goal:** The agent is reachable from Telegram and fires heartbeats. Others can talk to it.

| Task | Package | Complexity | Notes |
|------|---------|------------|-------|
| Telegram connector (grammy) | channel | M | Port from OpenClaw. Bot API, message send/receive, MarkdownV2 formatting, message splitting for long responses. Rate limit handling: respect Telegram's 429 responses, exponential backoff. |
| Telegram auth (allowlist + pairing) | channel | L | Same logic as OpenClaw, cleaner config. |
| Platform formatting layer | channel | M | Telegram MarkdownV2 escaping rules, reply tags, group chat mention detection. |
| Group chat behavior | channel | L | When to respond (direct mention, reply-to-bot) vs HEARTBEAT_OK vs ignore. |
| Streaming support (Telegram + TUI) | llm/channel | M | TUI: live token rendering. Telegram: batched message edits (configurable interval, e.g., every 500ms). |
| Basic heartbeat timer | heartbeat | L | Configurable interval, quiet hours check. Triggers agent with heartbeat prompt. |

**Exit criteria:** Mira (created from "companion" role) runs on Telegram. Has a TUI for direct chat. Can execute tools including MCP-provided tools. Has one brain that remembers across conversations and restarts. Router maps channels to conversations. Journal records every turn in SQLite. Supports /commands. Fires heartbeats.

---

### Phase 2 — Smarter Agent

**Goal:** Memory becomes semantic, history doesn't blow up context, tool calls are gated by granular permissions, skills are a first-class concept. Journal becomes queryable for self-improvement.

| Task | Package | Complexity | Notes |
|------|---------|------------|-------|
| SQLite + sqlite-vec setup | memory | M | `better-sqlite3` + sqlite-vec extension. Schema: embeddings table. Migration system. |
| Embedding provider | memory | M | Abstract interface. Ollama/LM Studio implementation first (OpenAI-compatible `/api/embeddings` endpoint). Cloud API as optional fallback. Batch on write. Cache to avoid re-embedding. |
| Semantic search across brain | memory | H | Query → embed → cosine similarity → merge with FTS → rank by (relevance × recency_decay × usage_boost) → top-N. Searches agent's unified memory, not per-conversation. |
| Memory distillation pipeline | memory | H | Conversations → LLM extracts key facts/decisions → embed → store in long-term brain. Dedup via cosine threshold. |
| Memory absorption | memory | M | `absorb.ts` — when a delegation returns or a conversation ends, merge relevant findings into agent's brain. |
| Memory pruning | memory | L | Score = usage_count × recency. Below threshold → archive table. Never delete. |
| Episode detection | history | M | Heuristic: time gaps >10min, topic shifts (embedding distance), explicit markers. Start simple, iterate. |
| Episode summarization | history | M | LLM per episode → structured YAML summary. Token cost tracking. |
| Rolling compaction window | history | L | Keep last N episodes in full, compact older ones. Config: `history.keep_full_episodes`. |
| Archive + retrieval | history | L | Compacted messages to JSONL on disk. Retrieval by episode ID. |
| Tool permission engine | tools | M | Glob matching (micromatch). Policy: deny → allow → default. `require_approval` checked after allow. |
| Context-aware rules | tools | M | Rules with path conditions: `exec:git* if cwd=/projects/*`. Simple condition parser. |
| Tool result compaction | tools | M | <2KB direct, 2-20KB summarized (LLM call), >20KB heavy summary + disk cache. Reference IDs. |
| Skill system lifecycle | commands | M | Dynamic skill loading, /command binding, trigger matching, conflict resolution, enable/disable per-agent. |
| Heartbeat full features | heartbeat | M | Sticky notes, scheduled checks, proactive messages. Port OpenClaw's heartbeat/sticky-note logic. |
| Anthropic native provider | llm | M | Direct Anthropic API (not through OpenAI compat). Supports tool_use natively. |
| Rate limiting + cost tracking | llm | L | Token bucket rate limiter. Per-conversation and per-day cost tracking. Configurable limits. |
| Journal query interface | journal | M | Query traces via SQLite: find failures, patterns, improvement candidates. "Show me turns where user corrected the agent." |
| Journal review / self-improvement | journal | M | Flag recurring issues, suggest instruction updates. Both automated (agent reviews own traces) and human-driven. |
| Debugging dashboard (Vue) | dashboard | H | Web-based observability UI served from the Fastify gateway. Vue SPA with views for: journal trace browser (per-turn assembled prompt, LLM response, tool calls), conversation inspector, agent brain viewer (search, scores, tiers), tool call log (success/fail rates, durations). Reads from journal SQLite. Real-time updates via WebSocket. The primary debugging surface — replaces ad-hoc log tailing. |
| Webhook ingress | gateway | M | HTTP POST endpoint that triggers agent conversations. Enables: GitHub webhooks, email notifications, external service callbacks. Simple auth (token/secret). Runs on the gateway alongside the dashboard. |
| Voice channel (input + output) | channel | H | Voice as a channel adapter. Input: Whisper transcription (local or API). Output: TTS (ElevenLabs, system TTS). Voice notes from Telegram transcribed before entering pipeline. Standalone voice channel for Alexa-style interaction. |
| Natural language scheduling | heartbeat | M | Agent can create scheduled tasks from conversation: "remind me every Monday at 9am" → cron job. Uses the heartbeat scheduler under the hood. Tasks persist, pausable, listable via `/tasks`. |
| Agent self-authoring tools | tools/journal | M | Agent can create new tool implementations from journal patterns. Reviews traces where it struggled → writes a new skill/tool script → registers it. Constrained: new tools go through approval before activation. Like NanoClaw's AI-native skill creation but driven by inspecting past failures. |
| Model failover chain | llm | M | Configure fallback providers per-agent. If primary model errors or rate-limits, automatically try next in chain. e.g., `[claude-sonnet-4, gpt-4.1, ollama/llama]`. |

**Exit criteria:** Agent recalls relevant context via semantic search across its unified brain. Long chats don't degrade quality. Tool calls gated by granular permissions. Skills load/unload dynamically. Journal is queryable for identifying improvement opportunities — both via API and via the Vue debugging dashboard. Webhook ingress accepts external triggers. Voice works as input and output. Agent can create scheduled tasks from conversation. Agent can author new tools from journal patterns.

---

### Phase 3 — Safety & Isolation

**Goal:** Secrets encrypted, gated tools require human approval, agents can't leak across namespaces, tool execution sandboxed, everything is audited. NanoClaw's key insight: container isolation is the real security boundary, not just permission patterns.

| Task | Package | Complexity | Notes |
|------|---------|------------|-------|
| age-encrypted vault | secrets | M | `age-encryption` npm. Encrypt/decrypt vault file. Master key from env var or macOS Keychain. |
| Secret manifest | secrets | L | YAML listing secret labels, scopes, rotation dates. No values in the manifest. |
| Secret resolver | secrets | L | Agent requests by label → check scope → decrypt → inject. Never log. |
| Secret access audit log | secrets | L | Append-only JSONL: who requested, which secret, when, granted/denied. |
| Human approval flow | tools | H | `require_approval` tool invoked → pause execution → send approval request to Telegram → wait with timeout → resume or deny. One pending approval at a time per agent. Timeout default 5min. Simple Promise-based, no job queue. |
| Config audit trail | config | L | Every CLI config change → append to audit JSONL (timestamp, who, what, old/new). |
| Per-agent brain isolation | agent | M | Each agent's brain (memory), conversations, tool-results in separate dirs/DB tables. No cross-read unless explicitly shared via team board. |
| Agent permission matrix | agent | L | YAML config: which agents can ask/hand-off to which. Checked by router before forwarding. |
| Container sandbox for tool execution | tools | H | Optional Docker/Apple Container isolation for `exec` tool calls. Default-deny filesystem: only explicitly mounted dirs accessible. Network lockdown: agent can only reach LLM API + allowed endpoints. Configurable per-agent: `sandbox: none | docker | apple-container`. Ephemeral containers with TTL. This is NanoClaw's core security model — OS-level isolation beats application-level permission checks. |
| Credential injection (not env vars) | secrets | M | Secrets injected into containers at request time via vault resolver, not stored as env vars. Automatic redaction of `*_KEY`, `*_TOKEN`, `*_PASSWORD` patterns in tool results and logs. |

**Exit criteria:** Secrets never appear in logs/prompts. Gated tools require human approval via Telegram. Agents can't read each other's brain. Tool execution optionally sandboxed in containers with default-deny filesystem. Credentials injected securely, never in env vars. All access is audited.

---

### Phase 4 — Multi-Agent & Connectivity

**Goal:** Multiple agents running, agent-to-agent communication (ask, hand off, check in), agent switching, teams with boards, additional channels.

| Task | Package | Complexity | Notes |
|------|---------|------------|-------|
| Agent self-awareness tools | tools | M | `my_conversations()`, `peek()`, `tell()` — agent can see and interact with its own active conversations. |
| Ask tool (delegation with return) | tools/router | H | Agent calls `ask("researcher", task)` → router spawns task agent from role → new conversation → task agent works → returns structured result → requesting agent absorbs findings. Context stays clean. |
| Hand-off tool (agent switching) | tools/router | H | Agent or user triggers `hand_off("coder")` → router rebinds channel to new agent's conversation. Three modes: clean (fresh start), with-context (summary transferred), delegation (return when done). |
| `/switch` and `/agent` commands | commands/router | M | User commands for switching between agents. `/switch coder`, `/agent mira`, `/agents` (list available). |
| Multi-agent lifecycle | agent | M | Start/stop agents independently. Track status. Handle crashes gracefully. |
| Task agent lifecycle | agent | M | Ephemeral agents spawned via `ask()`. Do their job, return results, archive. Memory optionally merged into requester's brain. |
| Team config + lifecycle | team | M | Create teams from YAML. Members, lead, goal. |
| Team board (shared state) | team | M | `board_read()`, `board_write()`, `board_subscribe()` — shared notebook for team members. Not a chat log, structured state. |
| Discord connector | channel | M | `discord.js`. Same adapter pattern as Telegram. Slash commands for interaction. |
| WhatsApp connector | channel | M | `@whiskeysockets/baileys` (same lib as OpenClaw/NanoClaw). QR pairing. Rate limiting. Group chat support. |
| Webhook adapter | channel | L | Generic HTTP POST/GET for custom integrations. |
| WebSocket gateway | gateway | M | `ws` library. Protocol: JSON messages with type/agent/content. Token auth. Graceful shutdown. |
| HTTP API | gateway | L | Fastify. Routes: /health, /agents, /conversations, /journal/query. Schema-validated. |

**Exit criteria:** Can run multiple agents simultaneously. Agents can ask each other for help (delegation with clean context). Users can switch between agents mid-conversation. Teams have shared boards. Discord and WhatsApp work. WebSocket gateway serves external clients.

---

### Phase 5 — Coding Agent Handoff

**Goal:** Main agent can delegate coding work to Claude Code, Codex, or other coding agents. This is a specialized form of `ask()` with sandbox, structured output, and review.

| Task | Package | Complexity | Notes |
|------|---------|------------|-------|
| Coding agent registry | handoff | L | YAML config (coding-agents.yaml). Load + validate. Model selection per-agent. |
| Handoff protocol | handoff | H | Prepare context (files, notes, constraints) → spawn coding agent via `ask()` pattern → wait → parse structured response (diffs, tests, summary). |
| Claude Code integration | handoff | H | Invoke `claude -p` or Claude Code API. Pass task + context. Capture output. Parse diffs. Primary target. |
| Codex integration | handoff | M | Similar pattern, different API surface. |
| Workspace sandbox | handoff | M | `git worktree` for isolation. Coding agent works in worktree. Approve → merge. Reject → delete worktree. |
| Parallel handoffs | handoff | M | Promise.allSettled for concurrent coding agents. Each in own sandbox. Results collected together. |
| Session mode | handoff | H | Persistent coding conversation (not one-shot). Follow-up tasks to same conversation. State + context accumulation. |
| Diff review pipeline | handoff | M | Structured diff output. Main agent reviews: approve (merge), iterate (send back), or escalate (flag for human). |
| Coding agent tool policies | handoff | L | Inherit from main agent + additional allow/deny. Same permission engine. |

**Exit criteria:** Mira can ask Claude Code to write tests, review the diff, and decide to merge or iterate. Sandbox prevents coding agent from touching main repo until approved.

---

## 6. OpenClaw Feature Parity Mapping

What OpenClaw does today and where it maps in agent-core:

| OpenClaw Feature | Current Implementation | Agent Core Equivalent | Phase |
|-----------------|----------------------|----------------------|-------|
| Agent identity (SOUL.md, IDENTITY.md, USER.md) | Flat files loaded into prompt | `memory/tiers/identity.ts` — part of agent's brain | 1 |
| Memory (daily markdown + MEMORY.md) | File-based, no search | `memory/brain.ts` — unified "one brain" per agent, file-based first, then tiered + vector | 1 (basic), 2 (smart) |
| Session transcripts (JSONL) | Raw JSONL recording | `conversation/persistence.ts` + `history/` | 1 (recording), 2 (compaction) |
| Telegram connector | Built-in, tightly coupled | `channel/telegram/` — adapter pattern | **1** |
| Bot allowlist + pairing | In openclaw.json | `channel/telegram/auth.ts` | **1** |
| LLM API calls | Inline OpenAI-compat calls | `llm/` package — abstracted, multi-provider | **1** |
| Tool execution | Built-in tool runner | `tools/` — registry + executor + implementations | **1** |
| /commands | Inline parser | `commands/` package — parser + router + builtins | **1** |
| Config (openclaw.json) | Single JSON file, hot-reload | `config/` — YAML, per-agent, schema-validated, CLI | 1 |
| Config audit log | config-audit.jsonl | `config/` — same pattern, richer metadata | 3 |
| Tool approval socket | exec-approvals.json + socket | `tools/approval.ts` — async flow via Telegram | 3 |
| Sub-agent spawning | runs.json tracking | `agent/lifecycle.ts` + `tools/ask.ts` — ask() spawns task agents from roles | 4 |
| Claude Code integration | Loose ACP integration | `handoff/` — specialized ask() with sandbox + review | 5 |
| Heartbeat + sticky notes | Shell scripts + cron | `heartbeat/` — native scheduler, quiet hours | 1 (basic), 2 (full) |
| WebSocket gateway | ws://127.0.0.1:18789 | `gateway/` — proper auth + routing | 4 |
| Model hot-swap | Config change triggers switch | `config/loader.ts` — hot-reload triggers reconfigure | 1 |
| OpenRouter / LMStudio support | Auth profiles in config | `llm/providers/` — configurable per-agent | 1 |
| Group chat behavior | Custom filter logic | `channel/group-chat.ts` — mention/reply rules | **1** |
| Message formatting | Telegram-specific inline | `channel/formatting.ts` — platform-abstracted | **1** |
| Reply tags | `[[reply_to_current]]` inline | `channel/reply-tags.ts` | **1** |
| (new) Session inspection | N/A | `journal/` — SQLite-backed structured traces per turn + Vue debugging dashboard | **1** (traces), **2** (dashboard) |
| (new) Agent switching | N/A | `router/switch.ts` + `tools/hand-off.ts` — switch between agents mid-conversation | 4 |
| (new) Agent delegation | N/A | `tools/ask.ts` + `memory/absorb.ts` — ask another agent, get results back clean | 4 |
| (new) Team boards | N/A | `team/board.ts` — shared state for agent teams | 4 |
| (new) Role templates | N/A | `agent/role.ts` — create agents from reusable roles | **1** |
| (new) MCP client | N/A | `tools/mcp-client.ts` — connect to MCP servers, expose tools to agents | **1** |
| (new) Webhook ingress | N/A | `gateway/webhooks.ts` — external events trigger agent conversations | 2 |
| (new) Debugging dashboard | N/A | `dashboard/` — Vue web UI for journal traces, memory, tools, conversations | 2 |
| (new) Voice (input + output) | N/A | `channel/voice/` — Whisper transcription + TTS | 2 |
| (new) Natural language scheduling | N/A | `heartbeat/` — agent creates cron tasks from conversation | 2 |
| (new) Agent self-authoring tools | N/A | `tools/self-author.ts` — agent writes new tools from journal patterns | 2 |
| (new) Model failover chain | N/A | `llm/` — automatic fallback between providers | 2 |
| (new) Container sandbox | N/A | `tools/sandbox.ts` — Docker/Apple Container isolation for exec | 3 |
| (new) Credential injection | N/A | `secrets/` — secrets injected at request time, not env vars | 3 |
| (new) WhatsApp connector | N/A | `channel/whatsapp/` — Baileys-based | 4 |
| MCP servers (OpenClaw) | 500+ tools via MCP | `tools/mcp-client.ts` — same standard, plug in any MCP server | **1** |
| Voice Wake / Talk Mode (OpenClaw) | macOS/iOS/Android apps | `channel/voice/` — voice channel adapter, no native app yet | 2 |
| Browser automation (OpenClaw) | Chrome management server | Via MCP server (e.g., Playwright MCP) — not built-in | MCP |
| Canvas / A2UI (OpenClaw) | Agent-driven HTML workspace | Future — needs client apps first | 6+ |
| Home Assistant (OpenClaw) | Dedicated add-on | Via MCP server (Home Assistant MCP) — not built-in | MCP |
| Camera / Vision (OpenClaw) | camsnap + Frigate | Via MCP server or skill — not built-in | MCP |
| Container isolation (NanoClaw) | Docker per conversation | `tools/sandbox.ts` — optional sandbox for tool execution | 3 |
| Skills as ~50-line scripts (NanoClaw) | Pure function skills | Skill system (Phase 2) — keep skills dead simple | 2 |
| ClawHub / skill registry (OpenClaw) | 700+ community skills | Future — community skill registry | 6+ |

**Not porting (Phase 6+ if ever):**
- Canvas / A2UI — needs client apps (macOS, iOS, Android) to render
- Device nodes / companion apps — native apps for macOS, iOS, Android
- ClawHub / skill marketplace — community skill registry
- Device pairing / multi-device — single-device for v1

**Covered via MCP (no custom code needed):**
- Browser automation → Playwright MCP server
- Home Assistant → Home Assistant MCP server
- Camera / Vision → camera MCP server or skill
- Database access → database MCP servers
- Any other external integration → write or find an MCP server

---

## 7. Key Dependencies

### Runtime Dependencies

| Package | Purpose | Why this one |
|---------|---------|-------------|
| `better-sqlite3` | SQLite access | Synchronous API, great TS types, well-maintained |
| `sqlite-vec` | Vector similarity search | Native SQLite extension, no external service (Phase 2) |
| `yaml` | YAML parse/stringify | Standard, handles all YAML features |
| `zod` | Schema validation | Best TS schema library. Validates config, generates types. |
| `age-encryption` | Secrets encryption (Phase 3) | Simple file encryption, CLI-compatible |
| `micromatch` | Glob pattern matching | For tool permission wildcards (Phase 2) |
| `grammy` | Telegram Bot API | Modern, TS-native, middleware-based |
| `@anthropic-ai/sdk` | MCP client protocol | Official SDK for MCP client connections to MCP servers |
| `@whiskeysockets/baileys` | WhatsApp connector (Phase 4) | Same lib OpenClaw/NanoClaw use. Battle-tested. |
| `openai` (Whisper) | Voice transcription (Phase 2) | Whisper API for voice input. Local fallback via `whisper.cpp` later. |
| `ws` | WebSocket server (Phase 4) | Standard, minimal |
| `fastify` | HTTP server (Phase 1 webhooks, Phase 4 full API) | Fast, TS-friendly, schema validation |
| `tiktoken` | Token counting | Official OpenAI tokenizer for prompt budgets |
| `commander` | CLI framework | For `agent-config` and `agent-core` CLIs |
| `chokidar` | File watching | For config hot-reload |
| `cron` | Cron scheduling | For heartbeat. Lightweight. |
| `ink` or `terminal-kit` | TUI framework | Terminal chat interface. ink = React-like, terminal-kit = lower level. Decide at implementation time. |
| `vue` + `vite` | Dashboard UI (Phase 2) | Vue SPA for debugging dashboard. Vite for dev/build. Served as static assets from Fastify. |

### Dev Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` ~5.8 | Language |
| `tsup` | Build (bundle packages) |
| `tsx` | Dev runner (no build step) |
| `vitest` | Unit + integration tests |
| `@types/better-sqlite3` | SQLite types |
| `@types/ws` | WebSocket types |
| `eslint` + `@typescript-eslint/*` | Linting |
| `prettier` | Formatting |

### External Services

| Service | Required? | Phase | Notes |
|---------|-----------|-------|-------|
| LLM provider (OpenRouter, Anthropic, etc.) | Yes | 1 | For conversations, summarization, distillation. |
| Telegram Bot API | Yes (primary surface) | 1 | Bot token required. |
| Local embedding model (Ollama / LM Studio) | Yes | 2 | Local model (e.g. nomic-embed-text). No external API required. Cloud API optional fallback. |
| macOS Keychain | Optional | 3 | For master key. Falls back to env var. |
| MCP servers (various) | Optional | 1+ | Any MCP-compatible server for external tool access. Home Assistant, Playwright, databases, etc. |
| ElevenLabs API | Optional | 2 | For high-quality TTS voice output. System TTS as free fallback. |
| Docker / Apple Container | Optional | 3 | For container sandboxing of tool execution. |

---

## 8. Dependency Graph

Build order within and across phases:

```
Phase 1a (Echo Loop):
  config ──┐
           ├──> llm ──┐
           │          ├──> prompt ──┐
           │          │            └──> conversation (state + loop, SQLite-backed)
           │          │                      │
           └──────────┴──────────────────> tui/
  agent (role loading, lifecycle)
  router (channel → conversation → agent binding)
  cli (entry point, structured logging, graceful shutdown)

Phase 1b (Capable Agent):
  memory (brain, focus, file-based + SQLite index)
  tools (registry + executor + core impls + MCP client)
  commands (parser + builtins)
  journal (trace recording, SQLite store, debug views)
  agent-config CLI

Phase 1c (Connected Agent):
  channel/telegram (connector, auth, formatting, group chat)
  heartbeat (basic timer)
  streaming (Telegram + TUI)

Phase 2:
  memory (sqlite-vec, embeddings, semantic brain search, absorption, distillation)
  history (episodes, compaction, archive) ── needs ──> memory, llm
  tools (permissions engine, result compaction, self-authoring) ── needs ──> llm, journal
  commands (skill system lifecycle)
  dashboard (Vue debugging UI, served by gateway) ── needs ──> journal, gateway
  gateway (webhook ingress)
  channel/voice (Whisper input, TTS output)
  heartbeat (full features + natural language scheduling)
  llm (Anthropic provider, rate limiting, cost tracking, failover chain)
  journal (query interface, self-improvement review)

Phase 3:
  secrets (vault, resolver, credential injection, audit)
  tools (approval flow, container sandbox) ── needs ──> channel (for approval messages)
  agent (brain isolation, permission matrix)
  config (audit trail)

Phase 4:
  tools (self-awareness: my_conversations, peek, tell)
  tools + router (ask, hand_off — agent-to-agent verbs)
  agent (multi-agent lifecycle, task agent spawn/archive)
  team (boards, shared state)
  channel (discord, whatsapp, webhook)
  gateway (WebSocket, full HTTP API)
  commands (/switch, /agent)

Phase 5:
  handoff (registry, protocol, sandbox, review)
    ── needs ──> tools/ask (delegation pattern)
    ── needs ──> agent (spawn/lifecycle)
    ── needs ──> tools (coding agent policies)
```

---

## 9. Risks and Tough Calls

### Risk: sqlite-vec maturity

sqlite-vec is relatively new. If it has bugs or performance issues with our embedding dimensions (768 for nomic-embed-text, or whatever local model is chosen), we're stuck.

**Mitigation:** Abstract the vector store behind an interface (`VectorStore { insert, search, delete }`). If sqlite-vec fails, swap to Chroma or custom HNSW without changing the rest. Write the abstraction in Phase 2, don't over-invest in sqlite-vec specifics.

### Risk: Embedding latency (local models)

Every memory write needs an embedding call. Local models avoid cost but may be slower depending on hardware.

**Mitigation:** Batch embeddings (buffer writes, embed in bulk every N seconds). Cache embeddings — if text hasn't changed, don't re-embed. Local models (Ollama/LM Studio) run on the same machine, so no network round-trip. If local hardware is too slow, cloud API fallback is available per-agent config.

### Risk: History compaction quality

LLM-generated summaries can lose critical details. If compaction drops a key decision, agent coherence breaks.

**Mitigation:** Structured summaries (not free-form) with explicit fields for decisions, outcomes, open questions. Keep originals archived and retrievable. Allow "look back" at full episodes. Start with aggressive retention, tighten later.

### Risk: Approval flow complexity

Suspending tool execution while waiting for human approval over Telegram is architecturally hard. Timeouts, disconnects, multiple pending approvals.

**Mitigation:** Keep it simple. One pending approval at a time per agent. Timeout after configurable period (default 5min) and deny. Simple Promise that resolves on Telegram callback. No job queue.

### Risk: Coding agent API instability

Claude Code and Codex APIs may change. Handoff depends on parsing their output.

**Mitigation:** Thin adapter per coding agent. Output parsing isolated. If API changes, one file changes. Start with Claude Code only (`claude -p` CLI mode is more stable than internal APIs).

### Risk: Phase 1 scope creep

Phase 1 is deliberately large — it's the "working agent" phase plus the entity model foundations. Temptation to gold-plate features or build multi-agent before the basics work.

**Mitigation:** Phase 1 is split into three milestones (1a echo loop, 1b capable agent, 1c connected agent) with testable exit criteria at each stage. Every feature gets a "good enough" bar, not a "perfect" bar. File-based memory, not vector. Basic allow/deny permissions, not full glob engine. Simple heartbeat timer, not sticky notes. Router exists but only maps 1 channel → 1 conversation → 1 agent (no switching yet). Journal records traces in SQLite but no query interface or dashboard yet (Phase 2). If it works like OpenClaw, it ships. Smart comes in Phase 2, multi-agent in Phase 4.

### Risk: Entity model over-abstraction

Four entities (agent, conversation, channel, role) plus router could lead to over-engineering if the boundaries aren't clear.

**Mitigation:** Keep it simple in Phase 1. An agent is created from a role, has one brain, and conversations are just chat threads with persistence. The router is a thin lookup table. Only add complexity (switching, delegation, teams) in Phase 4 when single-agent is proven stable. The entity model is a mental model first, code structure second.

### Risk: Container sandbox complexity

Docker/Apple Container isolation adds operational complexity. Not everyone has Docker installed. Containers add startup latency. Mounting the right directories is fiddly.

**Mitigation:** Sandbox is optional (`sandbox: none` is the default). Works without Docker — you just don't get OS-level isolation. When enabled, keep it simple: one container per `exec` call, ephemeral, pre-built image, explicit mount list in agent config. Don't try to be Kubernetes.

### Risk: MCP server reliability

MCP servers are third-party. They can be buggy, slow, or change their API.

**Mitigation:** MCP client has timeout + retry logic. Tool results from MCP go through the same compaction/error handling as local tools. If an MCP server is down, the agent gets a clear error message and can try alternative approaches. Don't make any MCP server required for core functionality.

### Risk: Voice latency

Voice round-trip (transcribe → LLM → TTS) can feel sluggish. Users expect near-instant response.

**Mitigation:** Stream TTS output (start speaking before the full response is generated). Use local Whisper for transcription where possible (lower latency than API). Keep voice responses shorter than text responses. Voice is Phase 2 — we'll have the core pipeline stable before adding this latency-sensitive layer.

### Tough call: YAML vs TOML

Spec mentions TOML for `system.toml` but shows YAML everywhere else.

**Decision:** All YAML. Handles nested structures better. Better ecosystem tooling (JSON Schema, Zod). Rename `system.toml` references to `system.yaml`.

### Tough call: Fastify vs Express

**Decision:** Fastify. Internal-facing API, ecosystem size doesn't matter. Schema validation and TypeScript plugin system are a better fit.

### Tough call: One process vs multiple

**Decision:** One process, multiple agents. Node's event loop handles concurrent I/O fine. Worker threads only if CPU-bound work blocks the event loop. Keep the option open but don't split prematurely.

### Tough call: TUI framework

ink (React-like, JSX components) vs terminal-kit (lower level, more control) vs blessed (mature but less maintained).

**Decision:** Defer to implementation time. Prototype with ink first — React mental model is familiar, JSX makes layout easy. Fall back to terminal-kit if ink can't handle streaming well. The TUI is a Phase 1 deliverable but not a critical path item — Telegram is the primary surface.

### Tough call: How much to reuse from OpenClaw

**Decision:** Rewrite to new interfaces, but use OpenClaw code as reference. The existing code is too coupled to extract cleanly, but the edge cases it handles (message splitting, markdown escaping, error recovery, group chat filtering) are valuable knowledge. Read the code before reimplementing.

---

## 10. Testing Strategy

| Level | Tool | Scope |
|-------|------|-------|
| Unit | vitest | Pure functions: config validation, glob matching, token counting, ranking, command parsing |
| Integration | vitest + SQLite in-memory | Memory brain, search, tool execution, conversation persistence, LLM client (mocked provider) |
| E2E | vitest + test fixtures | Full loop: config → agent → router → conversation → prompt → mock LLM → tools → brain → reply |
| Manual | TUI + Telegram | Real conversations with real LLM. The final test is whether Mira feels coherent. |

No mocking SQLite or the file system in integration tests. Use real (in-memory) SQLite and temp directories. Mocking hides real bugs — OpenClaw already learned this lesson.

LLM client tests use a mock provider that returns scripted responses (including tool calls). Real LLM calls only in manual testing and optional "live" test suite (not in CI).

---

## 11. Migration Path

Agent-core doesn't replace OpenClaw in one shot. Parallel operation:

1. **Phase 1 complete (1a→1b→1c):** Switch Telegram bot token to agent-core. Mira created from "companion" role. OpenClaw becomes fallback. Same SOUL.md, personality files (symlinked). Memory files imported. Journal recording from day one.
2. **Phase 2 complete:** Import OpenClaw's accumulated memory into agent's brain (vector store). Compare recall quality. Full cutover for daily use. Journal review identifies first improvement candidates.
3. **Phase 3 complete:** Secrets migrated to encrypted vault. Config audit trail running. Per-agent brain isolation enforced.
4. **Phase 4 complete:** Multi-agent running — can ask other agents for help, switch between agents. Teams with boards. Discord online. Gateway serving external clients.
5. **Phase 5 complete:** Full system operational with coding agent handoff. Archive OpenClaw.

At no point does OpenClaw need to stop running. The systems coexist on different ports and directories. Cutover happens at Phase 1, not Phase 4.

---

## 12. What This Plan Does NOT Cover

- **Canvas / A2UI** — needs native client apps to render agent-driven UI. Phase 6+ after gateway API is stable.
- **Device nodes / companion apps** — macOS, iOS, Android native apps that expose camera, location, notifications, screen recording. Major effort, Phase 6+.
- **ClawHub / skill marketplace** — community skill registry. Phase 6+, after skills system proves out.
- **Device pairing / multi-device** — single-user, single-device for v1
- **Rate limiting / billing** — single-user system, not a platform
- **Distributed deployment** — runs on one machine
- **Browser automation** — available via MCP (Playwright MCP server), not built-in
- **Home automation** — available via MCP (Home Assistant MCP server), not built-in
- **Camera / vision** — available via MCP or skill, not built-in
- **Signal / iMessage / Matrix / Slack** — channel adapter pattern makes these addable, but not in the initial phases. Community contributions welcome.

Key insight: MCP support in Phase 1 means many of OpenClaw's 200+ integrations become available without custom code. We don't need to build browser automation, Home Assistant, databases, etc. — we connect to MCP servers that already exist for these.
