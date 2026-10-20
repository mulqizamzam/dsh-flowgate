SPEC
INTERFACES:
- WorkflowController: { createRun(workflow, request), transition(runId, stageId), status(runId), report(runId), resume(runId) }
- StageAttempt: { runId, stageId, attempt, status, artifactId?, startedAt, finishedAt }
- TransitionRule: { from, to, preconditions[], validation[], postconditions[] }
- DependencyGraph: { addNode(id, type), addEdge(from, to, kind, policy), getAffected(changedNode), hasCycle() }
- InvalidationEngine: { onInputChange(runId, changedArtifactId), onEvidenceChange(runId, changedEvidenceId), computeAffected(runId) }
- CheckpointManager: { create(runId, turnBoundary), isValid(runId, checkpointId), selectLastValid(runId) }
- SideEffectPolicy: { classify(stageId), isSafeToRetry(stageId, attempt), requiresApproval(stageId) }
- HostEnforcement: { canBlockTransition(), getEnforcementLevel(), reportLimitation(limitation) }
- RunStateStore: { save(runState), load(runId), delete(runId), list() }

BOUNDARIES:
- No transition occurs without all preconditions met (blocked status returned)
- Evidence freshness checked on every transition attempt
- Unknown impact always → needs_revalidation (never silent current)
- Cycle in dependency graph → fail closed at graph construction
- Resume never skips required work (last valid checkpoint, not most recent)
- Side-effectful stage retry denied unless safe_idempotent proven
- Host enforcement level accurately reported (declared/validated/enforced)
- All state mutations atomic (session persistence JSONL)
- Max run state size: 10 MiB per run
- Max checkpoint history: 100 per run

TEST_STRATEGY:
- Unit: TransitionRule preconditions validate against RunState (gate 10)
- Unit: DependencyGraph cycle detection and reverse traversal (gate 11)
- Unit: InvalidationEngine propagates known changes, conservative on unknown (gate 11)
- Unit: CheckpointManager validity rules and last-valid selection (gate 13)
- Integration: Full workflow transition from intent→spec→slice→prove→review (gate 10)
- Integration: Input change invalidates downstream artifacts/evidence (gate 11)
- Integration: Resume from checkpoint with stale evidence blocked (gate 13)
- Adversarial: Missing prerequisite → blocked not failed (gate 10)
- Adversarial: Unmet criterion → failed not blocked (gate 10)
- Adversarial: Checker exception → error not failed (gate 10)
- Adversarial: Stale required evidence → blocked (gate 10)
- Adversarial: Unknown dependency impact → needs_revalidation (gate 11)
- Adversarial: Resume skips required stage → blocked (gate 13)
- Adversarial: Auto-retry of manual_approval_required → denied (gate 13)

ACCEPTANCE:
- Gate 10 (transition-rules.test.mjs) passes: missing prereq → blocked, unmet check → failed, checker error → error, stale evidence → blocked
- Gate 11 (invalidation.test.mjs) passes: source change → affected invalidated, unknown impact → revalidation, unaffected stays current with graph basis
- Gate 13 (recovery-safety.test.mjs) passes: resume no skip, side-effect policy enforced, auto-retry denied for unsafe
- All existing 201 tests continue to pass
- Dry-run shows contract resolution without execution
- Host enforcement limitations documented in every dry-run/report

## EVIDENCE
FACTS:
- M2 complete: 7 schemas, 201 tests passing
- PRD §7.2, §9 define controller/transition requirements
- PRD §7.5, §7.6 define dependency graph/invalidation requirements
- PRD §7.7, §7.8 define checkpoint/recovery/side-effect requirements
- PRD §14 gates 10, 11, 13 are M3 scope
- Existing controller.js has: createRun, startRun, recordStageOutput, status, but missing transition validation, invalidation, checkpoint
- Host capability matrix: turn/step events, session persistence, agent factory verified
ASSUMPTIONS:
- schemastery (lib/schema.js) validation continues for all data contracts
- RunState persisted via session persistence (JSONL)
- Dependency graph built from stage contract declarations
- Turn boundaries map to stage attempts
PROOF: none
UNKNOWN:
- Exact host API for blocking transitions
- Side-effect classification per v1 skill
DECISION: Proceed to slice stage to break M3 into independently provable slices.