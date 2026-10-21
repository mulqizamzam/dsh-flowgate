# PRD: dsh-flowgate v2.0

**Version:** 2.0.0-draft  
**Status:** Proposed for implementation; host-capability discovery is a blocking first milestone  
**Product:** DeepSeek Harness (DSH) plugin  
**Primary user:** Technical operator using a coding agent locally  
**Target outcome:** Evidence-driven, stateful engineering workflows with explicit validation, dependency-aware invalidation, and safe recovery  
**Estimate:** Provisional; refine after DSH API discovery and a vertical-slice prototype  
**Supersedes:** `PRD.md` v1.1 for v2 implementation scope

---

## 0. How to use this document

This PRD defines the intended product behavior, data contracts, runtime boundaries, tests, and delivery gates for Flowgate v2. It is the implementation source of truth for v2 unless a documented architecture decision record (ADR) supersedes a specific section.

Normative terms:

- **MUST / MUST NOT**: release-blocking requirement.
- **SHOULD / SHOULD NOT**: expected behavior; deviation requires a documented reason and test coverage.
- **MAY**: optional capability, explicitly marked as such.
- **Host capability**: behavior verified against the installed DSH version, not inferred from a method name or prompt instruction.

Before implementation, inspect the installed DSH package and verify the real APIs for command registration, skill resolution/rendering, steering, lifecycle hooks, tool execution, and persistence. Do not invent host methods, hook semantics, or registration signatures. The initial milestone MUST document which capabilities are supported and which require a fallback.

This PRD distinguishes three enforcement levels:

1. **Declared**: a rule exists in metadata or a prompt.
2. **Validated**: code checks the rule and reports the result.
3. **Enforced**: the runtime prevents an invalid transition or action.

A feature MUST NOT be described as enforced if it is only declared or validated. Where the host cannot support a requested enforcement boundary, Flowgate MUST disclose the limitation and use the strongest supported alternative without claiming a hard guarantee.

## 1. Executive summary

`dsh-flowgate` v1 composes engineering skills into a steering message and asks the agent to emit structured artifacts and evidence at each stage. This provides a repeatable process, but its stage gates are prompt-level instructions rather than a runtime state machine.

Flowgate v2 evolves this foundation into an **Evidence-Driven Workflow Controller**. It tracks a workflow run, validates each stage's contract, records artifact and evidence versions, follows explicit dependencies, marks affected results stale when inputs change, and resumes only from a valid checkpoint. It separates artifact validity, evidence validity, gate outcome, and review approval rather than collapsing them into one `done` state.

The product's governing rule is:

> Flowgate must report what it can verify, identify what remains unknown, and never treat an unverified or stale result as current success.

### v2 product envelope

- Retain the existing **9 skills**, **5 workflows**, and **10 slash commands**.
  ADR 0002 added the `decide` skill, the `Decision` artifact, and the `/decide`
  alias to the envelope this section originally fixed at 8 / 5 / 9.
- ADR 0003 adds the `research` skill, the `Research` artifact, and the `/research`
  alias, taking the envelope to **10 skills**, **5 workflows**, and **11 slash
  commands**.
- Introduce formal Stage Contracts and a dependency graph.
- Introduce persistent, explicit run state and deterministic transition rules.
- Validate stage outputs, required evidence, and gate criteria before a stage may be recorded as passed.
- Invalidate or revalidate dependent artifacts/evidence after input changes.
- Resume from the last valid checkpoint and protect side-effectful operations against unsafe retries.
- Emit structured execution reports and specific failure diagnostics.
- Prove behavior with unit, integration, adversarial, persistence, and live-host tests.

## 2. Problem statement

Coding agents can report progress without satisfying the corresponding engineering requirement. A statement that a test passed can be mistaken for test evidence; a file's existence can be mistaken for a valid artifact; and evidence generated for an earlier version of code can be reused after the code changes.

The v1 composer improves repeatability, but prompt-level gates cannot guarantee that the agent will not skip a stage or claim completion prematurely. It also does not, by itself, model the continued validity of artifacts and evidence after changes or interruption.

The v2 problem to solve is therefore not primarily “how to prompt better.” It is:

1. How does Flowgate know the current state of a workflow run?
2. How does it determine whether a stage's inputs, outputs, and evidence satisfy a formal contract?
3. How does it determine which results are affected by a change?
4. How does it prevent stale or unverified state from being treated as successful?
5. How can work resume after interruption without skipping necessary checks or repeating unsafe side effects?

## 3. Product thesis and principles

### 3.1 Product thesis

A workflow becomes trustworthy when its progress is represented as explicit state, every completion claim is attached to validated artifacts and relevant evidence, changes propagate through declared dependencies, and transitions follow deterministic rules.

### 3.2 Locked product principles

1. **Evidence over assertion.** An agent's claim is not sufficient proof of a result. A required completion claim must be supported by the evidence type and validation method declared in the contract.
2. **Multidimensional status.** Artifact, evidence, gate, and review states remain separate. No single generic `done` state substitutes for them.
3. **Validation before progression.** A stage cannot be recorded as passed until required inputs, outputs, evidence, and checks meet its contract.
4. **Dependency-based invalidation.** Changes trigger reevaluation of dependent results. Do not invalidate the whole run by default when the dependency graph safely identifies a narrower impact.
5. **Unknown impact means revalidation.** If Flowgate cannot establish whether a change affects an artifact or evidence, it must mark the result as requiring revalidation rather than silently retaining current validity.
6. **Last valid checkpoint.** Resume from the last checkpoint whose required state and dependencies still satisfy validity rules, not merely the most recent checkpoint by time.
7. **Deterministic behavior.** Routing, graph evaluation, transition decisions, status derivation, and recovery selection must be reproducible and explainable.
8. **Explicit state over implicit context.** Run status, artifacts, versions, dependencies, evidence, errors, and checkpoints must be recorded explicitly enough to reconstruct decisions.
9. **Honest enforcement claims.** Prompt-level instruction, application validation, and runtime enforcement are distinct. Documentation and reports must accurately state which level is active.
10. **Incremental complexity.** Add only machinery needed to satisfy current acceptance criteria. Do not start with distributed orchestration, full event sourcing, or a generalized workflow platform.

