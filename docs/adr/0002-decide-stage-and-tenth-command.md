# ADR 0002 — A ninth skill (`decide`), a tenth command, and published evidence ids

- **Status:** accepted
- **Context version:** engine 2.0.0, state schema 2, contract version 2
- **Supersedes:** PRD §1 (envelope counts), §6.1 (skill table), §6.2 (stage order of
  `feature`, `migration`, and `release`), §6.3 (nine command registrations), §6.4
  (artifact fields)

## Context

The eight shipped skills record what the operator wants (`intent`), what may
change (`spec`), how the work is cut up (`slice`), whether it works (`prove`),
what is wrong with it (`review`), what quality bar applies (`constrain`), what
broke (`recover`), and where the work stands (`handoff`).

None of them records **a choice**: which option was picked over which others,
on what property it won, what it costs, and what would reopen it. That
reasoning normally lives in the chat of the session that made the decision and
dies with it. The next session inherits the artifact (`SPEC` says what the
interfaces are) but not the argument, so it re-opens a settled question,
re-litigates a rejected alternative, or silently drifts from a constraint that
was never written down.

The gap is visible in the shipped data, not just in practice:

- `assets/artifact-fields.json` declares eight artifact types, and none of them
  has a field for the alternatives considered or the reason one was chosen.
- `assets/workflows/*.json` route a request through five workflows, and no stage
  in any of them produces such a record.

Two constraints shaped the implementation:

1. `lib/index.js` registers one alias command per directory in `assets/skills/`,
   so a ninth skill directory becomes a tenth command. PRD §6.3 says to keep
   exactly nine command registrations unless an ADR approves a replacement, and
   PRD §0 states that an ADR is the mechanism that supersedes a PRD section.
2. The composed workflow message never published the contract's evidence ids.
   An agent holding only the composed message could not know which ids to
   declare in an `EVIDENCE_RECORD` line, so the `evidence_current` check could
   not pass for any stage whose contract declares evidence. The ids were only
   visible in `assets/contracts.json` and in the `--dry-run` output, neither of
   which the agent sees while a run is executing.

## Decision 1 — `decide` is a ninth stage skill with its own contract

- **Artifact.** `Decision` with the fields `CONTEXT`, `OPTIONS`, `CHOSEN`,
  `RATIONALE`, `REJECTED`, `CONSEQUENCES`, `REVISED_BY`.
- **Contract.** `decide` in `assets/contracts.json`: produces `Decision`,
  requires the `Intent` artifact, category `decide`, risk `low`, side effects
  `read_only` / `safe_idempotent`.
- **Evidence.** Two declarations: `options_recorded` (the options and the
  choice) and `rationale_recorded` (the rationale, the rejected alternatives,
  the consequences, the reopening condition). `rationale_recorded` accepts
  `observed_command` and `observed_tool` provenance, so a rationale backed by a
  measurement is recorded as measured rather than asserted.
- **Binding.** The contract binds both evidence records to the `Intent`
  artifact, so a changed intent marks the decision stale instead of letting a
  decision about the old intent look current.

