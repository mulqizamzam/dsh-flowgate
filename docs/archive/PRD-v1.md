> **ARCHIVED — superseded by [PRD.md](../../PRD.md) (v2).** This is the v1
> specification, kept for historical context only. It no longer describes the
> shipped code: v2 replaced the enforcement model, the persistence format, the
> state schema, and the gate semantics. Do not implement from this document.

# PRD: dsh-flowgate

**Version:** 1.1  
**Status:** Ready for implementation  
**Target builder:** Autonomous coding agent operating in the DSH host environment  
**Estimated effort:** 12–18 working days for one agent  
**Predecessor:** None. This is a greenfield build. Do not import, port, or reuse content from any existing `dsh-agent-skills` repository.

## 0. How to use this document

This PRD is the complete product and implementation specification; there is no separate design document. Read it end to end before writing code. **MUST** and **REQUIRED** indicate hard requirements. **SHOULD** indicates a preferred implementation that may be departed from only for a documented technical reason. **OPTIONAL** identifies work deferred beyond v1.

Follow the milestone order in §15. Each milestone has an acceptance gate. Do not begin the next milestone until the current gate passes. When a detail is not specified, choose the simplest implementation that satisfies this document. Do not add unrequested features, abstractions, tutorials, or explanatory output.

This PRD specifies product behavior and tests. It does not replace the host's actual API documentation. Before integrating with DSH, inspect the installed host package and use its real command, skill-provider, and steering APIs. Do not invent host methods or signatures.

## 1. Summary

`dsh-flowgate` is a DeepSeek Harness (DSH) plugin for evidence-gated engineering workflows. It is not a catalog of how-to guides. It composes short skills into a workflow and instructs the agent to produce a structured, reviewable artifact at each stage before proceeding.

The v1 plugin ships:

- **8 skills**, each producing one artifact type: `Intent`, `Spec`, `SlicePlan`, `Proof`, `Review`, `Constraints`, `Diagnosis`, or `Handoff`.
- **5 workflows**: `feature`, `bugfix`, `investigation`, `migration`, and `release`.
- **9 slash commands**: 8 skill aliases plus `/flowgate`.
- **1 evidence protocol** shared by all stage artifacts.
- **14 unique test gates**, including strict JSON parsing and a mutation probe against the host's real skill loader.
- Boot-time validation of shipped contracts, workflows, and skill metadata, plus CI validation.

The product's value is repeatable process discipline across sessions. A stage is not considered complete merely because the agent says it is complete; it must emit the stage's defined artifact and evidence block. In v1, this gate is expressed in the composed steering message and is **not a hard runtime lock on the agent's turn progression**. See §17, Risk 1.

## 2. Product thesis

### Premise

Coding agents can skip engineering steps when nothing asks them to produce inspectable evidence before moving on. A spec-shaped sentence can be mistaken for a spec, a test invocation for proof, or a quick diff scan for review.

### Thesis

Define what “done” means for every stage as a structured artifact with required fields. Compose stages in a fixed order and make the evidence requirement explicit at workflow, stage, and completion levels.

### Design principles

1. **Artifacts over advice.** Skill bodies focus on purpose, artifact structure, evidence requirements, and failure modes—not tutorial prose.
2. **Skills are the source of stage behavior.** Workflow data names a skill and its purpose; the composer embeds the host-rendered skill body verbatim.
3. **Composition preserves content.** The composer may add workflow framing but must not rewrite, summarize, reorder, or truncate a skill body.
4. **Validation fails closed.** Invalid shipped data must prevent plugin startup or fail the relevant test gate with a clear error.
5. **Determinism.** The same request and same installed catalog must select and compose the same workflow.
6. **Honest enforcement claims.** Prompt-level evidence gates improve consistency but cannot mechanically prevent an agent from ignoring instructions in v1.

## 3. Goals and non-goals

### 3.1 Goals for v1

- Ship exactly 8 skills with verifiable, named artifact schemas.
- Ship exactly 5 workflow definitions for common engineering intents.
- Register exactly 9 commands: `/intent`, `/spec`, `/slice`, `/prove`, `/review`, `/constrain`, `/recover`, `/handoff`, and `/flowgate`.
- Use one evidence protocol for every stage artifact.
- Run 14 distinct test gates in a deterministic sequence.
- Prove that malformed skill files are handled by the host's real loader as expected.
- Provide `/flowgate --dry-run` to inspect selection, stage order, artifact dependencies, skipped optional stages, and skill-body sizes without steering the agent.
- Document one supported installation path designed to take under five minutes.
- Have no runtime or content dependency on any pre-existing `dsh-agent-skills` repository, its notices, its licenses, or its skill content.

### 3.2 Non-goals for v1

- A multi-turn runtime stage machine. v1 composes one steering message.
- A skill marketplace or registry.
- Compatibility with other hosts such as Claude Code or Cursor.
- Per-project skill overrides.
- Skill generation from repository observation.
- Metrics, telemetry, or analytics.
- Personas, hooks, pre-commit scripts, IDE integrations, or eval runners.
- A web UI.
- A `doctor` command.
- Multi-language skill bodies.
- A `--verbose` flag beyond the required `--dry-run` option.

## 4. Users

### Primary user

One competent technical operator working locally with DSH. The operator already understands specifications, testing, and code review and wants the agent to follow a repeatable process rather than learn engineering practices.

### Secondary user

None in v1. Do not design for teams, shared configuration, or multi-tenant deployment.

### Explicit non-user

