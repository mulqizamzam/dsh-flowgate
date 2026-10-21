---
name: research
description: "Gather evidence from outside this repository and record what each source established, where the sources disagree, and what is still unknown. Use when the answer depends on upstream documentation, a dependency's real behavior, a protocol's specification, or any fact the codebase cannot supply."
produces: Research
risk_level: low
---

# research

## Purpose

The research stage turns an open question into a recorded set of findings. It produces the Research artifact. The other stages record what the operator wants, what may change, what was built, and whether it works; none of them records what was learned from outside the codebase, where that knowledge came from, or which part of it is still hearsay. Research that stays in the chat of the session that did it dies with it, and the next session re-reads the same documents and re-asks the same question. This stage keeps it: the question, the sources, what each source established, where they disagree, what is still open, and what the findings change in this run.

## Artifact

The stage is complete when the following block has been emitted:

```
RESEARCH
QUESTION: <the single question this research answers>
SOURCES: <one source per line: its locator and what it established>
FINDINGS: <one established claim per line>
CONTRADICTIONS: <one disagreement between sources per line, or none>
GAPS: <what remains unanswered per line, or none>
CONFIDENCE: <high|medium|low, matched to the evidence>
IMPACT: <what the findings change or confirm in this run>
```

## Evidence block

The artifact ends with an `## EVIDENCE` block containing FACTS, ASSUMPTIONS, PROOF, UNKNOWN, DECISION, in that order. An empty field is written as "none". A research artifact handed to the next stage without a complete block fails this stage.

## Rules

- One question per artifact. A second question is a second artifact, not a second QUESTION line.
- Every source carries a locator another reader can open: a URL, a file path, a version, or the exact command that produced it. A claim without a locator is an assumption, and it belongs in ASSUMPTIONS.
- A statement is a finding only when a named source supports it. "The documentation says" is a finding only when the documentation is named.
- Sources that disagree are recorded in CONTRADICTIONS. They are not averaged into one confident sentence.
- CONFIDENCE describes the evidence, not the reader's feeling: high when primary sources agree, low when a claim rests on one secondary source or one remembered fact.
- GAPS names what was not checked, not only what was not answered.
- The stage block names the evidence ids this stage requires. Declare each one in an `EVIDENCE_RECORD` line, and let the command field carry the exact fetch or command that produced the source.
- When the repository already answers the question, emit no artifact and let the workflow skip this stage.

## Failure modes

1. **Locator-less source** — SOURCES names a claim without the place it came from.
2. **Question drift** — the artifact answers a question the stage was not asked.
3. **Recall as evidence** — a remembered fact is recorded in FINDINGS with no source behind it.
4. **Averaging** — contradicting sources are merged into one confident line instead of being listed.
5. **Confidence inflation** — CONFIDENCE is set above what the cited sources carry.
6. **Coverage as exhaustiveness** — GAPS says "none" while part of the question was never checked.
