# Evidence protocol

Every stage artifact ends with one evidence block. The block is the contract that
makes a stage's completion checkable: without it, a stage output is a claim, and
claims are what this plugin exists to replace.

## When the block is required

The block is required on every stage output, on all eight stages, with no
exceptions and no stages exempt. It is the last section of the artifact. A stage
whose artifact arrives without the block has not completed that stage, and the
composed workflow message says so in the header, in every stage block, and in the
footer.

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
