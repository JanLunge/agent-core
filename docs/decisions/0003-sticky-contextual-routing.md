# Decision 0003 — Sticky but Context-Aware Agent Routing

Date: 2026-04-28
Status: accepted

## Context

Runtime smoke testing showed that explicit persona/agent routing is currently sticky per channel: after a message such as `@ops ...`, an unaddressed follow-up in the same channel continues in the `ops` session.

Jan clarified that this should not be judged in a vacuum with fake agents. Real routing depends on the active agents, their capabilities, and the actual follow-up question.

## Decision

Agent/persona handoffs should be **sticky by default** when a conversation switches to a specialized agent or persona.

An unaddressed follow-up should usually stay with the current routed agent because humans often ask follow-up questions without re-addressing the agent.

The router may return to a previous/default topic or primary agent when context clearly indicates the prior handoff was one-off or the user is returning to the previous topic. This should be based on conversation context and real agent capabilities, not only on whether a message contains an explicit mention.

## Consequences

- The current channel binding behavior is directionally correct as a scaffold.
- Future router work should add context-aware handoff scoring rather than simply expiring persona bindings after one turn.
- Tests using fake agents should cover the mechanics of sticky binding, but product-quality routing must also be evaluated with actual agents and realistic questions.
- Routing history should preserve why a handoff stayed sticky or returned to a prior/default route.

## Follow-up implementation notes

Future routing slices should consider:

- active topic and recent session summary;
- current agent capability fit;
- explicit user mentions and mode hints;
- signals like “back to…”, “anyway”, “about the earlier thing”, or topic mismatch;
- whether a specialized agent was invoked for a narrow one-off task or an ongoing thread.
