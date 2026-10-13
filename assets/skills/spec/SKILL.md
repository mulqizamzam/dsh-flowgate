---
name: spec
description: "Convert intent into interfaces, boundaries, and test strategy. Use when the objective is agreed and the change must pin down contracts before code."
produces: Spec
risk_level: low
---

# spec

## Purpose

The spec stage converts a falsifiable intent into interfaces, boundaries, and a test strategy. It produces the Spec artifact, the contract every later stage is measured against. The spec pins what may change, what may not, and how each claim will be exercised, so implementation choices stop being reinterpretations.

## Artifact

The stage is complete when the following block has been emitted:

```
SPEC
INTERFACES: <one interface, signature, or data shape per line, or none>
BOUNDARIES: <one enforced limit per line, or none>
TEST_STRATEGY: <one test layer plus what it exercises per line, or none>
ACCEPTANCE: <one condition under which the spec meets the intent per line, or none>
```

## Evidence block

The artifact ends with an `## EVIDENCE` block containing FACTS, ASSUMPTIONS, PROOF, UNKNOWN, DECISION, in that order. An empty field is written as `none`. A spec handed to the next stage without a complete block fails this stage.

## Failure modes

1. **Interface vapor** — INTERFACES name modules without signatures, data shapes, or callers.
2. **Boundary blur** — BOUNDARIES describe intentions instead of limits that can be checked.
3. **Strategy gap** — TEST_STRATEGY leaves an acceptance condition with no layer that exercises it.
4. **Acceptance drift** — ACCEPTANCE is weaker than the intent's SUCCESS_CRITERIA.
5. **Assumed invariant** — a boundary the spec treats as holding without recorded evidence.
