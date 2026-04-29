# Typed Link Relation Design Note

Agent-core currently stores links as plain `BlockRef[]` on blocks and through `HeaperMemory.linkBlocks(a, b)`. That keeps the local scaffold simple and satisfies Jan's current architecture direction: agents collaborate by passing references, not hidden copied state. Future Heaper-backed memory should preserve that behavior while adding optional typed relations for better graph traversal, audit export, permissions, and UI drill-down.

## Decision

Keep `links?: BlockRef[]` as the compatibility field for now. Add typed relations later as adapter-level metadata, not as a breaking replacement for `links`.

Migration-safe default:

- every existing untyped link imports as relation `related`;
- typed links must also expose their target through ordinary `links` until all callers understand relation metadata;
- `getRelatedBlocks(ref)` must continue returning both typed and untyped neighbors;
- audit export should render untyped legacy links as `related` and typed links by relation name when available;
- no permission decision should rely only on relation labels until the Heaper adapter enforces heap scoping independently.

## Candidate relation names

| Relation | Direction | Meaning | Current untyped sources |
| --- | --- | --- | --- |
| `origin` | child/result -> source | Block was created from or because of another block. | runtime event/route/model/guard blocks, tool intents, human proposals, audit snapshots |
| `session` | message/audit/task -> session | Block belongs to or was created in a session. | session messages, route records, blockers, approvals, approval-resume tasks |
| `message` | assistant/tool/decision -> message | Block depends on or follows a specific user/assistant message. | assistant messages, tool intents, runtime blockers |
| `decision` | result/artifact -> decision | Block was produced after a route/model/guard/policy decision. | route records, model decisions, guard decisions, notification intents |
| `approval` | task/result -> approval | Block resumes or applies an approved request. | approval requests, approval-resume tasks, approval applied refs |
| `task` | result/blocker/notification -> task | Block is attached to a task. | task result refs, blockers, notifications, continuation worker outputs |
| `result` | task/approval -> result | Block is an output/result of a task or approved action. | `linkTaskResult`, `markApprovalApplied`, task result blocks |
| `blocker` | task/session/result -> blocker | Block explains why work is blocked. | runtime blockers, task blockers, blocked worker outcomes |
| `notification` | task/runtime/result -> notification | Block records notification intent/delivery state. | notification outbox refs from runtime and continuation worker |
| `continuity` | session/runtime -> daily entry | Block contributes to working continuity. | daily continuity entries linked from runtime refs |
| `summary` | snapshot/daily/session -> source refs | Block summarizes source blocks without deleting them. | audit snapshots, daily continuity, session summaries |
| `tool` | tool output -> tool intent | Tool output fulfills a tool intent. | tool boundary/output blocks |
| `delegation` | delegated task/result -> origin refs | Agent collaboration task/result references. | delegation task refs and result refs |
| `config` | runtime/session -> persona config | Runtime behavior was influenced by config. | persona config loads; not always linked today |

## Current link use-site map

### Runtime orchestration

- `runtime-event` is the root audit block for a normalized event.
- `route-record` links event and session. Future relations: `origin` to event, `session` to session.
- `model-decision` links event and route. Future relations: `origin`/`decision`.
- `guard-decision` links event and route. Future relation: `decision`.
- user message links event, route, and blockers. Future relations: `origin`, `decision`, `blocker`.
- assistant message links user message, route, model, guard decisions, and blockers. Future relations: `message`, `decision`, `blocker`.
- daily continuity links event, route, model, messages, guards, and blockers. Future relation: `continuity` from runtime refs to daily entry.
- notification outbox blocks link notification refs and runtime/worker refs. Future relation: `notification`.

### Task and continuation worker

- tasks link origin sessions when created. Future relation: `session`.
- task result blocks link task and runtime refs. Future relations: `task`, `result`, `origin`.
- `linkTaskResult` links task/result bidirectionally. Future relation: task `result` -> result and result `task` -> task.
- `linkTaskBlocker` links task/blocker bidirectionally. Future relation: `blocker`.
- continuation worker result blocks link task, blockers, and runtime refs. Future relations: `task`, `blocker`, `origin`.

### Approval flow

- approval request blocks link session/task/origin/audit refs. Future relations: `session`, `task`, `origin`, `decision`.
- `markApprovalApplied` links approval to resume task and result refs. Future relations: `approval`, `result`.
- approval-resume tasks link approval and origin session. Future relations: `approval`, `session`.

### Tool boundary and output blocks

- tool intent blocks link origin refs. Future relation: `origin`.
- tool output blocks link tool intent and optional guard decision. Future relations: `tool`, `decision`.
- denied/blocked tool outcomes link intent and guard decision. Future relations: `tool`, `blocker`, `decision`.

### Delegation and collaboration

- delegated tasks link permitted refs instead of copying hidden state. Future relation: `delegation` or `origin`.
- delegation results link back to task and permitted refs. Future relations: `result`, `delegation`.

### Human proposals and persona memory

- human proposal blocks link origin refs. Future relation: `origin`.
- persona/session summaries link the source daily/session refs. Future relation: `summary`.
- persona config is read from blocks but not always linked into runtime audit yet. Future relation: `config` when runtime behavior depends on it.

### Audit/status commands

- audit snapshots link every source ref they summarize. Future relation: `summary`.
- audit export currently traverses direct and reverse untyped links. Future traversal should include typed relation neighbors plus legacy `related` links.
- runtime status emits refs for drill-down but does not create links.

## Proposed representation

Do not change `HeaperBlock` yet. When the real Heaper adapter arrives, support typed relations as metadata shaped like:

```ts
interface TypedBlockLink {
  ref: BlockRef;
  relation: LinkRelation;
  direction?: 'out' | 'in' | 'bidirectional';
  note?: string;
}
```

Possible storage locations, in order of preference:

1. native Heaper relation/link metadata, if Heaper supports typed edges;
2. `block.metadata.typedLinks` as adapter-owned compatibility metadata;
3. tags such as `rel:task:<id>` only for temporary debugging, not long-term semantics.

## Migration plan

1. Keep existing `links` behavior and contract tests unchanged.
2. Introduce a helper such as `linkBlocksTyped(memory, a, b, relation)` that writes both ordinary `links` and relation metadata.
3. Gradually migrate high-value sites first: task result, blocker, approval, notification, daily continuity, audit snapshot.
4. Update audit export to display relation labels when present while still traversing legacy links.
5. Add contract tests proving legacy untyped links import/export as `related` and remain bidirectionally discoverable.
6. Only after Heaper integration is stable, consider making typed relation creation the default path for new links.

## Open questions for Jan

No blocker right now. Ask before product-visible changes:

- Should user-facing audit views show relation labels, or keep labels developer-only?
- Should Heaper treat `link_blocks(a, b)` as directional, bidirectional, or relation-dependent?
- Are relation names part of Jan-facing memory semantics, or internal implementation details?
