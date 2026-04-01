# Agent Core — Project Spec

> A ground-up replacement for OpenClaw, designed from the agent's perspective. Built for clarity, safety, and long-term coherence.

---

## Why

OpenClaw works, but it's built for humans to configure, not for agents to understand and maintain. Gaps we keep hitting:

- Monolithic system prompts that blow up context windows
- File-based memory with no semantic search or tiered recall
- History is trimmed, not summarized — context gets lost over long chats
- Secrets live in config files as plaintext
- Tool permissions are coarse (all or nothing)
- No proper multi-agent isolation
- Config is easy to break and hard for an agent to reason about

---

## Design Principles

1. **Agent-readable** — every config file, every structure is self-describing. An agent should be able to read its own setup and explain what it does.
2. **Human-inspectable** — no opaque binaries or generated blobs. Plain text, flat where possible, commented where it matters.
3. **Safe by default** — least privilege agents, explicit allowlists, secrets encrypted, agents can't write config directly.
4. **Coherent over time** — memory that actually accumulates insight, not just logs. History that compacts intelligently.
5. **Composable** — skills, tools, identities are modular. Agents are individuals, not clones.

---

## 1. Prompt Construction

**Problem:** OpenClaw builds one massive system prompt per session. It grows, it's rigid, context gets wasted on stale sections.

**Solution: Modular prompt assembly**

```
prompt/
  system.toml       # core identity + safety rules
  skills.md         # loaded skill instructions
  memory-context.md # relevant memory snippets
  session-context.md # what happened in this chat
  tools.md          # tool definitions + permissions
```

- Assembled at message time, not at startup
- Sections adapt: inactive skills aren't loaded, irrelevant memory stays out
- Each section has a token budget — the assembler keeps total under the model's context window
- Hot-swap: change identity without restarting, toggle skills per-message

---

## 2. Memory Management & Search

**Problem:** Flat markdown files. Works for small setups, breaks at scale. No ranking, no deduplication, no semantic recall.

**Solution: Tiered memory with vector search**

| Tier | Purpose | Backend |
|------|---------|---------|
| Working | Current session context | In-memory ring buffer |
| Short-term | Today/yesterday events | SQLite with FTS |
| Long-term | Distilled knowledge | Vector embeddings (sqlite-vec or pgvector) |
| Identity | SOUL.md, IDENTITY.md | Plain text files (always loaded) |

- **Write path**: Agent logs events → daily file → periodically distilled into long-term
- **Read path**: Query → semantic search across tiers → rank by relevance + recency → inject top-N into prompt
- **Pruning**: Long-term memory scored on usage frequency. Low-score entries archived (not deleted). Agent never loses memory permanently.
- **Isolation**: Each agent gets its own memory namespace. No cross-agent bleed.

---

## 3. History Compaction

**Problem:** Long chats exceed context. OpenClaw trims from the start, losing early context and decisions.

**Solution: Intelligent summarization**

- Messages are grouped into **episodes** (logical conversations within a session)
- On compaction: each episode → summary (preserves decisions, outcomes, questions asked)
- Original messages archived to disk, accessible via `/history` or agent tool access
- Summary format: structured, not prose — keeps token cost low
```yaml
episode: 3
summary: "User asked about weather API, configured wttr.in, tested with Berlin - OK"
key_decisions: ["use wttr.in over Open-Meteo", "no API key needed"]
tokens_used: 847
compact_to: 38
```
- Rolling window: keep last N episodes in full detail, compact older ones progressively
- Agent can reference compacted history by ID

---

## 4. Secrets Management

**Problem:** API keys and tokens in plaintext config files. No rotation, no scoping, no audit.

**Solution: Encrypted vault**

- Secrets stored in encrypted file (libsodium / age encryption)
- Master key derived from environment variable or OS keychain
- Per-secret metadata: label, scope (which agents/tools can access), created, last-rotated
- Secret values never appear in prompt, logs, or memory
- Agent requests secrets by label → vault resolves → value injected as context variable
- Audit log: who requested what, when

```yaml
# secrets manifest (no actual values here)
secrets:
  telegram-bot-token:
    scope: agent:mira
    rotated: 2026-03-15
  openai-api-key:
    scope: tool:llm-invoke
    rotated: 2026-04-01
```

