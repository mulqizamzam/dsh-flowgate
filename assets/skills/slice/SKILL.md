---
name: slice
description: "Break the spec into independently provable slices. Use when the change is large enough that one proof would not isolate failures."
produces: SlicePlan
risk_level: low
---

# slice

## Purpose

The slice stage converts a spec into an ordered list of independently provable slices. It produces the SlicePlan artifact. Each slice carries its own scope, proof, and rollback, so a failure localizes to one slice instead of collapsing the whole plan.

## Artifact

The stage is complete when the following block has been emitted:

```
SLICEPLAN
SLICE 1: <name>
  SCOPE: <what this slice changes>
  PROOF: <the check that passes only when this slice is done>
  ROLLBACK: <how this slice's changes are undone in isolation>
SLICE 2: <name>
  SCOPE: <...>
  PROOF: <...>
  ROLLBACK: <...>
```

## Evidence block

The artifact ends with an `## EVIDENCE` block containing FACTS, ASSUMPTIONS, PROOF, UNKNOWN, DECISION, in that order. An empty field is written as `none`. A slice plan handed to the next stage without a complete block fails this stage.

## Failure modes

1. **Monolith slice** — one slice whose scope is the whole spec.
2. **Unprovable slice** — a PROOF that cannot run before the slice's code exists.
3. **Rollback fiction** — a ROLLBACK that cannot isolate this slice's changes.
4. **Forward dependency** — a slice whose scope needs a later slice to make sense.
5. **Size skew** — one slice large enough to dominate the plan's risk.
