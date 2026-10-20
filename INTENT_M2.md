INTENT
GOAL: Implement M2 (Formal contracts and state foundation) by defining JSON schemas for all v2 data contracts and implementing fail-closed validators that pass gates 1, 2, 5, 6, 8, 9.
NON_GOALS:
- Implementing controller logic (M3)
- Implementing checkpoint/recovery (M4)
- Running live-host verification (M5 gate 18)
- Modifying existing v1 skills/workflows/commands
SUCCESS_CRITERIA:
- schemas/ directory created with 7 JSON Schema files: StageContract, Artifact, Evidence, DependencyEdge, RunState, Checkpoint, Report
- Each schema validates: required fields, enum values, no unknown fields, no duplicate keys, version field
- Validator module loads all schemas and exposes validate(type, data) → {valid, errors[]}
- Gate 1 (structural.test.mjs): skill frontmatter, directories, names, size limits, required artifact fields validate
- Gate 2 (json-schema.test.mjs): versioned data schemas, unknown fields/enums, duplicate JSON keys, malformed files fail closed
- Gate 5 (contracts.test.mjs): required inputs, accepted states, outputs, evidence, checks, side-effect policy, contract versions validate
- Gate 6 (workflows.test.mjs): five workflows, exact stage order/keywords/priorities, optional stages, artifact chains validate
- Gate 8 (artifact-registry.test.mjs): artifact identity/version/status correct; presence ≠ validity; binding changes detected
- Gate 9 (evidence-registry.test.mjs): evidence provenance and input bindings mandatory; current/stale/unknown/invalid states distinguished
- All validators are pure functions (no I/O, no host dependencies) for unit testing
UNKNOWNS:
- Exact JSON Schema dialect (draft-2020-12 vs draft-7) — use what schemastery/zod supports
- Whether to use schemastery (already in deps) or zod for validation — PRD mentions schemastery
- Migration strategy for v1 artifacts (PRD §19) — defer to M4 checkpoint tests
- Performance requirements for schema validation — assume negligible for unit tests

## EVIDENCE
FACTS:
- PRD §15 M2 gate: "contract, workflow, artifact, evidence, and persistence tests pass; invalid state cannot be interpreted as valid completion"
- PRD §14 gates 1,2,5,6,8,9 are M2 scope
- PRD §10.1: all Flowgate-owned JSON data files MUST include supported schema_version
- PRD §10.2: stage contract example in YAML; production storage may use JSON
- PRD §10.3: dependency edge model with from/to/kind/policy
- PRD §10.4: evidence binding to immutable references
- PRD §7.1: stage contract defines inputs, outputs, evidence, checks, dependencies, completion, recovery
- PRD §7.3: artifact registry fields (artifact_id, type, schema_version, producer, status, fingerprint, bindings)
- PRD §7.4: evidence registry fields (evidence_id, type, claim, provenance, result, bindings, freshness, validation)
- Host capability matrix: all core APIs verified; schemastery available via @deepseek-ai/schemastery
- Existing v1 skills/workflows in assets/ — must be preserved per PRD §19
ASSUMPTIONS:
- schemastery (z) is the preferred validation library (used in dsh-agent-default-model, dsh-skill)
- Schemas live in schemas/ directory, loaded at startup
- Validators are synchronous pure functions for testability
- Unknown fields → fail closed (PRD §7.1: "Unknown contract fields... MUST fail closed")
PROOF: none
UNKNOWN:
- Exact schemastery API for JSON Schema validation vs zod
- Whether to generate TypeScript types from schemas
DECISION: Proceed to spec stage to define interfaces, boundaries, and test strategy for M2 schemas and validators.