---

## 5. Tool Permissions & Safety

**Problem:** OpenClaw's approach is binary. Either a tool is available or it's not. No granular control.

**Solution: Pattern-based allow/deny with wildcards**

```yaml
# Per-agent tool config
tools:
  default: deny    # everything blocked unless explicitly allowed
  allow:
    - read:*                    # all file reads, any path
    - exec:*                    # all command execution
    - web_search
    - sessions_spawn            # spawn sub-agents
  deny:
    - exec:sudo*                # never allow sudo
    - exec:rm -rf /             # dangerous patterns
    - send:*telegram            # can't send telegram messages
  require_approval:
    - exec:brew*                # needs Jan's approval
    - write:*.conf             # config writes need approval
```

- Wildcard matching: glob patterns on tool namespace
- Context-aware rules: `exec:git commit` might be allowed in a project workspace but not in `/etc`
- Approval flow: gated tools route to human via messaging surface (Telegram, Discord, etc.)
- Tool result compaction (below) prevents output from becoming a side-channel attack

---

## 6. Tool Result Compaction

**Problem:** Some tool calls return massive outputs (file contents, API responses). They eat context budget.

**Solution: Adaptive result formatting**

- **Small results** (< 2KB): injected directly into prompt
- **Medium results** (2KB-20KB): summarized, full content stored in `tool-results/` cache
- **Large results** (> 20KB): summarized heavily, full content on disk, reference by ID
- Agent can request: "get full result #47" to retrieve the complete output
- Summarization is structured, not lossy for key data

---

## 7. Multi-Agent Architecture

**Problem:** OpenClaw has sub-agents but they're ephemeral and share config. No real identity isolation.

**Solution: Agents as namespaced individuals**

```
workspace/
  agents/
    mira/
      agent.conf          # this agent's config
      SOUL.md
      IDENTITY.md
      TOOLS.md            # per-agent tool notes
      memory/             # isolated memory
        daily/
        long-term/
      skills/             # skill symlinks or local overrides
      tool-results/       # local cache
        
    research/
      agent.conf
      SOUL.md
      memory/
      ...
  
  shared/
    skills/               # available to all (or symlink specific ones)
    .env.secure           # encrypted secrets vault
    config/
      master.conf         # global settings
```

**Cross-agent communication:**
- Controlled message passing via orchestrator
- No direct memory access between agents
- Agent can request info from another agent (goes through message channel)
- Permission matrix: which agents can talk to which

---

## 8. Coding Agent Handoff (Claude Code / Codex / `claude -p`)

**Problem:** When the agent needs real code work — not just scripting but actual development — it needs to delegate to tools built for that. Current OpenClaw ACP integration exists but is rough; context injection is loose and review loops are ad hoc.

**Solution: Structured handoff with bounded scope**

The agent (e.g., Mira) identifies coding work needed, prepares context, and spawns a coding agent with explicit boundaries.

```yaml
# Handoff initiated by the orchestrator on behalf of the main agent
handoff:
  agent: claude-code            # or: codex, or any registered coding agent
  task: "Add unit tests for the config parser"
  constraints:
    - "Tests must pass before submission"
    - "Do not modify src/config/schema.rs"
  context:
    files:
      - ./src/config/parser.rs
      - ./src/config/mod.rs
    notes: "Uses TOML, validates at load time, errors are typed"
  mode: run                     # one-shot; or "session" for iterative
  review: true                  # results come back to Mira for review
  approval: false               # Mira is authorized to send this without Jan
  timeout: 300                  # seconds
```

### Flow

1. **Identify** — Main agent determines work is code-heavy, not conversational
2. **Prepare** — Gathers relevant files, writes task description, sets constraints
3. **Spawn** — Launches coding agent with bounded scope (specific files/directories)
4. **Execute** — Coding agent works in isolation, writes code, runs tests, commits
5. **Return** — Diffs, test results, and summary come back to main agent
6. **Review** — Main agent decides: ship it, iterate, or flag for Jan

### Key Features

