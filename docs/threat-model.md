# Threat model and evidence boundaries

## Purpose

This lab tests specified permission invariants under controlled event schedules. It helps explain and reproduce failures between a policy decision and a side effect. It is not an identity provider, token verifier, production authorisation service or security certification.

A passing case means its assertions held for that adapter, fixture, configuration and schedule. It does not establish that an application is secure under other inputs, concurrency, timing, integrations or bypass paths.

## What is protected

The protected item is the effect described by a case: a model ledger entry or a row in an isolated local SQLite database. Synthetic amounts and logical milliseconds are test inputs, not money movements or measured latency.

The cases examine boundaries such as:

- authority changing after a request was queued or checked;
- approved parameters changing before execution;
- duplicate delivery and repeated attempts;
- expiration, audience and delegation constraints;
- multiple queued requests against a shared budget, where the selected adapter supports that case.

The exact supported cases and evidence must come from the selected adapter's run. A list of topics is not evidence that every adapter implements every property.

## Trust boundaries

| Boundary | Assumption and implication |
|---|---|
| Action payload | Treat it as a proposed action. It cannot establish its own authority, authenticated identity or approval. |
| Authority and approval state | The fixture supplies synthetic state. Production authenticity, human approval identity and the integrity of policy administration are outside the default lab. |
| Adapter code | A trusted local extension. It can execute with the permissions of the person running the lab. Review third-party adapters before running them. |
| Decision | What the tested design decided, with its observed revision and reasons where available. This is not proof of an effect. |
| Effect observation | Evidence of the state change within the declared environment. A model log and a database row have different evidential strength. Neither proves what happened at an external provider. |
| Report and provenance | A report describes a run. A content hash helps identify bytes; it does not authenticate the author or make a report tamper-proof. |

## Execution profiles

**In-memory model:** deterministic events and state transitions demonstrate the contract. An atomic model operation is not a database lock or distributed transaction. Its clock, replicas, participants and scheduling are simulated.

**Local SQLite:** a real local database can demonstrate the transaction and row outcomes implemented by its adapter. A two-connection writer-lock control establishes the observed SQLite ordering in that fixture. It does not establish distributed consistency, production throughput, multi-process race coverage or external payment cancellation.

Read each profile's documentation and the run's limitations. Do not combine model coverage counts with database coverage counts into a general security percentage.

## Limits that matter when using the result

1. **Identity labels are not authentication.** Subject, actor and audience fields can be checked against a synthetic grant without verifying signed credentials, issuer trust or possession of a key.
2. **Time is explicit.** Logical-time boundary tests do not establish behaviour under clock skew, wall-clock advancement during a transaction or scheduling delays.
3. **Approval recovery is a policy choice.** Restoring a grant does not inherently renew an approval. A fixture that reuses an approval must say so; a production system may require fresh approval after revocation or a policy revision.
4. **Cancellation has a boundary.** Revocation cannot undo an already committed effect. If a transaction wins the ordering race, later revocation is not retroactive cancellation.
5. **Idempotency has a scope.** Repeating one request identifier is different from replay under a new identifier. A local uniqueness constraint does not make a remote side effect exactly-once.
6. **Unknown is not failed.** A timed-out external call might have succeeded. Systems need provider-specific idempotency and reconciliation before retrying; a local model cannot prove these behaviours for an untested provider.
7. **The oracle is bounded.** An invariant checker can only check what it observes and encodes. Shared assumptions or code between an adapter and checker can conceal errors. Keep positive controls and intentionally failing designs.
8. **Bypasses remain possible outside the test boundary.** Protection applies only to operations routed through the tested path. Direct database writes, alternate tools, stolen credentials and compromised hosts are outside the reference fixtures.
9. **A harness timeout is not cancellation.** A timed-out custom operation may continue outside the runner's observation. A blocked JavaScript event loop can also prevent a timer from firing. Run trusted code against disposable targets; a timeout result is not proof that no effect occurred.

## Appropriate use

Run against isolated fixtures and disposable resources. Keep real credentials, customer information and production endpoints out of committed scenarios and evidence. Introduce a real integration only with a documented effect boundary, cleanup, independent observation and explicit permission to test it.

Use a failed case to identify a concrete mismatch. Use a passing case as regression evidence with its assumptions attached. For a report about the lab itself, see [SECURITY.md](../SECURITY.md).
