SLICEPLAN
SLICE 1: Schema Infrastructure
  SCOPE: Create schemas/ directory with 7 JSON Schema files (StageContract, Artifact, Evidence, DependencyEdge, RunState, Checkpoint, Report) plus meta-schema for schema validation
  PROOF: All 7 schema files exist, are valid JSON Schema, and pass meta-validation (no unknown fields, valid enums, required fields present)
  ROLLBACK: Delete schemas/ directory

SLICE 2: Schema Registry & Validator Core
  SCOPE: Implement SchemaRegistry (loads/caches schemas) and SchemaValidator (validates data against named schema) using schemastery (z)
  PROOF: SchemaRegistry.load() loads all 7 schemas; SchemaValidator.validate() returns {valid, errors[]} for valid/invalid test cases
  ROLLBACK: Delete lib/schema-registry.ts and lib/schema-validator.ts

SLICE 3: Artifact & Evidence Registry Types
  SCOPE: Implement type-safe ArtifactRecord and EvidenceRecord classes with status enums, fingerprint computation, and binding validation
  PROOF: ArtifactRecord status transitions tested (missing→present→valid/invalid); EvidenceRecord freshness transitions tested (current→stale→needs_revalidation)
  ROLLBACK: Delete lib/artifact-record.ts and lib/evidence-record.ts

SLICE 4: Workflow & Contract Validation
  SCOPE: Implement validators for workflow JSON files and stage contracts against their schemas; preserve v1 workflows/skills unchanged
  PROOF: All 5 workflow JSONs validate; all 8 skill frontmatters validate; v1 artifacts import as legacy with needs_revalidation
  ROLLBACK: Delete lib/workflow-validator.ts and lib/contract-validator.ts

SLICE 5: Gate Test Suite
  SCOPE: Create test files for gates 1, 2, 5, 6, 8, 9 (structural, json-schema, contracts, workflows, artifact-registry, evidence-registry)
  PROOF: All 6 test files exist and pass; adversarial cases (unknown fields, duplicate keys, invalid enums, missing required) fail closed
  ROLLBACK: Delete tests/m2-gate-*.test.mjs files

SLICE 6: Integration & Composition
  SCOPE: Wire all M2 components together; export public API from index.ts; verify end-to-end validation pipeline
  PROOF: Import validator → validate sample run state → all gates pass; no host dependencies in M2 code
  ROLLBACK: Revert index.ts changes; delete integration test

## EVIDENCE
FACTS:
- SPEC_M2.md defines 7 schema types, 4 status enums, and 6 test gates for M2
- PRD §14 gates 1,2,5,6,8,9 map to slices 1-5
- PRD §10.1: schema_version required on all JSON data files
- PRD §19: v1 workflows/skills preserved; v1 artifacts import as legacy
- Each slice has independent proof and rollback
- Slices ordered by dependency: infrastructure → core → types → validation → tests → integration
ASSUMPTIONS:
- schemastery (z) API supports JSON Schema validation
- Test framework is vitest (consistent with dsh-codebase)
- Pure function validators enable fast unit tests without host
PROOF: none
UNKNOWN:
- Exact schemastery API for JSON Schema validation
- Whether vitest config exists in plugin
DECISION: Proceed to prove stage for Slice 1 (Schema Infrastructure) — write failing tests first.