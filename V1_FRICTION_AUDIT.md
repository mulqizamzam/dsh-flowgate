# v1 Friction Audit — dsh-flowgate v2 M1 Evidence

**Generated**: 2025-10-20  
**Method**: Synthetic task simulation across 8 skills / 5 workflows  
**Scope**: Identify operator friction points that v2 features should address

---

## Audit Summary

| Skill/Workflow | Friction Points Found | Severity | v2 Feature Opportunity |
|---|---|---|---|
| intent | Goal falsifiability checking manual; no validation of SUCCESS_CRITERIA checkability | Medium | Auto-validate goal structure |
| spec | Interface/boundary/test-strategy completeness not checked; acceptance drift undetected | Medium | Schema validation + acceptance traceability |
| slice | Monolith slice detection manual; rollback feasibility not verified | High | Dependency graph + rollback validator |
| prove | FAILING_BEFORE/PASSING_AFTER evidence binding manual; green-only proof not caught | High | Evidence registry + binding enforcement |
| review | Severity calibration subjective; UNREVIEWED blindness; re-run claims unverified | High | Adversarial calibration + verification gates |
| constrain | Threshold measurability not checked; silent breach possible | Medium | Threshold validator + breach alarm |
| recover | Root cause vs symptom distinction manual; repro validation absent | High | Repro executor + mechanism validator |
| handoff | Verified vs not-verified separation manual; status inflation undetected | Medium | Status auditor + next-action linker |

| Workflow | Friction Points Found | Severity | v2 Feature Opportunity |
|---|---|---|---|
| feature | No stage transition validation; intent drift not caught; optional review skip silent | High | Transition controller + drift detection |
| bugfix | Double prove run not enforced; symptom vs fix confusion | High | Prove orchestration + symptom tracker |
| investigation | Question change detection manual; fix proposal leakage | Medium | Question anchor + stage gate |
| migration | Slice rollback ordering not enforced; handoff completeness | High | Slice dependency graph + rollback verifier |
| release | Constraint threshold enforcement manual; high-severity block not automated | High | Constraint gate + release blocker |

---

## Detailed Friction Observations (with Repro Steps)

### F1: Intent — Goal Falsifiability Not Validated
**Repro**: 
1. Run `/intent "make the app better"`
2. Observe: skill accepts wish goal "make the app better" as GOAL
3. No validation that GOAL is falsifiable or SUCCESS_CRITERIA are checkable
**Evidence**: Skill failure mode 1 "Wish goal" exists but no automated check
**v2 Opportunity**: Intent contract validator that rejects non-falsifiable goals

### F2: Intent — Criterion Drift Not Detected
**Repro**:
1. GOAL: "Reduce login latency to <200ms"
2. SUCCESS_CRITERIA: "Login is fast" (restates goal, not checkable)
3. Skill accepts without flagging drift
**Evidence**: Failure mode 2 "Criterion drift" documented but not enforced
**v2 Opportunity**: Criterion drift detector comparing GOAL vs SUCCESS_CRITERIA semantics

### F3: Spec — Interface Vapor Not Caught
**Repro**:
1. Run `/spec` after valid intent
2. INTERFACES: "AuthModule" (no signature, no data shape, no callers)
3. Skill accepts vapor interface
**Evidence**: Failure mode 1 "Interface vapor" documented but not enforced
**v2 Opportunity**: Interface signature parser + caller graph validator

### F4: Spec — Acceptance Drift Not Detected
**Repro**:
1. Intent SUCCESS_CRITERIA: "Login latency <200ms p95"
2. Spec ACCEPTANCE: "Login works" (weaker than intent)
3. No cross-stage validation
**Evidence**: Failure mode 4 "Acceptance drift" documented but not enforced
**v2 Opportunity**: Acceptance traceability checker linking intent → spec → prove

### F5: Slice — Monolith Slice Not Detected
**Repro**:
1. Run `/slice` after spec
2. Single slice with SCOPE = entire spec
3. Skill accepts monolith slice
**Evidence**: Failure mode 1 "Monolith slice" documented but not enforced
**v2 Opportunity**: Slice size analyzer + dependency graph to detect forward dependencies

### F6: Slice — Rollback Fiction Not Verified
**Repro**:
1. ROLLBACK: "git revert" (but changes span multiple files with shared state)
2. No verification that rollback isolates slice changes
**Evidence**: Failure mode 3 "Rollback fiction" documented but not enforced
**v2 Opportunity**: Rollback simulator that tests isolation in sandbox

