INTENT
GOAL: Implement M4 (Checkpoint, recovery, and diagnostics) by building checkpoint creation at turn boundaries, last-valid checkpoint selection for resume, side-effect retry policy enforcement, error taxonomy, run reports, and /flowgate --status/--report/--resume commands, such that gates 12 (checkpoint), 13 (recovery-safety), 14 (routing), 15 (composition-security), 16 (persistence), 17 (report-and-command-e2e) pass.
NON_GOALS:
- Live-host verification beyond existing capabilities (M5 gate 18)
- Web dashboard or graphical workflow editor
- Multi-agent orchestration or distributed workers
SUCCESS_CRITERIA:
- Checkpoint created at turn end capturing: run/workflow identity, completed stage states, artifact/evidence versions, gate outcomes, dependency basis, side-effect state, timestamp
- Checkpoint validity: all required artifacts valid, evidence current, gates passed, no unknown impact
- Resume selects last valid checkpoint (not most recent); corrupt/stale checkpoint rejected; earlier valid selected
- If no safe recovery point exists → RESUME_BLOCKED with reason
- Side-effectful stages: safe_idempotent retry allowed after idempotency verified; manual_approval_required requires explicit approval; not_retryable denies auto-retry
- Error taxonomy: stable codes for all failure modes (FLOW_REQUEST_TOO_LARGE through COMPOSITION_TOO_LARGE)
- Run report: human-readable + machine-readable JSON with routing, stages, checks, invalidations, checkpoint, errors, enforcement levels, completion decision
- /flowgate --status <run-id>: displays current run and stage statuses without changing them
- /flowgate --report <run-id>: emits persisted run report; supports JSON output
- /flowgate --resume <run-id>: validates state, chooses last valid checkpoint, resumes only if safe
- Dry-run proven not to steer, execute, or mutate state
- Gate 12 (checkpoint.test.mjs): checkpoint completeness/versioning/validity and last-valid selection work across stale/corrupt cases
- Gate 13 (recovery-safety.test.mjs): corrupt/stale checkpoints rejected; recovery tests pass; every blocked/failed/error run has actionable diagnostics
- Gate 14 (routing.test.mjs): exact-token scores, zero-match fallback, priority/lexical tie-breaks, Unicode, repeated words, punctuation, large input deterministic
- Gate 15 (composition-security.test.mjs): sanitization, request byte limit, 40 KiB message limit, wrapper injection tests, byte-identical skill bodies pass
- Gate 16 (persistence.test.mjs): atomic update/corruption/version migration and unsupported-version refusal behave correctly
- Gate 17 (report-and-command-e2e.test.mjs): nine commands register, dry-run side-effect-free, status/report/resume behaviors work, reports match stored state
UNKNOWNS:
- Exact host API for command registration with flags (--status, --report, --resume)
- Whether host supports JSON output flag for commands
- Exact turn boundary event data for checkpoint creation
- Side-effect classification per v1 skill (read_only/local_write/external)
UNKNOWNS:
- Whether host provides atomic write guarantee for checkpoint files
- Whether concurrent run access needs locking (PRD §10.5)

## EVIDENCE
FACTS:
- M1 complete: Host capability matrix done (8 verified, 2 unsupported, 0 unknown)
- M2 complete: 7 schemas, 201 tests passing, structural/json-schema/contracts/workflows/artifact-registry/evidence-registry gates pass
- M3 complete: Controller, transitions, invalidation implemented; gates 10, 11, 13 pass
- PRD §7.7: Checkpoint captures run identity, stage states, artifact/evidence versions, gate outcomes, dependency basis, side-effect state, timestamp
- PRD §7.7.3: Resume from last valid checkpoint, not most recent; revalidate external deps
- PRD §7.8: Side-effect classes (read_only, local_write, external) with retry policies
- PRD §7.9: Run report with routing, stages, checks, invalidations, checkpoint, errors, enforcement levels, completion
- PRD §12.2: /flowgate --dry-run, --status, --report, --resume
- PRD §13: Error taxonomy with 18+ stable codes
- PRD §14 gates 12, 13, 14, 15, 16, 17 are M4 scope
- All 201 tests currently pass
ASSUMPTIONS:
- schemastery validation continues via lib/schema.js
- RunState persisted via session persistence (JSONL)
- Turn boundaries (turn/end event) map to checkpoint creation
- Existing controller.js has partial checkpoint implementation
PROOF: none
UNKNOWN:
- Exact host command flag parsing API
- Side-effect classification per v1 skill
- Host atomic write guarantees
DECISION: Proceed to spec stage to define interfaces, boundaries, and test strategy for M4 checkpoint, recovery, and diagnostics.