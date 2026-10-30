# Related work

Reviewed 30 October 2026. These comparisons describe inspected primary documentation, not results from running the other projects. They do not establish feature absence or comparative security performance.

Agent Permission Lab focuses on a narrow question: **does an agent's permission still hold when an effect is committed, including after changes and retries?** Its intended contribution is a reusable set of event schedules, adapter tests and inspectable evidence. Existing authorisation engines, runtime guards and agent benchmarks remain useful alongside it.

| Work | Documented focus | Relationship to this lab |
|---|---|---|
| [AgentDojo](https://github.com/ethz-spylab/agentdojo) | Evaluating prompt-injection attacks and defences in tool-using environments. | Its [custom suites](https://agentdojo.spylab.ai/concepts/task_suite_and_tasks/) support state and trace checks. Our default suite isolates deterministic permission transitions from model behaviour. A future integration would complement, not replace, those suites. |
| [AgentSpec](https://github.com/haoyuwang99/AgentSpec) | User-defined runtime rules with LangChain integration, triggers, predicates and enforcement strategies. | A runtime guard can be a system under test. This lab does not introduce another rule language or assume a documented pre-execution check is an atomic transaction. |
| [Agent Security Bench (ASB)](https://github.com/agiresearch/ASB) | Benchmarking several attacks and defences across agent scenarios, including prompt injection, memory poisoning and plan backdoors. | Its scope is broader adversarial agent evaluation. This lab's reference cases run without a model or API credentials and concern execution authority and effects. “AgentSecurityBench” can refer to several projects; this link identifies the ASB compared here. |
| [OpenFGA](https://openfga.dev/docs/modeling/testing) | Relationship-based authorisation with declarative model tests, a CLI and a model-testing GitHub Action. | Keep existing policy tests. Add lifecycle tests around the application that calls the policy engine and performs the effect. OpenFGA already documents [agents as principals](https://openfga.dev/docs/modeling/agents/agents-as-principals) and [task-based authorisation](https://openfga.dev/docs/modeling/agents/task-based-authorization). |
| [Cedar](https://github.com/cedar-policy/cedar) | Fine-grained authorisation language, validation, concrete decisions and policy analysis. | Cedar can supply policy decisions. Application queues, retries, state freshness and effect commits are separate boundaries to exercise. A policy adapter alone is not an execution adapter. |
| [FINOS AI Governance Framework](https://github.com/finos/ai-governance-framework/issues/407) | Stale authority and uncertain outcomes are already discussed in issue 407; [PR 425](https://github.com/finos/ai-governance-framework/pull/425) proposes related control refinements. | Reproducible examples can illustrate these concerns. The lab does not invent the controls, claim endorsement or treat an open PR as an adopted requirement. |
| [SAF](https://github.com/secure-agentic-framework/saf-mcp/blob/main/techniques/SAF-T1201/README.md) | SAF-T1201 concerns changes to an approved tool definition or artifact. [Issue 238](https://github.com/secure-agentic-framework/saf-mcp/issues/238) discusses execution enforcement with observed-effect evidence. | Authority revocation and tool-definition mutation are different cases. Cite the exact boundary tested; this lab does not claim SAF certification or complete technique coverage. |

## Design choices informed by this work

- **Test the tests.** A valid action must work. An intentionally weak reference design must expose the intended violation. A deny-everything adapter is not a successful implementation.
- **Separate decisions and effects.** Record both. Do not infer a payment, file write or other effect solely from an `allow` response.
- **Keep the environment outside the request.** AgentDojo's [runtime documentation](https://agentdojo.spylab.ai/concepts/functions_runtime/) separates injected environment state from model-provided arguments. Authority and observation data in this lab must likewise come from a declared test boundary.
- **Declare consistency assumptions.** OpenFGA documents [cache and consistency modes](https://openfga.dev/docs/interacting/consistency). A fresh check and an atomic application write are separate properties. Do not label a real engine stale without recording its configuration.
- **Retain diagnostics.** Cedar distinguishes decisions and evaluation errors in its [authorisation semantics](https://docs.cedarpolicy.com/auth/authorization.html). A denied request, failed adapter and unavailable service are different observations.

Read the [threat model](threat-model.md) before interpreting a green result. None of these comparisons is a claim that this lab is a production enforcement service.
