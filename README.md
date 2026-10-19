# dsh-flowgate

Evidence-gated engineering workflows for DeepSeek Harness.

dsh-flowgate is a DSH plugin that enforces evidence-gated engineering workflows.
It is not a catalog of technique guides: it is a protocol that requires a
verifiable artifact at each stage of work before the next stage begins. The agent
cannot claim a stage is complete without producing the artifact that stage is
defined to produce.

The plugin ships 8 skills (Intent, Spec, SlicePlan, Proof, Review, Constraints,
Diagnosis, Handoff), 5 workflows that compose them, 9 slash commands, one
evidence protocol, and strict validation enforced at boot and in CI.

## Install

From the plugin directory:

```sh
dsh plugin --profile web add link:"$PWD"
```

A host restart activates the commands.

## Commands

| Command | Action |
| --- | --- |
| `/intent` | Load intent skill. |
| `/spec` | Load spec skill. |
| `/slice` | Load slice skill. |
| `/prove` | Load prove skill. |
| `/review` | Load review skill. |
| `/constrain` | Load constrain skill. |
| `/recover` | Load recover skill. |
| `/handoff` | Load handoff skill. |
| `/flowgate` | Compose a workflow from the request. |

Each alias command looks up the skill by name, verifies it is user-invocable, and
steers the agent with the skill body plus the user's request. `/flowgate` selects a
workflow from the request, resolves its stages through the host catalog,
validates the artifact chain, and steers exactly one composed message.
`/flowgate --dry-run` prints the resolved workflow, stage order, artifact flow, and
per-stage body size without steering.

## Workflows

| Workflow | Keywords | Stages (required *) |
| --- | --- | --- |
| feature | add, implement, build, create, feature | intent* → spec* → slice* → prove* → review |
| bugfix | fix, broken, regression, crash, bug | recover* → prove* → review* |
| investigation | investigate, why, diagnose, failing, understand | intent* → recover* → handoff* |
| migration | migrate, upgrade, deprecate, port, refactor | intent* → spec* → slice* → prove* → review → handoff* |
| release | release, deploy, ship, production, launch | constrain* → prove* → review* → handoff* |

Selection is pure: the request is tokenized into lowercase whole words, each
workflow counts its keywords present, the highest count wins, ties break on
priority then lexicographically, and no match falls back to investigation. The
bugfix workflow runs prove twice, expressed as a workflow rule rather than a
duplicate stage.

## Evidence protocol

Every artifact ends with an `## EVIDENCE` block containing FACTS, ASSUMPTIONS,
PROOF, UNKNOWN, and DECISION, in that order. An empty field is written as `none`.
Advancing to the next stage without a complete evidence block is a failure of the
current stage. The full protocol is defined in
[assets/references/evidence-protocol.md](assets/references/evidence-protocol.md)
and the artifact schemas in
[assets/references/artifact-schemas.md](assets/references/artifact-schemas.md).

## Development

```sh
npm test                          # 14 gates
node scripts/gen-readme.mjs       # regenerate the counted README region
bash scripts/verify-live.sh       # live host verification
```

`npm test` runs 14 gates: structural, skill-load, mutation-gate, contracts,
workflows, flow-select, flow-compose, flow-command, evidence-protocol,
verbatim-render, injection, and counts (counts runs twice, kept for ordering).
Each gate exits non-zero on failure with a message naming the file and the
violated rule. The mutation probe feeds the host's real skill loader four
malformed inputs and asserts the three invalid ones are dropped and the
directory/frontmatter mismatch loads.

`bash scripts/verify-live.sh` exits 0 when everything is registered, and with a
distinct code per failure class: 10 host web UI unreachable, 11 plugin link or
skills path broken, 12 plugin module failed to load, 13 profile package.json
missing the dependency or bundle entry, 14 catalog count mismatch. The lowest
failing code wins.

## customSkillDirs

`cordis.patch.yml` carries an absolute `customSkillDirs` path because the host
resolves it against its own working directory, not the plugin directory. If the
plugin directory moves, `verify-live.sh` exits 11 and prints the exact value to
substitute in `cordis.patch.yml`.

## Known limitations

- The evidence block can become ritual: an agent may fill it with filler to
  satisfy the format. Nothing mechanical in v1 rejects that. A future version
  may parse the block and reject empty fields.
- v1 composes one steering message per `/flowgate` invocation. The DSH API exposes
  no hook for a plugin to drive a multi-turn stage machine, so gating relies on
  the agent honoring the composed message. The message states the gating rule
  three times (header, per-stage, footer) as mitigation.
- The 8 artifact schemas are opinionated. Operators who disagree with them get
  no override mechanism in v1.

## License

MIT. See [LICENSE](LICENSE).

<!-- COUNTS:BEGIN -->

| Count | Value |
| --- | --- |
| Skills | 8 |
| Workflows | 5 |
| Contracts | 8 |
| Alias commands | 8 |
| Commands | 9 |
| Artifact types | 8 |
| Test gates | 14 |

<!-- COUNTS:END -->
