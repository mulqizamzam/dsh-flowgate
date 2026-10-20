SLICEPLAN
SLICE 1: Checkpoint Manager Core
  SCOPE: Implement CheckpointManager.createCheckpoint() capturing run/workflow identity, stage states, artifact/evidence versions, gate outcomes, dependency basis, side-effect state at turn/end event
  PROOF: Gate 12 tests pass: checkpoint captures all required fields, validity checks all required fields
  ROLLBACK: Revert lib/checkpoint.js createCheckpoint()

SLICE 2: Checkpoint Validity & Selection
  SCOPE: Implement checkpoint validity checks (required artifacts valid, evidence current, gates passed, no unknown impact) and selectLastValid() choosing last valid not most recent
  PROOF: Gate 12 tests pass: selectLastValid chooses valid not most recent, corrupt/stale rejected, earlier valid selected
  ROLLBACK: Revert lib/checkpoint.js validity/selection logic

SLICE 3: Resume Manager & State Validation
  SCOPE: Implement ResumeManager.resume() with planResume() validation, state validation, last-valid checkpoint selection, and RESUME_BLOCKED when no valid checkpoint
  PROOF: Gate 13 tests pass: resume from valid checkpoint continues remaining stages, refuses when no valid checkpoint, actionable diagnostics
  ROLLBACK: Revert lib/resume.js; keep checkpoint manager

SLICE 4: Side-Effect Policy & Retry Enforcement
  SCOPE: Implement SideEffectPolicy per stage (read_only/local_write/external with safe_idempotent/manual_approval_required/not_retryable) and enforce retry rules
  PROOF: Gate 13 tests pass: safe_idempotent auto-retry, manual_approval_required requires approval, not_retryable denied
  ROLLBACK: Revert lib/side-effects.js; keep resume/checkpoint

SLICE 5: Run Report Generator & Error Taxonomy
  SCOPE: Implement RunReportGenerator (human + JSON formats) with routing, stages, checks, invalidations, checkpoint, errors, enforcement levels; define 18+ error codes
  PROOF: Gate 17 tests pass: reports match stored state; error codes stable across messages/JSON
  ROLLBACK: Revert lib/report.js and lib/errors.js error codes

SLICE 6: Command Adapter: --status, --report, --resume
  SCOPE: Implement /flowgate --status, --report (human+JSON), --resume with dry-run side-effect-free verification
  PROOF: Gate 17 tests pass: 9 commands register, status/report/resume work, reports match state, dry-run side-effect-free
  ROLLBACK: Revert lib/commands.js new command handlers

SLICE 7: Dry-Run Security & Composition
  SCOPE: Enforce request sanitization (8KB limit), composed message 40KiB limit, byte-identical skill bodies, wrapper injection tests
  PROOF: Gate 15 tests pass: sanitization, limits, wrapper injection, byte-identical skills
  ROLLBACK: Revert lib/compose.js security checks

SLICE 8: Persistence Atomicity & Version Migration
  SCOPE: Ensure atomic checkpoint/run state writes, corruption detection, schema version migration, unsupported version refusal
  PROOF: Gate 16 tests pass: atomic update, corruption/version migration, unsupported version refusal
  ROLLBACK: Revert lib/persistence.js atomicity/migration logic

SLICE 9: Integration & Composition
  SCOPE: Wire all M4 components; verify all 201 tests pass; dry-run side-effect-free with enforcement limitations shown
  PROOF: All 201 tests pass; dry-run shows contract resolution without execution
  ROLLBACK: Revert integration wiring; keep individual slices

## EVIDENCE
FACTS:
- SPEC_M4.md defines 9 interfaces, 19 boundaries, 4 test layers, 8 acceptance conditions
- PRD §7.7, §7.8, §7.9, §12.2, §13, §14 gates 12-17 map to slices
- Existing gate tests 12, 13, 14, 15, 16, 17 already pass (30+ tests)
- M1-M3 complete: 201 tests passing
ASSUMPTIONS:
- schemastery validation continues via lib/schema.js
- RunState persisted via session persistence (JSONL)
- Turn boundaries (turn/end) map to checkpoint creation
- Existing controller.js has partial checkpoint/resume implementation
PROOF: none
UNKNOWN:
- Exact host command flag parsing API
- Side-effect classification per v1 skill
- Host atomic write guarantees
DECISION: Proceed to prove stage for Slice 1 (Checkpoint Manager Core) — write failing tests first.