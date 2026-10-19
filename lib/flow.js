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
  validateResolvedChain(stages, contracts.contracts, `workflow ${workflow.name}`)
  const message = composeWorkflowMessage({ workflow, stages, request, skipped })
  return { message, workflow, name, stages, skipped }
}

function validateResolvedChain(stages, contracts, source) {
  const available = new Set(['user-request'])
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index]
    const contract = contracts[stage.skill]
    if (contract === undefined) {
      throw new Error(`${source}: stage ${index + 1} "${stage.skill}" has no contract`)
    }
    for (const required of contract.requires) {
      if (!available.has(required)) {
        throw new Error(`${source}: stage ${index + 1} "${stage.skill}" requires "${required}", not produced by any prior stage or the user request`)
      }
    }
    if (contract.requires_any.length > 0) {
      const anyAvailable = contract.requires_any.some(artifact => available.has(artifact))
      if (!anyAvailable) {
        throw new Error(`${source}: stage ${index + 1} "${stage.skill}" requires at least one of [${contract.requires_any.join(', ')}], none available`)
      }
    }
    for (const produced of contract.produces) available.add(produced)
  }
}

async function resolveStage(catalog, skill) {
  try {
    return await catalog.get(skill)
  } catch {
    return undefined
  }
}
