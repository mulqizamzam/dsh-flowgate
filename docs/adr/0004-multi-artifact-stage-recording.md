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

## Live confirmation

The host was restarted on 2026-10-22 and serves the new code, and a live
run against it recorded two stage artifacts from one assistant message.

Run `run-mvjk2h8t19` (workflow `investigation`, four stages: `intent`,
`research` optional, `recover`, `handoff`) recorded four artifacts:

| Artifact | Stage | `created_at` | Status |
| --- | --- | --- | --- |
| `art-mvjl18e33c` | intent | 2026-10-22T13:34:09.331Z | invalid |
| `art-mvjl1nvs3g` | intent | 2026-10-22T13:34:29.416Z | invalid |
| `art-mvjlbnf84a` | intent | 2026-10-22T13:42:15.376Z | valid |
| `art-mvjlbnfc4f` | recover | 2026-10-22T13:42:15.376Z | invalid |

The gates ended at `intent=passed`, `research=pending`
(`STAGE_OPTIONAL_SKIPPED`), `recover=failed` (`ARTIFACT_SCHEMA_INVALID`) and
`handoff=pending`, which was never checked. The three gates that were
checked carry one identical `checked_at`, 2026-10-22T13:42:15.376Z, and the
run status is `failed`.

The third and fourth artifacts carry one identical `created_at`,
2026-10-22T13:42:15.376Z, and they came from one assistant message: the
session transcript shows a single message carrying the standalone marker
lines `INTENT`, `DIAGNOSIS` and `HANDOFF` and three `## EVIDENCE` headings.
The controller recorded the `Intent` artifact and then the `Diagnosis`
artifact from that message. The `Handoff` artifact in the same message was
not recorded: the walk stopped at the first stage that does not pass, and
the `recover` gate failed. The run advanced past stage 1 in that one
message.

What this confirms: the multi-artifact recording model runs live. One
assistant message recorded two artifacts, and the run moved past stage 1 in
that message.

What this does not confirm: a multi-artifact message whose stages all pass.
The `Diagnosis` artifact was recorded but its gate failed, so the message
never produced a fully passing second stage. The refusal path was not
exercised either: the `Handoff` artifact was not recorded because the walk
stopped at the failed stage, not because it was refused as premature.

Two agent-side defects showed up, and they are what the gates are there to
catch. The agent repeated the `FACTS` line in its evidence block, so the
first two `Intent` artifacts were recorded invalid and the run failed; it
recovered after a corrective prompt. It then wrote a sentence into the
enumerated `CONFIDENCE` field, which the `Diagnosis` contract rejected.

One caveat on the observation: the artifact-producing turns ran on
`nine-router` with `oc/minimax-m3.1-flash-free(thinking)`, not on the
profile's default route. The earlier turns died at the provider — the
default `kgw/minimax/minimax-m3.1-flash:free(thinking)` route returned a
503 after that model's free launch period ended, and the `deepseek-official`
routes returned 404 — and the verification session's model was switched to
complete the run.

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

- Done: the live run was observed. Run `run-mvjk2h8t19` recorded two
  artifacts from one assistant message, both stamped
  2026-10-22T13:42:15.376Z, and the run advanced past stage 1 in that
  message. ADR 0002's live-validation section records the observation.
- Open: a multi-artifact message whose every stage passes has not been
  observed. The run above recorded the `Diagnosis` artifact from the same
  message, but its gate failed, so the walk stopped there and the `Handoff`
  artifact in that message was never recorded. Watch a run whose stages all
  pass and record the result in ADR 0002's live-validation section.
