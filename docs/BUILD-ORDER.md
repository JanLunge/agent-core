# Agent-Core Minimal Build Order

This is the practical coding order for heartbeats and coding agents. Each step should be testable without Jan manually clicking around.

## 1. Heaper-compatible memory API

Goal: define and validate blocks, heaps, links, permissions, and search boundaries.

Acceptance tests:
- parse heap names (`human/*`, `agent/*`, `persona/<name>/*`);
- enforce heap permissions;
- create/get/update/link blocks in local scaffold;
- search/filter by heap, tag, type, and time.

## 2. Event ingestion + session routing

Goal: normalize chat/TUI/voice/API/background triggers into events and route them to the correct session/persona/mode.

Acceptance tests:
- same channel resumes same session;
- addressed persona routes to that persona heap;
- sensitive event sets sensitive mode;
- async/background mode does not spam live chat.

## 3. Agent harness

Goal: basic loop that receives routed event, pulls context, calls model/tool layer, writes result blocks.

Acceptance tests:
- prompt/context includes recent session slice + relevant blocks;
- tool calls are guarded before execution;
- full tool output is stored as block and summarized to agent;
- results are written back to correct heap/session.

## 4. Persona system

Goal: persona config and isolated memory with explicit sharing by reference.

Acceptance tests:
- persona/mira and persona/dave do not read each other's private memory by default;
- both can read shared `agent/*` references;
- delegation passes block references, not copied hidden memory.

## 5. Daily entries

Goal: every heap can maintain daily entries for continuity.

Acceptance tests:
- append to today's daily entry;
- read today + yesterday for startup/context;
- session summaries link to daily entries.

## 6. Tool execution + guard

Goal: enforce allow/deny/ask before shell, API calls, and file writes.

Acceptance tests:
- deny secret reads;
- ask for risky writes;
- block external calls in sensitive mode;
- audit decisions.

## 7. Async/background tasks

Goal: task blocks and continuation worker.

Acceptance tests:
- create task block;
- resume pending task;
- write result and notify only on milestone/blocker.

## 8. Model routing + sensitive mode

Goal: router-enforced model choice.

Acceptance tests:
- sensitive task selects local model and restricted tools;
- complex non-sensitive task can select stronger remote model;
- persona defaults are respected.

## 9. UI layers

Goal: chat, TUI, voice, API all emit the same event shape.

Acceptance tests:
- each interface creates equivalent normalized events;
- routing behavior is independent of input surface.
