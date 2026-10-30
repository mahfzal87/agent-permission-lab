# SQLite transaction adapter

This adapter uses actual SQLite transactions and observes committed database rows. Identities, grants, approvals, amounts and logical times are fictional fixture inputs. The protected effect is an insert into this private database's `effects` table. It does not contact a payment service, run an MCP server or verify identity-provider credentials.

Requirements: Node.js 22 or newer and Python 3 with its standard-library `sqlite3` module. No packages are installed. `PERMISSION_LAB_PYTHON` may select a trusted Python executable; it is passed as an executable name, never as shell text.

From the repository root:

```sh
node bin/permission-lab.cjs run --adapter ./adapters/sqlite/index.cjs --fixture all --format json --output /tmp/sqlite-report.json
node --test tests/sqlite-adapter.test.cjs
python3 tests/sqlite-locking.py
```

## Adapter behaviour

`index.cjs` implements the shared adapter contract. Each instance gets a new private temporary database. JSON operations travel on a child process's standard input using explicit subprocess arguments with `shell: false`. SQL values use parameter binding. No request field is interpolated into SQL.

Each mutating operation uses `BEGIN IMMEDIATE`. The protected execution transaction:

1. Reads the current authoritative grant, queued request and stored approval.
2. Checks active status and exclusive expiry against supplied logical time.
3. Compares subject, actor, action, resource, audience and recipient with that grant.
4. Checks the parent limit, requested child limit and amount.
5. Binds the complete request, including ID and idempotency key, to the stored approved intent.
6. Denies an existing idempotency key with a different intent. Returns `duplicate` for an unchanged already-committed request only after current authority checks pass.
7. For a new effect, checks the shared budget, records its reservation and inserts the protected row in the same transaction.

The uniqueness constraint on the effect key is a second local guard. An aborted insert rolls back the reservation. `observe()` reads actual authority, reservations, request records and effects in one database read transaction, then checks that stored spend matches the effects sum. It does not manufacture effects from the decision returned by `execute()`.

Restoration increments authority revision but does not extend expiry or trigger execution. The shared exercise policy permits an unchanged original approval after explicit restoration. The adapter supports an explicit higher approval revision for a newly authorised payload; changing the queued payload alone preserves the old approval. A request rejected at enqueue cannot later execute.

## Clock and concurrency boundaries

`at` is a non-negative safe-integer logical millisecond value supplied by the fixture. It cannot go backwards. Expiry is exclusive: execution requires `at < expiresAt`. This permits an exact-boundary test without pretending to measure wall-clock deadlines, clock skew or distributed revocation propagation.

The common catalogue controls operation order deliberately. Additional SQLite tests exercise two genuinely independent database connections:

- An authority writer is blocked while the actual adapter is paused at its protected insert inside an active write transaction. The authority change commits afterwards; the test does not call an attempted but blocked revocation a committed revocation.
- Two concurrent request writers compete for one budget that cannot fund both. One commits and the other is denied. Which request wins is intentionally unspecified.
- A test-only trigger aborts the protected insert. Both its budget reservation and effect roll back; an explicit retry succeeds after the trigger is removed.

These observations concern one local SQLite database and its configured locking. They establish neither distributed isolation nor exactly-once effects at an external API. The process-per-operation transport is a reproducibility convenience, not a performance design.

## Isolation and failure handling

The transport is asynchronous so framework deadlines can run. A subprocess timeout requests termination after 15 seconds; this is not a guaranteed completion bound. Output is limited to 4 MiB. Disposal terminates active children before removing the temporary database. A timed-out operation is still a failed/unknown outcome until authoritative state is checked; this adapter does not turn a timeout into proof of no commit. Temporary evidence disappears on disposal, so use the runner's report export to retain observations.

Authentication of the fixture caller and the trusted approval producer is outside this adapter. Equality with fixture identity fields is not proof that a real principal owns those fields. Approval fingerprints bind local canonical JSON; they are not signed tokens or a claim of interoperable protocol compliance.
