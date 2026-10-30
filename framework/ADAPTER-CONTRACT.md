# Adapter contract v1

A CommonJS module exports `createAdapter(options)` (async allowed). The returned instance has `metadata: {id, label, kind, capabilities}`. `kind` is `simulator`, `database` or `integration`; it is a declaration, not certification. Capabilities are string names from the list below. Every method may return a promise. The runner requests one instance for each fixture and attempts bounded disposal of every instance it obtains. A timed-out factory may settle later; resources created after that timeout remain the adapter's responsibility. Timeouts do not cancel arbitrary trusted module code.

Required base methods: `reset`, `enqueue`, `execute`, `observe`, `dispose`. Optional capabilities must match their methods; missing support is INCONCLUSIVE, never PASS. Only `check-write-race` and `shared-budget` require a separate `preflight`; the other fixtures call `execute` directly.

```js
await adapter.reset({at: 0, authority});
await adapter.enqueue({at, request, approval}); // {accepted: boolean, reasonCodes: string[]}
await adapter.preflight({at, requestId}); // {allowed: boolean, reasonCodes: string[]}
await adapter.changeAuthority({at, patch}); // increments authority.revision once, preserves other fields
await adapter.changeQueued({at, requestId, patch, approval}); // approval optional; absent means preserve prior approval
await adapter.execute({at, requestId});
await adapter.observe();
await adapter.dispose();
```

Capabilities: `preflight`, `authority-change`, `queued-change`, `approval-change`, `multi-request`, `logical-clock`, `effect-observation`.

`authority` has exactly the following required values (extra adapter-specific fields allowed):

```js
{id:'grant-1', revision:1, active:true, expiresAt:1000,
 limit:100, budget:120, subject:'user:amina', actor:'agent:refund-worker',
 action:'refund:create', resource:'order:1042', audience:'payments-api', recipient:'customer:1042'}
```

`request`:

```js
{id:'R-001', key:'intent-1', subject:'user:amina', actor:'agent:refund-worker',
 action:'refund:create', resource:'order:1042', audience:'payments-api',
 recipient:'customer:1042', amount:40, childLimit:100}
```

`approval`: `{revision:1, intent: request}`. `intent` is a complete deep-copied request, including id and key. An explicit new approval in `changeQueued` uses revision 2 and the newly approved complete intent. A payload change alone must not modify the stored approval. The fixture supplies this trusted approval; no signature/authentication is simulated or implied.

`execute` returns:

```js
{decision:'committed'|'denied'|'duplicate', reasonCodes:[],
 evidence:{authorityRevision:1, approvalRevision:1}}
```

`observe` returns an authoritative snapshot:

```js
{authority, spent:40,
 requests:[{request, approval, accepted:true}],
 ledger:[{effectId:'effect-1', requestId:'R-001', key:'intent-1', amount:40,
 subject:'user:amina', actor:'agent:refund-worker', action:'refund:create',
 resource:'order:1042', audience:'payments-api', recipient:'customer:1042',
 at:100, authorityRevision:1, approvalRevision:1}]}
```

All fields above are required. `spent` must equal the sum of ledger amounts. Empty ledger is valid; missing ledger/evidence fields are not. Returned evidence revisions must identify the current authoritative revision and the queued approval revision for each execution outcome. A committed effect must carry those same revisions. Deliberately vulnerable adapters may report a stale decision basis, which the runner records as a failure. A duplicate response reports the current decision basis, while the original immutable ledger row retains its original commit revisions. Revisions and amounts are safe integers. No secrets should be recorded. A real adapter must observe actual authoritative effects rather than synthesize a ledger from its returned decision.

`at` is a supplied logical millisecond clock, monotonically increasing within a fixture. Expiry is exclusive (`at < expiresAt`). It is not a wall-clock timing or latency claim. `changeAuthority` commits before returning. For the atomic/database adapter, current policy, intent binding, budget and duplicate handling share the protected write boundary. The cached and preflight adapters intentionally violate parts of this contract's desired outcomes to demonstrate failed controls; the runner's expected outcomes are defined independently in fixtures.

Restoration sets active=true at a new authority revision; it does not extend expiry or automatically execute queued work. This fixture policy permits the unchanged original approval after an explicit restoration. Some real systems require a new grant/approval; they should declare this case unsupported or map a separately named fixture rather than claim equivalent semantics.

Unsupported operation: throw an Error with `code='UNSUPPORTED'` and a useful message, or omit its capability. The runner reports INCONCLUSIVE unless a failure was already observed in that fixture, in which case FAIL takes precedence. Other errors/crashes are FAIL. Invalid CLI configuration, an unloadable module or a missing factory export is INVALID. Missing or malformed per-fixture observation/decision fields are FAIL. Unsupported cases do not count as passes. No networking is performed by built-ins; custom modules are executable code and must be explicitly trusted by the operator.
