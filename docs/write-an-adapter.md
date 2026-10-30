# Write an adapter

An adapter connects the fixture runner to a system whose permission behaviour you want to test. The runner supplies an action and a sequence of changes. Your adapter performs those operations and reports the effects it can actually observe.

Start locally with Node.js 22 or newer. You do not need a model, API key or production service to understand the contract. The separate SQLite adapter also requires Python 3.

## 1. Run the reference designs

From the repository root:

```sh
node bin/permission-lab.cjs list
node bin/permission-lab.cjs run --adapter atomic --fixture valid-control --format md
node bin/permission-lab.cjs run --adapter atomic --fixture queued-revocation --format md
node bin/permission-lab.cjs run --adapter cached --fixture queued-revocation --format md
node bin/permission-lab.cjs run --adapter deny-all --fixture valid-control --format md
```

The atomic reference should pass both the valid control and queued revocation. The cached design should fail queued revocation because it deliberately retains stale authority. The deny-all design should fail the valid control: blocking valid work must not be counted as correct permission handling. A reported `FAIL` from an intentionally weak design is expected teaching evidence, not an instruction to weaken the assertions.

The two intentionally failing commands return exit code `1`. A complete passing run returns `0`. A run with unsupported coverage and no failures returns `2`, as does invalid CLI configuration. Failures take precedence when a run also has unsupported cases. This lets a real regression fail CI without presenting unavailable coverage as success.

Inspect the fixture, event trace and observed ledger rather than only the totals. The [threat model](threat-model.md) explains what a result does and does not establish.

## 2. Start with the runnable extension

[The custom adapter example](../examples/custom-adapter.cjs) demonstrates the actual module interface used by the runner. It delegates to the local atomic simulator and declares that fact. It is a working extension scaffold, not a deployed integration. Run it before modifying it:

```sh
node bin/permission-lab.cjs run --adapter ./examples/custom-adapter.cjs --fixture all --format md
```

Make your own copy, change one boundary and rerun. An adapter module is trusted executable code. Do not run an unfamiliar adapter against your credentials or production data.

## 3. Implement the exact contract

The authoritative definition is [Adapter contract v1](../framework/ADAPTER-CONTRACT.md). The module exports `createAdapter(options)`. It returns an instance with `metadata` and the required methods `reset`, `enqueue`, `execute`, `observe` and `dispose`. Methods may be asynchronous.

| Method | Responsibility |
|---|---|
| `reset({at, authority})` | Create isolated initial state for this fixture. Do not reuse effects from another run. |
| `enqueue({at, request, approval})` | Store the proposed request and its complete approved intent without silently changing either. Return whether the request was accepted. |
| `execute({at, requestId})` | Attempt the queued action. Return a decision, reason codes and the authority/approval revisions used. |
| `observe()` | Read current authoritative state, requests, spent amount and effect ledger. It must not manufacture an effect from an `allow` response. |
| `dispose()` | Release the fixture's resources, including after a failure. |

Optional methods are `preflight`, `changeAuthority` and `changeQueued`. Match them to the capability names in the contract. `metadata.kind` distinguishes a simulator, database or integration; declaring a kind is not certification.

Keep effect observation separate from the decision path where your system permits it. For a database adapter, query the protected table. For a disposable external tool, query that destination or a reliable system of record. If the destination cannot establish an outcome, do not invent a zero effect.

## 4. Preserve the fixture's meaning

The fixture supplies a synthetic authority, request and trusted approval. The approval contains a deep copy of the complete request, including its identifier and idempotency key. Changing queued arguments must preserve the old approval unless a new approval is explicitly supplied.

The supplied `at` values are logical milliseconds. They are not delays to sleep for or latency measurements. Expiry is exclusive. `changeAuthority` must commit before it returns, and its revision changes once per update.

Grant restoration changes authority state; it does not extend expiry or execute the queue. The reference restoration policy permits an unchanged original approval after an explicit retry. If your system intentionally requires a new approval, disclose the semantic mismatch and use an appropriately named fixture. Do not quietly change its meaning to obtain a green result.

Idempotency, approval binding and policy checks must be evaluated at the boundary your adapter claims. A successful remote policy check followed by an unprotected write must not be labelled atomic.

## 5. Handle unsupported behaviour honestly

Omit an unsupported capability or throw an error with `code = 'UNSUPPORTED'`. The runner reports `INCONCLUSIVE`. Adapter errors and missing or malformed evidence during a fixture are `FAIL`. Invalid CLI configuration, an unloadable module or a missing factory is `INVALID`. Unsupported work is never a pass.

Use the exact required observation fields. An empty ledger is a valid observation. An absent ledger is missing evidence. The spent amount must equal the ledger's amounts; revisions and amounts must be safe integers. See the contract for the full shape.

## 6. Save evidence with the change

```sh
node bin/permission-lab.cjs run --adapter ./examples/custom-adapter.cjs --fixture all --format json --output evidence.json
node bin/permission-lab.cjs run --adapter ./examples/custom-adapter.cjs --fixture all --format junit --output results.xml
```

Use the JSON to inspect individual events and observations. Use JUnit output in your own test workflow. Keep the command, adapter source revision, dependency versions and configuration with any shared result. Remove credentials and customer information before committing evidence.

For a contribution, include one counterexample, a valid positive control, its observed effects, the fix and the rerun. Follow [CONTRIBUTING.md](../CONTRIBUTING.md). A small adapter that honestly exposes its limits is more useful than a large integration that reports every unavailable case as successful.
