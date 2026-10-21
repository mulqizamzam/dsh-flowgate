/**
 * Gate 1: structural.test.mjs
 * Skill frontmatter, directories, names, size limits, and required artifact fields validate.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import yaml from 'yaml'

const SKILLS_DIR = join(process.cwd(), 'assets', 'skills')
const WORKFLOWS_DIR = join(process.cwd(), 'assets', 'workflows')
const MAX_SKILL_SIZE = 64 * 1024 // 64 KiB
const MAX_WORKFLOW_SIZE = 32 * 1024 // 32 KiB

test('Gate 1: Structural validation - Skills', async (t) => {
  const skillDirs = readdirSync(SKILLS_DIR).filter(d => statSync(join(SKILLS_DIR, d)).isDirectory())
  
  await t.test('has exactly 9 skills', () => {
    assert.equal(skillDirs.length, 9)
  })

  await t.test('each skill has valid SKILL.md with required frontmatter', () => {
    const requiredFields = ['name', 'description', 'produces', 'risk_level']
    for (const dir of skillDirs) {
      const skillPath = join(SKILLS_DIR, dir, 'SKILL.md')
      const content = readFileSync(skillPath, 'utf-8')
      const frontmatter = content.match(/^---([\s\S]*?)---/)?.[1]
      assert(frontmatter, `Missing frontmatter in ${dir}`)
      const parsed = yaml.parse(frontmatter)
      for (const field of requiredFields) {
        assert.ok(Object.prototype.hasOwnProperty.call(parsed, field), `Missing ${field} in ${dir}`)
      }
      assert.equal(parsed.name, dir)
      assert.ok(['low', 'medium', 'high'].includes(parsed.risk_level), `Invalid risk_level in ${dir}`)
    }
  })

  await t.test('skill content size within limit', () => {
    for (const dir of skillDirs) {
      const skillPath = join(SKILLS_DIR, dir, 'SKILL.md')
      const size = statSync(skillPath).size
      assert.ok(size <= MAX_SKILL_SIZE, `${dir} exceeds size limit: ${size} > ${MAX_SKILL_SIZE}`)
    }
  })

  await t.test('skill artifact fields match PRD §6.1', () => {
    const expectedArtifacts = {
      intent: 'Intent',
      decide: 'Decision',
      spec: 'Spec',
      slice: 'SlicePlan',
      prove: 'Proof',
      review: 'Review',
      constrain: 'Constraints',
      recover: 'Diagnosis',
      handoff: 'Handoff'
    }
    for (const dir of skillDirs) {
      const skillPath = join(SKILLS_DIR, dir, 'SKILL.md')
      const content = readFileSync(skillPath, 'utf-8')
      const frontmatter = content.match(/^---([\s\S]*?)---/)?.[1]
      const parsed = yaml.parse(frontmatter)
      assert.equal(parsed.produces, expectedArtifacts[dir], `${dir} produces mismatch`)
    }
  })
})

test('Gate 1: Structural validation - Workflows', async (t) => {
  const workflowFiles = readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'))
  
  await t.test('has exactly 5 workflows', () => {
    assert.equal(workflowFiles.length, 5)
  })

  await t.test('each workflow has valid JSON with required fields', () => {
    const requiredFields = ['schema_version', 'name', 'description', 'match', 'stages', 'rules', 'on_optional_missing', 'completion']
    for (const file of workflowFiles) {
      const path = join(WORKFLOWS_DIR, file)
      const content = readFileSync(path, 'utf-8')
      const size = statSync(path).size
      assert.ok(size <= MAX_WORKFLOW_SIZE, `${file} exceeds size limit`)
      
      const parsed = JSON.parse(content)
      for (const field of requiredFields) {
        assert.ok(Object.prototype.hasOwnProperty.call(parsed, field), `Missing ${field} in ${file}`)
      }
      assert.equal(parsed.schema_version, 1)
      assert.ok(Array.isArray(parsed.match.keywords))
      assert.ok(typeof parsed.match.priority === 'number')
      assert.ok(Array.isArray(parsed.stages))
      for (const stage of parsed.stages) {
        assert.ok(Object.prototype.hasOwnProperty.call(stage, 'skill'))
        assert.ok(Object.prototype.hasOwnProperty.call(stage, 'required'))
        assert.ok(Object.prototype.hasOwnProperty.call(stage, 'purpose'))
      }
    }
  })

  await t.test('workflow names and keywords match PRD §6.2', () => {
    const expected = {
      'feature.json': { name: 'feature', priority: 60, keywords: ['add', 'implement', 'build', 'create', 'feature'] },
      'bugfix.json': { name: 'bugfix', priority: 75, keywords: ['fix', 'broken', 'regression', 'crash', 'bug'] },
      'investigation.json': { name: 'investigation', priority: 50, keywords: ['investigate', 'why', 'diagnose', 'failing', 'understand'] },
      'migration.json': { name: 'migration', priority: 70, keywords: ['migrate', 'upgrade', 'deprecate', 'port', 'refactor'] },
      'release.json': { name: 'release', priority: 80, keywords: ['release', 'deploy', 'ship', 'production', 'launch'] }
    }
    for (const file of workflowFiles) {
      const path = join(WORKFLOWS_DIR, file)
      const parsed = JSON.parse(readFileSync(path, 'utf-8'))
      const exp = expected[file]
      assert.equal(parsed.name, exp.name)
      assert.equal(parsed.match.priority, exp.priority)
      assert.deepEqual(parsed.match.keywords.sort(), exp.keywords.sort())
    }
  })

  await t.test('stage order matches PRD §6.2', () => {
    const expectedStages = {
      'feature.json': ['intent', 'decide', 'spec', 'slice', 'prove', 'review'],
      'bugfix.json': ['recover', 'prove', 'review'],
      'investigation.json': ['intent', 'recover', 'handoff'],
      'migration.json': ['intent', 'decide', 'spec', 'slice', 'prove', 'review', 'handoff'],
      'release.json': ['intent', 'constrain', 'decide', 'prove', 'review', 'handoff']
    }
    for (const file of workflowFiles) {
      const path = join(WORKFLOWS_DIR, file)
      const parsed = JSON.parse(readFileSync(path, 'utf-8'))
      const stages = parsed.stages.map(s => s.skill)
      assert.deepEqual(stages, expectedStages[file], `${file} stage order mismatch`)
    }
  })
})