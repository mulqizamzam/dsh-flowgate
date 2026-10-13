---
name: prove
description: "Write the proof, as a test, repro, or measurement, before the change. Use when the change must be demonstrated correct rather than asserted correct."
produces: Proof
risk_level: medium
---

# prove

## Purpose

The prove stage writes the proof before the change: a test, a repro, or a measurement that fails on the current code and passes on the changed code. It produces the Proof artifact. The proof is written first so the change is a response to a failing check, not a rationalization after the fact.

## Artifact

The stage is complete when the following block has been emitted:

```
PROOF
WHAT_IS_PROVEN: <the claim the proof establishes>
HOW: <the exact command or procedure to run, with arguments>
FAILING_BEFORE: <the observed failure on the unproven code, or none>
PASSING_AFTER: <the observed pass on the changed code, or none>
EDGE_CASES: <one boundary case per line, or none>
```

## Evidence block

The artifact ends with an `## EVIDENCE` block containing FACTS, ASSUMPTIONS, PROOF, UNKNOWN, DECISION, in that order. An empty field is written as `none`. A proof handed to the next stage without a complete block fails this stage.

## Failure modes

1. **Claim without run** — HOW names no executable command or observable procedure.
2. **Green-only proof** — no FAILING_BEFORE observation on the unproven code.
3. **Echo test** — a test that asserts existing behavior instead of the intended change.
4. **Boundary omission** — EDGE_CASES written as none where the claim has boundaries.
5. **Ambient proof** — HOW depends on timing, network, or machine state it does not pin.
