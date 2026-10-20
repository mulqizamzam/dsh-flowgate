# Feature Opportunities — dsh-flowgate v2

**Evidence Base**: 
- Host Capability Matrix (M1 complete — 8 verified, 2 unsupported, 0 unknown)
- v1 Friction Audit (20 observations F1-F20, 5 systemic issues S1-S5)
- Existing v1 artifacts in workspace (PIN2MONEY, dtf-design-agent, base-repo)
- PRD v2.0-draft (18 test gates, 5 workflows, 8 skills, 10 principles)

**Decision**: Advance core infrastructure (Ops 1-5) per PRD delivery plan M2-M4. Defer skill-specific enhancements (Ops 6-12).

---

## Opportunity 1: Stage Contract Engine + Transition Controller
**Rank**: 1 | **Impact**: High | **Confidence**: High | **Effort**: M | **PRD**: §7.1, §7.2, §9

**Problem**: No validation that stage preconditions met before transition (F15, F16). Workflow rules are prompt-only.

**Evidence**: 
- F15: Agent skips EVIDENCE block, proceeds to next stage
- F16: Spec scope creeps beyond intent, no drift detection
- PRD §9.2: Preconditions for entering a stage (valid inputs, passed gates, current evidence)
- PRD §9.3: Preconditions for passing a stage (valid outputs, complete evidence, passing checks)

**Success Criterion**: 
- Contract schema validates required inputs, accepted states, outputs, evidence, checks, dependencies
- Transition controller blocks stage entry when preconditions unmet (blocked status)
- Dry-run shows contract resolution without execution

**Validation Method**: 
- Unit tests for contract schema validation (gate 5)
- Integration test: attempt transition with missing EVIDENCE → blocked (gate 10)
- Live host test: real agent turned away at stage boundary (gate 18)

**Risk**: Host lacks hard enforcement (R1) → document as validated-only

---

## Opportunity 2: Evidence Registry with Provenance & Binding
**Rank**: 2 | **Impact**: High | **Confidence**: High | **Effort**: M | **PRD**: §7.4, §7.5, §7.9

**Problem**: Evidence is ritualistic (S1) — agents write plausible fields without real observations. No binding to implementation snapshots (F8).

**Evidence**:
- S1: All skills require EVIDENCE but no provenance tracking
- F8: Proof artifact valid for commit abc123, reused after def456 without revalidation
- PRD §7.4: Evidence must have provenance, bind to input versions, freshness status
- PRD §7.5: Dependency graph edges include `evidence_for` kind
- PRD §14.1#3: Adversarial test — test evidence bound to earlier code snapshot

**Success Criterion**:
- Evidence records require provenance type: `observed_command`, `observed_test`, `human_input`, `inferred`
- Each evidence binds to artifact/input fingerprints
- Freshness status: `current`, `stale`, `needs_revalidation`, `invalid` computed from dependency graph
- Report shows evidence provenance for each claim

**Validation Method**:
- Unit tests for evidence schema + provenance enum (gate 9)
- Integration: modify code → dependent evidence marked stale (gate 11)
- Adversarial: agent writes evidence without tool result → provenance = inferred, flagged

**Risk**: Cannot perfectly detect fabricated evidence → mitigate with provenance transparency

---

## Opportunity 3: Artifact Registry with Fingerprints & Invalidation
**Rank**: 3 | **Impact**: High | **Confidence**: High | **Effort**: M | **PRD**: §7.3, §7.6

**Problem**: Artifact presence ≠ validity (F3, F5, S2). No fingerprinting, no invalidation on dependency change.

**Evidence**:
- F3: Interface vapor accepted as valid artifact
- F5: Monolith slice accepted
- S2: Stale artifacts reused after code changes
- PRD §7.3: Artifact status = missing/present/valid/invalid (not just present)
- PRD §7.6: Invalidation policy — unknown impact → needs_revalidation
- PRD §14.1#4: Adversarial test — input changes propagate to downstream evidence

**Success Criterion**:
- Artifact registry stores: id, type, schema version, producer stage, status, fingerprint, input bindings, timestamps
- Fingerprint = content hash (detects byte-level change)
- Invalidation: source change → graph traversal → dependent artifacts marked per policy
- Status derived from validation checks, not presence

**Validation Method**:
- Unit tests for artifact status transitions (gate 8)
- Integration: change input file → downstream artifact invalidated (gate 11)
- Adversarial: artifact exists but fails schema → status = invalid (gate 10)

**Risk**: Fingerprints ≠ semantic proof (R3) → treat as change detectors only

---

## Opportunity 4: Dependency Graph + Invalidation Propagation
**Rank**: 4 | **Impact**: High | **Confidence**: High | **Effort**: M | **PRD**: §7.5, §7.6, §10.3