- **Parallel handoffs** — Multiple coding agents can work simultaneously (e.g., Claude Code on frontend, Codex on backend)
- **Session mode** — Persistent coding sessions for complex multi-step work, not just one-shots
- **Result review** — Diffs and summaries come back structured, not as raw output
- **Iterate loop** — Main agent can send follow-up tasks to the same coding session: "fix the failing test" / "add edge cases for empty input"
- **Sandbox** — Coding agent gets its own working directory copy. No writes to main repo until approved.
- **Model selection** — Different coding agents can use different models per-task

### Coding Agent Registry

```yaml
# config/coding-agents.conf
agents:
  claude-code:
    type: acp
    enabled: true
    default_model: claude-sonnet-4
    sandbox: inherit            # inherits workspace, or "require" for isolated
  
  codex:
    type: acp
    enabled: true
    default_model: gpt-4.1
    sandbox: require
  
  gemini-cli:
    type: acp
    enabled: false
    default_model: gemini-2.5-pro
    sandbox: require
```

### Permission

Coding agents need their own tool policies, separate from the main agent:

```yaml
tools:
  inherited_from: main          # inherit main agent's allow/deny
  additional_allow:
    - exec:git*                 # coding agents always need git
    - exec:npm*
    - exec:cargo*
    - write:./src/*            # can write only in source tree
  additional_deny:
    - exec:rm -rf*
    - write:*.conf             # never touch config files
```

---

## Config Structure

All config is YAML/TOML, self-describing, validated by CLI.

### `agent.conf`
```yaml
name: mira
model: claude-sonnet-4
role: Companion agent for Jan. Thinks alongside him.

identity:
  soul: ./SOUL.md
  name: ./IDENTITY.md
  user: ./USER.md

memory:
  engine: sqlite-vec            # or files, or pg
  path: ./memory
  embedding_model: text-embedding-3-small   # local or API
  
tools:
  default: deny
  allow: []
  deny: []
  require_approval: []

heartbeat:
  enabled: true
  every: 30m
  quiet_hours: [23, 8]

skills:
  - name: weather
    source: shared
  - name: github  
    source: ./skills/github
```

### CLI for config management
```bash
agent-config --agent mira validate        # check config validity
agent-config --agent mira diff            # show pending changes
agent-config --agent mira set model claude-sonnet-4
agent-config --agent mira add skill weather --allow-read
agent-config --agent mira tools allow "exec:git*"
agent-config --global set default_model claude-sonnet-4
agent-config secrets add telegram-bot-token   # prompts for value, encrypts
```

Agents **never** write config directly. All changes go through the CLI which validates against the schema before applying. Atomic writes — no partial config states.

---

## Tech Stack (TBD)

Open questions to resolve:

| Decision | Options | Notes |
|----------|---------|-------|
| Language | Rust / Go / TypeScript | Rust = safety, Go = simplicity, TS = ecosystem |
| Vector store | sqlite-vec / chroma / custom | sqlite-vec is simplest deployment |
| Encryption | age / libsodium | age is simpler, libsodium more battle-tested |
| Messaging transport | same as OpenClaw (connectors) | reuse battle-tested channel code? or pure rewrite |
| Embeddings | local model / API | local = privacy, API = quality |

---

## Phases

### Phase 1 — Foundation
- Config schema + CLI tool
- Agent directory structure
- Basic prompt assembler
- File-based memory (tiered, no vectors yet)

### Phase 2 — Core
- Vector-backed memory + semantic search
- History compaction with summaries
- Tool permission engine with wildcards
- Tool result compaction

### Phase 3 — Safety
- Encrypted secrets vault
- Approval flow for gated tools
- Config audit trail
- Cross-agent isolation

### Phase 4 — Polish
- Multi-agent orchestrator
- Messaging connectors (Telegram, Discord, etc.)
- Heartbeat system
- Self-documenting agent queries

### Phase 5 — Handoff & Orchestration
- Coding agent registry + ACP integration
- Structured handoff protocol
- Parallel coding agent support
- Session-mode persistent coding agents
- Sandbox for coding agent workspace isolation
- Diff review pipeline

---

## Status

**Just started.** Conversation with Jan, 2026-04-01 ~01:20. Concept phase.
