# ADR 0001 — Persistence and enforcement level

- **Status:** accepted
- **Context version:** engine 2.0.0, state schema 2, contract version 2

## Context

v2 needs durable run state (artifacts, evidence, gates, checkpoints,
invalidations) and a credible answer to "can Flowgate stop an agent that keeps
working after a failed gate?" The DSH plugin API offers:

- `session/event` — an observer stream for `assistant/message`, `tool/call`, and
  `tool/result`.
- `agent/pre-step` — a hook that can reject a step.
- Commands, skills, steering.
- No plugin state-directory service and no tool-boundary denial hook.

Two decisions had to be made together, because the enforcement we can honestly
claim depends on what we persist and when.

## Decision 1 — Persistence is plugin-owned, per-run, atomic, and locked

- **Location.** `config.stateDir` > `DSH_FLOWGATE_STATE_DIR` > `$DSH_HOME/flowgate-state`,
  resolved once in `lib/persistence.js`. There is no host API to ask, so the order
  is documented instead of guessed.
- **Layout.** `<stateDir>/runs/<run-id>/state.json` plus a transient `state.lock`.
  One file per run keeps a write small and makes a run independently movable.
- **Envelope.** `{ "schema_version": 2, "checksum": "sha256:...", "state": {...} }`.
  The checksum is a canonical digest of `state`. A body that has been edited
  outside the plugin fails the guard and is reported as `STATE_CORRUPT` rather than
  loaded with silent differences.
- **Write path.** Write a sibling temp file, `fsync`, `rename` over the target,
  then `fsync` the directory. A crash leaves either the previous file or the new
  one, never a half-written file.
- **Concurrency.** `withRunLock` opens `state.lock` with `O_EXCL`; a concurrent
  writer gets `STATE_LOCKED` instead of interleaving. A lock older than 60 seconds
  is treated as stale and recovered, so a killed process cannot wedge a run
  forever.
- **Validation before write.** The controller validates the whole run against
  `schemas/run-state.schema.json` before persisting. An invalid shape raises
  `VALIDATOR_ERROR` and leaves the previous file untouched; there is no path that
  writes state the loader would later reject.
- **Migration.** A `schema_version: 1` envelope is migrated deterministically:
  status becomes `blocked`, every legacy gate becomes `blocked`, every artifact
  becomes `present` with `needs_revalidation` freshness, every evidence record
  becomes `needs_revalidation`, and a `STATE_MIGRATED` error is recorded. v1
  records are never assumed current. Any other unknown version is refused with
  `STATE_VERSION_UNSUPPORTED`.

Alternatives rejected: one global JSON file (whole-file rewrite on every update,
larger blast radius, harder lock semantics); SQLite (a native dependency for a
plugin that runs in a JS host, plus a second schema to migrate); trusting file
mtime as the source of truth (no integrity check).

## Decision 2 — Enforcement is reported as `validated`, and `agent/pre-step` is not used

- Gates are evaluated from recorded facts: the artifact must satisfy its contract
  and the required evidence must be `current`. The controller never accepts a
  claim (`recorded: true, gate: ...`) without that evaluation.
- The plugin reports `level: 'validated'`, `pre_step: 'available_not_used'`, and
  three explicit limitations in every dry run, status, and report.
- `agent/pre-step` is deliberately **not** subscribed. It can reject a step, but
  it cannot tell a prohibited continuation from the remediation step that a
  failed gate requires. Using it would either block the fix or produce a gate
  that only sometimes blocks — both are worse than an honest label.

Alternatives rejected: claiming `enforced` because a gate status exists;
subscribing to `agent/pre-step` and documenting the false positives; hiding the
limitations in a wiki page instead of the command output.

## Consequences

- Positive: state is crash-safe, tamper-evident, lockable, and migratable; the
  capability document, the report, and the tests all state the same enforcement
  level.
- Positive: the failure modes are named codes (`STATE_CORRUPT`,
  `STATE_VERSION_UNSUPPORTED`, `STATE_LOCKED`, `RESUME_BLOCKED`,
  `SIDE_EFFECT_RETRY_DENIED`) with remediation text, not raw exceptions.
- Negative: a plugin-owned directory must be writable. In a sandbox that only
  allows the workspace, an operator must pass `stateDir` explicitly; the default
  path fails at the first write with a clear filesystem error.
- Negative: `validated` is weaker than `enforced`. The mitigation is disclosure
  plus a composition that states the rule in the header, in every stage block, and
  in the footer, and a checkpoint model that refuses to resume when evidence went
  stale.
- Follow-up if the host later declares a tool-boundary denial hook: add an entry
  to the capability matrix, gate it behind live verification, and only then
  consider raising the level above `validated`.
