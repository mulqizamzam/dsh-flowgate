---
name: decide
description: "Record a choice with the alternatives considered, why one was chosen, and what would reopen it. Use when more than one approach is viable and the reasoning has to survive into the next session."
produces: Decision
risk_level: low
---

# decide

## Purpose

The decide stage turns a choice into a recorded artifact. It produces the Decision artifact. The other stages record what was built, what it must satisfy, and whether it works; none of them records which option was picked and why the alternatives lost, so the reasoning behind a design dies with the session that produced it. This stage keeps it: the constraint that forced the choice, the options on the table, the one that won, the cost it commits to, and the condition that would reopen it.

## Artifact

The stage is complete when the following block has been emitted:

```
DECISION
CONTEXT: <the constraint or situation that forces a choice>
OPTIONS: <one candidate option per line>
CHOSEN: <the option that was selected>
RATIONALE: <the property the chosen option wins on, and what it costs>
REJECTED: <one alternative and the reason it lost, per line>
CONSEQUENCES: <one thing the choice now commits to, per line>
REVISED_BY: <the condition that would reopen this decision, or none>
```

## Evidence block

The artifact ends with an `## EVIDENCE` block containing FACTS, ASSUMPTIONS, PROOF, UNKNOWN, DECISION, in that order. An empty field is written as `none`. A decision handed to the next stage without a complete block fails this stage. When the rationale rests on a measurement, declare the command that produced it, so the controller records the rationale as observed instead of asserted.

## Failure modes

1. **Single-option pretence** — OPTIONS names one entry, so no alternative was ever examined.
2. **Preference as rationale** — RATIONALE calls the chosen option better without naming the property it wins on.
3. **Silent rejection** — REJECTED is none while OPTIONS names two or more alternatives.
4. **Unpriced commitment** — CONSEQUENCES leaves a reader unable to tell what the choice forecloses.
5. **Permanent verdict** — REVISED_BY is none, so nothing can ever reopen the decision.
