import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { readJsonFileSync } from './json-file.js'
import { WORKFLOWS_DIR, SCHEMAS_DIR, shippedSkills } from './catalog.js'
import { loadSchemas, validateValue } from './schema.js'
import { FlowgateError, CODES } from './errors.js'

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function validateWorkflow(data, source, schemas = loadSchemas(SCHEMAS_DIR)) {
  const schema = schemas.get('workflow')
  if (schema === undefined) {
    throw new FlowgateError(CODES.WORKFLOW_INVALID, `${source}: schemas/workflow.schema.json is not installed`)
  }
  const result = validateValue(data, schema, schema)
  if (!result.ok) {
    const first = result.errors[0]
    throw new FlowgateError(CODES.WORKFLOW_INVALID, `${source}: ${first.message} at ${first.path}`)
  }
  if (!KEBAB_CASE.test(data.name)) {
    throw new FlowgateError(CODES.WORKFLOW_INVALID, `${source}: name "${data.name}" is not kebab-case`)
  }
  const shipped = new Set(shippedSkills())
  const seen = new Set()
  for (const [index, stage] of data.stages.entries()) {
    if (!shipped.has(stage.skill)) {
      throw new FlowgateError(CODES.WORKFLOW_INVALID, `${source}: stage ${index + 1} names unknown skill "${stage.skill}"`)
    }
    if (seen.has(stage.skill)) {
      throw new FlowgateError(CODES.WORKFLOW_INVALID, `${source}: skill "${stage.skill}" appears twice in stages`)
    }
    seen.add(stage.skill)
  }
  return data
}

export function loadWorkflowFile(file, stem, schemas = loadSchemas(SCHEMAS_DIR)) {
  const workflow = validateWorkflow(readJsonFileSync(file), file, schemas)
  if (workflow.name !== stem) {
    throw new FlowgateError(CODES.WORKFLOW_INVALID, `${file}: name "${workflow.name}" does not match file stem "${stem}"`)
  }
  return workflow
}

export function loadWorkflows(dir = WORKFLOWS_DIR, schemas = loadSchemas(SCHEMAS_DIR)) {
  const files = readdirSync(dir).filter(name => name.endsWith('.json')).sort()
  const workflows = new Map()
  for (const file of files) {
    const stem = basename(file, '.json')
    const workflow = loadWorkflowFile(join(dir, file), stem, schemas)
    workflows.set(workflow.name, workflow)
  }
  return workflows
}

/** Review policy derived from the workflow: required unless the review stage is optional/absent. */
export function reviewRequired(workflow) {
  const stage = workflow.stages.find(entry => entry.skill === 'review')
  return stage !== undefined && stage.required
}
