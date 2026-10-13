---
name: constrain
description: "Establish a written quality bar with enforceable thresholds. Use when a release or a sustained effort needs a line that failure cannot cross silently."
produces: Constraints
risk_level: low
---

# constrain

## Purpose

The constrain stage converts quality expectations into written constraints with thresholds and failure actions. It produces the Constraints artifact. A constraint without a threshold and an enforced reaction is an opinion, so this stage exists to keep opinions out of the workflow's rules.

## Artifact

The stage is complete when the following block has been emitted:

```
CONSTRAINTS
CONSTRAINT 1:
  NAME: <short identifier>
  THRESHOLD: <the measurable bound, or a comparison rule>
  HOW_ENFORCED: <the check or command that evaluates the threshold>
  FAILURE_ACTION: <what happens when the threshold is crossed>
CONSTRAINT 2:
  NAME: <...>
  THRESHOLD: <...>
  HOW_ENFORCED: <...>
  FAILURE_ACTION: <...>
```

## Evidence block

The artifact ends with an `## EVIDENCE` block containing FACTS, ASSUMPTIONS, PROOF, UNKNOWN, DECISION, in that order. An empty field is written as `none`. A constraints artifact handed to the next stage without a complete block fails this stage.

## Failure modes

1. **Unmeasurable bar** — a THRESHOLD no tool or procedure can evaluate.
2. **Unenforced rule** — HOW_ENFORCED names nothing runnable.
3. **Silent breach** — no FAILURE_ACTION when the threshold is crossed.
4. **Constraint sprawl** — rules that punish ordinary work instead of guarding real risk.
5. **Mutual contradiction** — two constraints that cannot hold at the same time.
