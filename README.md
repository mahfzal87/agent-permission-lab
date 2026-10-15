---
title: Agent Permission Lab
emoji: 🧪
colorFrom: gray
colorTo: blue
sdk: static
app_file: index.html
pinned: false
license: mit
---
# Agent Permission Lab

An executable teaching model of authority at the boundary between a policy decision and a side effect. Built by [Ahmad Afzal](https://mahmadafzal.com).

## Explore

[Live workbench](https://mahfzal87.github.io/agent-permission-lab/) · [Hugging Face Space](https://huggingface.co/spaces/mahmadafzal/agent-permission-lab)

Nine deterministic experiments compare task-start approval, a separate preflight using a delayed replica, and a simulated atomic policy-and-write operation:

- Revocation between check and write (TOCTOU)
- Replica staleness after revocation
- Duplicate delivery and idempotency
- Approved intent changing before execution
- Grant expiry in a queue
- Wrong audience
- Delegation that exceeds its parent grant
- Concurrent requests against one shared budget
- A valid control case

Edit amount, delegated ceiling, shared budget, lifetime and replication lag. Step through the execution trace, inspect decision evidence, compare all 27 scenario/design pairs and export reproducible JSON.

A useful experiment: set budget to 120 and run duplicate delivery. With the default budget of 60, the preflight design blocks the second 40-unit request for budget reasons, masking its missing replay guard.

## Run and test

No dependencies, network requests or credentials. Serve the directory with any static web server. JavaScript is required for the workbench.

```sh
npm test
python3 -m http.server 4187 --bind 127.0.0.1
```

`engine.js` contains the deterministic model; `app.js` renders the UI; `test.cjs` checks 13 groups, including 972 parameter/scenario combinations for the atomic design. All values are synthetic whole pounds and logical milliseconds. These are not latency benchmarks.

## Model contract and limits

The atomic design serialises authoritative policy validation, exact approved-intent comparison, shared-budget reservation and ledger insertion in one in-memory operation. It returns the prior result on duplicate delivery without creating a second effect. This is a backend contract, not an implementation of database locks or a distributed transaction.

At each successful write, an independent oracle checks current authoritative constraints and intent, plus duplicate effects. Write-event evidence for the deliberately vulnerable designs shows that oracle, not checks those designs actually enforced.

No OAuth server, signed tokens, cryptographic identity, clock skew, partitions, crash recovery, external payment provider or LLM is implemented. External side effects need provider idempotency, reliable delivery, reconciliation and a defined cancellation boundary. A green cell means the modelled invariants held for that experiment, not a security certification.

## Sources

- [RFC 8693 subject and actor semantics](https://datatracker.ietf.org/doc/html/rfc8693)
- [Auth0 FGA consistency modes](https://docs.fga.dev/writing-data/consistency-modes)
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Contributed OWASP AISVS revocation verification example](https://github.com/OWASP/AISVS/issues/1196)
