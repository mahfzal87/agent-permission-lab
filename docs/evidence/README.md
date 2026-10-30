# Example evidence

These are real local runs of the fictional `queued-revocation` fixture, produced on 30 October 2026. All identities and amounts are synthetic.

- [SQLite transaction: PASS](sqlite-revocation.json): revocation commits before execution; the effect ledger remains empty.
- [Cached decision: FAIL](cached-revocation.json): the old decision creates a protected effect using stale authority. The returned revision and observed effect expose the mismatch.

Reproduce from the repository root:

```sh
node bin/permission-lab.cjs run --adapter sqlite --fixture queued-revocation --format json
node bin/permission-lab.cjs run --adapter cached --fixture queued-revocation --format json
```

The second command should return exit code 1. These reports include source and fixture hashes and the local Node environment. They are unsigned example artifacts. Only the adapter entry file is hashed automatically; transitive adapter dependencies are not attested. Use the exact repository commit and keep your environment with a new result.
