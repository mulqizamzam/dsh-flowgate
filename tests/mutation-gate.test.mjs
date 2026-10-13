import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { SKILLS_DIR, shippedSkills } from '../lib/catalog.js'

const PROVIDER_NAME = 'flowgate'
const MUTATION_DIR = fileURLToPath(new URL('fixtures/mutation/', import.meta.url))
const SKILL_LOAD_SOURCE = fileURLToPath(new URL('skill-load.test.mjs', import.meta.url))

const CASES = [
  { path: 'no-frontmatter.md', outcome: 'dropped' },
  { path: 'Bad_Name/SKILL.md', outcome: 'dropped' },
  { path: 'no-description/SKILL.md', outcome: 'dropped' },
  { path: 'mismatch-dir/SKILL.md', outcome: 'loads', name: 'real-name' },
]

async function loadCatalog(root) {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    providerName: PROVIDER_NAME,
    includeDefaultRoots: false,
    customSkillDirs: [root],
    watch: false,
  })
  const candidates = await ctx.skills.list({ cwd: process.cwd() })
  const definitions = []
  for (const candidate of candidates) {
    const definition = await ctx.skills.get(candidate.name)
    if (definition !== undefined) definitions.push(definition)
  }
  return { candidates, definitions }
}

test('skill-load.test.mjs contains a mutation probe covering all four cases', () => {
  const source = readFileSync(SKILL_LOAD_SOURCE, 'utf8')
  assert.ok(source.includes('MUTATION_PROBE_CASES'), 'skill-load.test.mjs must define the mutation probe')
  for (const probeCase of CASES) {
    assert.ok(source.includes(`'${probeCase.path}'`), `the probe must cover ${probeCase.path}`)
    assert.ok(source.includes(`'${probeCase.outcome}'`), `the probe must record outcome ${probeCase.outcome}`)
  }
  assert.ok(source.includes('real-name'), 'the probe must name the surviving frontmatter name')
})

test('every mutation probe fixture exists on disk', () => {
  for (const probeCase of CASES) {
    assert.equal(existsSync(fileURLToPath(new URL(`fixtures/mutation/${probeCase.path}`, import.meta.url))), true, `${probeCase.path} fixture missing`)
  }
})

test('the mutation probe outcomes hold against the host loader', async () => {
  const { candidates, definitions } = await loadCatalog(MUTATION_DIR)
  const names = candidates.map(candidate => candidate.name)
  for (const probeCase of CASES) {
    if (probeCase.outcome === 'dropped') continue
    assert.equal(names.includes(probeCase.name), true, `${probeCase.path} must load as ${probeCase.name}`)
  }
  for (const name of names) {
    assert.equal(CASES.some(probeCase => probeCase.outcome === 'dropped' && probeCase.path.includes(name)), false, `dropped case ${name} survived the loader`)
  }
  const survivor = definitions.find(definition => definition.name === 'real-name')
  assert.notEqual(survivor, undefined, 'the mismatched-directory fixture must load')
  assert.equal(survivor.content.length > 0, true, 'the surviving skill must carry its body')
})

test('the probe fixture root never shadows the shipped skills', async () => {
  const { candidates } = await loadCatalog(MUTATION_DIR)
  const shipped = new Set(shippedSkills(SKILLS_DIR))
  for (const candidate of candidates) {
    assert.equal(shipped.has(candidate.name), false, `fixture survivor "${candidate.name}" collides with a shipped skill`)
  }
  assert.deepEqual(candidates.map(candidate => candidate.name), ['real-name'])
})