### 3.3 Decision priority order

When requirements conflict, prioritize in this order:

1. Evidence integrity and safety.
2. Contract validity and correctness of workflow state.
3. Determinism and testability.
4. Safe recovery and operational clarity.
5. Usability and feature breadth.

## 4. Goals and non-goals

### 4.1 Goals for v2

- Retain the nine existing artifact-producing skills and five workflow types.
- Formalize a machine-readable contract for every stage.
- Model workflow runs and stage attempts as persistent state.
- Keep artifact, evidence, gate, and review status independent.
- Validate required stage inputs/outputs and evidence through explicit validators.
- Bind evidence to the inputs and implementation snapshot it verifies.
- Model artifact/evidence/stage dependencies explicitly and reject dependency cycles.
- Reevaluate dependent results after a source change.
- Treat unknown change impact conservatively and report the reason.
- Support safe resume from a last valid checkpoint.
- Distinguish failed checks, blocked prerequisites, validator errors, stale evidence, and unsafe recovery.
- Preserve `/flowgate --dry-run`; extend `/flowgate` with status/report/resume options where compatible with the actual DSH command API.
- Provide deterministic reports and actionable failure diagnostics.
- Provide tests that demonstrate both successful paths and adversarial failure paths.
- Document limitations where DSH does not provide a runtime capability required for hard enforcement.

### 4.2 Non-goals for v2

- Web dashboard or graphical workflow editor.
- Skill marketplace or remote plugin registry.
- Multi-agent orchestration, distributed workers, or general-purpose parallel execution.
- Cross-host compatibility (for example, other coding-agent environments).
- Team, multi-tenant, or server deployment model.
- Telemetry, analytics, or uploading repository/user data to an external service.
- Automatic skill generation from repository analysis.
- Arbitrary user-defined workflow programming or executable workflow files.
- Full event-sourcing infrastructure.
- Automatic retry of side-effectful operations without a declared safety policy.
- Semantic proof of arbitrary claims from prose alone.
- A guarantee that the agent itself cannot bypass a gate unless a tested host mechanism provides that enforcement boundary.

## 5. Users and use cases

### Primary user

One competent technical operator working locally with DSH who wants coding-agent work to be repeatable, reviewable, and recoverable.

### Core jobs to be done

- Start a workflow from a natural-language engineering request.
- Inspect the chosen workflow and stage plan before executing it.
- Know which stages passed, failed, are blocked, or need revalidation.
- Inspect which evidence supports a completion decision.
- Change code or inputs and see which outputs/evidence are no longer current.
- Resume work after agent/session interruption without blindly trusting stale state.
- Obtain a machine-readable run report for debugging or downstream local automation.

### Representative scenario

An operator asks Flowgate to fix a login regression. Flowgate selects `bugfix`, identifies the reproduction and implementation inputs, records a failing-before test result, then verifies the fix. If code changes after verification, evidence bound to the prior implementation snapshot is reevaluated. The run cannot be reported as complete while required evidence is stale, a required gate is failed, or a validator is in error.

## 6. Compatibility and preserved v1 scope

### 6.1 Preserved skills

| Skill | Artifact | Category | Risk | Purpose |
|---|---|---|---|---|
| `intent` | `Intent` | `frame` | `low` | State what the operator wants in falsifiable terms. |
| `decide` | `Decision` | `decide` | `low` | Record the chosen approach, the alternatives it beat, and what would reopen it. Added by ADR 0002. |
| `research` | `Research` | `research` | `low` | Record evidence gathered from outside this repository: the question, the sources, the findings, and what remains unknown. Added by ADR 0003. |
| `spec` | `Spec` | `specify` | `low` | Define interfaces, boundaries, and a test strategy. |
| `slice` | `SlicePlan` | `plan` | `low` | Break the work into independently provable slices. |
| `prove` | `Proof` | `prove` | `medium` | Define proof before the change and record reproducible before/after evidence. |
| `review` | `Review` | `review` | `medium` | Review changes adversarially with explicit finding severities. |
| `constrain` | `Constraints` | `guard` | `low` | Establish a written quality bar and enforceable thresholds. |
| `recover` | `Diagnosis` | `recover` | `high` | Identify likely root cause systematically. |
| `handoff` | `Handoff` | `close` | `low` | Preserve compact takeover state: changed, verified, unverified, and next. |

### 6.2 Preserved workflows

| Workflow | Keywords | Priority | Ordered stages (`*` means required) |
|---|---|---:|---|
| `feature` | `add`, `implement`, `build`, `create`, `feature` | 60 | `intent* → research → decide → spec* → slice* → prove* → review` |
| `bugfix` | `fix`, `broken`, `regression`, `crash`, `bug` | 75 | `recover* → prove* → review*` |
| `investigation` | `investigate`, `why`, `diagnose`, `failing`, `understand` | 50 | `intent* → research → recover* → handoff*` |
| `migration` | `migrate`, `upgrade`, `deprecate`, `port`, `refactor` | 70 | `intent* → research → decide → spec* → slice* → prove* → review → handoff*` |
| `release` | `release`, `deploy`, `ship`, `production`, `launch` | 80 | `intent* → constrain* → decide → prove* → review* → handoff*` |

The optional `decide` stage was added by ADR 0002. It is present in `feature`,
`migration`, and `release`, because those are the workflows where the operator
chooses between approaches rather than reacting to an event. `release` also
gained a required `intent` stage in the same change, because the `decide`
contract requires a valid `Intent` artifact and the release workflow produced
none.

The optional `research` stage was added by ADR 0003. It is present in `feature`,
`investigation`, and `migration`, because those are the workflows that start from
a question this repository cannot answer on its own. `bugfix` and `release` are
untouched: a bugfix reacts to an event that already happened, and a release
concerns the artifact being shipped rather than the shape of the world outside
the repository. The `research` contract requires a valid `Intent` artifact, so a
workflow without an `intent` stage cannot host it.

Workflow selection MUST remain deterministic:

