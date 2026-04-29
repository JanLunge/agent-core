# Heaper Adapter Migration Checklist

This note captures the current gap between agent-core's local `HeaperMemory` scaffold and the intended future Heaper-backed memory layer. It is deliberately practical: keep runtime code depending on `src/heaper/types.ts`, then replace the local implementation behind that interface.

## Interface mapping

| agent-core method | Intended Heaper operation | Current local behavior | Migration notes |
| --- | --- | --- | --- |
| `search(query, filters)` | `search(query, filters)` | Case-insensitive substring search over JSON-ish block text; supports heap/tag/type/time/limit filters. | Replace with Heaper search. Preserve deterministic filtering semantics at adapter boundary, especially heaps/tags/types. |
| `getBlock(ref)` | `get_block(id)` scoped by heap/ref | Returns cloned block or `undefined`. | Heaper refs must include heap/namespace or a globally unique id plus heap validation. Missing blocks should remain non-fatal for callers that probe optional refs. |
| `createBlock(input)` | `create_block(data, heap)` | Creates timestamped block with local incremental id. | Real Heaper ids may be opaque. Code must continue treating ids as references, not sortable counters. Preserve tags, metadata, links, and timestamps. |
| `updateBlock(ref, changes)` | `update_block(id, changes)` | Shallow-merges `data` and `metadata`; replaces tags/links when provided. | Confirm whether Heaper updates are patch/merge or replacement. Adapter should emulate current shallow merge unless callers are migrated deliberately. |
| `linkBlocks(a, b)` | `link_blocks(a, b)` | Bidirectional links, deduped. | Confirm Heaper link directionality. Current callers assume `getRelatedBlocks` can traverse both directions. |
| `getDailyEntry(date, heap)` | `get_daily_entry(date, heap)` | Finds one `daily-entry` block by `data.date`. | Prefer native Heaper daily entry lookup if available; otherwise search by heap/type/date metadata. Must not create on read. |
| `appendToDailyEntry(content, heap, date)` | `append_to_daily_entry(content, heap)` | Creates daily-entry or appends text with newline. | Confirm append atomicity. Runtime continuity depends on no lost updates when multiple workers append. |
| `getRelatedBlocks(ref)` | `get_related_blocks(id)` | Returns blocks linking to the ref; because `linkBlocks` is bidirectional, this is effectively related-neighbor traversal. | Adapter should define whether direct outgoing links are included. Audit export expects both direct and reverse-related traversal. |
| `semanticSlice(options)` | `semantic_slice(query, time_range, tags)` | Delegates to substring `search`; ignores `timeRangeLabel`. | Replace with semantic retrieval while preserving heap/tag/type scoping. Time labels need a canonical translation layer. |

## Local scaffold assumptions to preserve or decide

1. **Refs are heap-qualified.** Callers use `{ heap, id }` everywhere. Keep this even if Heaper ids are globally unique because heap qualification carries permission and persona boundaries.
2. **Blocks are immutable snapshots from the caller's perspective.** Local adapters clone returned blocks. Real adapter should avoid exposing mutable cached objects.
3. **Links are never hidden copied state.** Collaboration, audit export, daily continuity, approvals, and notifications pass refs rather than embedding private block bodies.
4. **Daily continuity is bounded text plus refs.** Daily entries may contain concise summaries, but full session/task/tool context should stay in linked blocks.
5. **No silent deletion.** Current code creates snapshots/status/outbox records instead of removing raw audit/session/task blocks.
6. **Human heap writes require policy above the adapter.** The adapter should not silently bypass `human/*` approval/proposal rules.
7. **Search is security-sensitive.** Heap filters are part of permission scoping, not just performance hints.
8. **Local id ordering is not a product contract.** Tests should prefer refs returned by operations; only local fixture tests may assert concrete ids.

## Known gaps before real Heaper integration

