# Security reports

Agent Permission Lab is a teaching and testing project. It is not a production authorisation boundary. Read the [threat model](docs/threat-model.md) for its assumptions and limits.

Intentionally vulnerable reference designs are part of the lab. Report a problem if the lab misrepresents those failures, unsafe content is executed unexpectedly, sensitive data is exposed, or an implementation contradicts its documented safety boundary.

## Reporting a sensitive issue

Check the repository's [Security page](https://github.com/mahfzal87/agent-permission-lab/security). If GitHub offers **Report a vulnerability**, use that private reporting route. Its availability is controlled by the repository settings and is not guaranteed by this document.

If private reporting is unavailable, open a minimal issue requesting a private reporting channel. Do not include credentials, personal data, an active exploit or sensitive reproduction details in that public issue. No private contact address or response-time commitment is specified here.

When a private channel is available, include the affected revision, operating environment, exact command, expected and observed behaviour, and a small synthetic reproduction. Distinguish an intended weak-design result from an unintended defect. Do not test systems you do not have permission to assess.

Public documentation corrections and ordinary test failures can use normal issues. Remove secrets and customer information from attached traces and evidence.
