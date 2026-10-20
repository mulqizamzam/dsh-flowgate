import { loadContracts, validateArtifactChain } from './contracts.js'
import { assertRequestSize, composeWorkflowMessage, composedBytes } from './flow-compose.js'
import { routeWorkflow } from './flow-select.js'
import { loadWorkflows } from './workflows.js'
import { buildPlanGraph, validateGraph } from './graph.js'
import { FlowgateError, CODES } from './errors.js'

/**
 * Resolve a request into a workflow, its resolvable stages, the stage contracts,
 * and a validated dependency graph. This is the only preflight path used by both
 * execution and dry-run.
 */
export async function composeWorkflow(request, options = {}) {
  assertRequestSize(request)
  const workflows = options.workflows ?? loadWorkflows()
  const contracts = options.contracts ?? loadContracts()
  const route = routeWorkflow(request, workflows)
  const workflow = workflows.get(route.selected)
  if (workflow === undefined) {
    throw new FlowgateError(CODES.WORKFLOW_INVALID, `flow: selected workflow "${route.selected}" is not loaded`)
  }
  const catalog = options.catalog ?? options.ctx?.skills
  if (catalog === undefined) {
    throw new FlowgateError(CODES.HOST_CAPABILITY_UNAVAILABLE, 'flow: no skill catalog is available to resolve stages')
  }
  validateArtifactChain(workflow, contracts.contracts, `workflow ${workflow.name}`)
  const stages = []
  const skipped = []
  for (const stage of workflow.stages) {
    const definition = await resolveStage(catalog, stage.skill)
    if (definition === undefined) {
      if (stage.required) {
        throw new FlowgateError(CODES.HOST_CAPABILITY_UNAVAILABLE, `flow: required stage "${stage.skill}" failed to resolve`)
      }
      if (workflow.on_optional_missing === 'fail') {
        throw new FlowgateError(CODES.WORKFLOW_INVALID, `flow: optional stage "${stage.skill}" failed to resolve and on_optional_missing is "fail"`)
      }
      skipped.push(stage.skill)
      continue
    }
    const contract = contracts.contracts[stage.skill]
    if (contract === undefined) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `flow: stage "${stage.skill}" has no contract entry`)
    }
    stages.push({
      skill: stage.skill,
      purpose: stage.purpose,
      required: stage.required,
      artifact: contract.produces[0],
      contract,
      provider: definition.provider,
      definition,
    })
  }
  validateResolvedChain(stages, contracts.contracts, `workflow ${workflow.name}`)
  const graph = buildPlanGraph(workflow, contracts.contracts)
  validateGraph(graph)
  const message = composeWorkflowMessage({ workflow, stages, request, skipped })
  return {
    message,
    workflow,
    name: route.selected,
    route,
    stages,
    skipped,
    graph,
    contracts,
    bytes: composedBytes(message),
  }
}

function validateResolvedChain(stages, contracts, source) {
  const available = new Set(['user-request'])
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index]
    const contract = contracts[stage.skill]
    if (contract === undefined) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: stage ${index + 1} "${stage.skill}" has no contract`)
    }
    for (const required of contract.requires) {
      if (!available.has(required)) {
        throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: stage ${index + 1} "${stage.skill}" requires "${required}", not produced by any prior stage or the user request`)
      }
    }
    if (contract.requires_any.length > 0 && !contract.requires_any.some(artifact => available.has(artifact))) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: stage ${index + 1} "${stage.skill}" requires at least one of [${contract.requires_any.join(', ')}], none available`)
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
