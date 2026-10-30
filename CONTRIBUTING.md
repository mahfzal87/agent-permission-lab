# Contributing

A useful contribution makes one permission boundary easier to reproduce, inspect or test. Small fixtures, clear counterexamples and corrections to an overclaim are welcome.

Start with the [README](README.md), [threat model](docs/threat-model.md) and [related work](docs/related-work.md). For an integration, follow [Write an adapter](docs/write-an-adapter.md).

## Before changing the code

- Search existing issues and pull requests for the same case.
- State the concrete behaviour you want to demonstrate and the boundary being observed.
- Keep scenarios synthetic and local by default. Do not include credentials, private customer data, destructive production targets or unreviewed remote code.
- Submit only material you have the right to share. Preserve attribution and notices. Read the repository's [licence](LICENSE) before reusing or redistributing its content. Third-party assets may have separate terms.

## Adding a scenario

Include the initial authority, proposed action, event order, expected decisions, expected effects and why each invariant matters. Show a valid positive control and a relevant failing design. Avoid a case that passes merely because every action is denied.

Use fixed fixtures or a recorded seed. Record the time model. If a case depends on cache behaviour, restart, simultaneous execution or an external protocol, identify exactly where that behaviour is implemented and observed. Unsupported behaviour must remain explicit rather than being represented by a successful stub.

## Adding an adapter

Keep the implementation behind the documented contract. Document its dependencies, version, supported operations, state-reset behaviour, effect boundary and limitations. Return observations rather than a self-awarded safety score. A policy engine's allow/deny result is different from evidence of an executed action.

Provide a minimal runnable example and a regression test that would fail before the change. A real integration should have an isolated target, cleanup and no dependency on a contributor's private service. Do not silently require API keys for the default suite.

## Pull request checklist

- Explain the problem, final behaviour and scope in plain language.
- Run the repository checks listed in the README and the tests affected by the change.
- Include the exact command, relevant result and evidence limitations. Do not claim tests were run if they were only inspected.
- Preserve existing public demo behaviour unless the change intentionally replaces it and documents the migration.
- Keep modelled outcomes, real local observations and external-service results clearly separated.
- Update the example and documentation when the contract changes.
- Describe substantive tool assistance accurately when relevant or required by the contribution destination. The contributor remains responsible for every submitted claim and file.

No certification, conformance or production-readiness badge should be added merely because the reference suite passes. See [SECURITY.md](SECURITY.md) for sensitive reports.