1. Tokenize on Unicode-aware letter/digit boundaries and normalize tokens to lowercase.
2. Count distinct configured keywords present as exact tokens; repeated occurrence of one keyword does not increase its score.
3. If every score is zero, select `investigation`.
4. Otherwise choose highest score, then higher priority, then lexicographically earlier workflow name.
5. Record scores and the tie-break result in dry-run/report output.

For `bugfix`, one `prove` stage produces one `Proof` artifact containing `FAILING_BEFORE` and `PASSING_AFTER`. If the failing reproduction cannot be obtained, report the limitation; do not fabricate evidence.

### 6.3 Preserved commands

Keep exactly these eleven command registrations unless the host's command API makes an equivalent registration impossible and an ADR approves a replacement:

`/intent`, `/decide`, `/research`, `/spec`, `/slice`, `/prove`, `/review`, `/constrain`, `/recover`, `/handoff`, `/flowgate`.

The ten aliases resolve one skill and pass the sanitized request without mutating the skill body. `/flowgate` is the orchestration entry point. v2 should extend `/flowgate` flags instead of proliferating top-level commands.

`/decide` was added by ADR 0002 and `/research` by ADR 0003, which supersede the earlier nine-registration rule for those two aliases. The rule against new orchestration surfaces is unchanged: `/decide` and `/research` load one stage skill and orchestrate nothing.

### 6.4 Preserved artifact fields

- **Intent:** `GOAL`, `NON_GOALS`, `SUCCESS_CRITERIA`, `UNKNOWNS`.
- **Decision:** `CONTEXT`, `OPTIONS`, `CHOSEN`, `RATIONALE`, `REJECTED`, `CONSEQUENCES`, `REVISED_BY`.
- **Research:** `QUESTION`, `SOURCES`, `FINDINGS`, `CONTRADICTIONS`, `GAPS`, `CONFIDENCE`, `IMPACT`.
- **Spec:** `INTERFACES`, `BOUNDARIES`, `TEST_STRATEGY`, `ACCEPTANCE`.
- **SlicePlan:** ordered slices with `SCOPE`, `PROOF`, `ROLLBACK`.
- **Proof:** `WHAT_IS_PROVEN`, `HOW`, `FAILING_BEFORE`, `PASSING_AFTER`, `EDGE_CASES`.
- **Review:** findings with `SEVERITY` (`high`, `medium`, `low`), `LOCATION`, `ISSUE`, `FIX`; plus `UNREVIEWED`.
- **Constraints:** enforceable constraints with `NAME`, `THRESHOLD`, `HOW_ENFORCED`, `FAILURE_ACTION`.
- **Diagnosis:** `SYMPTOM`, `REPRO`, `ROOT_CAUSE`, `FIX`, `PREVENTION`, `CONFIDENCE`.
- **Handoff:** `STATUS`, `CHANGED`, `VERIFIED`, `NOT_VERIFIED`, `RISKS`, `OPEN_ITEMS`, `NEXT_ACTION`.

Every artifact continues to require one terminal `## EVIDENCE` block with `FACTS`, `ASSUMPTIONS`, `PROOF`, `UNKNOWN`, `DECISION`, in that order. v2 adds machine-readable evidence records and validation metadata around these artifacts; it does not remove the human-readable evidence block.

## 7. Product requirements

### 7.1 Stage Contract Engine

Each stage MUST resolve to a versioned contract. A contract defines:

- stable stage/skill identifier and contract version;
- required and optional input artifact references;
- accepted input states and version/snapshot requirements;
- required output artifact types and schema references;
- required evidence types and the claims they support;
- validation checks and pass criteria;
- dependency declarations;
- completion policy;
- recovery eligibility and side-effect policy.

Contracts are data, not executable code. Unknown contract fields, unsupported schema versions, invalid references, duplicate identifiers, and invalid enums MUST fail closed.

### 7.2 Runtime Workflow Controller

Flowgate MUST track workflow state beyond a one-time composed message, subject to verified host capabilities. Before recording a transition to the next stage, it must evaluate the current stage's contract and state invariants.

The controller must distinguish:

- **prompt instruction**: guidance supplied to the agent;
- **application validation**: Flowgate checks a produced artifact/evidence/report;
- **runtime enforcement**: a supported host control prevents the prohibited transition or action.

A transition can only be called runtime-enforced if an integration test demonstrates the prevention at the actual host boundary. If DSH does not provide that control, Flowgate MUST label the behavior as best-effort/validation-only and surface that limitation in the run report and README.

### 7.3 Artifact registry

Every artifact instance MUST have:

- `artifact_id` unique within the run;
- `artifact_type` and schema version;
- producer stage and attempt ID;
- `status` and validation summary;
- content location or approved content reference;
- content fingerprint where useful and safe;
- input/dependency references used to produce it;
- timestamps for creation and last validation.

An artifact being present MUST NOT imply it is valid. Fingerprints can detect byte-level change; they do not prove semantic correctness.

### 7.4 Evidence registry

Every evidence record MUST have:

- `evidence_id` unique within the run;
- `evidence_type` from a closed vocabulary;
- the claim or acceptance criterion it supports;
- source/provenance (for example command, test runner, inspected artifact, or explicit human input);
- observed result and execution metadata where applicable;
- references to the input/artifact versions it verifies;
- validation method and result;
- freshness status and reason;
- timestamp and producer stage/attempt.

Do not store secrets in reports. Evidence records SHOULD reference bounded log excerpts or safe summaries rather than copying an unbounded environment dump.

### 7.5 Dependency graph

Flowgate MUST model dependencies between stage inputs, artifact instances, evidence records, validation checks, and downstream stages. The graph must:

- use stable identifiers, not display labels, as edge endpoints;
- reject dangling references and cycles where the relation must be acyclic;
- distinguish data dependency from ordering-only dependency;
- support reverse traversal to identify potentially affected downstream results;
- preserve the source version/snapshot used for a derived result;
- record when impact analysis is incomplete.

The v2 graph is scoped to one workflow run and the artifacts/evidence it knows about. It must not claim complete repository-wide semantic dependency coverage.

### 7.6 Dependency-aware invalidation

When an input, source artifact, implementation snapshot, or declared external dependency changes, Flowgate MUST reevaluate dependent nodes.

