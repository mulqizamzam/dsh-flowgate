---
name: recover
description: "Perform systematic root-cause analysis instead of trial and error. Use when a failure is reported and the mechanism is not yet known."
produces: Diagnosis
risk_level: high
---

# recover

## Purpose

The recover stage finds the mechanism behind a failure instead of trying candidate fixes. It produces the Diagnosis artifact. The stage ends when the root cause is named with a repro that fails on demand; the fix itself belongs to a later stage, not this one.

## Artifact

The stage is complete when the following block has been emitted:

```
DIAGNOSIS
SYMPTOM: <the observed failure>
REPRO: <the exact steps that reproduce it on demand>
ROOT_CAUSE: <the mechanism, not the location of the crash>
FIX: <the change that removes the mechanism, or none>
PREVENTION: <the check that stops the same failure returning>
CONFIDENCE: <high|medium|low, matched to the evidence>
```

## Evidence block

The artifact ends with an `## EVIDENCE` block containing FACTS, ASSUMPTIONS, PROOF, UNKNOWN, DECISION, in that order. An empty field is written as `none`. A diagnosis handed to the next stage without a complete block fails this stage.

## Failure modes

1. **Guess as cause** — ROOT_CAUSE asserted without a mechanism that explains the symptom.
2. **Repro gap** — no REPRO that fails on demand.
3. **Symptom treatment** — a FIX that hides the signal without touching the mechanism.
4. **Recidivism** — no PREVENTION for the same failure returning.
5. **Confidence inflation** — CONFIDENCE set above what the evidence carries.