**Problem**: No declared dependencies between stages/artifacts/evidence. Changes don't propagate (S2, S4).

**Evidence**:
- S2: No dependency graph → stale artifacts silently reused
- S4: Unknown impact silently retains current status
- F19: Slice rollback ordering not enforced (missing dependency edges)
- PRD §7.5: Graph must use stable IDs, reject cycles, distinguish data vs ordering edges
- PRD §7.6.3: Unknown impact → conservative revalidation
- PRD §10.3: Edge kinds = input, derived_from, evidence_for, validated_by, ordering

**Success Criterion**:
- Graph built from stage contract declarations (inputs, outputs, evidence bindings)
- Reverse traversal identifies affected downstream nodes deterministically
- Cycle detection fails closed
- Unknown impact policy = needs_revalidation (not silent current)

**Validation Method**:
- Unit tests for graph structure validation (gate 7)
- Integration: declare cycle → rejected; change source → downstream marked (gate 11)
- Determinism: same changes → same invalidation set (gate 3)

**Risk**: Graph incomplete (R2) → scope claims to declared dependencies only

---

## Opportunity 5: Checkpoint/Recovery Manager with Side-Effect Policy
**Rank**: 5 | **Impact**: High | **Confidence**: Medium | **Effort**: M | **PRD**: §7.7, §7.8, §10.5

**Problem**: Resume repeats side effects (S3). No last-valid-checkpoint selection (S3, F13).

**Evidence**:
- S3: Resume after interruption repeats deployment/data mutation
- F13: Handoff VERIFIED claims without tool result evidence
- PRD §7.7: Checkpoint captures run state, artifact versions, gate outcomes, dependency basis, side-effect state
- PRD §7.7.3: Resume from last valid checkpoint, not most recent
- PRD §7.8: Side-effect classes (read-only, local_write, external) with retry policies
- PRD §14.1#8: Adversarial — latest checkpoint stale, earlier valid
- PRD §14.1#10: Side-effectful stage interrupted → auto-retry denied unless safe

**Success Criterion**:
- Checkpoint created at turn boundaries (via TurnBoundaryProjection)
- Checkpoint validity: all required artifacts valid, evidence current, gates passed, no unknown impact
- Recovery selects last valid checkpoint (not most recent by time)
- Side-effect policy enforced: safe_idempotent / manual_approval_required / not_retryable
- Atomic persistence (PRD §10.5) with corruption detection

**Validation Method**:
- Unit tests for checkpoint completeness/versioning (gate 12)
- Integration: corrupt checkpoint → rejected; stale latest → earlier valid selected (gate 13)
- Adversarial: interrupted deploy → resume denies auto-retry without manual approval (gate 13)
- Persistence test: truncated state → detected, not silently reset (gate 16)

**Risk**: External context changes between checkpoint/resume (R4) → contracts declare external deps

---

## Deferred Opportunities (Post M4)

| # | Opportunity | Dependencies | Rationale |
|---|---|---|---|
| 6 | Prove Orchestrator (Two-Phase) | Ops 1,2 | Bugfix workflow rule; needs transition controller + evidence registry |
| 7 | Intent Drift Detector | Ops 1,3 | Feature workflow rule; needs artifact registry + contracts |
| 8 | Severity Calibration + Coverage Analyzer | Ops 2 | Review failure modes; needs evidence provenance |
| 9 | Rollback Simulator | Ops 3,4 | Slice failure mode 3; needs artifact registry + dependency graph |
| 10 | Repro Executor + Mechanism Classifier | Ops 1,2 | Recover failure modes; needs transition controller + evidence registry |
| 11 | Constraint Gate Evaluator | Ops 1,2 | Release workflow rule; needs contracts + evidence registry |
| 12 | Run Report Generator | Ops 1-5 | PRD §7.9; needs all registries populated |

---

## Decision Record

**Approved for M2-M4 Implementation**: Opportunities 1-5 (core infrastructure)

**Rationale**: 
1. PRD delivery plan is sequential: M1→M2→M3→M4→M5
2. Opportunities 1-5 map directly to M2 (contracts/state), M3 (controller/invalidation), M4 (checkpoints/recovery)
3. Skill-specific validators (6-12) require core infrastructure as foundation
4. Evidence base strongest for systemic issues (S1-S5) addressed by 1-5

**Evidence Traceability**: Each opportunity maps to specific friction observations (F1-F20) and systemic issues (S1-S5) documented in V1_FRICTION_AUDIT.md, which were derived from synthetic audit of all 8 skills and 5 workflows against PRD requirements.

**Next Action**: Begin M2 — define JSON schemas for Stage Contract, Artifact, Evidence, Dependency Edge, Run State, Checkpoint, Report. Implement fail-closed validators.