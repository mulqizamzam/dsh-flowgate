# Security checklist

Checks for the boundaries this plugin actually owns. Each item names what to
verify and where the behavior is enforced.

## Request boundaries

- The user request embedded in a composed message carries no `<skill_content`,
  `</skill_content`, `## EVIDENCE`, or `STAGE <n> of <m>` occurrence; each is
  replaced with `[redacted-marker]`. Enforced in `lib/flow-compose.js`
  (`sanitizeRequest`), tested in `tests/injection.test.mjs`.
- A user request over 8192 bytes is rejected with an error naming the limit, not
  truncated. Enforced in `lib/flow-compose.js` (`assertRequestSize`), tested in
  `tests/injection.test.mjs` and `tests/flow-command.test.mjs`.
- A composed message over 40960 bytes is rejected. Enforced in
  `lib/flow-compose.js`, tested in `tests/flow-compose.test.mjs`.

## Skill body boundaries

- The composer never modifies, summarizes, reorders, or truncates a skill body;
  the `<skill_content>` block is byte-identical to the host's
  `renderSkillContent()` output. Enforced in `lib/flow-compose.js`, tested in
  `tests/verbatim-render.test.mjs`.
- The host loader drops malformed skill files (no frontmatter, non-kebab-case
  name, missing description), and the mutation probe proves the three drops plus
  the directory/frontmatter mismatch load. Tested in `tests/skill-load.test.mjs`
  and `tests/mutation-gate.test.mjs`.
- Alias commands verify the invocation policy before steering: a skill that is
  not user-invocable fails with an error instead of steering. Enforced in
  `lib/index.js`, tested in `tests/e2e-handler.test.mjs`.

## Execution boundaries

- Command handlers steer text and return a result; they execute no repository
  code, make no network calls, and read no credentials. The only outbound effect
  is `agent.steer()` with the composed message. Enforced in `lib/index.js`.
- Every `/flow` invocation steers exactly once; `--dry-run` never steers.
  Tested in `tests/flow-command.test.mjs`.
- Stage resolution failures abort with an error naming the skill; a missing
  optional stage is dropped and recorded under Skipped. Enforced in `lib/flow.js`.

## Data boundaries

- No telemetry, analytics, or metrics of any kind. No network calls in `lib/` or
  `assets/`.
- All shipped JSON carries `schema_version: 1` and is read by a strict reader
  that rejects duplicate keys. Enforced in `lib/json-file.js`, tested in
  `tests/workflows.test.mjs`.
- The plugin's skills are served only through the explicit `customSkillDirs`
  entry in `cordis.patch.yml`; no default project or user skill roots are
  included. `scripts/verify-live.sh` checks the path exists and points at the
  plugin, exiting 11 with the exact value to substitute when it does not.
