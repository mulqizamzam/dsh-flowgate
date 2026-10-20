# dsh-flowgate

Evidence-gated engineering workflows for DeepSeek Harness — v2.

Flowgate turns a workflow into recorded facts: a stage contract declares what an
artifact must contain, what evidence must support it, which checks decide the
gate, and which inputs it binds to. The runtime controller accepts stage output
only when the artifact validates and its evidence is current, then writes a
checkpoint. When an input changes, everything downstream is marked for
revalidation instead of quietly staying green.

The harness is honest about its ceiling: gates are **validated**, not
**enforced**. The host exposes no hook that can stop an agent mid-loop without
also blocking remediation, so Flowgate states that limitation in every dry run,
status, and report instead of claiming a lock it does not have.

## Install

From the plugin directory:

```sh
dsh plugin --profile web add link:"$PWD"
```

A host restart activates the commands. State is written on the first run; see
[State location](#state-location) for the directory order.

## Commands

| Command | Action |
| --- | --- |
| `/intent` | Load the intent skill. |
| `/spec` | Load the spec skill. |
| `/slice` | Load the slice skill. |
| `/prove` | Load the prove skill. |
| `/review` | Load the review skill. |
| `/constrain` | Load the constrain skill. |
| `/recover` | Load the recover skill. |
| `/handoff` | Load the handoff skill. |
| `/flowgate` | Start, inspect, or resume a run. |

`/flowgate` options:

| Input | Behavior |
| --- | --- |
| `<request>` | Select a workflow, compose one message, create a run, steer the agent. |
| `--dry-run <request>` | Print workflow, routing scores, stages, contracts, graph size, and limits. Creates no run, writes nothing, does not steer. |
| `--status <run-id>` | Render the stored status of that run. |
| `--report <run-id> [--json]` | Render the stored report, redacted; `--json` emits the schema-validated report object. |
| `--resume <run-id>` | Continue from the last valid checkpoint. Refuses (`RESUME_BLOCKED`) when none survives validation. |

Each alias command resolves the skill through the host registry, refuses a
non-user-invocable skill, and steers one message with the host-rendered body plus
the request.

## Workflows

| Workflow | Priority | Keywords | Stages (`*` = required) |
| --- | ---: | --- | --- |
| feature | 60 | add, implement, build, create, feature | intent* → spec* → slice* → prove* → review |
| bugfix | 75 | fix, broken, regression, crash, bug | recover* → prove* → review* |
| investigation | 50 | investigate, why, diagnose, failing, understand | intent* → recover* → handoff* |
| migration | 70 | migrate, upgrade, deprecate, port, refactor | intent* → spec* → slice* → prove* → review → handoff* |
| release | 80 | release, deploy, ship, production, launch | constrain* → prove* → review* → handoff* |

Routing is pure and deterministic: the request is tokenized on Unicode letter and
number boundaries, each workflow counts the distinct keywords it contains, the
highest count wins, ties break on higher priority then lexicographically, and a
zero-match request falls back to `investigation` with the reason recorded. The
bugfix workflow runs prove twice by rule rather than duplicating a stage.

## Stage contracts

A contract is data (`assets/contracts.json`, validated against
`schemas/contracts-file.schema.json`). Each contract declares:

- **requires / requires_any** — the artifact inputs, or alternatives that force
  revalidation because the plan cannot know which one will be used.
- **produces** — exactly one artifact type.
- **evidence** — required evidence id, type, accepted provenance, and the fields
  it supports.
- **checks** — the five gate checks: `artifact_fields`, `artifact_schema`,
  `evidence_block`, `evidence_validation`, `evidence_current`.
- **side_effects** — `read_only`, `local_write`, or `external_write`, plus a retry
  policy (`safe_idempotent`, `manual_approval_required`, `not_retryable`).

| Stage | Artifact | Required evidence | Provenance accepted | Side effects |
| --- | --- | --- | --- | --- |
| intent | Intent | `request_recorded` (operator input, synthesized) | operator_input | read_only / safe_idempotent |
| spec | Spec | `acceptance_recorded` (artifact inspection) | observed_tool, agent_statement | read_only / safe_idempotent |
| slice | SlicePlan | `slices_recorded` (declared) | agent_statement | read_only / safe_idempotent |
| prove | Proof | `failing_before_observed`, `passing_after_observed` (test execution) | observed_command, observed_tool | local_write / safe_idempotent |
| review | Review | `review_findings_recorded` (review result) | agent_statement, observed_tool | read_only / safe_idempotent |
| constrain | Constraints | `thresholds_recorded` (declared) | agent_statement, operator_input | read_only / safe_idempotent |
| recover | Diagnosis | `repro_observed` (command execution), `root_cause_recorded` | observed_command/observed_tool; agent_statement/observed_tool | read_only / safe_idempotent |
| handoff | Handoff | `state_recorded` (declared) | agent_statement, operator_input, observed_command | local_write / safe_idempotent |

## Evidence protocol

Every stage output ends with an `## EVIDENCE` block containing FACTS, ASSUMPTIONS,
PROOF, UNKNOWN, and DECISION, in that order. An empty field is written as `none`.
A missing, incomplete, or out-of-order block fails the stage.

Evidence may also be declared:

```text
EVIDENCE_RECORD: {"id": "repro_observed", "type": "command_execution", "command": "node --test tests/login.test.mjs", "result": "fail"}
```

The controller matches a declaration against observations captured from real host
`tool/result` events. A match upgrades provenance to `observed_command`; a declared
`result` that contradicts the observed result makes the evidence `invalid`; no
observation leaves `agent_statement`, which satisfies only contracts that accept
it. Evidence the contract does not accept is `needs_revalidation`, never `current`.
Full formats: [assets/references/evidence-protocol.md](assets/references/evidence-protocol.md),
[assets/references/artifact-schemas.md](assets/references/artifact-schemas.md).

## Statuses

Evidence: `missing` · `current` · `stale` · `needs_revalidation` · `invalid`.

Artifacts: `missing` · `present` · `valid` · `invalid`, plus a freshness of
`current` or `needs_revalidation`. A recorded artifact is never `valid` until its
structural checks pass; `present` alone can never pass a gate.

Gates: `pending` · `passed` · `failed` · `blocked` · `error`.

| Gate | Meaning |
| --- | --- |
| pending | The stage has not produced or validated anything yet. |
| passed | Artifact valid, required evidence current, all checks passed. |
| failed | The stage claimed a result the contract rejects, or a check failed. |
| blocked | A prerequisite is missing, or its evidence is missing/stale/invalid/unknown impact. |
| error | A checker could not run; `VALIDATOR_ERROR` is recorded. |

Runs: `running` · `blocked` · `failed` · `completed` · `cancelled`. Completion is
`pending` while work remains, `blocked` when a required gate cannot pass, and
`completed` only when every required stage passed with current evidence and the
review policy is satisfied. Review is never auto-approved: `decideReview` records
`approved`, `changes_requested`, or `pending` explicitly.

## Dependency graph and invalidation

Every run builds a graph: `input:user-request`, `stage:<skill>`, `gate:<skill>`,
`artifact:<type>:<id>`, `evidence:<id>`. Edges are `input`, `derived_from`,
`evidence_for`, `validated_by`, or `ordering`; ordering edges record sequence only
and never propagate a change. Evidence support edges point from the artifact into
the evidence, so a change reaches what depends on it. `validateGraph` rejects
dangling endpoints, duplicate ids, self-loops, and cycles with distinct codes.

Changing a node marks its dependents: artifacts get `freshness.needs_revalidation`,
evidence becomes `stale` or `needs_revalidation`, and the affected gates are
re-evaluated. A change outside the declared graph is treated as unknown impact and
marks every evidence record for revalidation. An unchanged fingerprint retains
results, but the decision is still recorded — an unexplained absence of
invalidation is indistinguishable from a missed one.

## Checkpoints, resume, and retry safety

A passing gate writes a checkpoint: schema version, engine/workflow version, stage
attempt states, artifact and evidence identities with digests, gate outcomes,
pending stages, side-effect outcomes, a dependency digest, and a checksum.
Validity is rechecked against live records, so a checkpoint cannot pin stale
evidence as current.

`--resume` selects the newest checkpoint that still validates. The newest may be
rejected while an earlier one is usable; the result lists rejected ids. Resume
refuses (`RESUME_BLOCKED`) when no checkpoint validates, when a checkpoint omits a
required stage it did not record as pending, or when an interrupted stage has an
unknown side-effect outcome and its retry policy does not permit an automatic
retry. A `manual_approval_required` stage resumes only after an explicit retry
approval is recorded; `not_retryable` always refuses.

## Report and enforcement honesty

`--report` renders stored state: run status, workflow, routing reason, per-stage
gate and attempt facts, artifacts, evidence, invalidation decisions, checkpoints,
errors, completion reasons, and the enforcement record. Evidence excerpts are
bounded and redacted (secrets, bearer tokens, PEM blocks, home paths); artifact
content is never copied into a report. `--json` emits the same data validated
against `schemas/run-report.schema.json`.

Every report states `Enforcement: validated (pre-step: available_not_used)` and
lists the limitations. See [docs/host-capability-matrix.md](docs/host-capability-matrix.md)
and [ADR 0001](docs/adr/0001-persistence-and-enforcement.md).

## State location

In order of precedence:

1. `stateDir` passed to the plugin (`ctx.plugin(flowgate, { stateDir })`).
2. `DSH_FLOWGATE_STATE_DIR`.
3. `$DSH_HOME/flowgate-state` (falling back to `~/.dsh/flowgate-state`).

Layout: `<stateDir>/runs/<run-id>/state.json`, written atomically (temp file,
fsync, rename, directory fsync) and guarded by a per-run `state.lock` that recovers
after 60 seconds of staleness. The envelope is
`{ "schema_version": 2, "checksum": "sha256:…", "state": {…} }`; a body that fails
the checksum is reported as `STATE_CORRUPT` and never silently rewritten. A v1
envelope is migrated to v2 with every record marked for revalidation; any other
version is refused with `STATE_VERSION_UNSUPPORTED`. Every mutation validates the
whole run against `schemas/run-state.schema.json` before writing, so an invalid
shape cannot reach disk.

## Security and limits

- Requests are limited to 8192 bytes (`FLOW_REQUEST_TOO_LARGE`) and composed
  messages to 40960 bytes (`COMPOSITION_TOO_LARGE`). Skill bodies are never
  shortened to fit.
- Only the operator request is sanitized; host-rendered skill bodies are embedded
  byte-identically. Request text that imitates a stage boundary, a skill wrapper,
  or an evidence block is neutralized before composition.
- Composed messages are validated against the same limits before steering; a
  failure happens before any state is written.

## Error codes

`FLOW_REQUEST_TOO_LARGE`, `FLOW_NO_MATCH_FALLBACK`, `WORKFLOW_INVALID`,
`CONTRACT_INVALID`, `SCHEMA_INVALID`, `DEPENDENCY_DANGLING_REFERENCE`,
`DEPENDENCY_CYCLE`, `STAGE_INPUT_MISSING`, `ARTIFACT_MISSING`,
`ARTIFACT_SCHEMA_INVALID`, `EVIDENCE_MISSING`, `EVIDENCE_STALE`,
`EVIDENCE_IMPACT_UNKNOWN`, `EVIDENCE_INVALID`, `EVIDENCE_RECORD_INVALID`,
`GATE_FAILED`, `VALIDATOR_ERROR`, `CHECKPOINT_INVALID`, `RESUME_BLOCKED`,
`SIDE_EFFECT_RETRY_DENIED`, `HOST_CAPABILITY_UNAVAILABLE`, `STATE_CORRUPT`,
`STATE_VERSION_UNSUPPORTED`, `STATE_LOCKED`, `COMPOSITION_TOO_LARGE`,
`RUN_NOT_FOUND`, `COMMAND_INVALID`, `STAGE_OUTPUT_UNPARSEABLE`.

Every thrown code carries a remediation sentence; command handlers return
`{ kind: 'error', text: 'flowgate: <CODE>: <message>' }` instead of throwing at the
host boundary.

## Development

```sh
npm test                          # 18 gates, in order, stops at the first failure
npm run test:gate -- persistence  # one gate
node scripts/gen-readme.mjs       # regenerate the counted region below
bash scripts/verify-live.sh       # live host verification
```

The suite is ordered: `structural`, `json-schema`, `host-capabilities`,
`skill-load`, `contracts`, `workflows`, `dependency-graph`, `artifact-registry`,
`evidence-registry`, `transition-rules`, `invalidation`, `checkpoint`,
`recovery-safety`, `routing`, `composition-security`, `persistence`,
`report-and-command-e2e`, `live-host-verification`. The mutation probe inside
`skill-load` feeds the host's real loader four malformed skills and asserts the
three invalid ones are dropped.

`bash scripts/verify-live.sh` exits 0 when everything is registered, and with a
distinct code per failure class: 10 host web UI unreachable, 11 plugin link or
skills path broken, 12 plugin module failed to load, 13 profile package.json
missing the dependency or bundle entry, 14 catalog count mismatch.

## Known limitations

- Gating is `validated`, not `enforced`: the host offers no hook that can stop an
  agent without also blocking remediation. The composition restates the rule in
  the header, every stage block, and the footer; the report restates the limit.
- An evidence block can still be filled with filler. Structural and provenance
  checks reject missing fields and unobserved claims, but they cannot judge whether
  a sentence is true. `prove` and `recover` mitigate this by accepting only
  observed test/command evidence.
- The eight artifact schemas are opinionated and there is no per-project override.
- Invocation is one composed message per run; the multi-turn callback path relies
  on the agent emitting stage output that the session observer can record.
- Artifact and evidence content is capped (64 KiB per artifact record, 2 KiB per
  evidence excerpt) so state stays bounded.

## License

MIT. See [LICENSE](LICENSE).

<!-- COUNTS:BEGIN -->

| Count | Value |
| --- | --- |
| Skills | 8 |
| Workflows | 5 |
| Contracts | 8 |
| Alias commands | 8 |
| Commands | 9 |
| Artifact types | 8 |
| Test gates | 18 |

<!-- COUNTS:END -->