### F7: Prove — Green-Only Proof Not Caught
**Repro**:
1. Run `/prove` 
2. HOW: "npm test" (but test already passes on current code)
3. FAILING_BEFORE: "none" (accepted)
4. Skill accepts proof without failing-before evidence
**Evidence**: Failure mode 2 "Green-only proof" documented but not enforced
**v2 Opportunity**: Proof executor that requires observed FAILING_BEFORE before PASSING_AFTER

### F8: Prove — Evidence Binding Manual
**Repro**:
1. Proof written for commit abc123
2. Code changes to def456
3. Proof artifact still shows as valid (no binding to implementation snapshot)
**Evidence**: PRD §7.4 evidence binding model; v1 has no binding
**v2 Opportunity**: Evidence registry binding evidence to implementation snapshots

### F9: Review — Severity Inflation Not Calibrated
**Repro**:
1. Cosmetic whitespace issue marked SEVERITY: high
2. No calibration against defined severity scale
3. Skill accepts inflated severity
**Evidence**: Failure mode 1 "Severity inflation" documented but not enforced
**v2 Opportunity**: Severity calibration rubric + auto-detection of cosmetic vs functional

### F10: Review — Blind-Spot Silence
**Repro**:
1. UNREVIEWED: "none"
2. But auth flow, error handling, edge cases never examined
3. Skill accepts silent blind spot
**Evidence**: Failure mode 4 "Blind-spot silence" documented but not enforced
**v2 Opportunity**: Coverage analyzer that flags unexamined risky paths

### F11: Recover — Guess as Cause
**Repro**:
1. Run `/recover` on flaky test
2. ROOT_CAUSE: "test is flaky" (mechanism not explained)
3. REPRO: "run test 10 times" (not on-demand fail)
4. Skill accepts guess without mechanism
**Evidence**: Failure mode 1 "Guess as cause" + mode 2 "Repro gap" documented but not enforced
**v2 Opportunity**: Repro executor that validates on-demand failure + mechanism classifier

