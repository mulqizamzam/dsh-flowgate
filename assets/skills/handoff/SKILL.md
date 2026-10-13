---
name: handoff
description: "Produce a compact state for takeover: changed, verified, not verified, next. Use when ending a session, pausing work, or handing work to another agent."
produces: Handoff
risk_level: low
---

# handoff

## Purpose

The handoff stage compresses the session state into a takeover-ready record. It produces the Handoff artifact. The record separates what changed, what was verified by running something, what was not, and the single next action, so the next session starts from evidence instead of memory.

## Artifact

The stage is complete when the following block has been emitted:

```
HANDOFF
STATUS: <where the work stands>
CHANGED: <one file or component per line, or none>
VERIFIED: <one verified claim with its check per line, or none>
NOT_VERIFIED: <one unverified claim per line, or none>
RISKS: <one known hazard per line, or none>
OPEN_ITEMS: <one unresolved item per line, or none>
NEXT_ACTION: <the single next step>
```

## Evidence block

The artifact ends with an `## EVIDENCE` block containing FACTS, ASSUMPTIONS, PROOF, UNKNOWN, DECISION, in that order. An empty field is written as `none`. A handoff artifact without a complete block fails this stage.

## Failure modes

1. **Selective memory** — VERIFIED claims with no recorded run behind them.
2. **Silent gap** — NOT_VERIFIED written as none while unverified work exists.
3. **Risk omission** — RISKS written as none while known hazards exist.
4. **Action drift** — NEXT_ACTION that does not follow from OPEN_ITEMS.
5. **Status inflation** — STATUS claims progress the artifacts do not show.
