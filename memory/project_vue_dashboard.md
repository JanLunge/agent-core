---
name: Vue Debugging Dashboard
description: Agent-core will include a Vue-based web dashboard for debugging/observability, served directly from the TS backend
type: project
---

Agent-core includes a web-based debugging dashboard built with Vue, served directly from the Fastify backend.

**Why:** SQLite-backed journal traces need a queryable UI for debugging agent behavior — assembled prompts, tool calls, memory retrieval, errors. Terminal logging isn't enough for a system this complex.

**How to apply:** The dashboard is a package in the monorepo (`packages/dashboard`). It reads from the journal's SQLite store. It's part of the gateway server, not a separate process. Plan for it alongside journal SQLite schema design.
