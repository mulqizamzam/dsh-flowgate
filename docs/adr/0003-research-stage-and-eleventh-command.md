# ADR 0003 — A tenth skill (`research`), a `Research` artifact, and an eleventh command

- **Status:** accepted
- **Context version:** engine 2.0.0, state schema 2, contract version 2
- **Supersedes:** PRD §1 (envelope counts), §6.1 (skill table), §6.2 (stage order of
  `feature`, `investigation`, and `migration`), §6.3 (ten command registrations),
  §6.4 (artifact fields)

## Context

Nine skills ship today. They record what the operator wants (`intent`), which
approach was chosen (`decide`), what may change (`spec`), how the work is cut up
(`slice`), whether it works (`prove`), what is wrong with it (`review`), what
quality bar applies (`constrain`), what broke (`recover`), and where the work
stands (`handoff`).

None of them records **knowledge that came from outside this repository**.

Every artifact the plugin produces is derived from two input kinds only: the
operator's request, and artifacts derived from this codebase. There is no
artifact type whose value is an external observation, and no field on any
artifact that can name a source:

- `assets/artifact-fields.json` declares nine artifact types, and not one of them
  has a field for a source locator, a finding, or a contradiction.
- Every shipped contract binds its evidence to `user-request` or to a prior
  artifact, so an externally sourced claim has no input it could bind to.
- No workflow has a stage that runs before the choice is made.

The consequence is that research is invisible to the gate. An agent that reads
upstream documentation, checks a dependency's real behavior, or reads a
protocol's specification has exactly one place to put the result: prose inside an
unrelated field — the `RATIONALE` of a Decision, a finding inside a Review. The
controller sees one flat string there. There is no evidence id for the source, no
provenance that separates "I fetched it" from "I remember it", and no input
binding, so a changed intent never marks the researched fact stale and the next
session cannot tell which claims were ever checked.

## Decision 1 — `research` is a tenth stage skill with its own contract

- **Artifact.** `Research` with the fields `QUESTION`, `SOURCES`, `FINDINGS`,
  `CONTRADICTIONS`, `GAPS`, `CONFIDENCE`, `IMPACT`. `CONFIDENCE` is enumerated
  `high`/`medium`/`low`, like the `Diagnosis` artifact's confidence.
- **Contract.** `research` in `assets/contracts.json`: produces `Research`,
  requires the `Intent` artifact, category `research`, risk `low`, side effects
  `read_only` / `safe_idempotent`.
- **Evidence.** Two declarations: `sources_fetched` (the sources and the findings
  they support) and `claims_graded` (the contradictions, the gaps, the
  confidence, and the impact). Both accept `agent_statement`, `observed_command`,
  and `observed_tool` provenance.
- **Binding.** Both evidence records bind to the `Intent` artifact, so a changed
  intent marks the research evidence stale instead of leaving a finding about the
  old question looking current. This is the same binding `decide` uses.