Policy:

1. If an input fingerprint is unchanged and all declared preconditions remain satisfied, dependent results may remain current.
2. If a relevant dependency changed, mark affected artifacts/evidence for revalidation or invalidation according to contract policy.
3. If impact is unknown, dependency metadata is missing, or the validator cannot determine relevance, conservatively set the affected result to `needs_revalidation` (or `stale` with an explicit reason if storage constraints require that representation).
4. Do not silently retain `current` status after a relevant or uncertain change.
5. Recompute downstream gate/run statuses from the recorded facts; do not edit old evidence to make it appear current.
6. Keep unrelated results current only when the declared graph provides a defensible basis for doing so.

Invalidation decisions MUST be explainable in the run report, including the changed dependency and affected records.

### 7.7 Checkpoints and safe resume

A checkpoint captures enough state to validate a possible resume point:

- run and workflow identity/version;
- completed stage and attempt states;
- artifact/evidence identifiers and versions;
- gate outcomes and validation summaries;
- dependency basis and relevant fingerprints;
- pending stage plan;
- side-effect state and recovery constraints;
- checkpoint creation time and schema version.

A checkpoint is valid only when all required referenced records exist, required artifacts are valid, required evidence is current, required gates passed, and no unknown impact remains unresolved for its continuation path.

Resume behavior:

1. Find the most recent checkpoint that passes current validity rules.
2. Revalidate external or unobservable dependencies that cannot be safely assumed unchanged.
3. Resume from that checkpoint only if no required stage/evidence is skipped.
4. Otherwise backtrack to a safe earlier checkpoint or rerun only the affected section.
5. If no safe path is established, stop with a clear `blocked`/recovery error and explain what must be revalidated.

The most recent checkpoint is not automatically the last valid checkpoint.

### 7.8 Side-effect and retry safety

Each stage must declare whether it is read-only, writes local artifacts, or performs external/stateful side effects. For side-effectful stages, the contract must define retry safety:

- `safe_idempotent`: retry is allowed after the controller verifies the declared idempotency condition;
- `manual_approval_required`: require explicit operator approval before repeating;
- `not_retryable`: do not automatically retry; require recovery/manual intervention.

A missing side-effect declaration is a validation error for any stage that may execute an external mutation. Flowgate must not assume an operation is idempotent merely because it is described as a retry.

### 7.9 Run report and diagnostics

Every run MUST produce a report in human-readable form and a machine-readable JSON form. The report includes:

- run ID, workflow name/version, contract/engine version;
- routing scores and selection rationale;
- stage sequence and attempt count;
- per-stage artifact, evidence, gate, and review statuses;
- checks performed and results;
- invalidation/revalidation decisions and affected dependencies;
- checkpoint used, skipped, or rejected and why;
- errors with stable error codes and actionable messages;
- enforcement level actually available for relevant gates;
- final completion decision and any remaining limitations.

The report must not equate `stage output emitted` with `stage passed`. It must not expose credentials, environment secrets, or unbounded raw logs.

### 7.10 Dry run

`/flowgate --dry-run` MUST select, resolve, and validate the workflow without causing steering, writes to source files, external side effects, or stage execution. It must show selected workflow, matching rationale, stage order, contract inputs/outputs, dependency flow, optional-stage handling, estimated/exact composition size, and any host enforcement limitations known before execution.

### 7.11 Request security and composition integrity

Retain v1 input hardening:

- measure original request in UTF-8 bytes before sanitization;
- reject requests larger than **8,192 bytes**; never truncate;
- sanitize prompt-control markers in user text before inserting it into a steering message;
- never interpolate user text into paths, workflow names, or metadata attributes;
- preserve the host-rendered skill body byte-for-byte within the composition wrapper;
- fail if total composed message exceeds **40 KiB**; do not shorten/summarize skill bodies to fit;
- validate skill/workflow metadata at startup and in CI.

Sanitization MUST be narrowly scoped to the untrusted user request. Skill content may not be silently rewritten to work around invalid metadata.

Each stage block in the composed message MUST name the evidence ids the stage's
contract requires, with their types, so the agent can declare them without
reading the contract file. The ids MUST come from the resolved contract and not
from a skill body, so a body cannot drift from what the gate accepts. Operator
input evidence is synthesized by the controller and is not listed.

## 8. State model

Status dimensions remain separate. The following enums are normative for v2 unless schema migration is required by a documented ADR.

### 8.1 Artifact status

- `missing`: no artifact instance is available.
- `present`: artifact exists but has not passed its required validation.
- `valid`: artifact passed the currently applicable artifact contract.
- `invalid`: artifact was checked and does not satisfy its contract, or its contents are corrupted/unusable.

### 8.2 Evidence status

- `missing`: required evidence does not exist.
- `current`: evidence was evaluated as relevant to the current dependency versions and satisfies its evidence contract.
- `stale`: evidence was relevant to prior inputs but a known dependency change means it no longer supports the current state without revalidation.
- `needs_revalidation`: Flowgate cannot establish whether evidence remains relevant, or required external context cannot be verified.
- `invalid`: evidence record is malformed, provenance is unacceptable, or its validation failed.

`current` means current with respect to tracked inputs; it does not independently prove that a claim is true. Claim credibility depends on evidence type, provenance, and validator quality.

### 8.3 Gate status

- `pending`: not evaluated yet.
- `passed`: every required prerequisite and check passed against current inputs/evidence.
- `failed`: checks ran and at least one required criterion was not met.
- `blocked`: required prerequisite is missing, invalid, stale, or awaiting revalidation.
- `error`: a validator/controller failed to execute reliably, so no valid result can be concluded.

### 8.4 Review status

- `pending`: review has not completed.
- `approved`: required review passed according to declared policy.
- `changes_requested`: review found changes required before completion.

If review is not required for a particular workflow, record that policy in the workflow/run; do not fake an `approved` review.

### 8.5 Run status

