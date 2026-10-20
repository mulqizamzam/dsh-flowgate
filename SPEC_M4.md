SPEC
INTERFACES:
- CheckpointManager: { createCheckpoint(runId, turnEvent), isValid(checkpointId), selectLastValid(runId), list(runId) }
- Checkpoint: { checkpointId, runId, workflow, workflowVersion, schemaVersion, stageStates[], artifactVersions[], evidenceVersions[], gateOutcomes[], dependencyBasis[], sideEffectState, timestamp, schemaVersion }
- ResumeManager: { resume(runId), planResume(runId), validateState(runId) }
- RunReportGenerator: { generate(runId, format: 'human'|'json') }
- Report: { runId, workflow, workflowVersion, contractVersion, engineVersion, routing, stages[], checks[], invalidations[], checkpoint, errors[], enforcementLevels, completion, limitations }
- SideEffectPolicy: { classify(stageId), isSafeToRetry(stageId, attempt), requiresApproval(stageId, attempt), getIdempotencyKey(stageId, attempt) }
- ErrorTaxonomy: { code, message, remediationHint } for 18+ codes
- CommandAdapter: { registerCommands(ctx), handleStatus(runId), handleReport(runId, format), handleResume(runId), handleDryRun(request) }
- DryRunResult: { selectedWorkflow, scores, stages, contracts, dependencies, size, limitations }

BOUNDARIES:
- Checkpoint only created at turn/end event (not mid-turn)
- Checkpoint validity: all required artifacts valid + evidence current + gates passed + no unknown impact
- Resume selects LAST VALID checkpoint (not most recent by time)
- Corrupt checkpoint → rejected with CHECKPOINT_INVALID code
- Stale checkpoint (evidence stale) → rejected, earlier valid selected
- No valid checkpoint → RESUME_BLOCKED with reason
- Side-effect retry: safe_idempotent verified → auto-retry; manual_approval_required → explicit approval; not_retryable → denied
- Max checkpoint history: 100 per run
- Run report max size: 1 MiB (truncated with note if exceeded)
- Error codes stable across messages and JSON reports
- Missing prerequisite → blocked not failed; checker error → error not failed
- Dry-run never steers, executes, or mutates state
- Request > 8192 bytes → FLOW_REQUEST_TOO_LARGE; composed message > 40 KiB → COMPOSITION_TOO_LARGE

TEST_STRATEGY:
- Unit: CheckpointManager.create captures all required fields (gate 12)
- Unit: Checkpoint validity checks all required fields (gate 12)
- Unit: selectLastValid chooses valid not most recent (gate 12)
- Unit: Corrupt checkpoint rejected with CHECKPOINT_INVALID (gate 12)
- Unit: Stale checkpoint rejected, earlier valid selected (gate 12)
- Unit: No valid checkpoint → RESUME_BLOCKED (gate 12)
- Unit: SideEffectPolicy classifies and enforces retry policy (gate 13)
- Unit: Error taxonomy covers all 18+ codes (gate 13)
- Integration: Checkpoint created at turn/end event (gate 12)
- Integration: Resume from valid checkpoint continues remaining stages (gate 13)
- Integration: Resume refuses when no valid checkpoint (gate 13)
- Integration: Auto-retry denied for manual_approval_required/not_retryable (gate 13)
- Integration: /flowgate --status/--report/--resume work (gate 17)
- Integration: Dry-run side-effect-free, shows all contract info (gate 15)
- Integration: Request sanitization, 8KB limit, 40KiB limit enforced (gate 15)
- Integration: Atomic persistence, corruption/version migration (gate 16)
- Adversarial: Corrupt checkpoint rejected not silently accepted (gate 12)
- Adversarial: Stale checkpoint not silently accepted (gate 12)
- Adversarial: No valid checkpoint → RESUME_BLOCKED with reason (gate 12)
- Adversarial: Auto-retry denied for unsafe side effects (gate 13)
- Adversarial: Dry-run proven no steering/execution/mutation (gate 15)
- Adversarial: Atomic persistence survives corruption (gate 16)

ACCEPTANCE:
- Gate 12 (checkpoint.test.mjs): completeness/versioning/validity and last-valid selection work
- Gate 13 (recovery-safety.test.mjs): corrupt/stale checkpoints rejected; recovery tests pass; actionable diagnostics
- Gate 14 (routing.test.mjs): exact-token scores, zero-match fallback, tie-breaks, Unicode, deterministic
- Gate 15 (composition-security.test.mjs): sanitization, 8KB/40KiB limits, wrapper injection, byte-identical skills
- Gate 16 (persistence.test.mjs): atomic update, corruption/version migration, unsupported version refusal
- Gate 17 (report-and-command-e2e.test.mjs): 9 commands register, dry-run side-effect-free, status/report/resume work, reports match state
- All 201 tests pass

## EVIDENCE
FACTS:
- M1-M3 complete: 201 tests passing
- PRD §7.7, §7.8, §7.9, §12.2, §13, §14 gates 12-17 define M4 scope
- Existing checkpoint.test.mjs and recovery-safety.test.mjs pass (9+9 tests)
- Existing report-and-command-e2e.test.mjs passes
- Existing routing.test.mjs, composition-security.test.mjs, persistence.test.mjs pass
ASSUMPTIONS:
- schemastery validation continues via lib/schema.js
- RunState persisted via session persistence (JSONL)
- Turn boundaries (turn/end) map to checkpoint creation
- Existing controller.js has partial checkpoint implementation
PROOF: none
UNKNOWN:
- Exact host command flag parsing API
- Side-effect classification per v1 skill
- Host atomic write guarantees
DECISION: Proceed to slice stage to break M4 into independently provable slices.