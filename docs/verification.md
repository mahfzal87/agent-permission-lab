# Verification record for framework v3

Verified locally on 30 October 2026 with Node 24.15.0, Python 3.9.6 and macOS arm64. GitHub CI separately runs Node 22 and 24 with Python 3.12 on Linux; its live result is the authority for that environment.

## Executed checks

- `npm test`: 40 Node tests passed, covering runner failure injection, CLI/reporting, URL round trips and SQLite integration. The retained teaching engine also passed 13 test groups and 972 atomic scenario/parameter combinations. These are different scopes, not a combined security score.
- Full lifecycle catalogue: 18 expected outcomes passed for the atomic reference and 18 for the SQLite adapter. Deliberate cached, preflight and deny-all failures are tested as negative controls.
- SQLite integration includes independent writer locking, concurrent budget competition, transaction rollback on forced insert failure and retry, current identity/scope constraints, exclusive expiry and invalid input rollback.
- Review mutations caught incorrect returned revisions, hidden earlier failures, mandatory preflight overreach, inclusive expiry and missing audience enforcement. Corresponding regression tests are retained.
- Example JSON reports were parsed, JUnit output was parsed as XML, and tutorial commands were executed.
- Diagram Design offline structural self-check passed for the architecture reference.
- Browser verification covered comparison cells, unsafe trace inspection, shared URL replay, malformed URL fallback, Step and Reset, and 390-pixel mobile layout. No page-wide horizontal overflow on the mobile workbench. The architecture has its own keyboard-focusable horizontal scroll area. Browser console contained no errors during these checks.

## Limits

No real OpenFGA, Cedar, MCP, identity-provider or remote payment integration was tested. No external attack benchmark was reproduced. Logical time does not test wall-clock races or distributed scheduling. A malicious adapter can lie because it is trusted executable code; source hashes do not attest its behaviour. Runtime, network and provider crash recovery remain outside this release.

The browser's original model and the new CLI are intentionally distinct profiles. The browser result verifier reuses its policy predicate. The CLI uses literal fixture outcomes plus structural, identity, revision and ledger-delta checks. Inspect the [threat model](threat-model.md) and [example evidence](evidence/README.md) before reusing a result.