Someone seeking an engineering tutorial. Skills are protocol definitions, not lessons.

## 5. Core concepts

- **Stage:** One unit of work in a workflow, backed by exactly one skill entry.
- **Skill:** A `SKILL.md` file that defines a stage's purpose, artifact schema, evidence requirement, and failure modes. Its body is the sole source of stage behavior.
- **Artifact:** Structured Markdown required from a skill before the stage can be treated as complete. Artifact types and required fields are defined in §9.
- **Evidence block:** The terminal `## EVIDENCE` section required in every artifact, containing `FACTS`, `ASSUMPTIONS`, `PROOF`, `UNKNOWN`, and `DECISION` in that order.
- **Workflow:** Ordered stage definitions, matching metadata, rules, optional-stage behavior, and a definition of done. Stored as JSON data, not code.
- **Contract:** A machine-readable declaration of a skill's output, input requirements, accepted input artifacts, category, and risk level.
- **Composition:** Resolve workflow stages to host skill content and assemble one steering message. Composition must preserve the skill body verbatim.
- **Alias command:** One slash command that loads one skill. There are **8 aliases**; `/flowgate` is the ninth command and is not an alias.
- **Prompt-level gate:** An instruction requiring a complete artifact before proceeding. In v1 this is guidance in the steering message, not a runtime-enforced transaction or multi-turn state machine.

## 6. Architecture

The plugin has three layers with separate responsibilities:

```text
┌─────────────────────────────────────────────────────────────┐
│ COMMAND LAYER — lib/index.js                                │
│ Registers exactly 9 commands. Loads one skill for aliases  │
│ or invokes workflow composition for /flowgate.                  │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ COMPOSITION LAYER — lib/flow*.js                            │
│ Selects a workflow, resolves skills through the host        │
│ catalog, validates the artifact chain, builds one message.  │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ DATA LAYER — assets/                                       │
│ Skills, workflow JSON, contracts, and shared references.    │
│ All shipped data is validated at startup and in CI.         │
└─────────────────────────────────────────────────────────────┘
```

Rules:

- Data files contain no executable code.
- Runtime code contains no workflow-specific stage sequence or stage-body instructions.
- Skills define stage behavior; workflow data defines sequence and workflow-level rules.
- The composer may add framing and stage gates but may not modify the skill content itself.
- Host integration must use the actual installed DSH APIs, verified by tests and live verification.

## 7. Repository layout

The authored repository must contain exactly the following project files and directories. Generated or ignored environment directories such as `.git/` and `node_modules/` are not part of this authored-layout constraint.

```text
dsh-flowgate/
├── lib/
│   ├── index.js
│   ├── flow.js
│   ├── flow-select.js
│   ├── flow-compose.js
│   ├── workflows.js
│   ├── contracts.js
│   ├── json-file.js
│   ├── evidence.js
│   ├── catalog.js
│   └── counts.js
├── assets/
│   ├── skills/
│   │   ├── intent/SKILL.md
│   │   ├── spec/SKILL.md
│   │   ├── slice/SKILL.md
│   │   ├── prove/SKILL.md
│   │   ├── review/SKILL.md
│   │   ├── constrain/SKILL.md
│   │   ├── recover/SKILL.md
│   │   └── handoff/SKILL.md
│   ├── workflows/
│   │   ├── feature.json
│   │   ├── bugfix.json
│   │   ├── investigation.json
│   │   ├── migration.json
│   │   └── release.json
│   ├── contracts.json
│   └── references/
│       ├── evidence-protocol.md
│       ├── artifact-schemas.md
│       └── security-checklist.md
├── scripts/
│   ├── run-tests.mjs
│   ├── gen-readme.mjs
│   └── verify-live.sh
├── tests/
│   ├── structural.test.mjs
│   ├── json-file.test.mjs
│   ├── skill-load.test.mjs
│   ├── mutation-gate.test.mjs
│   ├── contracts.test.mjs
│   ├── workflows.test.mjs
│   ├── flow-select.test.mjs
│   ├── flow-compose.test.mjs
│   ├── flow-command.test.mjs
│   ├── evidence-protocol.test.mjs
│   ├── verbatim-render.test.mjs
│   ├── injection.test.mjs
│   ├── counts.test.mjs
│   ├── e2e-handler.test.mjs
│   └── fixtures/
├── cordis.patch.yml
├── package.json
├── LICENSE
├── README.md
└── .gitignore
```

There must be no `NOTICE.md`, imported predecessor files, extra top-level project directories, or unlisted project files. `scripts/run-tests.mjs` exists to enforce the test-gate order in §14.

## 8. Data schemas and validation

All JSON data files under `assets/` must contain `"schema_version": 1`. The loader rejects a missing or unsupported version. This rule does not apply to `package.json`, whose structure is defined by npm.

### 8.1 `assets/contracts.json`

The file contains a schema version, closed vocabularies, and exactly one contract for each shipped skill. The following is a shape example, not the complete file:

```json
{
  "schema_version": 1,
  "vocabulary": {
    "artifacts": [
      "Intent", "Spec", "SlicePlan", "Proof", "Review",
      "Constraints", "Diagnosis", "Handoff", "user-request"
    ],
    "categories": [
      "frame", "specify", "plan", "prove",
      "review", "guard", "recover", "close"
    ],
    "risk_levels": ["low", "medium", "high"]
  },
  "contracts": {
    "intent": {
      "produces": ["Intent"],
      "consumes": ["user-request"],
      "requires": ["user-request"],
      "requires_any": [],
      "categories": ["frame"],
      "risk_level": "low"
    }
  }
}
```

