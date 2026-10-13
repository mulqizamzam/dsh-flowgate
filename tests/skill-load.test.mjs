import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { SKILLS_DIR, shippedSkills } from '../lib/catalog.js'

const PROVIDER_NAME = 'flowgate'
const MUTATION_DIR = fileURLToPath(new URL('fixtures/mutation/', import.meta.url))

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

test('every shipped skill loads through the host FileSystemSkillProvider', async () => {
  const { candidates } = await loadCatalog(SKILLS_DIR)
  const loaded = candidates.map(candidate => candidate.name).sort()
  assert.deepEqual(loaded, shippedSkills(SKILLS_DIR))
  for (const candidate of candidates) {
    assert.equal(candidate.provider, PROVIDER_NAME)
  }
})

test('every loaded skill carries its frontmatter description, body, and invocation policy', async () => {
  const { definitions } = await loadCatalog(SKILLS_DIR)
  for (const definition of definitions) {
    const raw = readFileSync(fileURLToPath(new URL(`../assets/skills/${definition.name}/SKILL.md`, import.meta.url)), 'utf8')
    assert.equal(definition.description.includes('Use when'), true, `${definition.name}: description must contain "Use when"`)
    assert.equal(definition.content.length > 0, true, `${definition.name}: body must be non-empty`)
    assert.equal(raw.includes(definition.description), true, `${definition.name}: description must come from frontmatter`)
    assert.equal(definition.invocation.userInvocable, true, `${definition.name}: must be user-invocable`)
  }
})

// MUTATION-PROBE: four malformed inputs fed to the host loader; the first three
// must be dropped, the fourth must load under its frontmatter name.
const MUTATION_PROBE_CASES = [
  { path: 'no-frontmatter.md', outcome: 'dropped' },
  { path: 'Bad_Name/SKILL.md', outcome: 'dropped' },
  { path: 'no-description/SKILL.md', outcome: 'dropped' },
  { path: 'mismatch-dir/SKILL.md', outcome: 'loads', name: 'real-name' },
]

test('the mutation probe drops three malformed skills and loads the mismatched directory', async () => {
  const { candidates } = await loadCatalog(MUTATION_DIR)
  const names = candidates.map(candidate => candidate.name)
  assert.deepEqual(names, ['real-name'], 'only the mismatched-directory case may survive the loader')
})
