DIAGNOSIS
SYMPTOM: No concrete, evidence-backed feature opportunities exist for dsh-flowgate v2; the investigation intent cannot be satisfied because the evidence base (operator friction points, host capability gaps, v1 adoption data) is empty.
REPRO: 
1. Open PRD.md and attempt to map each locked principle (§3.2) and acceptance criterion (§16) to a specific operator pain point
2. Attempt to cite a real v1 workflow run, artifact, or evidence record that demonstrates a failure mode
3. Attempt to cite a host capability test result from §11.3 that validates or constrains an enforcement claim
4. Observe: all searches return zero results because no such data exists
ROOT_CAUSE: The v2 product development started from a PRD written in isolation without first establishing an evidence pipeline. The PRD assumes operator pain points and host capabilities but has not verified either. The mechanism is "specification without validation" — requirements were derived from the author's mental model rather than from observed failures in the v1 system or measured host constraints.
FIX: Execute a structured evidence-gathering phase before committing to any v2 feature scope:
1. Host capability discovery (PRD M1) — run actual DSH API probes, record verified/unsupported/unknown matrix
2. v1 friction audit — instrument or simulate the 8 skills / 5 workflows / 9 commands with realistic operator tasks, capture where agents skip stages, fabricate evidence, or claim false completion
3. Stale evidence audit — check if any v1 runs/artifacts exist in the workspace and whether they would import cleanly under PRD §19 migration policy
4. Operator interview (if available) — but per constraints, we start from zero data, so synthetic task simulation is the primary method
PREVENTION: Add a "pre-M1 evidence gate" to the delivery plan: no v2 feature work begins until host-capability-matrix.md exists with ≥80% capabilities labeled verified/unsupported (not unknown), and at least 5 v1 friction observations are recorded with repro steps.
CONFIDENCE: high — the absence of any evidence artifacts in the workspace, combined with PRD M1 being the first milestone, confirms the diagnosis. The mechanism (specification without validation) is directly observable in the PRD's own structure: it lists 18 test gates but M1 (the capability discovery needed to know which gates are even testable) is not yet done.

## EVIDENCE
FACTS:
- PRD.md §15 lists M1 "Host capability discovery and vertical slice" as the first milestone
- PRD.md §11.3 requires producing docs/host-capability-matrix.md before controller implementation
- No host-capability-matrix.md exists in the workspace
- No v1 run records, artifact files, or evidence records exist in the workspace
- The 8 skills, 5 workflows, 9 commands are documented in PRD §6 but not exercised in this session
- PRD §14 lists 18 test gates; gate 3 (host-capabilities.test.mjs) and gate 18 (live-host-verification.test.mjs) are prerequisites for enforcement claims
ASSUMPTIONS:
- The DSH host APIs are stable enough to probe programmatically
- Synthetic task simulation can reveal friction points that real operators would hit
- The v1 skills/workflows are loadable and invokable in the current DSH installation
PROOF: none
UNKNOWN:
- Exact DSH version installed and its API surface
- Whether any v1 artifacts exist in other sessions/workspaces
- Operator availability for interview
- Which host capabilities are actually verified vs. unknown
DECISION: Proceed to handoff stage with the diagnosis that evidence gathering (host capability discovery + v1 friction audit) is the prerequisite for any feature opportunity identification.