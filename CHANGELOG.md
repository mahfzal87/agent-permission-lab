# Changelog

## 3.0.0

The teaching workbench now includes a reusable permission lifecycle testing framework.

- Added a versioned adapter contract, deterministic fixture catalogue and CLI.
- Added separate expected outcomes and observed-effect validation, including valid controls and intentionally broken implementations.
- Added a real local SQLite adapter with atomic policy, approval, budget and protected-row handling.
- Added JSON, JUnit and Markdown evidence reports, explicit unsupported outcomes and bounded asynchronous operation waits.
- Added a custom adapter scaffold, contribution templates, threat model, source-linked related-work review, CI and software citation metadata.
- Added reproducible browser experiment URLs, a framework quick start and architecture reference.
- Corrected the browser model's claim of an independent oracle. Its verification pass reuses its policy predicate.
- Added the MIT licence text corresponding to the existing README licence declaration.

The original browser engine remains a distinct teaching model. No production identity provider, remote payment system, OpenFGA, Cedar, MCP or AgentDojo integration is included.