Contract fields:

- `produces`: non-empty array of artifact types emitted by the skill. Each shipped skill must produce exactly one type in v1.
- `consumes`: artifact types the skill is allowed to use if available. All values must be in the closed artifact vocabulary.
- `requires`: artifact types that must all be available before the stage can run. Every value must also appear in `consumes`.
- `requires_any`: a non-empty set of alternatives when at least one listed artifact must be available; an empty array means no additional any-of requirement. Every value must also appear in `consumes`.
- `categories`: non-empty array of closed-vocabulary categories.
- `risk_level`: one of `low`, `medium`, or `high`.

Required validation rules:

1. `artifacts`, `categories`, and `risk_levels` are closed vocabularies. Unknown values fail validation.
2. Every shipped skill has exactly one contract, and every contract names a shipped skill.
3. Every contract has the required fields with the correct types; array entries are unique non-empty strings.
4. Every `requires` and `requires_any` value appears in `consumes`.
5. No skill may produce an artifact it also lists in `consumes`.
6. Each skill's frontmatter `produces` value matches the single artifact type in its contract.

The distinction between `consumes` and `requires` is intentional: `consumes` describes usable context; `requires` and `requires_any` define the inputs that must exist for the workflow to be coherent.

The eight contracts must use the following exact input requirements. `consumes` entries may include optional context in addition to mandatory inputs; no entry may be added or removed without updating the workflow-chain tests.

| Skill | `produces` | `consumes` | `requires` | `requires_any` |
|---|---|---|---|---|
| `intent` | `Intent` | `user-request` | `user-request` | none (`[]`) |
| `spec` | `Spec` | `Intent` | `Intent` | none (`[]`) |
| `slice` | `SlicePlan` | `Intent`, `Spec` | `Spec` | none (`[]`) |
| `prove` | `Proof` | `user-request`, `Intent`, `Spec`, `SlicePlan`, `Diagnosis`, `Constraints` | `user-request` | at least one of `SlicePlan`, `Diagnosis`, `Constraints` |
| `review` | `Review` | `user-request`, `Intent`, `Spec`, `SlicePlan`, `Proof`, `Constraints`, `Diagnosis` | `Proof` | none (`[]`) |
| `constrain` | `Constraints` | `user-request` | `user-request` | none (`[]`) |
| `recover` | `Diagnosis` | `user-request`, `Intent`, `Spec`, `Proof` | `user-request` | none (`[]`) |
| `handoff` | `Handoff` | `user-request`, `Intent`, `Spec`, `SlicePlan`, `Proof`, `Review`, `Constraints`, `Diagnosis` | `user-request` | at least one of `Diagnosis`, `Review`, `Proof` |

Use the category and risk level from the catalog in §9 for each corresponding contract. The exact `categories` and `risk_level` values are listed there.

### 8.2 `assets/workflows/<name>.json`

Example shape:

```json
{
  "schema_version": 1,
  "name": "feature",
  "description": "Implements a new capability from intent to review.",
  "match": {
    "keywords": ["add", "implement", "build", "create", "feature"],
    "priority": 60
  },
  "stages": [
    { "skill": "intent", "required": true, "purpose": "Capture what the operator actually wants." },
    { "skill": "spec", "required": true, "purpose": "Pin interfaces, boundaries, and success criteria." },
    { "skill": "slice", "required": true, "purpose": "Break the work into independently provable slices." },
    { "skill": "prove", "required": true, "purpose": "Define proof before changing code and record before/after results." },
    { "skill": "review", "required": false, "purpose": "Review the change adversarially against available evidence and constraints." }
  ],
  "rules": [
    "Do not begin a stage until the preceding stage artifact and evidence block are complete.",
    "If a stage reveals that the intent is wrong, return to the intent stage before continuing."
  ],
  "on_optional_missing": "skip",
  "completion": "Complete when the Review has no unresolved high-severity findings, or when Review was skipped and every required prior artifact is complete."
}
```

Required validation rules:

- `name` is kebab-case and equals the JSON file stem.
- `description` is a non-empty string.
- `match.keywords` is a non-empty array of unique, non-empty, single-token keywords.
- `match.priority` is an integer.
- `stages` is a non-empty array; no skill appears more than once in a workflow.
- Each stage names a shipped skill, has a boolean `required`, and has a non-empty `purpose`.
- `rules` is a non-empty array of non-empty strings.
- `completion` is a non-empty string.
- `on_optional_missing` is exactly `skip` or `fail`.
- The set of workflow files and workflow names matches the five workflows in §10.

### 8.3 Skill frontmatter

Every `assets/skills/<name>/SKILL.md` starts with this frontmatter shape:

```yaml
---
name: <kebab-case name matching the skill directory>
description: <one sentence ending with a "Use when ..." clause, at most 400 characters>
produces: <one artifact name>
risk_level: low|medium|high
---
```

Required validation rules:

- The first line is exactly `---`.
- The host's YAML parser can parse the frontmatter.
- `name` is kebab-case and equals the containing directory name.
- `description` contains the exact substring `Use when` and is no longer than 400 characters.
- `produces` matches the skill contract.
- `risk_level` matches the skill contract.
- Each skill file is no larger than 24,000 bytes.
- Every skill body is in English.

## 9. Skill catalog and artifact schemas