- `created`: run record exists, execution has not started.
- `planned`: workflow and contracts are resolved and preflight passed.
- `running`: at least one stage attempt is active.
- `paused`: execution intentionally paused with a resumable state candidate.
- `completed`: workflow definition of done is satisfied and no required gate/evidence is stale or unresolved.
- `failed`: a required criterion failed and the workflow's failure policy marks the run failed.
- `blocked`: execution cannot safely progress pending input, revalidation, approval, host capability, or recovery.
- `cancelled`: operator or supported host action cancelled the run.

A run can be `completed` only if all required stages satisfy the workflow's definition of done and no required gate is `pending`, `failed`, `blocked`, or `error`. A stage cannot be `passed` solely because its skill returned text.

## 9. Transition model

### 9.1 Stage attempt lifecycle

The normal stage attempt follows:

`pending → ready → running → validating → passed`

Alternative terminal/paused outcomes are `failed`, `blocked`, `error`, or `cancelled`. Rework creates a new attempt or explicit revision; it must not overwrite the historical record of the previous attempt.

### 9.2 Preconditions for entering a stage

A stage can become `ready` only if:

- all required input artifacts exist and are valid;
- required input versions match the contract's acceptance policy;
- required prerequisite gates have passed;
- no required evidence is stale, invalid, or awaiting revalidation;
- any required human review/approval is recorded;
- the host capability needed for the declared enforcement level is available or the limitation has been explicitly accepted under policy.

### 9.3 Preconditions for passing a stage

A stage may be recorded as `passed` only if:

1. its output artifact(s) exist and conform to the specified schema;
2. its terminal `## EVIDENCE` block is structurally complete;
3. required evidence records exist, have acceptable provenance, and bind to the correct input/output versions;
4. all required checks passed;
5. no required dependency has unresolved freshness/impact status;
6. the stage's completion policy is satisfied.

### 9.4 Transition invariants

- Missing prerequisite → `blocked`, not `failed`.
- A criterion was evaluated and not met → `failed`.
- Validator could not run or returned an untrustworthy result → `error`.
- Required evidence stale or impact unknown → `blocked` until revalidated.
- Input change → reevaluate all graph-reachable dependent records under their invalidation policies.
- Resume → cannot skip a stage whose required outputs/evidence no longer satisfy current contracts.
- Completion → cannot be reported while required evidence/gates are unresolved.
- One assistant message may carry several stage artifacts. They are recorded in
  stage order; the walk stops at the first stage that does not pass, and an
  artifact whose required prerequisite did not pass is refused as premature
  while the artifacts already recorded stand.
- All transition decisions must record their reason and the contract/rule that produced the decision.

## 10. Data contracts and storage

### 10.1 Schema versioning

All Flowgate-owned JSON data files MUST include a supported `schema_version`. Data definitions for shipped skills/workflows remain declarative and contain no executable code. Run-state, graph, report, and checkpoint records must also be versioned and validated.

The implementation MUST provide explicit migration behavior for persisted state versions:

- known compatible version: load and normalize deterministically;
- known migratable version: migrate with a test and preserve provenance;
- unknown/incompatible version: refuse resume, preserve the file, and report an actionable error.

Never silently reset incompatible persisted state and then report a successful resume.

### 10.2 Stage contract example

Illustrative YAML; final production storage may use JSON if that is most compatible with the existing repository conventions.

```yaml
schema_version: 1
stage_contract:
  id: prove
  contract_version: 1
  purpose: Verify implementation against acceptance criteria
  inputs:
    required:
      - ref: SlicePlan
        accepted_status: [valid]
        bind_version: true
  outputs:
    required:
      - ref: Proof
        schema_ref: artifact-schemas/Proof
        bind_to_inputs: [SlicePlan, implementation_snapshot]
  evidence:
    required:
      - id: relevant_test_results
        type: test_execution
        supports: acceptance_criteria
        bind_to_inputs: [implementation_snapshot]
        freshness_policy: invalidate_on_dependency_change
  checks:
    required:
      - id: proof_schema
        type: artifact_schema
      - id: acceptance_criteria
        type: acceptance_criteria
      - id: proof_evidence
        type: evidence_validation
  dependencies:
    unknown_impact_policy: needs_revalidation
  completion:
    required_checks: all
    missing_prerequisite: blocked
    unmet_criterion: failed
    checker_error: error
  recovery:
    checkpoint_eligible: true
    require_current_evidence: true
  side_effects:
    class: local_write
    retry_policy: safe_idempotent
```

This is a shape example, not a finalized JSON Schema. Exact field names and type constraints must be formalized in `schemas/` and enforced by schema tests before controller implementation.

### 10.3 Dependency edge model

Every edge must specify:

- `from`: stable source node ID;
- `to`: stable dependent node ID;
- `kind`: `input`, `derived_from`, `evidence_for`, `validated_by`, or `ordering`;
- `policy`: whether a source change invalidates, stales, or requires revalidation of the target;
- optional rationale and contract reference.

Graph construction rejects dangling IDs and prohibited cycles. Ordering-only edges do not automatically imply evidence dependency. Reverse traversal used for invalidation must be deterministic.

### 10.4 Evidence binding model

An evidence record binds to immutable references for the relevant artifact/input versions. When source data changes, create a new evidence attempt or revalidation record; do not rewrite old evidence as if it came from the new version.

### 10.5 Persistence boundaries

Persist only the minimum state needed for transparent status and recovery. Use atomic writes or an equivalent host-supported durable update mechanism. A corrupted/partial state file must be detected and must never be interpreted as a valid completed run.

The initial implementation is single-user and local. Multi-process locking is required only if the inspected DSH execution model permits concurrent controllers against the same state store; if concurrency is possible and locking cannot be implemented safely, refuse concurrent resume/update rather than permit state corruption.

## 11. Architecture

### 11.1 Logical components