### F12: Recover — Symptom Treatment as Fix
**Repro**:
1. SYMPTOM: "memory leak"
2. FIX: "restart service daily" (hides signal, doesn't remove mechanism)
3. Skill accepts symptom treatment
**Evidence**: Failure mode 3 "Symptom treatment" documented but not enforced
**v2 Opportunity**: Fix mechanism analyzer distinguishing root-cause removal vs symptom masking

### F13: Handoff — Selective Memory
**Repro**:
1. VERIFIED: "tests pass" 
2. But no test command/output recorded in session
2. Skill accepts unverified claim
**Evidence**: Failure mode 1 "Selective memory" documented but not enforced
**v2 Opportunity**: Verification linker requiring tool result evidence for each VERIFIED claim

### F14: Handoff — Status Inflation
**Repro**:
1. STATUS: "feature complete"
2. But NOT_VERIFIED has items, OPEN_ITEMS not empty
3. Skill accepts inflated status
**Evidence**: Failure mode 5 "Status inflation" documented but not enforced
**v2 Opportunity**: Status auditor cross-checking STATUS against VERIFIED/NOT_VERIFIED/OPEN_ITEMS

### F15: Feature Workflow — Stage Transition Not Validated
**Repro**:
1. Start `/flowgate "add user dashboard"`
2. Agent emits intent artifact but skips EVIDENCE block
3. Proceeds to spec stage anyway
4. No gate blocking transition
**Evidence**: Workflow rule "Do not begin a stage until previous artifact complete" not enforced
**v2 Opportunity**: Transition controller enforcing preconditions (PRD §9.2)

### F16: Feature Workflow — Intent Drift Not Caught
**Repro**:
1. Intent GOAL: "add dark mode toggle"
2. Spec INTERFACES: "theme engine with 50 options" (scope creep)
3. No drift detection back to intent
**Evidence**: Workflow rule "If stage reveals intent was wrong, return to intent" not enforced
**v2 Opportunity**: Intent drift detector comparing spec scope vs intent goal

### F17: Bugfix Workflow — Double Prove Not Enforced
**Repro**:
1. Run `/flowgate "fix login crash"`
2. Prove stage runs once with PASSING_AFTER only
3. No FAILING_BEFORE encoded
4. Workflow completes without double prove
**Evidence**: Workflow rule "Run prove stage twice" not enforced
**v2 Opportunity**: Prove orchestrator enforcing two-phase execution

### F18: Investigation Workflow — Fix Proposal Leakage
**Repro**:
1. Run `/flowgate "investigate why deploy fails"`
2. Recover stage produces DIAGNOSIS with FIX field populated
3. Workflow rule "Do not propose a fix during recover" violated
**Evidence**: Workflow rule documented but not enforced
**v2 Opportunity**: Stage content validator rejecting FIX in recover artifact

### F19: Migration Workflow — Slice Rollback Ordering
**Repro**:
1. Slice 1 changes DB schema, Slice 2 migrates data
2. Slice 2 starts before Slice 1 rollback verified
3. No enforcement of independent rollbackability
**Evidence**: Workflow rule "Each slice must be independently rollbackable" not enforced
**v2 Opportunity**: Rollback dependency verifier + slice sequencer

### F20: Release Workflow — Constraint Threshold Not Enforced
**Repro**:
1. CONSTRAINT: "test coverage >80%"
2. HOW_ENFORCED: "nyc report" but no threshold check in command
3. FAILURE_ACTION: "block release" but no automation
4. Release proceeds with 60% coverage
**Evidence**: Workflow rule "constraint without threshold and failure action is not a constraint" not enforced
**v2 Opportunity**: Constraint gate evaluator with automated failure actions

---

## Cross-Cutting Systemic Issues

### S1: Evidence Ritualism (PRD Risk R7)
**Observation**: All 8 skills require `## EVIDENCE` block but agents write plausible fields without real observations
**Root Cause**: No evidence provenance tracking; structural validation ≠ truth validation
**v2 Mitigation**: Evidence registry with provenance types (observed_command, observed_test, human_input, inferred)

### S2: Stale Artifact Reuse (PRD §7.6)
**Observation**: Artifacts from prior runs reused after code changes without revalidation
**Root Cause**: No fingerprinting, no dependency graph, no invalidation
**v2 Mitigation**: Artifact registry with fingerprints + dependency graph + invalidation policy

### S3: No Recovery Safety (PRD Risk R5)
**Observation**: Resume after interruption repeats side effects (deployment, data mutation)
**Root Cause**: No side-effect classification, no idempotency evidence, no manual approval gate
**v2 Mitigation**: Side-effect policy in stage contracts + checkpoint recovery constraints

### S4: Unknown Impact Silent Retention (PRD §7.6.3)
**Observation**: When dependency impact unknown, evidence silently stays "current"
**Root Cause**: No conservative revalidation policy implementation
**v2 Mitigation**: Unknown impact → needs_revalidation enforced by controller

### S5: Single `done` State Collapse (PRD Principle 2)
**Observation**: All skills collapse artifact/evidence/gate/review into one "done" claim
**Root Cause**: No multidimensional status model in v1
**v2 Mitigation**: Separate status dimensions per PRD §8

---

## Ranked Feature Opportunities for v2

| Rank | Opportunity | Impact | Confidence | Effort | Maps to PRD |
|---|---|---|---|---|---|
| 1 | **Stage Contract Engine + Transition Controller** | High | High | M | §7.1, §7.2, §9 |
| 2 | **Evidence Registry with Provenance & Binding** | High | High | M | §7.4, §7.5 |
| 3 | **Artifact Registry with Fingerprints & Invalidation** | High | High | M | §7.3, §7.6 |
| 4 | **Dependency Graph + Invalidation Propagation** | High | High | M | §7.5, §7.6 |
| 5 | **Checkpoint/Recovery Manager with Side-Effect Policy** | High | Medium | M | §7.7, §7.8 |
| 6 | **Prove Orchestrator (Two-Phase Execution)** | Medium | High | S | Bugfix workflow rule |
| 7 | **Intent Drift Detector** | Medium | High | S | Feature workflow rule |
| 8 | **Severity Calibration + Coverage Analyzer** | Medium | Medium | S | Review failure modes |
| 9 | **Rollback Simulator** | Medium | Medium | M | Slice failure mode 3 |
| 10 | **Repro Executor + Mechanism Classifier** | High | Medium | L | Recover failure modes 1,2 |
| 11 | **Constraint Gate Evaluator** | Medium | High | S | Release workflow rule |
| 12 | **Run Report Generator** | Medium | High | S | §7.9 |

---

## Decision Record

**Advancing to Spec Stage**: Opportunities 1-5 (core v2 infrastructure per PRD milestones M2-M4)  
**Deferring**: Opportunities 6-12 (skill-specific enhancements, address after core infrastructure)  
**Rationale**: PRD delivery plan requires M1→M2→M3→M4→M5 sequence. Core infrastructure (contracts, registries, graph, controller, checkpoints) must exist before skill-specific validators can be built on top.

**Evidence Base**: 20 friction observations (F1-F20) + 5 systemic issues (S1-S5) from synthetic audit of all 8 skills and 5 workflows.