Ship exactly these eight skills. Each skill body must contain: (1) a purpose in 2–4 sentences, (2) the artifact schema, (3) the evidence-block requirement, and (4) 3–5 named failure modes the artifact must rule out. Do not add tutorial prose or unrelated recommendations. Target body length is 1,500–3,000 bytes; the hard limit is 24,000 bytes.

| Skill | Produces | Category | Risk | Purpose |
|---|---|---|---|---|
| `intent` | `Intent` | `frame` | low | State what the operator actually wants in falsifiable terms. |
| `spec` | `Spec` | `specify` | low | Convert intent into interfaces, boundaries, and a test strategy. |
| `slice` | `SlicePlan` | `plan` | low | Break the spec into independently provable slices. |
| `prove` | `Proof` | `prove` | medium | Define proof before the change and record reproducible before/after evidence. |
| `review` | `Review` | `review` | medium | Perform adversarial, multi-axis review with explicit finding severities. |
| `constrain` | `Constraints` | `guard` | low | Establish a written quality bar with enforceable thresholds. |
| `recover` | `Diagnosis` | `recover` | high | Identify root cause systematically rather than by trial and error. |
| `handoff` | `Handoff` | `close` | low | Preserve compact takeover state: changed, verified, unverified, and next. |

The canonical artifact structure is defined in `assets/references/artifact-schemas.md`. Required minimum fields are:

- **Intent:** `GOAL`, `NON_GOALS`, `SUCCESS_CRITERIA`, `UNKNOWNS`.
- **Spec:** `INTERFACES`, `BOUNDARIES`, `TEST_STRATEGY`, `ACCEPTANCE`.
- **SlicePlan:** ordered slices, each with `SCOPE`, `PROOF`, `ROLLBACK`.
- **Proof:** `WHAT_IS_PROVEN`, `HOW`, `FAILING_BEFORE`, `PASSING_AFTER`, `EDGE_CASES`.
- **Review:** a findings list, each finding with `SEVERITY` (`high`, `medium`, or `low`), `LOCATION`, `ISSUE`, and `FIX`; also `UNREVIEWED`.
- **Constraints:** a list of enforceable constraints, each with `NAME`, `THRESHOLD`, `HOW_ENFORCED`, and `FAILURE_ACTION`.
- **Diagnosis:** `SYMPTOM`, `REPRO`, `ROOT_CAUSE`, `FIX`, `PREVENTION`, `CONFIDENCE`.
- **Handoff:** `STATUS`, `CHANGED`, `VERIFIED`, `NOT_VERIFIED`, `RISKS`, `OPEN_ITEMS`, `NEXT_ACTION`.

Each artifact must end with the evidence block defined in §12. The schemas define required structure, not fixed literal values; the agent must supply task-specific content.

## 10. Workflow system

Ship exactly five workflow files. Keyword lists and priorities below are normative; if a workflow JSON differs, validation or tests must fail.

| Workflow | Keywords | Priority | Ordered stages (`*` = required) |
|---|---|---:|---|
| `feature` | `add`, `implement`, `build`, `create`, `feature` | 60 | `intent* → spec* → slice* → prove* → review` |
| `bugfix` | `fix`, `broken`, `regression`, `crash`, `bug` | 75 | `recover* → prove* → review*` |
| `investigation` | `investigate`, `why`, `diagnose`, `failing`, `understand` | 50 | `intent* → recover* → handoff*` |
| `migration` | `migrate`, `upgrade`, `deprecate`, `port`, `refactor` | 70 | `intent* → spec* → slice* → prove* → review → handoff*` |
| `release` | `release`, `deploy`, `ship`, `production`, `launch` | 80 | `constrain* → prove* → review* → handoff*` |

### 10.1 Workflow-selection algorithm

`lib/flow-select.js` must implement this pure, deterministic algorithm:

1. Tokenize the request into whole words, normalize tokens to lowercase, and use Unicode-aware letter/digit boundaries. A keyword matches only an exact token, not a substring.
2. For each workflow, count how many of its configured keywords appear at least once in the request. Repeating the same keyword in the request does not increase its score.
3. If every workflow's score is zero, return `investigation`.
4. Otherwise, choose the workflow with the highest score.
5. If scores tie, choose the workflow with the higher integer priority.
6. If score and priority still tie, choose the lexicographically earlier workflow name.

No randomness, configuration, environment-dependent ordering, or mutable global state is allowed. The same input must always return the same workflow.

### 10.2 Proof behavior for bugfix

The `bugfix` workflow contains one `prove` stage; it must not list the same skill twice. That stage produces one `Proof` artifact with both `FAILING_BEFORE` and `PASSING_AFTER` populated. The steering instructions require the agent to establish the failing reproduction before applying the fix, then run the same relevant proof after the fix. If no failing-before result can be obtained, the artifact must state that limitation explicitly rather than fabricate a result.

### 10.3 Artifact-chain rules

At startup, validate every complete workflow against its skill contracts. For each stage, all `requires` artifacts must be available from the original `user-request` plus outputs of earlier stages, and at least one `requires_any` artifact must be available when that array is non-empty. Optional `consumes` context may be absent. A chain violation is a boot-time validation error.

After optional stages are skipped at runtime, validate the resolved chain again. If a skip leaves any later required stage without its required inputs, stop with a clear error naming the dependent skill and missing artifact requirement. Do not run a knowingly incoherent chain.

## 11. Commands

Register exactly these nine slash commands:

| Command | Action |
|---|---|
| `/intent` | Load the `intent` skill. |
| `/spec` | Load the `spec` skill. |
| `/slice` | Load the `slice` skill. |
| `/prove` | Load the `prove` skill. |
| `/review` | Load the `review` skill. |
| `/constrain` | Load the `constrain` skill. |
| `/recover` | Load the `recover` skill. |
| `/handoff` | Load the `handoff` skill. |
| `/flowgate` | Select, validate, and compose a workflow from the request. |

Each alias command performs exactly three operations: look up its skill by name, verify that the skill is user-invocable under the host's actual skill API, and hand the unmodified skill body plus the sanitized user request to the agent. It must not select a workflow, add workflow logic, or mutate skill content.

`/flowgate` accepts an optional `--dry-run` flag. Dry-run must:

- select and load the workflow;
- resolve its stages and validate the artifact chain;
- print the selected workflow, matching rationale (scores and tie-break result), ordered stages, required/optional status, purposes, artifact inputs/outputs, skipped optional skills, and byte size of each resolved skill body;
- print the total composed-message byte size or a deterministic estimate based on the exact composition path; and
- **not** call `agent.steer()`.

A dry-run must not bypass validation. If selection, loading, resolution, or chain validation fails, it reports the same relevant error category as a normal `/flowgate` invocation.

## 12. Evidence protocol

Every artifact must end with this exact section structure, with task-specific bullet content:

```markdown
## EVIDENCE
FACTS:
  - <directly checkable observation, or none>
ASSUMPTIONS:
  - <claim accepted without proof, or none>
PROOF:
  - <command run, output observed, or artifact inspected, or none>
UNKNOWN:
  - <open question, or none>
DECISION:
  - <choice made and alternative rejected, or none>
```

Rules:

- The block is required for all eight artifact types and every workflow stage.
- Field order and labels are fixed. Do not add a second `## EVIDENCE` block to satisfy the requirement.
- No field may be blank. Use the literal value `none` when there is no applicable content.
- `FACTS` contains observations that can be checked directly. `ASSUMPTIONS` contains unproven claims. Do not present an assumption as a fact.
- `PROOF` records what was actually run or inspected and the observed result. Planned commands are not completed proof.
- `UNKNOWN` records material questions that remain unresolved.
- `DECISION` records a choice made and an alternative rejected. Use `none` only when no decision was made.
- A complete-looking heading with no bullet or value is an empty field and is invalid.

`assets/references/evidence-protocol.md` must define these rules, including why the FACTS/ASSUMPTIONS distinction matters.

`lib/evidence.js` exports a validator used by tests, not by runtime composition. Given Markdown, it must confirm that one `## EVIDENCE` block contains all five fields in the correct order and that every field has at least one non-empty bullet or the literal value `none`. It must reject a missing block, duplicate evidence blocks, missing or reordered fields, empty fields, and malformed evidence sections.

The composed steering message must state the evidence gate at three levels: (1) the workflow header, (2) a stage-specific gate after each stage's skill content, and (3) the final completion instruction. This is prompt-level enforcement in v1, not a host-enforced transaction.

## 13. Composition pipeline

`/flowgate <request>` executes the following steps in order:

1. **Validate request length.** Measure the original request as UTF-8 bytes before sanitization. If it exceeds 8,192 bytes, reject it with a clear error. Do not truncate it.
2. **Sanitize request markers.** Replace every case-insensitive occurrence of `<skill_content`, `</skill_content`, `## EVIDENCE`, or a stage marker matching `STAGE\s+\d+\s+of\s+\d+` with `[redacted-marker]`. Sanitize only the user request, never a skill body.
3. **Select.** `flow-select.js` returns a workflow name using §10.1.
4. **Load.** `workflows.js` loads and validates the named JSON file using `json-file.js`.
5. **Resolve.** Resolve each stage through the host's actual skill catalog/provider API. If a required skill cannot be resolved, abort with an error naming it. If an optional skill cannot be resolved and `on_optional_missing` is `skip`, omit it and record it under `Skipped`. If policy is `fail`, abort.
6. **Validate the resolved chain.** Confirm that all remaining stages' `requires` and `requires_any` conditions can be satisfied by the request and the outputs of earlier resolved stages. If not, abort clearly.
7. **Compose.** Assemble the steering message as specified below. Preserve each skill body's exact bytes within its wrapper.
8. **Size check.** If the final composed message would exceed 40 KiB, fail with a size error. Never solve an oversized workflow by truncating or summarizing skill content.
9. **Steer.** For a normal invocation, call the host's actual `agent.steer()` API exactly once with the composed message and correct source metadata.

The sanitized request is the version embedded in the message footer; do not append the untrusted raw request after sanitization.

### 13.1 Message format

The composed message contains these sections in this order:

1. **Header:** workflow goal, selected workflow and description, matching scores and priority tie-break if relevant, execution order, artifact flow, skipped optional stages, workflow rules, definition of done, and evidence-protocol reminder.
2. **Stage blocks:** For each resolved stage, emit `STAGE N of M`, where `M` is the count of resolved stages after optional skips; stage name; required/optional status; purpose; required artifact; and the host's verbatim rendered skill body inside `<skill_content name="..."> ... </skill_content>`. Immediately after the wrapper, add the stage-specific evidence gate.
3. **Footer:** the sanitized user request followed by a concise instruction that workflow completion is invalid unless every executed stage has a complete artifact and evidence block and the workflow's definition of done is met.

The fixed wrapper must not become part of the skill body for the purpose of verbatim-byte comparisons. The body between wrapper boundaries must be byte-identical to the host's `renderSkillContent()` result.

