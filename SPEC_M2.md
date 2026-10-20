SPEC
INTERFACES:
- SchemaValidator.validate(schemaName: string, data: unknown): ValidationResult
- ValidationResult = { valid: boolean; errors: ValidationError[] }
- ValidationError = { path: string; message: string; code: string }
- SchemaRegistry.load(schemaDir: string): Promise<void>
- SchemaRegistry.get(schemaName: string): JSONSchema
- ArtifactStatus = "missing" | "present" | "valid" | "invalid"
- EvidenceStatus = "missing" | "current" | "stale" | "needs_revalidation" | "invalid"
- GateStatus = "pending" | "passed" | "failed" | "blocked" | "error"
- RunStatus = "created" | "planned" | "running" | "paused" | "completed" | "failed" | "blocked" | "cancelled"
- StageContract = { id, contract_version, purpose, inputs, outputs, evidence, checks, dependencies, completion, recovery, side_effects }
- ArtifactRecord = { artifact_id, artifact_type, schema_version, producer_stage, attempt_id, status, validation_summary, content_ref, fingerprint, input_bindings, timestamps }
- EvidenceRecord = { evidence_id, evidence_type, claim, provenance, result, input_bindings, validation_method, freshness_status, timestamp }
- DependencyEdge = { from, to, kind: "input"|"derived_from"|"evidence_for"|"validated_by"|"ordering", policy, rationale }
- RunState = { run_id, workflow, version, schema_version, stages, artifacts, evidence, gates, graph, checkpoints, status, timestamps }
- Checkpoint = { run_id, workflow, version, stage_states, artifact_versions, evidence_versions, gate_outcomes, dependency_basis, side_effect_state, timestamp, schema_version }
- RunReport = { run_id, workflow, version, routing, stages, checks, invalidations, checkpoint, errors, enforcement_levels, completion, limitations }
BOUNDARIES:
- Unknown schema fields → validation error (fail closed)
- Duplicate JSON keys → validation error (fail closed)
- Invalid enum values → validation error (fail closed)
- Missing required fields → validation error (fail closed)
- Schema version mismatch → validation error (fail closed)
- All validators pure functions (no I/O, no host deps)
- Schema files must be valid JSON Schema (draft-2020-12 compatible)
- schemastery (z) used for validation (consistent with dsh-codebase)
- Max schema file size: 64 KiB each
- Max total schemas: 20
TEST_STRATEGY:
- Unit: SchemaValidator validates valid/invalid data for each schema (gates 2,5,8,9)
- Unit: SchemaRegistry loads all schemas, rejects unknown/duplicate/malformed (gate 2)
- Unit: ArtifactRecord status transitions: missing→present→valid/invalid (gate 8)
- Unit: EvidenceRecord freshness: current→stale→needs_revalidation (gate 9)
- Integration: Full workflow contracts validate against StageContract schema (gate 5)
- Integration: All 5 workflow JSON files validate against workflow schema (gate 6)
- Integration: v1 skill artifacts validate against artifact schemas (gate 8)
- Adversarial: Unknown field in contract → fail closed (gate 2)
- Adversarial: Duplicate key in JSON → fail closed (gate 2)
- Adversarial: Invalid enum in evidence status → fail closed (gate 2)
- Adversarial: Missing required field in artifact → status=invalid (gate 8)
- Adversarial: Evidence without provenance → invalid (gate 9)
ACCEPTANCE:
- All 7 schema files exist in schemas/ and pass meta-validation
- Validator module exports validate() and loads schemas on init
- Gates 1,2,5,6,8,9 test files exist and pass
- No validator uses host APIs or performs I/O
- Schemas cover all PRD §10 data contracts (stage contract, artifact, evidence, dependency edge, run state, checkpoint, report)
- v1 workflow/skill files validate without modification (backward compatible)

## EVIDENCE
FACTS:
- PRD §10 defines data contracts for: stage contract (§10.2), artifact registry (§7.3), evidence registry (§7.4), dependency edge (§10.3), run state (§8), checkpoint (§7.7), report (§7.9)
- PRD §14 gates 1,2,5,6,8,9 are M2 scope
- PRD §7.1: stage contract fields defined
- PRD §10.1: schema_version required on all JSON data files
- PRD §10.2: unknown fields/enums/duplicates fail closed
- PRD §19: v1 skills/workflows preserved; v1 artifacts import as legacy with needs_revalidation
- schemastery (z) used in dsh-agent-default-model, dsh-skill for validation
ASSUMPTIONS:
- JSON Schema draft-2020-12 compatible with schemastery
- Pure function validators enable fast unit tests
- Schema files loaded once at startup, cached
- TypeScript types can be inferred from schemas (optional)
PROOF: none
UNKNOWN:
- Exact schemastery API for JSON Schema validation
- Whether to generate .d.ts from schemas
DECISION: Proceed to slice stage to break M2 into independently provable slices.