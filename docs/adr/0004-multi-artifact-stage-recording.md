# ADR 0004 — One assistant message may record several stage artifacts

- **Status:** accepted
- **Context version:** engine 2.0.0, state schema 2, contract version 2
- **Implements:** the follow-up recorded in ADR 0002 ("record every stage
  artifact an assistant message contains")
- **Supersedes:** the README's "the session observer records at most one stage
  artifact per assistant message"

## Context

ADR 0002 validated the `decide` skill against the running host and, while
reading the recording path, exposed a limit in it.

The controller records one stage artifact per assistant message: it matches the
first pending stage whose artifact marker appears in the message, records it,
and ignores the rest of the message.

The live run showed what that limit does and does not do. The run recorded its
`Intent` artifact at 02:02:59Z and its `Decision` artifact at 02:12:29Z — nine
and a half minutes apart, in two separate assistant messages, because the agent
kept working between them. The run advanced one stage at a time for as long as
the agent took, and the pause seen from the outside (`intent=passed`,
`decide=pending`) was the agent's turn, not the recorder. A run that stalls
this way is waiting for the agent.

What the limit does break is the other message shape, and that shape is
common: an agent that writes its whole answer — prose plus every artifact — in
one final message advances the run by exactly one stage, and every artifact
after the first in that message is ignored. The stage that follows then waits
for a message that never comes, because Flowgate does not steer the agent for
the next stage.

Two things blocked the fix.

1. **The parser read across artifacts.** `parseStageOutput` searched for the
   first `## EVIDENCE` heading after the artifact marker, with no upper bound.
   With two artifacts in one message, the first artifact's evidence block
   swallowed the second artifact's fields, so the block parsed as incomplete and
   the first stage failed.
2. **Evidence declarations collided.** `buildStageEvidence` refused every
   `EVIDENCE_RECORD` the current stage's contract did not require. A message
   carrying the `decide` artifact therefore failed the `intent` stage for
   declaring `options_recorded` — evidence that belongs to another stage of the
   same workflow.

## Decision

- **One message, many artifacts.** The controller walks the artifacts a message
  carries, in stage order, and records each one. The walk stops at the first
  stage that does not pass, and at the first artifact whose required
  prerequisite did not pass.
- **An artifact ends at the next artifact marker.** `parseStageOutput` takes
  the run's artifact markers and bounds the artifact — its fields and its
  evidence block — at the next marker, so two artifacts in one message cannot
  bleed into each other.
- **Evidence is scoped to the workflow.** A declaration the contract of the
  stage being recorded does not require is an error only when no contract of
  this run's workflow requires it. A declaration that belongs to another stage
  is left for that stage.
- **A refusal keeps what was recorded.** When a later artifact is premature,
  the artifacts already recorded in that message stand, and the refusal is
  reported with its code (`STAGE_INPUT_MISSING`) and its message. Nothing is
  silently dropped.
- **The return value names every stage.** `recordStageOutput` returns
  `stages[]`, one entry per recorded stage, and keeps `stage`, `artifact_id`,
  `gate`, and `reasons` pointing at the last recorded stage, so a caller that
  cares about one stage needs no change. A refusal appears in `rejected`.

Alternatives rejected: re-steering the agent after each accepted stage (it
costs a turn per stage and changes how the plugin talks to the host, for a
problem the recording model can solve locally); asking the agent to send one
artifact per message (the plugin does not control the agent's message shape);
recording artifacts in the order they appear in the text (it would break the
dependency model, where a later stage's artifact depends on an earlier one
being valid).

## Consequences

- Positive: an agent that emits every artifact at once advances the run by
  every stage it completed, instead of exactly one.
- Positive: the refusal path stays explicit. An artifact whose prerequisite did
  not pass is reported, not recorded early.
- Positive: the tests that fail under the old model are the regression tests
  for this one — one message carrying two artifacts records both; a premature
  later artifact is refused while the first stands; a failed stage stops the
  walk.
- Negative: `parseStageOutput` now takes the run's markers. A caller that does
  not pass them keeps the old single-artifact behavior.
- Negative: the controller can record several artifacts from one assistant
  message, so one message can now produce several checkpoints.

## Not in scope

- Flowgate still does not steer the agent for the next stage. An agent that
  emits only the first artifact and then stops still leaves the later gates
  `pending`; the README says so.
- The `EVIDENCE_RECORD` lines of a stage that never produced an artifact stay
  unrecorded.

## Follow-up

- Watch a live run once the host picks this change up, and record in ADR 0002's
  live-validation section whether a run now advances past stage 1.