### 13.2 Injection and content-integrity requirements

- User text must not be able to impersonate a workflow-stage boundary or close/open a skill-content wrapper. Apply the sanitizer before inserting the request anywhere in the message.
- Do not interpolate request text into filesystem paths, workflow names, or HTML/XML-like attributes.
- Workflow and skill names used in wrappers must come from validated shipped metadata, not directly from user input.
- The composer must not sanitize, edit, summarize, reorder, or truncate skill bodies. Invalid shipped metadata or a body that violates the host's loader requirements must fail validation rather than be silently altered.
- Tests must prove sanitization, byte-limit rejection, verbatim rendering, and the absence of steering during dry-run.

## 14. Validation and test strategy

`npm test` must execute **14 unique gates sequentially in the fixed order below**, stopping at the first failure. `scripts/run-tests.mjs` owns this ordering and must report the failing test file and violated rule; it exits non-zero on failure. A duplicated test filename does not count as a separate gate.

| Order | Gate | Acceptance evidence |
|---:|---|---|
| 1 | `structural.test.mjs` | Every `SKILL.md` has valid frontmatter; names match directories; descriptions, `produces`, risk levels, and file-size limits are correct. |
| 2 | `json-file.test.mjs` | Valid JSON loads; malformed JSON, unsupported/missing schema version, and duplicate object keys are rejected, including nested keys and keys containing escaped characters. |
| 3 | `skill-load.test.mjs` | Every shipped skill loads through the host's real `FileSystemSkillProvider` or the host's actual equivalent. Includes the mutation probe in §14.1. |
| 4 | `mutation-gate.test.mjs` | The mutation probe exists and tests all four required malformed/mismatched inputs. Removing the probe fails this gate. |
| 5 | `contracts.test.mjs` | Every skill has exactly one contract; closed vocabularies and input requirements are enforced; no produce/consume self-loop exists. |
| 6 | `workflows.test.mjs` | Every workflow validates; malformed JSON, duplicate keys, unknown skills, duplicate stages, invalid priorities, invalid keywords, and incoherent artifact chains are rejected. |
| 7 | `flow-select.test.mjs` | Exact keyword routing, zero-match fallback, priorities, lexicographic tie-breaks, and at least 20 deterministic property-style cases pass. Cases cover empty input, 10,000-word input, substring false positives, Unicode, punctuation, and repeated keywords. |
| 8 | `flow-compose.test.mjs` | Stage ordering and numbering are correct; optional skips are recorded; artifact flow, header, stage gates, footer, request sanitization, size limit, and user-request inclusion are correct; skill bodies remain verbatim. |
| 9 | `evidence-protocol.test.mjs` | A complete block is accepted; missing block, duplicate block, missing/out-of-order field, empty field, and malformed bullet/value are rejected; `none` is accepted. |
| 10 | `verbatim-render.test.mjs` | For every skill, the body inside the composed `<skill_content>` wrapper is byte-identical to the host's `renderSkillContent()` output. |
| 11 | `injection.test.mjs` | Requests containing opening/closing skill markers, evidence headings, stage markers, case variants, or oversized payloads are sanitized or rejected as specified. |
| 12 | `counts.test.mjs` | Every generated README count matches values derived by `lib/counts.js`; expected counts are 8 skills, 5 workflows, 9 commands, 8 aliases, and 14 gates. |
| 13 | `flow-command.test.mjs` | `/flowgate` performs one steer call with correct source metadata; missing-skill and invalid-workflow errors are covered; `--dry-run` performs zero steer calls. |
| 14 | `e2e-handler.test.mjs` | All nine commands register against the actual host registry; aliases resolve and invoke the correct skill. |

### 14.1 Mutation probe

`skill-load.test.mjs` must feed these four cases to the host's real skill loader, using isolated temporary fixture directories:

1. A skill file with no frontmatter: the loader drops it.
2. A skill whose frontmatter `name` is not kebab-case: the loader drops it.
3. A skill with otherwise valid frontmatter but no `description`: the loader drops it.
4. A skill whose frontmatter name is valid but differs from its directory name: the loader loads it under the frontmatter name. The directory-name consistency rule is enforced by `structural.test.mjs`, not by the host loader.

`mutation-gate.test.mjs` must assert that the probe exists and exercises all four cases. Deleting or bypassing any case must fail the gate.

### 14.2 Live verification

`scripts/verify-live.sh` checks an installed, running DSH host and returns the first applicable failure according to the lowest numeric failure code:

- `0`: every required registration and path check passes.
- `10`: host web UI is unreachable.
- `11`: plugin symlink is missing or points to the wrong plugin path.
- `12`: plugin module failed to load.
- `13`: profile `package.json` is missing the plugin dependency or required bundle entry.
- `14`: registered skill/command catalog count does not match expectations.

The script must evaluate all relevant checks sufficiently to choose the lowest applicable code, rather than returning whichever failure happens to be encountered first. For code `11`, print the exact configured path and the expected plugin path. Do not hard-code a guessed host API or browser URL; inspect the installed host layout and document the required local setting in `README.md`.

## 15. Delivery plan

Complete milestones in this order; run each gate before starting the next.

### M1 — Skeleton (Days 1–2)

Create the repository layout and write `package.json`, `cordis.patch.yml`, `.gitignore`, `LICENSE`, and the test-runner entry point. Add no production skills or workflows yet. Configure `npm test` so it succeeds when no domain tests exist at this milestone. Verify dependency installation and the host's minimum supported Node/runtime version.