1. **Command adapter** — registers the nine aliases and `/flowgate`; maps real host calls to Flowgate interfaces.
2. **Capability adapter** — provides verified host capabilities for command registration, skill resolution/rendering, steering, lifecycle/interruption signals, and any supported execution controls.
3. **Workflow resolver** — deterministic routing and stage/contract resolution.
4. **Contract validator** — validates skill contracts, stage contracts, artifact schemas, and workflow definitions.
5. **Run controller** — owns transitions, preconditions, gate results, and run status.
6. **Artifact registry** — records artifact identities, versions, validity, and input bindings.
7. **Evidence registry** — records claims, provenance, results, and freshness.
8. **Dependency graph** — validates graph structure and identifies affected downstream records.
9. **Checkpoint/recovery manager** — selects valid checkpoints and applies retry/side-effect policy.
10. **Report writer** — emits deterministic human-readable and JSON reports.
11. **Persistence adapter** — reads/writes versioned run state atomically within the host-supported local boundary.

### 11.2 Separation of concerns

- Workflow JSON defines stage order and workflow policy; it must not embed runtime logic.
- Skills define stage behavior and human-facing artifact instructions.
- Contracts define inputs, outputs, evidence, checks, dependencies, and recovery conditions.
- Controller code implements generic transitions; it must not hard-code individual workflow stage sequences.
- Host-specific API calls stay behind the capability adapter.
- Reports are derived from stored facts; they must not be the source of truth for runtime state.

### 11.3 Host capability discovery gate

Before implementing transitions, inspect the installed host to establish:

- supported command registration and invocation context;
- whether a command can persist/recover run state between turns;
- whether DSH exposes supported stage/turn/tool lifecycle hooks;
- whether a host tool/action can block or reject a prohibited continuation;
- how skills are loaded and rendered;
- how steering is invoked and errors surfaced;
- host/runtime versions and test harness capabilities.

Produce `docs/host-capability-matrix.md` with each capability labeled `verified`, `unsupported`, or `unknown`, the evidence/test used, and the effect on product guarantees. `unknown` cannot be presented as `verified`.

## 12. Command behavior

Keep the ten command registrations. Exact flag parsing must be deterministic and documented in README.

### 12.1 Skill aliases

Each alias must resolve one shipped skill, verify that it is user-invocable through the real host API, sanitize the request, and invoke the supported host behavior. It must not select or run a multi-stage workflow. Skill bodies are passed through unchanged.

### 12.2 `/flowgate`

Required behavior:

- `/flowgate <request>`: create a run, select/resolve/validate the workflow, perform preflight, and initiate execution using supported host APIs.
- `/flowgate --dry-run <request>`: perform routing, resolution, contract/graph preflight, and composition-size checks; no steering or stage execution.
- `/flowgate --status <run-id>`: display current run and stage statuses without changing them.
- `/flowgate --report <run-id>`: emit the persisted run report; support JSON output where the command API permits, otherwise write/report a documented deterministic path.
- `/flowgate --resume <run-id>`: validate current state, choose the last valid checkpoint, and resume only if safe.

If the host command parser cannot support this exact grammar, implement an equivalent unambiguous grammar and document the ADR. Do not add a separate top-level slash command merely to work around flag parsing.

### 12.3 Dry-run output

Dry-run includes:

- selected workflow, keyword scores, priority and tie-break rationale;
- ordered stages with required/optional flag and purpose;
- required/optional inputs, output artifact types, evidence, and checks;
- dependency graph summary and expected invalidation behavior;
- unresolved host capability constraints;
- skill body sizes and total exact/estimated composed message size;
- no state mutation, steering call, source write, or external side effect.

## 13. Error taxonomy

All errors surfaced to users and reports need a stable machine-readable code, a human-readable message, and, where applicable, a remediation hint.

Minimum categories:

- `FLOW_REQUEST_TOO_LARGE`
- `FLOW_NO_MATCH_FALLBACK`
- `WORKFLOW_INVALID`
- `CONTRACT_INVALID`
- `DEPENDENCY_DANGLING_REFERENCE`
- `DEPENDENCY_CYCLE`
- `STAGE_INPUT_MISSING`
- `ARTIFACT_SCHEMA_INVALID`
- `EVIDENCE_MISSING`
- `EVIDENCE_STALE`
- `EVIDENCE_IMPACT_UNKNOWN`
- `GATE_FAILED`
- `VALIDATOR_ERROR`
- `CHECKPOINT_INVALID`
- `RESUME_BLOCKED`
- `SIDE_EFFECT_RETRY_DENIED`
- `HOST_CAPABILITY_UNAVAILABLE`
- `STATE_CORRUPT`
- `STATE_VERSION_UNSUPPORTED`
- `COMPOSITION_TOO_LARGE`

A missing prerequisite is not reported as a failed acceptance criterion. A checker failure is not reported as a criterion failure. Error codes must be stable across messages and JSON reports.

## 14. Validation and test strategy

Tests must run deterministically and stop at the first failed gate. Every test suite must be uniquely named; duplicated files do not count as separate gates. Unit tests may use adapters/fakes, but hard-enforcement claims require integration tests against the real DSH capability involved.

The target v2 suite contains **18 unique gates**, in this fixed order:

| Order | Gate | Required proof |
|---:|---|---|
| 1 | `structural.test.mjs` | Skill frontmatter, directories, names, size limits, and required artifact fields validate. |
| 2 | `json-schema.test.mjs` | Versioned data schemas, unknown fields/enums, duplicate JSON keys, and malformed files fail closed. |
| 3 | `host-capabilities.test.mjs` | Real installed APIs and supported runtime assumptions are recorded; unknown host methods are never guessed. |
| 4 | `skill-load.test.mjs` | Every skill loads through the host's real loader; mutation probes confirm actual loader behavior. |
| 5 | `contracts.test.mjs` | Required inputs, accepted states, outputs, evidence, checks, side-effect policy, and contract versions validate. |
| 6 | `workflows.test.mjs` | Five workflows, exact stage order/keywords/priorities, optional stages, and artifact chains validate. |
| 7 | `dependency-graph.test.mjs` | Edge endpoints exist, prohibited cycles fail, ordering edges are distinguished, reverse traversal is deterministic. |
| 8 | `artifact-registry.test.mjs` | Artifact identity/version/status are correct; presence is not accepted as validity; binding changes are detected. |
| 9 | `evidence-registry.test.mjs` | Evidence provenance and input bindings are mandatory; current/stale/unknown/invalid states are distinguished. |
| 10 | `transition-rules.test.mjs` | Missing prerequisites block; unmet checks fail; checker exceptions error; a gate cannot pass with unresolved required evidence. |
| 11 | `invalidation.test.mjs` | Source changes affect graph-dependent results; unknown impact forces revalidation; unaffected results remain current only with a defensible graph basis. |
| 12 | `checkpoint.test.mjs` | Checkpoint completeness/versioning/validity and last-valid selection work across stale and corrupted state cases. |
| 13 | `recovery-safety.test.mjs` | Resume does not skip required work; side-effect policies prevent unsafe automatic retries. |
| 14 | `routing.test.mjs` | Exact-token scores, zero-match fallback, priority/lexical tie-breaks, Unicode, repeated words, punctuation, and large input are deterministic. |
| 15 | `composition-security.test.mjs` | Sanitization, request byte limit, 40 KiB message limit, wrapper injection tests, and byte-identical skill bodies pass. |
| 16 | `persistence.test.mjs` | Atomic update/corruption/version migration and unsupported-version refusal behave correctly. |
| 17 | `report-and-command-e2e.test.mjs` | Ten commands register, dry-run is side-effect-free, status/report/resume behaviors work, and reports match stored state. |
| 18 | `live-host-verification.test.mjs` | Supported live host path verifies actual behavior; enforcement level is proven or explicitly downgraded/documented. |

