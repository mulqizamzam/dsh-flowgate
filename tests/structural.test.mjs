import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse as parseYaml } from 'yaml'
import { ARTIFACT_FIELDS_FILE, SCHEMAS_DIR, SKILLS_DIR, WORKFLOWS_DIR, shippedSkills } from '../lib/catalog.js'
import { loadContracts } from '../lib/contracts.js'
import { loadWorkflows } from '../lib/workflows.js'
import { loadArtifactFields } from '../lib/artifact.js'
import { derivedCounts } from '../lib/counts.js'
import { GATE_ORDER, gateFile } from '../lib/gates.js'

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_FILE_BYTES = 24000
const pluginRoot = fileURLToPath(new URL('../', import.meta.url))
const testsRoot = fileURLToPath(new URL('./', import.meta.url))

const contracts = loadContracts()
const workflows = loadWorkflows()
const artifactFields = loadArtifactFields()

function skillFiles() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ name: entry.name, file: join(SKILLS_DIR, entry.name, 'SKILL.md') }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function parseFrontmatter(raw, file) {
  const lines = raw.split('\n')
  assert.equal(lines[0].replace(/\r$/, ''), '---', `${file}: first line must be ---`)
  const closing = lines.findIndex((line, index) => index > 0 && line.replace(/\r$/, '') === '---')
  assert.notEqual(closing, -1, `${file}: frontmatter closing --- missing`)
  const data = parseYaml(lines.slice(1, closing).join('\n'))
  assert.equal(typeof data, 'object', `${file}: frontmatter must parse to an object`)
  assert.notEqual(data, null, `${file}: frontmatter must parse to an object`)
  return data
}

test('the plugin ships exactly 8 skills, 5 workflows, 9 commands, and 18 gates', () => {
  assert.equal(shippedSkills(SKILLS_DIR).length, 8)
  assert.equal(workflows.size, 5)
  const counts = derivedCounts()
  assert.equal(counts.commands, 9)
  assert.equal(counts.aliases, 8)
  assert.equal(counts.gates, 18)
  assert.equal(GATE_ORDER.length, 18)
})

test('every shipped skill file respects the 24000 byte size limit', () => {
  for (const { name, file } of skillFiles()) {
    const size = statSync(file).size
    assert.ok(size <= MAX_FILE_BYTES, `${file}: ${size} bytes exceeds the ${MAX_FILE_BYTES} byte limit (${name})`)
  }
})

test('every shipped skill parses with a kebab-case name matching its directory', () => {
  for (const entry of skillFiles()) {
    const data = parseFrontmatter(readFileSync(entry.file, 'utf8'), entry.file)
    assert.equal(typeof data.name, 'string', `${entry.file}: frontmatter name must be a string`)
    assert.ok(KEBAB_CASE.test(data.name), `${entry.file}: name "${data.name}" is not kebab-case`)
    assert.equal(data.name, entry.name, `${entry.file}: frontmatter name does not match directory name`)
  }
})

test('every skill description names its use and stays within 400 characters', () => {
  for (const entry of skillFiles()) {
    const data = parseFrontmatter(readFileSync(entry.file, 'utf8'), entry.file)
    assert.equal(typeof data.description, 'string', `${entry.file}: description must be a string`)
    assert.ok(data.description.includes('Use when'), `${entry.file}: description must contain "Use when"`)
    assert.ok(data.description.length <= 400, `${entry.file}: description is over 400 characters`)
  }
})

test('every skill frontmatter matches its v2 contract', () => {
  for (const entry of skillFiles()) {
    const data = parseFrontmatter(readFileSync(entry.file, 'utf8'), entry.file)
    const contract = contracts.contracts[entry.name]
    assert.notEqual(contract, undefined, `${entry.file}: no contract entry for skill "${entry.name}"`)
    assert.equal(data.produces, contract.produces[0], `${entry.file}: produces must equal contract produces[0]`)
    assert.ok(contracts.vocabulary.risk_levels.includes(data.risk_level), `${entry.file}: risk_level is not in the vocabulary`)
  }
})

test('every artifact type has a field specification', () => {
  for (const contract of Object.values(contracts.contracts)) {
    for (const artifact of contract.produces) {
      assert.notEqual(artifactFields.fields[artifact], undefined, `artifact "${artifact}" has no field specification`)
      assert.ok(existsSync(ARTIFACT_FIELDS_FILE))
      assert.ok(artifactFields.fields[artifact].required.length > 0, `artifact "${artifact}" declares no required fields`)
    }
  }
})

test('every declared gate file exists and the runner order matches the PRD order', () => {
  assert.deepEqual(GATE_ORDER, [
    'structural',
    'json-schema',
    'host-capabilities',
    'skill-load',
    'contracts',
    'workflows',
    'dependency-graph',
    'artifact-registry',
    'evidence-registry',
    'transition-rules',
    'invalidation',
    'checkpoint',
    'recovery-safety',
    'routing',
    'composition-security',
    'persistence',
    'report-and-command-e2e',
    'live-host-verification',
  ])
  for (const name of GATE_ORDER) {
    assert.ok(existsSync(join(testsRoot, `${name}.test.mjs`)), `missing gate file ${gateFile(name)}`)
  }
})

test('every versioned data schema exists', () => {
  // 10 original v1 schemas + 7 new v2 schemas
  const expected = [
    'Artifact',
    'Checkpoint',
    'DependencyEdge',
    'Evidence',
    'Report',
    'RunState',
    'StageContract',
    'artifact-fields',
    'artifact-record',
    'checkpoint',
    'contracts-file',
    'dependency-edge',
    'evidence-record',
    'run-report',
    'run-state',
    'stage-contract',
    'workflow',
  ]
  const present = readdirSync(SCHEMAS_DIR).filter(name => name.endsWith('.schema.json')).map(name => name.replace('.schema.json', '')).sort()
  assert.deepEqual(present, expected)
})

test('the README counts region matches the derived counts', () => {
  const readme = readFileSync(join(pluginRoot, 'README.md'), 'utf8')
  const counts = derivedCounts()
  const labels = [
    ['Skills', counts.skills],
    ['Workflows', counts.workflows],
    ['Contracts', counts.contracts],
    ['Alias commands', counts.aliases],
    ['Commands', counts.commands],
    ['Artifact types', counts.artifacts],
    ['Test gates', counts.gates],
  ]
  for (const [label, value] of labels) {
    assert.ok(readme.includes(`| ${label} | ${value} |`), `README is missing or has a stale row: ${label}=${value}`)
  }
})

test('the workflows directory holds exactly five JSON files', () => {
  const files = readdirSync(WORKFLOWS_DIR).filter(name => name.endsWith('.json')).sort()
  assert.deepEqual(files, ['bugfix.json', 'feature.json', 'investigation.json', 'migration.json', 'release.json'])
})

test('docs and references required by the PRD exist', () => {
  for (const relative of [
    'docs/host-capability-matrix.md',
    'docs/adr/0001-persistence-and-enforcement.md',
    'assets/references/artifact-schemas.md',
    'assets/references/evidence-protocol.md',
    'schemas/run-state.schema.json',
  ]) {
    assert.ok(existsSync(join(pluginRoot, relative)), `missing ${relative}`)
  }
})
