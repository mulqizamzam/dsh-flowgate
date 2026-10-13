import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { readJsonFileSync } from './json-file.js'
import { WORKFLOWS_DIR, shippedSkills } from './catalog.js'
import { assertObject, assertSchemaVersion } from './contracts.js'

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ON_OPTIONAL_MISSING = ['skip', 'fail']

export function validateWorkflow(data, source) {
  assertObject(data, `${source}: top level must be an object`)
  assertSchemaVersion(data, source)
  assertNonEmptyString(data.name, `${source}: name must be a non-empty string`)
  if (!KEBAB_CASE.test(data.name)) {
    throw new Error(`${source}: name "${data.name}" is not kebab-case`)
  }
  assertNonEmptyString(data.description, `${source}: description must be a non-empty string`)
  assertObject(data.match, `${source}: match must be an object`)
  validateKeywords(data.match.keywords, source)
  if (!Number.isInteger(data.match.priority)) {
    throw new Error(`${source}: match.priority must be an integer`)
  }
  validateStages(data.stages, source)
  validateRules(data.rules, source)
  assertNonEmptyString(data.completion, `${source}: completion must be a non-empty string`)
  if (!ON_OPTIONAL_MISSING.includes(data.on_optional_missing)) {
    throw new Error(`${source}: on_optional_missing must be one of ${ON_OPTIONAL_MISSING.join(', ')}`)
  }
  return data
}

export function loadWorkflowFile(file, stem) {
  const workflow = validateWorkflow(readJsonFileSync(file), file)
  if (workflow.name !== stem) {
    throw new Error(`${file}: name "${workflow.name}" does not match file stem "${stem}"`)
  }
  return workflow
}

export function loadWorkflows(dir = WORKFLOWS_DIR) {
  const files = readdirSync(dir).filter(name => name.endsWith('.json')).sort()
  const workflows = new Map()
  for (const file of files) {
    const stem = basename(file, '.json')
    const workflow = loadWorkflowFile(join(dir, file), stem)
    workflows.set(workflow.name, workflow)
  }
  return workflows
}

function validateKeywords(keywords, source) {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw new Error(`${source}: match.keywords must be a non-empty array`)
  }
  for (const keyword of keywords) {
    if (typeof keyword !== 'string' || keyword.length === 0) {
      throw new Error(`${source}: match.keywords entries must be non-empty strings`)
    }
  }
}

function validateStages(stages, source) {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error(`${source}: stages must be a non-empty array`)
  }
  const shipped = new Set(shippedSkills())
  const seen = new Set()
  for (const [index, stage] of stages.entries()) {
    assertObject(stage, `${source}: stage ${index + 1} must be an object`)
    if (typeof stage.skill !== 'string' || stage.skill.length === 0) {
      throw new Error(`${source}: stage ${index + 1} skill must be a non-empty string`)
    }
    if (!shipped.has(stage.skill)) {
      throw new Error(`${source}: stage ${index + 1} names unknown skill "${stage.skill}"`)
    }
    if (seen.has(stage.skill)) {
      throw new Error(`${source}: skill "${stage.skill}" appears twice in stages`)
    }
    seen.add(stage.skill)
    if (typeof stage.required !== 'boolean') {
      throw new Error(`${source}: stage ${index + 1} required must be a boolean`)
    }
    assertNonEmptyString(stage.purpose, `${source}: stage ${index + 1} purpose must be a non-empty string`)
  }
}

function validateRules(rules, source) {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error(`${source}: rules must be a non-empty array`)
  }
  for (const rule of rules) {
    if (typeof rule !== 'string') {
      throw new Error(`${source}: rules entries must be strings`)
    }
  }
}

function assertNonEmptyString(value, message) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(message)
  }
}
