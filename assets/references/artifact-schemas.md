# Artifact schemas

Each stage produces one artifact. The schemas below are the reference copy; each
skill body embeds its own schema, and the skill body is the source of truth for
its stage. Every artifact ends with the evidence block defined in
[evidence-protocol.md](evidence-protocol.md).

## Intent

```text
INTENT
GOAL: <one falsifiable sentence>
NON_GOALS: <one excluded item per line, or none>
SUCCESS_CRITERIA: <one checkable condition per line, or none>
UNKNOWNS: <one open question per line, or none>
```

## Spec

```text
SPEC
INTERFACES: <one interface, signature, or data shape per line, or none>
BOUNDARIES: <one enforced limit per line, or none>
TEST_STRATEGY: <one test layer plus what it exercises per line, or none>
ACCEPTANCE: <one condition under which the spec meets the intent per line, or none>
```

## SlicePlan

```text
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

## Proof

```text
PROOF
WHAT_IS_PROVEN: <the claim the proof establishes>
HOW: <the exact command or procedure to run, with arguments>
FAILING_BEFORE: <the observed failure on the unproven code, or none>
PASSING_AFTER: <the observed pass on the changed code, or none>
EDGE_CASES: <one boundary case per line, or none>
```

## Review

```text
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

## Constraints

```text
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

## Diagnosis

```text
DIAGNOSIS
SYMPTOM: <the observed failure>
REPRO: <the exact steps that reproduce it on demand>
ROOT_CAUSE: <the mechanism, not the location of the crash>
FIX: <the change that removes the mechanism, or none>
PREVENTION: <the check that stops the same failure returning>
CONFIDENCE: <high|medium|low, matched to the evidence>
```

## Handoff

```text
HANDOFF
STATUS: <where the work stands>
CHANGED: <one file or component per line, or none>
VERIFIED: <one verified claim with its check per line, or none>
NOT_VERIFIED: <one unverified claim per line, or none>
RISKS: <one known hazard per line, or none>
OPEN_ITEMS: <one unresolved item per line, or none>
NEXT_ACTION: <the single next step>
```