Alternatives rejected: folding the fields into `Spec` (a spec states what
builds; it does not carry a rejected-option record, and the drift between the
two would be invisible); a free-form "notes" artifact (an artifact with no
required fields cannot fail, which is the opposite of this plugin's premise);
recording the decision only in the handoff (the handoff closes a run; it is
too late to inform the stage that follows the choice).

## Decision 2 — `decide` is wired in as an optional stage of three workflows

- `feature` and `migration` gained `decide` between `intent` and `spec`, marked
  `required: false`. A run that has more than one viable approach emits the
  artifact; a run with one surviving approach omits it, and the controller marks
  the stage skipped when the workflow advances.
- `release` gained `decide` between `constrain` and `prove`, also optional: a
  release picks a rollout path, and the reasoning for that pick belongs in the
  run rather than in the chat that chose it.
- `release` also gained a required `intent` stage. The `decide` contract
  requires a valid `Intent` artifact, and `release` produced none, so the
  artifact-chain validator (`lib/contracts.js`) would have rejected the
  workflow. A release run now states what is being released before the quality
  bar is written, which also gives the release handoff an intent to refer to.
- Each of the three workflows gained the rule that says when the stage is
  emitted and when it is omitted.
- `bugfix` and `investigation` are untouched: a diagnosis reacts to an event
  that already happened, and the bugfix workflow already starts at `recover`.

Alternatives rejected: making the stage required (a forced decision on a
one-line change is ceremony, and the plugin's `optional` mechanism exists for
exactly this); dropping the `Intent` requirement from the `decide` contract so
that `release` would not need an `intent` stage (that would have removed the
Intent-to-decision binding, and with it the invalidation link that marks a
decision about an old intent stale — a worse trade than one extra stage);
adding it to every workflow (the same ceremony in workflows where no choice is
made).

## Decision 3 — A tenth command is registered, and PRD §6.3 is superseded here

- `/decide` is registered beside the eight existing aliases, so the skill is
  reachable on its own and not only inside a composed workflow.
- PRD §6.3's "exactly nine command registrations" is superseded by this ADR for
  the `decide` alias. The rule against proliferating top-level commands is
  otherwise unchanged: `/flowgate` still expresses every orchestration behavior,
  and `decide` is one more stage skill, not a second orchestration surface.
- PRD §1, §6.1, §6.2, and §6.4 are updated in the same change, so the shipped
  PRD and the shipped code state the same envelope: 9 skills, 9 contracts, 9
  artifact types, 5 workflows, 9 alias commands, 10 commands.

Alternatives rejected: shipping `decide` as a workflow-only stage with no
command (reachable only through `/flowgate`, which makes the skill unusable for
the standalone question "which of these two should we do?"); skipping the ADR
and leaving the PRD claiming nine commands while the code registers ten.

## Decision 4 — The composed stage block publishes the contract's evidence ids

- Every stage block in the composed message now carries one line:
  `Required evidence: <id> (<type>), <id> (<type>)`, listing the evidence ids
  the agent has to declare for that stage, with their contract types.
- The ids are read from the resolved contract at composition time
  (`lib/flow-compose.js`), never from a skill body. A body therefore cannot
  declare an id the gate will not accept, and the contract cannot change
  without the message changing with it.
- Operator-input evidence is not listed: the controller synthesizes it from the
  recorded request, so there is nothing for the agent to declare. A stage whose
  contract has no declarable evidence shows `Required evidence: none`.
- The `decide` skill body no longer hardcodes its evidence ids for the same
  reason. It keeps one sentence stating that a measured rationale should
  declare the command that produced it.
- PRD §7.11 now states this as a requirement of the composed message.

Alternatives rejected: hardcoding the ids in each of the nine skill bodies (the
bodies would drift from the contracts, which is exactly the class of drift this
plugin exists to prevent, and nine copies of the same list to keep in sync);
publishing the whole contract in the stage block (the dry run already prints it
in full, and the message has a 40 KiB budget to respect).

## Live validation (2026-10-21)

The decisions above were validated against the running host, not only against the
test suite.

- The running host served the new plugin code from the linked workspace with no
  restart: `/decide` was present in the host command registry, and
  `/flowgate --dry-run "add a rate limiter"` listed `2. decide (optional) —
  Artifact: Decision`, with the contract's two evidence records, in a six-stage
  feature plan.
- The composed message that actually reached the agent carried the new line:

  ```text
  STAGE 2 of 6: decide
  Purpose: Record the chosen approach, the alternatives it beat, and what would reopen it.
  Produces: Decision
  Required: no
  Required evidence: options_recorded (declared_evidence), rationale_recorded (declared_evidence)
  ```

  The `intent` stage, whose only evidence is synthesized by the controller,
  carried `Required evidence: none`.
- `/decide "untuk rate limiter di API publik: token bucket in-memory atau
  Redis?"` made a real agent produce a Decision artifact. Condensed, it read:

  ```text
  DECISION
  CONTEXT: the operator asked one narrow question — token bucket in-memory, or Redis? — and it forces a choice because the store decides what the plugin owes the operator at runtime.
  OPTIONS: In-memory token bucket inside the plugin process, keyed per session id plus a second global per-instance bucket …
  CHOSEN: In-memory token bucket inside the plugin process, keyed per session id plus a global per-instance bucket, covering only the run-creating and run-advancing paths …
  RATIONALE: It wins on the property that matters for this threat model — bounding a runaway agent loop on one machine needs no shared state …
  REJECTED: Redis-backed token bucket — it buys cross-process sharing this threat model never needs …
  CONSEQUENCES: The plugin gains no runtime dependency, no external service requirement and no network I/O on the command path. …
  REVISED_BY: The decision reopens if the operator needs one budget shared by two concurrently running host processes …

  ## EVIDENCE
  FACTS: The plugin's runtime dependency set is exactly two packages …
  EVIDENCE_RECORD: {"id": "options_recorded", "type": "declared_evidence", "result": "declared"}
  EVIDENCE_RECORD: {"id": "rationale_recorded", "type": "declared_evidence", "result": "declared"}
  ```

- Feeding that artifact back through the plugin's own controller recorded it and
  passed the gate: `stage: decide`, `gate: passed`, `reasons: []`, artifact
  `valid / current`, and both evidence records `current`. The agent had read the
  evidence ids from the plugin's contracts file in its workspace, not from the
  skill body, which no longer names them.

### Finding from the same validation

A live `/flowgate` run stopped after its first stage: `intent=passed`,
`decide=pending`, with the later artifacts never recorded. The cause is not the
new stage. The controller records one stage artifact per assistant message and
Flowgate never steers the agent again to ask for the next stage, so an agent
that emits every artifact in one final message leaves the remaining gates
`pending` forever. Runs in the same state directory that did complete
(`intent`, `recover`, `handoff` all passed) were runs whose agent emitted each
artifact in its own message. This limit is now stated in the README's known
limitations; changing the recording model is a separate change.

## Consequences

- Positive: the reasoning behind a design becomes a gated artifact with
  evidence, a fingerprint, and invalidation — a change to the intent now marks
  the decision stale rather than leaving a settled question looking settled.
- Positive: `REVISED_BY` gives the record a reopening condition, which is what
  stops a decision from hardening into an unquestioned premise.
- Positive: a stage can now be completed by an agent that holds only the
  composed message, because the message carries the ids the gate will check.
- Negative: the composed message for `feature` and `migration` grew by one
  skill body, `release` grew by two stages, and every run has one more stage
  to skip.
- Negative: the `release` workflow gained a required stage, so a release run
  now starts with an intent artifact it did not need before.
- Negative: the PRD envelope changed. Any consumer that hard-coded "8 skills"
  or "9 commands" — `scripts/verify-live.sh` and the count rows in the README
  among them — must be updated in the same change, and did.

## Not in scope

- The `decide` contract requires an `Intent` artifact, so a workflow without an
  `intent` stage cannot host it. Making that requirement optional would need a
  contract-level "optional dependency" that the stage contract schema does not
  have; it is a schema change, not a workflow change, and it belongs in its own
  ADR.
- Per-project artifact overrides remain out of scope, as they were in v1.

## Follow-up

- Record every stage artifact an assistant message contains, instead of only the
  first one, so a run whose agent emits all artifacts at once is not left with
  `pending` gates. The live validation above is the evidence for this item; the
  change touches `lib/controller.js` and the observer, and deserves its own
  change with a test that fails on the current recording model.
  **Done in ADR 0004** (`docs/adr/0004-multi-artifact-stage-recording.md`).
- If `release` ever needs a second decision point (for example the rollback
  path chosen after a failed canary), the `decide` stage can be repeated only
  after the contract model allows one stage to produce two artifacts.
- Re-check the composed message size budget after every added stage; the
  `composition-security` gate prints the size of all five workflows.
