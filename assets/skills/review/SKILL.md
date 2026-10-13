---
name: review
description: "Run an adversarial multi-axis review with explicit finding severities. Use when work is complete enough to be attacked and the cost of a missed defect is real."
produces: Review
risk_level: medium
---

# review

## Purpose

The review stage attacks the finished work against the spec, the constraints, and the proof. It produces the Review artifact. The review is adversarial by design: its value is the findings that survive a hostile reading, and the honest record of what was never examined.

## Artifact

The stage is complete when the following block has been emitted:

```
REVIEW
FINDING 1:
  SEVERITY: <high|medium|low>
  LOCATION: <file, line, or component a reader can open>
  ISSUE: <the defect or risk>
  FIX: <the concrete change that resolves it>
FINDING 2:
  SEVERITY: <...>
  LOCATION: <...>
  ISSUE: <...>
  FIX: <...>
UNREVIEWED: <one path or aspect never examined per line, or none>
```

## Evidence block

The artifact ends with an `## EVIDENCE` block containing FACTS, ASSUMPTIONS, PROOF, UNKNOWN, DECISION, in that order. An empty field is written as `none`. A review handed to the next stage without a complete block fails this stage.

## Failure modes

1. **Severity inflation** — a cosmetic item marked high to manufacture urgency.
2. **Location vagueness** — an ISSUE whose LOCATION no reader can open.
3. **Fixless finding** — a finding with no concrete FIX.
4. **Blind-spot silence** — UNREVIEWED written as none while risky paths went unexamined.
5. **Re-run claim** — a verification claimed without recorded command and output.
