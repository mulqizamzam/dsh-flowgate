---
name: intent
description: "State what the operator actually wants, in a form that can be falsified. Use when starting work, when the objective is contested, or when a prior session's intent is being resumed."
produces: Intent
risk_level: low
---

# intent

## Purpose

The intent stage converts an operator request into a falsifiable statement of what is wanted. It produces the Intent artifact, the only artifact that may cite the operator's request as its source. Every later stage consumes this artifact, so a goal that cannot be checked propagates as a spec that cannot be pinned, a plan that cannot be sliced, and a proof that cannot fail.

## Artifact

The stage is complete when the following block has been emitted:

```
INTENT
GOAL: <one falsifiable sentence>
NON_GOALS: <one excluded item per line, or none>
SUCCESS_CRITERIA: <one checkable condition per line, or none>
UNKNOWNS: <one open question per line, or none>
```

## Evidence block

The artifact ends with an `## EVIDENCE` block containing FACTS, ASSUMPTIONS, PROOF, UNKNOWN, DECISION, in that order. An empty field is written as `none`. An intent handed to the next stage without a complete block fails this stage.

## Failure modes

1. **Wish goal** — GOAL states a desire with no checkable condition.
2. **Criterion drift** — SUCCESS_CRITERIA restate the goal instead of checks that could fail.
3. **Scope smuggling** — NON_GOALS omit the approach or boundary the operator excluded.
4. **Unknown denial** — UNKNOWNS written as none while real questions exist.
5. **Context loss** — the goal is unreadable to a reader without the operator's session history.
