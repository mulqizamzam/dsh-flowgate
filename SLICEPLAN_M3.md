SLICEPLAN
SLICE 1: Transition Rule Engine
  SCOPE: Implement TransitionRule type and WorkflowController.transition() with precondition checks (valid inputs, passed gates, current evidence, no unknown impact)
  PROOF: Gate 10 tests pass: missing prereq → blocked, unmet check → failed, checker error → error, stale evidence → blocked
  ROLLBACK: Revert lib/controller.js transition logic; keep existing createRun/startRun/status

SLICE 2: Dependency Graph & Invalidation Engine
  SCOPE: Implement DependencyGraph (nodes, edges, cycle detection, reverse traversal) and InvalidationEngine (onInputChange, onEvidenceChange, computeAffected with policies)
  PROOF: Gate 11 tests pass: source change → affected invalidated, unknown impact → needs_revalidation, unaffected stays current with graph basis
  ROLLBACK: Revert lib/graph.js and lib/invalidation.js; keep existing controller

SLICE 3: Stage Attempt Lifecycle & Turn Boundary Integration
  SCOPE: Map stage attempts to turn boundaries (turn/start, turn/end events); implement attempt status transitions (pending→ready→running→validating→passed/failed/blocked/error/cancelled)
  PROOF: Stage attempts correctly record at turn boundaries; gate 10 transition tests pass with real host events
  ROLLBACK: Revert turn boundary handler in controller.js

SLICE 4: Checkpoint Manager & Recovery Safety
  SCOPE: Implement CheckpointManager (create at turn end, validate completeness, select last valid) and side-effect policies per stage
  PROOF: Gate 13 tests pass: resume no skip, side-effect policy enforced, auto-retry denied for unsafe
  ROLLBACK: Revert lib/checkpoint.js; keep existing controller

SLICE 5: Host Enforcement Integration & Reporting
  SCOPE: Integrate strongest host-supported transition control; report enforcement limitations in dry-run/status/report
  PROOF: Dry-run shows contract resolution without execution; enforcement level accurately reported; gate 10/11/13 pass
  ROLLBACK: Revert host enforcement adapter; keep validation-only behavior

SLICE 6: Integration & Composition
  SCOPE: Wire all M3 components together; verify end-to-end workflow transitions; ensure all 201 tests pass
  PROOF: All 201 tests pass; dry-run works; dry-run shows enforcement limitations
  ROLLBACK: Revert integration changes; keep individual slices

## EVIDENCE
FACTS:
- SPEC_M3.md defines 6 interfaces, 9 boundaries, 4 test layers, 6 acceptance conditions
- PRD §7.2, §9, §7.5, §7.6, §7.7, §7.8, §14 gates 10, 11, 13 map to slices
- Existing controller.js has partial implementation (createRun, startRun, recordStageOutput, status)
- Host capability matrix: turn/step events, session persistence, agent factory verified
ASSUMPTIONS:
- schemastery validation continues via lib/schema.js
- RunState persisted via session persistence (JSONL)
- Dependency graph built from stage contract declarations
- Turn boundaries map to stage attempts
PROOF: none
UNKNOWN:
- Exact host API for blocking transitions
- Side-effect classification per v1 skill
DECISION: Proceed to prove stage for Slice 1 (Transition Rule Engine) — write failing tests first.