### 14.1 Mandatory adversarial scenarios

At minimum, tests must cover:

1. Agent emits a success sentence without the required output artifact.
2. Artifact exists but fails its schema.
3. Test evidence exists but is bound to an earlier code snapshot.
4. Input changes and graph propagation marks downstream evidence stale.
5. Dependency impact is unknown or a required dependency is undeclared.
6. A checker crashes; the gate becomes `error`, not `failed` or `passed`.
7. A stage has a missing prerequisite; it becomes `blocked`.
8. The latest checkpoint is stale but an earlier checkpoint is valid.
9. No valid checkpoint exists; resume refuses to continue.
10. A side-effectful stage is interrupted before outcome is known; automatic retry is denied unless policy proves it safe.
11. Persisted state is truncated/corrupt or uses an unsupported schema version.
12. Request attempts to close or spoof skill wrappers, evidence markers, stage markers, workflow names, or filesystem paths.
13. Dry-run attempts are proven not to steer, execute, or mutate state.
14. Runtime enforcement is reported only where host integration tests demonstrate it.

### 14.2 Host live-verification behavior

The live verification script must inspect the installed host layout and use configured local paths; it must not hard-code guessed APIs or browser URLs. It must identify plugin load, command registration, skill catalog resolution, state persistence, and any claimed enforcement boundary. Every unsupported capability must yield a documented limitation, not a false-positive success.

## 15. Delivery plan and milestone gates

Milestones are sequential. Do not begin controller implementation before the host capability gate is resolved.

### M1 — Host capability discovery and vertical slice

- Inspect installed DSH package and runtime.
- Create `docs/host-capability-matrix.md` and ADR for the enforcement boundary.
- Verify command registration, skill loading/rendering, steering and test harness.
- Prototype one workflow stage from command invocation through artifact capture/validation using only verified APIs.

**Gate:** the vertical slice is reproducible in the actual host or the PRD is revised to reflect the host's real constraints. No guessed host API remains.

### M2 — Formal contracts and state foundation

- Define finalized JSON schemas for stage contracts, artifacts, evidence, dependency edges, run state, checkpoints, and reports.
- Implement schema versioning and fail-closed validators.
- Implement routing and preserve the existing skills/workflows/aliases.
- Implement artifact/evidence registries and persisted run records.

**Gate:** contract, workflow, artifact, evidence, and persistence tests pass; invalid state cannot be interpreted as valid completion.

### M3 — Controller, transitions, and invalidation

- Implement stage attempt lifecycle and deterministic transition rules.
- Implement graph validation and dependency-aware invalidation.
- Implement revalidation behavior for known changes and unknown impact.
- Integrate the strongest host-supported transition control and label un-enforced cases honestly.

**Gate:** transition and invalidation tests pass; stale required evidence cannot produce a passed gate.

### M4 — Checkpoint, recovery, and diagnostics

- Implement checkpoint creation, last-valid selection, safe resume, side-effect retry policy, error taxonomy, and report output.
- Implement `/flowgate --status`, `/flowgate --report`, and `/flowgate --resume` with supported host-compatible grammar.

**Gate:** corrupt/stale checkpoints are rejected; recovery tests pass; every blocked/failed/error run has actionable diagnostics.

### M5 — Adversarial hardening and live acceptance

- Complete all 18 gates.
- Run live-host verification for every claimed enforcement boundary.
- Verify request sanitization, limits, byte-preserving skill composition, and report redaction.
- Update README, install instructions, migration guidance, and known limitations.

**Gate:** all tests pass in the fixed order; live integration result is documented; no success claim exceeds demonstrated behavior.

## 16. Final acceptance criteria

Flowgate v2 is not release-ready until all of the following hold:

1. All 18 unique test gates pass in the required order.
2. The 9 skills, 5 workflows, and 10 commands remain present and pass structural checks.
3. `/flowgate --dry-run` displays deterministic routing, stage order, inputs/outputs, dependencies, checks, and size information without steering, executing, or mutating run state.
4. All stages are represented by versioned contracts with input, output, evidence, check, dependency, completion, and recovery declarations.
5. Artifact, evidence, gate, review, and run statuses are stored/derived independently.
6. An output artifact cannot be marked valid solely because it exists.
7. A required gate cannot pass without valid outputs, current required evidence, and passing checks.
8. Evidence is bound to the input/source versions it verifies.
9. A known relevant dependency change triggers invalidation/revalidation of its affected descendants according to policy.
10. Unknown impact never silently leaves evidence current.
11. Missing prerequisites result in `blocked`; unmet criteria in `failed`; validator failures in `error`.
12. A run cannot be `completed` while required checks or evidence remain pending, failed, blocked, stale, invalid, or unresolved.
13. Resume selects the last valid checkpoint, not simply the most recent checkpoint.
14. If no safe recovery point exists, resume stops with `RESUME_BLOCKED` and a reason.
15. Side-effectful stages cannot be automatically retried contrary to their declared policy.
16. Persisted state corruption or unsupported schema versions are detected and never silently reset into a successful run.
17. Reports show decisions and reasons from the stored state and contain no secrets or unbounded raw logs.
18. The report accurately labels declared, validated, and enforced behavior based on verified host capabilities.
19. Original request length above 8,192 UTF-8 bytes is rejected; user-supplied control markers are sanitized; composed message above 40 KiB fails without truncating skill content.
20. Live integration tests demonstrate every asserted hard-enforcement boundary. Any unsupported host capability is explicitly documented.
21. Installation, operation, recovery, migration, and known limitations are documented in README.