Alternatives rejected: folding the fields into `Spec` (a spec states what builds;
it does not carry a source record, and the drift between the two would be
invisible); a free-form "notes" artifact (an artifact with no required fields
cannot fail, which is the opposite of this plugin's premise); recording research
only in the handoff (the handoff closes a run; it is too late to inform the stage
that follows the finding).

## Decision 2 — `research` is wired in as an optional stage of three workflows

- `feature`, `investigation`, and `migration` gained `research` between `intent`
  and the stage that consumes the answer, marked `required: false`. A run whose
  question this repository can answer emits no artifact, and the controller marks
  the stage skipped when the workflow advances.
- Each of the three workflows gained a rule that says when the stage is emitted
  and when it is omitted.
- `bugfix` and `release` are untouched: `bugfix` starts at `recover` and reacts
  to an event that already happened, `release` concerns the artifact being
  shipped, and the `research` contract requires a valid `Intent` artifact that
  `bugfix` never produces.

Alternatives rejected: making the stage required (a forced literature review on a
one-line change is ceremony, and the plugin's `optional` mechanism exists for
exactly this); adding it to every workflow (the same ceremony in workflows where
nothing external is at stake); letting `research` produce an artifact without
requiring `Intent` (the question being researched is what the intent states, and
without that binding there is nothing to invalidate the findings against).

## Decision 3 — An eleventh command is registered, and PRD §6.3 is superseded here

- `/research` is registered beside the nine existing aliases, so the skill is
  reachable on its own and not only inside a composed workflow.
- PRD §6.3's "exactly ten command registrations" is superseded by this ADR for the
  `research` alias. The rule against proliferating top-level commands is
  otherwise unchanged: `/flowgate` still expresses every orchestration behavior,
  and `research` is one more stage skill, not a second orchestration surface.
- PRD §1, §6.1, §6.2, and §6.4 are updated in the same change, so the shipped
  PRD and the shipped code state the same envelope: 10 skills, 10 contracts, 10
  artifact types, 5 workflows, 10 alias commands, 11 commands.

## Decision 4 — The `Research` artifact is the only place a source locator can live

- `SOURCES` names each source with a locator another reader can open, and
  `FINDINGS` carries only claims a named source supports. The skill body states
  that a claim without a locator is an assumption, and that assumptions belong in
  the `## EVIDENCE` block.
- `CONTRADICTIONS` records disagreements instead of averaging them into one
  confident sentence, and `GAPS` names what was not checked rather than only what
  was not answered.
- `decide` and `spec` now list `Research` among the artifacts they consume, and
  `handoff` lists it too, so the dependency is recorded in the vocabulary.

Alternatives rejected: a free-text `NOTES` field that agents fill in as they
please (the plugin's premise is that a stage output can fail); storing sources in
the `## EVIDENCE` block only (that block is for what was observed here and now,
not for a reading list); inferring sources from URLs found in prose (the plugin
never guesses an artifact's structure).

## Known limitation — research evidence is `agent_statement` in practice

The controller upgrades a declaration to `observed_command` only when a matching
`tool/result` observation exists, and the observation carries the exact command
string the host tool was called with. A web fetch is not a shell command, so a
research artifact normally records `agent_statement` provenance even though the
source was genuinely fetched.

The mitigation is structural rather than mechanical: every source must carry a
locator in `SOURCES`, so a reader can re-fetch it and compare, and the artifact's
fingerprint and invalidation bindings still work. A host that reported fetches as
observations would raise the provenance without any change to this contract.

## Known limitation — the contract model cannot express an optional dependency

`decide` and `spec` consume `Research`, but the dependency graph builds
`derived_from` edges only from `requires` and `requires_any`. Because `research`
is optional, making it a hard requirement would break the workflows where it is
skipped, and there is no "optional dependency" concept in the stage contract
schema. The invalidation path that exists today runs `Intent → Research`: a
changed intent marks the research evidence stale and blocks the research gate.
Adding `Research → Decision` as a graph edge needs a contract-level optional
dependency, which is a schema change, not a workflow change.

## Consequences

- Positive: an external fact can now enter a run only through an artifact that
  names its source, carries an evidence id, and is invalidated when the intent
  it answered changes.
- Positive: `CONTRADICTIONS` and `GAPS` make the shape of the uncertainty
  explicit, which is the difference between a research record and a summary.
- Positive: the workflow rules now say when to research and when not to, so a
  run does not either skip research it needed or perform research it did not.
- Negative: `feature` and `migration` gained a stage, `investigation` gained a
  stage, and every run has one more optional stage to skip.
- Negative: the PRD envelope changed. Any consumer that hard-coded "9 skills" or
  "10 commands" — `scripts/verify-live.sh` and the count rows in the README
  among them — must be updated in the same change, and did.
- Negative: research evidence is `agent_statement` rather than `observed_command`
  until the host reports fetches as observations.

## Not in scope

- The `research` contract requires an `Intent` artifact, so a workflow without an
  `intent` stage cannot host it, exactly like `decide`.
- Per-project artifact overrides remain out of scope, as they were in v1.
- Recording every stage artifact an assistant message contains, instead of only
  the first one, remains an open item from ADR 0002.
