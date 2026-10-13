import { loadContracts, validateArtifactChain } from './contracts.js'
import { composeWorkflowMessage, assertRequestSize } from './flow-compose.js'
import { selectWorkflow } from './flow-select.js'
import { loadWorkflows } from './workflows.js'

export async function composeWorkflow(request, options = {}) {
  assertRequestSize(request)
  const workflows = options.workflows ?? loadWorkflows()
  const contracts = options.contracts ?? loadContracts()
  const name = selectWorkflow(request, workflows)
  const workflow = workflows.get(name)
  if (workflow === undefined) {
    throw new Error(`flow: selected workflow "${name}" is not loaded`)
  }
  const catalog = options.catalog ?? options.ctx?.skills
  if (catalog === undefined) {
    throw new Error('flow: no skill catalog available to resolve stages')
  }
  const stages = []
  const skipped = []
  for (const stage of workflow.stages) {
    const definition = await resolveStage(catalog, stage.skill)
    if (definition === undefined) {
      if (stage.required) {
        throw new Error(`flow: required stage "${stage.skill}" failed to resolve`)
      }
      if (workflow.on_optional_missing === 'fail') {
        throw new Error(`flow: optional stage "${stage.skill}" failed to resolve and on_optional_missing is "fail"`)
      }
      skipped.push(stage.skill)
      continue
    }
    const contract = contracts.contracts[stage.skill]
    if (contract === undefined) {
      throw new Error(`flow: stage "${stage.skill}" has no contract entry`)
    }
    stages.push({
      skill: stage.skill,
      purpose: stage.purpose,
      required: stage.required,
      artifact: contract.produces[0],
      provider: definition.provider,
      definition,
    })
  }
  validateArtifactChain(workflow, contracts.contracts, `workflow ${workflow.name}`)
  const message = composeWorkflowMessage({ workflow, stages, request, skipped })
  return { message, workflow, name, stages, skipped }
}

async function resolveStage(catalog, skill) {
  try {
    return await catalog.get(skill)
  } catch {
    return undefined
  }
}