**Acceptance:** install succeeds; the test command exists and exits successfully in the empty-test skeleton; the repository layout is correct.

### M2 — Data layer (Days 3–5)

Implement `json-file.js`, `contracts.js`, `workflows.js`, `catalog.js`, and `counts.js`. Add `assets/contracts.json`, all five workflow JSON files, and eight placeholder `SKILL.md` files with valid frontmatter. Add the structural, JSON-reader, contracts, and workflow tests.

**Acceptance:** `structural.test.mjs`, `json-file.test.mjs`, `contracts.test.mjs`, and `workflows.test.mjs` pass. All workflow chains satisfy the contract rules.

### M3 — Skill bodies (Days 6–8)

Write the production body for all eight skills. Each body contains its purpose, artifact structure, evidence requirement, and 3–5 named failure modes. Add and run the real-loader and mutation-probe tests.

**Acceptance:** all eight skills load; the first three malformed mutation cases are dropped; the directory/frontmatter mismatch loads under its frontmatter name; all real bodies meet length and schema requirements.

### M4 — Composition (Days 9–11)

Implement `flow-select.js`, `flow-compose.js`, `flow.js`, and `evidence.js`. Complete deterministic routing, chain validation, sanitization, dry-run data preparation, the message-size cap, stage gates, and verbatim body insertion.

**Acceptance:** `flow-select.test.mjs`, `flow-compose.test.mjs`, and `evidence-protocol.test.mjs` pass. No oversized workflow is truncated to fit.

### M5 — Commands (Days 12–13)

Implement `lib/index.js` and register the eight aliases plus `/flowgate` using the host's actual API. Implement `--dry-run` without a steering call.

**Acceptance:** `flow-command.test.mjs` and `e2e-handler.test.mjs` pass against a host-compatible test harness.

### M6 — Hardening (Days 14–15)

Complete `injection.test.mjs`, `verbatim-render.test.mjs`, and `counts.test.mjs`. Implement `scripts/run-tests.mjs`, `scripts/verify-live.sh`, and `scripts/gen-readme.mjs` if not already complete. Run all 14 gates from `npm test`.

**Acceptance:** all 14 gates pass in the required order; the composed message for every workflow is at most 40 KiB; injection and byte-identity tests pass.

### M7 — Documentation and live validation (Days 16–18)

Write `README.md` with generated, marked regions. Complete `assets/references/evidence-protocol.md`, `artifact-schemas.md`, and `security-checklist.md`. Document the one-command installation path, host-specific path configuration, live verification codes, and known limitations.

**Acceptance:** documentation counts are current; `npm test` exits 0; `bash scripts/verify-live.sh` exits 0 against a running, correctly installed DSH host; `git log --oneline` contains at least one milestone commit for each of M1–M7.

## 16. Final acceptance criteria

The v1 build is complete only when all criteria below pass:

1. `npm test` exits `0` with 14 unique gates passing in the specified order.
2. `bash scripts/verify-live.sh` exits `0` against a running DSH host.
3. Exactly nine commands appear in the host's command registry.
4. Exactly eight shipped skills appear in the host skill catalog, and each skill's `produces` matches its contract.
5. `/flowgate add a health endpoint --dry-run` selects `feature`, prints five stages in the defined order, reports body sizes, and does not steer the agent.
6. `/flowgate fix the login crash` selects `bugfix` and composes three required stages.
7. A user request containing `</skill_content>` is sanitized before it is embedded in the message.
8. A request longer than 8,192 UTF-8 bytes is rejected with a clear error and is not truncated.
9. The composed message never exceeds 40 KiB; an oversized composition fails rather than changing any skill body.
10. `git log --oneline` shows at least one commit per milestone.
11. The shipped plugin repository contains no references to `dsh-agent-skills`, `addyosmani`, or copied/ported content. This is a repository hygiene requirement; do not add those forbidden strings to shipped files merely to test for their presence.
12. All shipped asset JSON files use `schema_version: 1` and reject duplicate object keys.

## 17. Risks and open questions

### Risk 1 — No multi-turn enforcement

The v1 host integration composes one message. It does not have a runtime stage hook that guarantees the agent cannot move on without evidence. The protocol is therefore prompt-level, not a mechanically enforced state machine. The composer repeats the gate in the header, every stage, and the footer. Do not invent or emulate a host hook that does not exist.

**Open question:** If a future DSH API provides a supported stage hook, a multi-turn implementation may be considered in a later version. It is out of scope for v1.

### Risk 2 — Long composed messages

A five-stage feature workflow is expected to produce a composed message of roughly 15–25 KiB. `flow-compose.test.mjs` must measure exact output size for each workflow and fail if any message exceeds 40 KiB. The composer must never truncate or summarize skill content to satisfy the cap.

### Risk 3 — Skill-name collision

Another plugin may provide a skill named `intent`, `spec`, or another shipped name. The composed header records which provider served each stage. Emit a boot-time warning if a shipped skill is shadowed; warn rather than hard-fail in v1 unless the host itself refuses the resolution.

### Risk 4 — Evidence becomes ritual

An agent may fill fields with low-value text to satisfy the format. The v1 validator is a structural test helper, not a semantic truth detector, and it is not called to approve runtime artifacts. Document this under `Known limitations` in the README.

### Risk 5 — Absolute path in `cordis.patch.yml`

The host may resolve `customSkillDirs` relative to its own working directory rather than the plugin directory. `verify-live.sh` must verify that the configured path exists and points to the plugin. On failure, return code `11` and print the exact value to change. Document the host-specific path requirement in the README.

