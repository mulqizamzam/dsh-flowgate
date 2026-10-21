# Evidence protocol

Every stage artifact ends with one evidence block. The block is the contract that
makes a stage's completion checkable: without it, a stage output is a claim, and
claims are what this plugin exists to replace.

## When the block is required

The block is required on every stage output, on all ten stages, with no
exceptions and no stages exempt. It is the last section of the artifact. A stage
whose artifact arrives without the block has not completed that stage, and the
composed workflow message says so in the header, in every stage block, and in the
footer.

The block is also terminal: a stage artifact must end with the evidence block,
because a heading after it means the artifact continues into material the gate
does not read.

## Several artifacts in one message

An assistant message may carry more than one stage artifact. Each artifact then
ends with its own evidence block, and the artifact ends where the next artifact
marker starts. The controller records the artifacts in stage order and stops at
the first stage that does not pass, so a later artifact whose prerequisite did
not pass is refused rather than recorded early.

A message that carries several artifacts may declare the evidence of each of
them: `EVIDENCE_RECORD` lines are matched to the contract of the stage that is
being recorded, and a declaration that belongs to another stage of the same
workflow is not an error.

## When a field may be empty

Never. An empty field is written as `none`. A field holding `none` is a statement
that the category has no entries, which is itself checkable; a blank or missing
field is indistinguishable from an unfinished artifact, and an unfinished
artifact cannot be verified.

## Block shape

```text
## EVIDENCE
FACTS:
  - <observation that is directly checkable>
ASSUMPTIONS:
  - <claim taken as true without proof>
PROOF:
  - <command run, output observed, or artifact inspected>
UNKNOWN:
  - <question that remains open>
DECISION:
  - <choice made and the alternative rejected>
```

The five field names appear in this order, in a single `## EVIDENCE` block. The
block ends at the next `##` heading or the end of the artifact.

## Why the FACTS / ASSUMPTIONS distinction is the entire point

Everything else in the protocol follows from one separation: what was observed
versus what was taken as true. FACTS are observations a reader can re-check —
command output that was pasted, a file that was read, a behavior that was
witnessed. ASSUMPTIONS are claims carried without proof — version equivalences,
environment behaviors, intent readings.

An agent that confuses the two fails in one specific way: it reports its beliefs
with the confidence of its observations, and no later stage can tell which parts
of the artifact were ever checked. Mixing them does not make the artifact slightly
weaker; it removes the only signal the next stage has for deciding what to
re-verify. The same discipline separates PROOF (what was run and observed) from
UNKNOWN (what remains open), and forces DECISION to name the alternative that was
rejected, so a reviewer can attack the choice rather than guess at it.
