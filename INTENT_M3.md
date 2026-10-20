INTENT
GOAL: Implement M3 (Controller, transitions, and invalidation) by building the runtime workflow controller with deterministic transition rules, dependency-aware invalidation, and revalidation behavior, such that gates 10 (transition-rules), 11 (invalidation), and 13 (recovery-safety) pass.
NON_GOALS:
- Checkpoint/recovery manager (M4)
- Run report generator (M4)
- Dry-run command extensions (M4)
- Live-host verification beyond existing capabilities (M5)
SUCCESS_CRITERIA:
- Stage attempt lifecycle (pending→ready→running→validating→passed/failed/blocked/error/cancelled) implemented
- Preconditions for entering a stage enforced: valid inputs, passed prerequisite gates, current evidence, no unknown impact
- Preconditions for passing a stage enforced: valid outputs, complete evidence, passing checks, no unresolved dependencies
- Transition invariants enforced: missing prereq → blocked, unmet criterion → failed, checker error → error, stale evidence → blocked, input change → reeval, resume from last valid checkpoint, completion blocked if unresolved
- Dependency graph validates: stable IDs, no dangling refs, no cycles, data vs ordering edges, reverse traversal, source versions preserved, incomplete impact recorded
- Invalidation policy: unchanged fingerprint + satisfied preconditions → keep current; relevant change → revalidate/invalidate per policy; unknown impact → needs_revalidation
- Revalidation: known changes propagate per policy; unknown impact → conservative needs_revalidation
- Host enforcement: strongest supported transition control integrated; un-enforced cases labeled honestly in dry-run/report
- Gate 10 (transition-rules.test.mjs): missing prereqs block, unmet checks fail, checker exceptions error, gate cannot pass with unresolved required evidence
- Gate 11 (invalidation.test.mjs): source changes affect graph-dependent results, unknown impact forces revalidation, unaffected results stay current with defensible graph basis
- Gate 13 (recovery-safety.test.mjs): resume does not skip required work, side-effect policies prevent unsafe automatic retries
UNKNOWNS:
- Exact host API for turn/step lifecycle hooks beyond turn/start, turn/end, step/start, step/end
- Whether host supports blocking stage transitions at the runtime level or only validation
- Exact side-effect classification for each v1 skill (read_only/local_write/external)
- Whether concurrent run access needs locking (PRD §10.5 says refuse if unsafe)

## EVIDENCE
FACTS:
- M2 complete: 7 schemas, 201 tests passing, structural/json-schema/contracts/workflows/artifact-registry/evidence-registry gates pass
- PRD §7.2: Runtime workflow controller tracks workflow state, validates contracts before transitions
- PRD §7.5: Dependency graph with stable IDs, no cycles, data vs ordering edges, reverse traversal
- PRD §7.6: Invalidation policy with unknown_impact_policy = needs_revalidation
- PRD §7.7: Checkpoint at turn boundaries, resume from last valid checkpoint
- PRD §7.8: Side-effect classes (read_only, local_write, external) with retry policies
- PRD §9: Transition model with preconditions for ready/passed, invariants
- PRD §14 gates 10, 11, 13 are M3 scope
- Host capability matrix: turn/step events verified, session persistence verified, agent factory verified
ASSUMPTIONS:
- schemastery validation from lib/schema.js continues to be used for schema validation
- Existing controller.js has partial implementation that can be extended
- Run state persisted via session persistence (JSONL)
- Dependency graph built from stage contract declarations
PROOF: none
UNKNOWN:
- Exact host transition control API
- Side-effect classification per skill
DECISION: Proceed to spec stage to define interfaces, boundaries, and test strategy for M3 controller, transitions, and invalidation.