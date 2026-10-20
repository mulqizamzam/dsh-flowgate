INTENT
GOAL: Identify at least 3 concrete, evidence-backed feature opportunities for dsh-flowgate v2 that address unmet operator needs, where each opportunity has a falsifiable success criterion and a validation method that can be executed within 2 weeks.
NON_GOALS:
- Building or prototyping any feature (this is investigation only)
- Evaluating features outside the v2 product envelope defined in PRD.md §4.2
- Market sizing or business case analysis
- UI/dashboard features (explicitly non-goal per PRD §4.2)
SUCCESS_CRITERIA:
- At least 3 feature opportunities documented with: problem statement, evidence source, success criterion (falsifiable), validation method, effort estimate (S/M/L), and risk level
- Each opportunity maps to at least one locked product principle (PRD §3.2) or acceptance criterion (PRD §16)
- Opportunities are ranked by impact × confidence / effort
- A single decision record captures which opportunities advance to spec stage and why
UNKNOWNS:
- Which operator pain points are most acute in the current v1 workflow experience
- Whether DSH host capabilities (PRD §11.3) enable or constrain specific v2 enforcement features
- What the actual adoption friction is for the 8 skills / 5 workflows / 9 commands
- Whether any v1 runs/artifacts exist that could inform migration priorities (PRD §19)

## EVIDENCE
FACTS:
- PRD.md v2.0-draft defines the full v2 product envelope, 10 locked principles, 18 test gates, 5 workflows, 8 skills, 9 commands
- Current state: M1 (Host capability discovery) not yet started per PRD §15
- Product is a DSH plugin for a single local technical operator
- Non-goals explicitly exclude: web UI, marketplace, multi-agent, cross-host, telemetry, event sourcing, parallel execution, semantic truth detection
- Investigation workflow stages: intent* → recover* → handoff*
- v2 adds formal contracts, dependency graph, evidence registry, checkpoints, deterministic reports - all not yet implemented
ASSUMPTIONS:
- Operator pain points exist in: workflow selection ambiguity, evidence ritualism, stale artifact reuse, recovery uncertainty, dry-run limitations
- Host capability gaps (PRD R1) will constrain enforcement claims
- Evidence quality (PRD R7) is a systemic risk across all skills
- The 18 test gates in PRD §14 are the true measure of v2 completeness
PROOF: none
UNKNOWN:
- Actual operator friction points with v1 skills/workflows
- Host capability matrix results (PRD §11.3)
- Migration burden from v1 runs (PRD §19)
- Which v2 features operators would actually use vs. ignore
DECISION: Proceed to recover stage to systematically diagnose operator friction and host capability gaps as the evidence base for feature opportunities.