- **Concurrency/atomicity:** `LocalHeaperMemory` rewrites a whole JSON file and is not safe for multiple writers. Real Heaper append/update/link operations need atomic semantics.
- **Semantic retrieval:** `semanticSlice` is placeholder substring search; relevance, embeddings, time labels, and ranking are not modeled yet.
- **Permissions enforcement:** Heap namespace permissions are represented in code/docs/tests, but the memory adapter itself does not enforce read/write authorization.
- **Schema validation:** Block `data` is mostly structural TypeScript. A real adapter may need runtime schemas or validation errors for malformed blocks.
- **Pagination:** `search` uses a simple limit with no cursor. Runtime status/audit commands may need pagination for large stores.
- **Link semantics:** Directionality and relation types are not represented. All links are untyped `BlockRef[]` today.
- **Conflict handling:** `updateBlock` has no revision/etag support. Real Heaper should expose or hide conflict retries intentionally.
- **Redaction boundary:** Audit export redacts at render time. Sensitive data can still be present in local blocks when source operations store it.
- **Time label translation:** `SemanticSliceOptions.timeRangeLabel` exists but the local implementation ignores it.

## Feedback checkpoints for Jan

No immediate blocking checkpoint is required before the next implementation slice. The current interface still maps cleanly to Jan's Heaper direction.

Ask Jan before changing any of these product-level semantics:

1. Whether Heaper links should stay untyped or become typed relations such as `origin`, `result`, `approval`, `summary`, `continuity`.
2. Whether permission enforcement belongs inside the Heaper adapter or in a policy layer above it.
3. Whether daily entries should be first-class Heaper daily blocks or ordinary blocks with date metadata.
4. Whether audit snapshots should become durable summary blocks in `agent/*` by default once Heaper is live.


## Executable contract suite

Every memory adapter must run the shared conformance suite before it is used by runtime code. The suite lives in `src/heaper/adapter-contract.test.ts` and exports `describeHeaperMemoryContract(adapter)`. It currently validates the local in-memory and JSON-file adapters, and future real-Heaper adapters should import the same helper instead of copying assertions.

Minimal adapter test pattern:

```ts
import { describeHeaperMemoryContract } from './adapter-contract.test.js';
import { HeaperClientMemory } from './heaper-client-memory.js';

describeHeaperMemoryContract({
  name: 'HeaperClientMemory',
  create: () => new HeaperClientMemory({
    // test endpoint/client/credentials go here
  }),
  reopen: (memory) => memory,
});
```

Use `reopen` only when the adapter has restart/persistence semantics that can be exercised in the test environment. Networked Heaper adapters should add separate adapter-specific tests for authentication failures, permission denials, retryable transport errors, and conflict/revision behavior.

Run target:

```sh
pnpm test -- src/heaper/adapter-contract.test.ts
```

The contract intentionally checks behavior that runtime code depends on:

- create/get/update preserve heap, type, data, tags, metadata, timestamps, and defensive clone semantics;
- search honors query, heap, tag, type, time, and limit filters;
- links are deduplicated and currently traversable in both directions through `getRelatedBlocks`;
- daily entries append to one block per date/heap and semantic slices preserve filter behavior;
- human/agent/persona heap names and permission-facing tags are not coerced;
- optional `reopen` verifies blocks, links, and daily entries survive adapter restart.

## Migration checklist

- [ ] Add a real Heaper adapter implementing `HeaperMemory` without changing runtime callers.
- [ ] Run `describeHeaperMemoryContract` from `src/heaper/adapter-contract.test.ts` against the adapter.
- [ ] Add adapter-specific tests for auth/permission failures, retryable network/storage failures, and conflict/revision behavior.
- [ ] Decide and document link directionality/typing before relying on richer graph traversal.
- [ ] Implement semantic time-range translation for `semanticSlice`.
- [ ] Add pagination/cursor support or a bounded iteration wrapper before using production-sized stores.
- [ ] Confirm daily append atomicity with concurrent worker/runtime writes.
- [ ] Audit all concrete-id assertions and keep them limited to local fixture tests.
- [ ] Validate that audit export/status commands can inspect Heaper-backed refs without leaking sensitive data.
- [ ] Keep local JSON storage as a deterministic fixture adapter after Heaper integration.