## 17. Risks and mitigations

### R1 — Host APIs cannot enforce transitions

**Risk:** DSH may not expose a supported hook that can mechanically prevent the agent from progressing.  
**Mitigation:** Resolve in M1, isolate APIs behind an adapter, test the real boundary, and describe the feature as validation-only if hard enforcement is unavailable. Do not build a pretend lock using prompt language.

### R2 — Dependency graph is incomplete

**Risk:** A changed dependency may affect a result that is not represented in the graph.  
**Mitigation:** Scope claims to declared dependencies, require explicit stage contract dependencies, record incomplete impact analysis, and use conservative revalidation when coverage is uncertain.

### R3 — Fingerprints are mistaken for semantic proof

**Risk:** Matching hashes can show the bytes did not change but cannot establish that evidence is truthful or adequate.  
**Mitigation:** Treat fingerprints as change detectors; validate provenance, result, criteria, and evidence type independently.

### R4 — External context changes between checkpoint and resume

**Risk:** Local artifacts remain unchanged while environment, service state, toolchain, or remote resource changes.  
**Mitigation:** Allow contracts to declare external dependencies; revalidate those that cannot be fingerprinted or reliably observed before resuming.

### R5 — Duplicate side effects on recovery

**Risk:** Resume repeats deployment, data mutation, or another non-idempotent action.  
**Mitigation:** Required side-effect classification, explicit retry policy, operation identity/idempotency evidence, and manual approval where necessary.

### R6 — Persistence becomes overly complex

**Risk:** Prematurely introducing event sourcing or a database makes a local plugin brittle.  
**Mitigation:** Start with small versioned state records and atomic updates; add complexity only when acceptance tests require it.

### R7 — Agent-generated evidence is ritualistic

**Risk:** The agent writes plausible fields that do not represent real observations.  
**Mitigation:** Prefer evidence produced/observed by real tools or validated sources; identify evidence provenance and validator type; never claim that structural validation alone proves truth.

### R8 — Reports leak sensitive data

**Risk:** Raw command output, environment variables, paths, or tokens appear in a report.  
**Mitigation:** Redact known secret patterns, avoid environment dumps, bound excerpts, and test redaction. Do not promise perfect secret detection.

### R9 — Persisted state is corrupted or incompatible

**Risk:** The controller resumes from a partial or older state record.  
**Mitigation:** Atomic writes, checksums where appropriate, schema versions, fail-closed load, and tested migration/refusal behavior.

## 18. Explicitly do not build

- A web UI or dashboard.
- Marketplace or remote skill registry.
- Multi-agent/distributed orchestration.
- Cross-host compatibility.
- General-purpose user-coded workflow definitions.
- External telemetry or analytics.
- Full event sourcing or distributed database.
- Arbitrary parallel execution.
- Automatic retries for unsafe side effects.
- Semantic truth detection from unstructured prose alone.
- More top-level slash commands unless an ADR demonstrates `/flowgate` cannot express the required supported behavior.
- Any fabricated host API, undocumented hook, or false claim of runtime enforcement.

## 19. v1-to-v2 migration policy

- Keep the nine skills' user-visible purpose and their artifact minimum fields unless a schema change is justified and documented.
- Preserve all five workflow names, keyword lists, priorities, and stage order unless a separate ADR establishes a backward-incompatible correction.
- Preserve the ten command registrations; extend `/flowgate` options compatibly.
- Keep the existing human-readable `## EVIDENCE` block while adding structured evidence records.
- Existing v1 runs/artifacts without version bindings MUST NOT be assumed current under v2. They may be imported as legacy artifacts with `needs_revalidation` status.
- v1 prompt-level gates must not be retroactively described as runtime-enforced.
- Use explicit schema migration. If a legacy record cannot be safely normalized, preserve it and require a fresh run or manual validation; never mark it completed by default.

## 20. Documentation requirements

The README and references must include:

- product summary, installation, verified host/runtime versions;
- all ten commands and their supported options;
- workflow selection rules;
- artifact and evidence status definitions;
- run status and error code reference;
- how invalidation works and what an unknown dependency impact means;
- how to inspect reports and resume a run;
- side-effect and retry behavior;
- host capability matrix and precise enforcement limitations;
- local state location, schema migration policy, and how to handle corrupt state;
- known limitations, especially that evidence relevance is bounded by declared dependency coverage and validators cannot infer truth from any arbitrary claim.

## 21. Open decisions that must be resolved during M1/M2

These are implementation questions, not permission to guess:

1. Which installed DSH hooks, if any, can block or gate agent continuation?
2. Which host APIs expose actual tool/test execution results with reliable provenance?
3. What local storage boundary is supported and writable by the plugin?
4. Can multiple runs execute concurrently, and what locking mechanism is supported?
5. Which external dependencies can be fingerprinted or revalidated reliably?
6. Can command options return structured output directly, or must reports be written to a documented local path?

Each decision must produce an ADR or capability-matrix update and corresponding tests.

## 22. Definition of done

A workflow run is complete only when:

- its selected workflow and resolved stage contracts are valid;
- all required stages have passed under their declared completion policies;
- every required output artifact is valid for the current inputs;
- every required evidence record is current, provenance-acceptable, and bound to the right versions;
- all required gates pass and all required reviews have the declared approval state;
- no unresolved impact analysis or unsafe recovery condition remains;
- the final report records the completion decision and any limitations.

A report that says a workflow is complete while violating any of these conditions is a product defect.