### Risk 6 — Opinionated artifact schemas

The eight artifact schemas represent deliberate v1 choices. Per-project overrides and schema customization are out of scope.

### Risk 7 — Host API drift

Command registration, skill-provider resolution, rendering, and steering are host-specific. Pin the supported host/runtime assumptions in project metadata and tests. Use the APIs available in the installed host package; do not infer signatures from names alone.

## 18. Explicitly do not build

- Personas.
- Hooks, pre-commit scripts, or IDE integrations.
- An eval runner.
- A web UI.
- Telemetry or analytics.
- A `--verbose` mode beyond `--dry-run`.
- Multi-language skill bodies.
- A marketplace client.
- Skill generation from repository analysis.
- Per-project overrides.
- A `doctor` command.
- Content ported from any existing skill repository.
- Additional commands, workflow types, or hidden configuration switches.

Do not use the phrases “educational,” “for learning,” “use responsibly,” “consult a professional,” or “please note” in shipped code or output. Do not add comments explaining why code exists; comments should describe non-obvious behavior only.

## 19. Appendix — Sample composed message

Illustrative shape for `/flowgate add a /health endpoint`. The skill-content placeholders below are not literal production output; the live composer must insert the host-rendered content verbatim.

```text
WORKFLOW
========

Goal:
add a /health endpoint

Selected workflow:
feature — Implements a new capability from intent to review.

Execution order:
1. intent (required) — Capture what the operator actually wants.
   Requires: user-request
   Produces: Intent
2. spec (required) — Pin interfaces, boundaries, and success criteria.
   Requires: Intent
   Produces: Spec
3. slice (required) — Break the work into independently provable slices.
   Requires: Spec
   Produces: SlicePlan
4. prove (required) — Define proof before changing code and record before/after results.
   Requires: user-request and at least one of SlicePlan, Diagnosis, Constraints
   Produces: Proof
5. review (optional) — Review the change adversarially against available evidence and constraints.
   Requires: Proof
   Produces: Review

Workflow rules:
- Do not begin a stage until the preceding stage artifact and evidence block are complete.
- If a stage reveals that the intent is wrong, return to the intent stage before continuing.

Evidence protocol:
Every stage must end with one complete ## EVIDENCE block containing FACTS, ASSUMPTIONS, PROOF, UNKNOWN, and DECISION, in that order. Write "none" where a field has no applicable content. Moving forward without a complete block is a failure of the current stage. This is a prompt-level gate in v1.

Definition of done:
Complete when the Review has no unresolved high-severity findings, or when Review was skipped and every required prior artifact is complete.

STAGE 1 of 5: intent (required)
Purpose: Capture what the operator actually wants.
Produces: Intent
<skill_content name="intent">
...verbatim host render...
</skill_content>
Stage gate: Produce the complete Intent artifact and its evidence block before continuing.

STAGE 2 of 5: spec (required)
Purpose: Pin interfaces, boundaries, and success criteria.
Produces: Spec
<skill_content name="spec">
...verbatim host render...
</skill_content>
Stage gate: Produce the complete Spec artifact and its evidence block before continuing.

STAGE 3 of 5: slice (required)
Purpose: Break the work into independently provable slices.
Produces: SlicePlan
<skill_content name="slice">
...verbatim host render...
</skill_content>
Stage gate: Produce the complete SlicePlan artifact and its evidence block before continuing.

STAGE 4 of 5: prove (required)
Purpose: Define proof before changing code and record before/after results.
Produces: Proof
<skill_content name="prove">
...verbatim host render...
</skill_content>
Stage gate: Produce the complete Proof artifact and its evidence block before continuing. Record only results actually observed.

STAGE 5 of 5: review (optional)
Purpose: Review the change adversarially against available evidence and constraints.
Produces: Review
<skill_content name="review">
...verbatim host render...
</skill_content>
Stage gate: Produce the complete Review artifact and its evidence block. Each finding must include SEVERITY, LOCATION, ISSUE, and FIX; include UNREVIEWED. Completion requires no unresolved high-severity findings.

Final gate:
Do not claim the workflow is complete unless every executed stage has a complete artifact and evidence block and the definition of done is satisfied. These are prompt-level gates in v1.

User request (sanitized):
add a /health endpoint
```

## 20. Refactor decisions recorded in this version

This revision preserves the original product scope while resolving implementation ambiguities that would otherwise produce conflicting code or tests:

1. Clarified the command count: eight aliases plus `/flowgate` equals nine commands.
2. Replaced the duplicate `counts.test.mjs` entry with a distinct `json-file.test.mjs` gate, yielding 14 unique gates.
3. Defined contract semantics for required inputs versus optional accepted context, so the five workflow chains can be validated coherently despite using the same skills in different workflows.
4. Defined explicit priorities for all workflows and made zero-match fallback occur before tie-breaking.
5. Clarified bugfix proof as one stage and one artifact containing both failing-before and passing-after evidence.
6. Defined evidence validation so the literal `none` is valid but blank fields are not.
7. Made request sanitization and UTF-8 byte-limit order explicit; only the sanitized request may be embedded.
8. Clarified that v1 gating is prompt-level rather than a runtime-enforced stage machine.
9. Added a deterministic sequential test runner and an explicit 40 KiB composition failure rule; skill bodies are never truncated.
10. Reconciled optional-stage skipping with downstream artifact requirements by revalidating the resolved chain at runtime.
