import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { SCHEMAS_DIR, SKILLS_DIR, shippedSkills } from './catalog.js'
import { loadSchemas } from './schema.js'
import { loadContracts } from './contracts.js'
import { loadWorkflows } from './workflows.js'
import { loadArtifactFields } from './artifact.js'
import { composeWorkflow } from './flow.js'
import { FlowgateController } from './controller.js'
import { enforcementRecord, hostCapabilityMatrix } from './host.js'
import { FlowgateError, CODES } from './errors.js'
import { MAX_MESSAGE_BYTES, MAX_REQUEST_BYTES } from './flow-compose.js'
import { selectLastValid } from './checkpoint.js'
import { gateFor, latestAttempt } from './state.js'

export const name = 'dsh-flowgate'
export const inject = ['skills', 'commands']

const MODES = new Set(['--dry-run', '--status', '--report', '--resume'])
const OPTIONS = new Set(['--json'])

/**
 * Register the nine skill aliases and the `/flowgate` entry point, then wire
 * the session observer. Commands are claimed before any await so an interrupted
 * load cannot leave a partial command set behind.
 */
export function apply(ctx, config = {}) {
  const schemas = loadSchemas(SCHEMAS_DIR)
  const contracts = loadContracts()
  const workflows = loadWorkflows()
  const artifactFields = loadArtifactFields()
  const capabilities = hostCapabilityMatrix({ commands: ctx.commands, skills: ctx.skills })
  const enforcement = enforcementRecord(capabilities)
  const controller = new FlowgateController({
    stateDir: config?.stateDir,
    workflows,
    contracts,
    artifactFields,
    schemas,
  })
  const dependencies = { contracts, workflows, controller, enforcement, capabilities }
  registerCommands(ctx, dependencies)

  const sessionRuns = new Map()
  const pendingCalls = new Map()
  ctx.on('session/event', (session, event) => {
    try {
      observeSessionEvent({ controller, ctx, sessionRuns, pendingCalls }, session, event)
    } catch (error) {
      ctx.logger?.warn?.(`flowgate: observer ignored an event: ${errorMessage(error)}`)
    }
  })

  void warnOnShadowedSkills(ctx)
}

function registerCommands(ctx, dependencies) {
  ctx.effect(function* () {
    const definitions = shippedSkills().map(skill => ({
      name: skill,
      description: `Load ${skill} skill.`,
      handler: invocation => loadSkill(ctx, invocation, skill),
    }))
    definitions.push({
      name: 'flowgate',
      description: 'Run, inspect, or resume an evidence-gated workflow.',
      input: { hint: '<request> | --dry-run <request> | --status <run-id> | --report <run-id> [--json] | --resume <run-id>' },
      handler: invocation => runFlowCommand(ctx, invocation, dependencies),
    })
    for (const definition of definitions) {
      const dispose = claim(ctx, definition)
      if (dispose !== undefined) yield dispose
    }
  }, 'flowgate: commands')
}

function claim(ctx, definition) {
  try {
    return ctx.commands.register(definition)
  } catch (error) {
    if (!isNameTaken(error)) throw error
    ctx.logger?.warn?.(`flowgate: command "/${definition.name}" is already registered; the existing owner is kept`)
    return undefined
  }
}

function isNameTaken(error) {
  return error instanceof Error
    && error.message.startsWith('command "')
    && error.message.includes('is already registered')
}

async function loadSkill(ctx, invocation, skill) {
  const definition = await ctx.skills.get(skill)
  if (definition === undefined) {
    return { kind: 'error', text: `flowgate: skill "${skill}" is not served by any provider` }
  }
  if (definition.invocation.userInvocable !== true) {
    return { kind: 'error', text: `flowgate: skill "${skill}" is not user-invocable` }
  }
  const request = invocation.rawInput.trim()
  steer(invocation.agent, `${renderSkillContent(definition)}\n\nUser request:\n${request}`)
  return { kind: 'success', text: `flowgate: ${skill} loaded` }
}

/**
 * Deterministic option grammar:
 *   /flowgate <request>
 *   /flowgate --dry-run <request>
 *   /flowgate --status <run-id>
 *   /flowgate --report <run-id> [--json]
 *   /flowgate --resume <run-id>
 * Unknown or repeated flags are rejected rather than guessed.
 */
export function parseFlowgateInput(rawInput) {
  const raw = String(rawInput ?? '').trim()
  const flags = raw.split(/\s+/).filter(token => token.startsWith('--'))
  const modes = flags.filter(flag => MODES.has(flag))
  const options = flags.filter(flag => OPTIONS.has(flag))
  for (const flag of flags) {
    if (!MODES.has(flag) && !OPTIONS.has(flag)) {
      throw new FlowgateError(CODES.COMMAND_INVALID, `unknown /flowgate option "${flag}"`, `Supported: ${[...MODES, ...OPTIONS].join(', ')}`)
    }
  }
  if (new Set(flags).size !== flags.length) {
    throw new FlowgateError(CODES.COMMAND_INVALID, 'a /flowgate option was repeated', 'Pass each option exactly once.')
  }
  if (modes.length > 1) {
    throw new FlowgateError(CODES.COMMAND_INVALID, `only one of ${[...MODES].join(', ')} may be used at a time`)
  }
  if (options.includes('--json') && !modes.includes('--report')) {
    throw new FlowgateError(CODES.COMMAND_INVALID, '--json is only valid with --report')
  }
  if (modes.length === 0) {
    return { mode: 'run', request: raw }
  }
  const mode = modes[0].slice(2)
  const rest = raw.replace(modes[0], ' ').replace(/--json/g, ' ').trim()
  if (mode === 'dry-run') {
    return { mode, request: rest }
  }
  const tokens = rest.split(/\s+/).filter(Boolean)
  if (tokens.length !== 1) {
    throw new FlowgateError(CODES.COMMAND_INVALID, `--${mode} takes exactly one run id`)
  }
  return { mode, runId: tokens[0], json: options.includes('--json') }
}

async function runFlowCommand(ctx, invocation, dependencies) {
  try {
    const parsed = parseFlowgateInput(invocation.rawInput)
    switch (parsed.mode) {
      case 'dry-run':
        return { kind: 'success', text: await dryRun(ctx, parsed.request, dependencies) }
      case 'status':
        return { kind: 'success', text: statusText(dependencies.controller.status(parsed.runId), dependencies) }
      case 'report': {
        const { text } = dependencies.controller.report(parsed.runId, { format: parsed.json ? 'json' : 'text' })
        return { kind: 'success', text }
      }
      case 'resume':
        return resumeRun(ctx, invocation, parsed.runId, dependencies)
      default:
        return startRun(ctx, invocation, parsed.request, dependencies)
    }
  } catch (error) {
    return errorResult(error)
  }
}

async function startRun(ctx, invocation, request, dependencies) {
  if (request === '') {
    throw new FlowgateError(CODES.COMMAND_INVALID, '/flowgate needs a request', `Describe the work, or use --dry-run to preview. Requests are limited to ${MAX_REQUEST_BYTES} bytes.`)
  }
  const composed = await composeWorkflow(request, { ctx, contracts: dependencies.contracts, workflows: dependencies.workflows })
  const sessionId = invocation.agent?.session?.id === undefined ? undefined : String(invocation.agent.session.id)
  const run = dependencies.controller.createRun({
    request,
    sessionId,
    route: composed.route,
    workflow: composed.workflow,
    enforcement: dependencies.enforcement,
  })
  steer(invocation.agent, composed.message)
  const first = run.stages[0]
  return {
    kind: 'success',
    text: [
      `flowgate: run ${run.run_id} started — workflow ${composed.workflow.name}, stage 1/${run.stages.length} ${first?.skill ?? ''}`,
      `Composed ${composed.bytes} bytes from ${composed.stages.length} skill bodies (limit ${MAX_MESSAGE_BYTES}).`,
      `Status: /flowgate --status ${run.run_id}   Report: /flowgate --report ${run.run_id}`,
    ].join('\n'),
  }
}

function resumeRun(ctx, invocation, runId, dependencies) {
  const plan = dependencies.controller.resume(runId)
  const run = dependencies.controller.status(runId)
  const next = plan.stages[0]
  if (next !== undefined) {
    steer(invocation.agent, [
      `RESUME WORKFLOW ${run.workflow.name}`,
      `Checkpoint: ${plan.checkpoint_id} (validated)`,
      `Remaining stages: ${plan.stages.join(' -> ')}`,
      `Start with: ${next}`,
      'Do not repeat stages that already passed under this run.',
    ].join('\n'))
  }
  return {
    kind: 'success',
    text: [
      `flowgate: resumed ${runId} from checkpoint ${plan.checkpoint_id}`,
      `Remaining stages: ${plan.stages.join(', ') || 'none'}`,
      plan.rejected.length > 0 ? `Rejected checkpoints: ${plan.rejected.join(', ')}` : 'Rejected checkpoints: none',
    ].join('\n'),
  }
}

async function dryRun(ctx, request, dependencies) {
  if (request === '') {
    throw new FlowgateError(CODES.COMMAND_INVALID, '--dry-run needs a request to route')
  }
  const composed = await composeWorkflow(request, { ctx, contracts: dependencies.contracts, workflows: dependencies.workflows })
  return dryRunText(composed, dependencies)
}

export function dryRunText(composed, dependencies) {
  const lines = [
    `WORKFLOW: ${composed.workflow.name} — ${composed.workflow.description}`,
    `Routing: ${composed.route.reason}`,
    `Scores: ${composed.route.scores.map(entry => `${entry.workflow}=${entry.score}${entry.selected ? '*' : ''}`).join(' ')}`,
    `Fallback: ${composed.route.fallback ? 'yes (no keyword matched)' : 'no'}`,
    '',
    'Stages:',
  ]
  for (const [index, stage] of composed.stages.entries()) {
    const bodyBytes = Buffer.byteLength(stage.definition.content, 'utf8')
    lines.push(`${index + 1}. ${stage.skill} (${stage.required ? 'required' : 'optional'}) — Artifact: ${stage.artifact} — Provider: ${stage.provider} — body ${bodyBytes} bytes`)
    lines.push(`   contract v${stage.contract.contract_version} — inputs: ${[...stage.contract.requires, ...stage.contract.requires_any.map(ref => `any(${ref})`)].join(', ') || 'none'}`)
    lines.push(`   evidence: ${stage.contract.evidence.map(requirement => `${requirement.id}:${requirement.type} [${requirement.accepted_provenance.join('|')}]`).join(', ') || 'none'}`)
    lines.push(`   checks: ${stage.contract.checks.map(check => check.type).join(', ')}`)
    lines.push(`   side effects: ${stage.contract.side_effects.class}/${stage.contract.side_effects.retry_policy}`)
  }
  const ordering = composed.graph.edges.filter(edge => edge.kind === 'ordering').length
  const derived = composed.graph.edges.filter(edge => edge.kind !== 'ordering').length
  lines.push(
    '',
    `Dependency graph: ${composed.graph.nodes.length} nodes, ${composed.graph.edges.length} edges (${derived} dependency, ${ordering} ordering-only)`,
    `Expected invalidation: a changed dependency revalidates its graph descendants; ordering edges never invalidate.`,
    `Composed message: ${composed.bytes} bytes (limit ${MAX_MESSAGE_BYTES}); request limit ${MAX_REQUEST_BYTES} bytes`,
    `Enforcement available now: ${dependencies.enforcement.level} (pre-step: ${dependencies.enforcement.pre_step})`,
  )
  if (composed.skipped.length > 0) lines.push(`Skipped (unresolvable optional stages): ${composed.skipped.join(', ')}`)
  for (const limitation of dependencies.enforcement.limitations) lines.push(`Limitation: ${limitation}`)
  lines.push('Dry run: no run was created, no state was written, and the agent was not steered.')
  return lines.join('\n')
}

export function statusText(run, dependencies) {
  const lines = [
    `RUN ${run.run_id}`,
    `Status: ${run.status}`,
    `Workflow: ${run.workflow.name} (${run.workflow.stage_count} stages, contract v${run.workflow.contract_version})`,
    `Detail: /flowgate --report ${run.run_id}`,
    'Stages:',
  ]
  for (const stage of run.stages) {
    const gate = gateFor(run, stage.skill)
    const attempt = latestAttempt(run, stage.skill)
    lines.push(`  ${stage.position}. ${stage.skill} [${stage.required ? 'required' : 'optional'}] -> ${stage.artifact} :: gate ${gate.status} (attempt ${attempt?.state ?? 'none'})`)
    for (const reason of gate.reasons) lines.push(`     - ${reason.code}: ${reason.message}`)
  }
  const current = run.evidence.filter(record => record.status === 'current').length
  lines.push(
    `Artifacts: ${run.artifacts.length} (valid ${run.artifacts.filter(record => record.status === 'valid').length}, needs revalidation ${run.artifacts.filter(record => record.freshness.status !== 'current').length})`,
    `Evidence: ${run.evidence.length} (current ${current})`,
    `Invalidations: ${run.invalidations.length}  Checkpoints: ${run.checkpoints.length}`,
  )
  const selection = selectLastValid(run, { contracts: dependencies.contracts })
  lines.push(`Last valid checkpoint: ${selection.checkpoint?.checkpoint_id ?? 'none'}`)
  lines.push(`Completion: ${run.completion.status}${run.completion.reasons.length > 0 ? ` — ${run.completion.reasons.join('; ')}` : ''}`)
  if (run.errors.length > 0) {
    lines.push('Errors:')
    for (const error of run.errors) lines.push(`  ${error.code}: ${error.message}`)
  }
  return lines.join('\n')
}

function observeSessionEvent({ controller, ctx, sessionRuns, pendingCalls }, session, event) {
  const sessionId = String(session?.id ?? '')
  if (sessionId === '') return
  let runId = sessionRuns.get(sessionId)
  if (runId === undefined) {
    const run = controller.findActiveRun(sessionId)
    if (run === undefined) return
    runId = run.run_id
    sessionRuns.set(sessionId, runId)
  }
  const data = event?.data ?? {}
  if (event.type === 'tool/call') {
    pendingCalls.set(`${sessionId}:${String(data.callId)}`, {
      name: data.name,
      arguments: data.arguments,
    })
    return
  }
  if (event.type === 'tool/result') {
    const callId = `${sessionId}:${String(data.message?.toolCallId ?? '')}`
    const call = pendingCalls.get(callId)
    if (call === undefined) return
    pendingCalls.delete(callId)
    const command = extractCommand(call.arguments)
    if (command === undefined) return
    controller.recordObservation(runId, {
      command,
      exit_code: null,
      is_error: data.message?.isError === true,
      excerpt: messageText(data.message),
    })
    return
  }
  if (event.type !== 'assistant/message') return
  if (data.interrupted === true) return
  const text = messageText(data.message)
  if (!text.includes('## EVIDENCE')) return
  const result = controller.recordStageOutput(runId, text)
  if (result.recorded === true) {
    for (const stage of result.stages ?? []) {
      ctx.logger?.info?.(`flowgate: recorded ${stage.stage} artifact ${stage.artifact_id} — gate ${stage.gate}`)
    }
  }
  if (result.rejected !== undefined) {
    ctx.logger?.warn?.(`flowgate: ${result.rejected.code}: ${result.rejected.message}`)
  }
}

function messageText(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

/** Extract the exact command string a tool call asked to run, when it carries one. */
export function extractCommand(argumentsText) {
  if (typeof argumentsText !== 'string' || argumentsText.trim() === '') return undefined
  let parsed
  try {
    parsed = JSON.parse(argumentsText)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  for (const key of ['command', 'cmd', 'script', 'input']) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim() !== '') return value
    if (Array.isArray(value) && value.every(item => typeof item === 'string') && value.length > 0) {
      return value.join(' ')
    }
  }
  return undefined
}

function steer(agent, text) {
  agent.steer(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

function errorResult(error) {
  if (error instanceof FlowgateError) {
    const remediation = error.remediation === undefined ? '' : `\nRemediation: ${error.remediation}`
    return { kind: 'error', text: `flowgate: ${error.code}: ${error.message}${remediation}` }
  }
  return { kind: 'error', text: `flowgate: ${CODES.VALIDATOR_ERROR}: ${errorMessage(error)}` }
}

function warnOnShadowedSkills(ctx) {
  return (async () => {
    let skillsRoot
    try {
      skillsRoot = realpathSync(SKILLS_DIR)
    } catch {
      return
    }
    for (const skill of shippedSkills()) {
      let definition
      try {
        definition = await ctx.skills.get(skill)
      } catch (error) {
        ctx.logger?.warn?.(`flowgate: skill "${skill}" could not be resolved: ${errorMessage(error)}`)
        continue
      }
      if (definition === undefined) {
        ctx.logger?.warn?.(`flowgate: skill "${skill}" is not served by any provider`)
        continue
      }
      if (definition.path !== join(skillsRoot, skill, 'SKILL.md')) {
        ctx.logger?.warn?.(`flowgate: skill "${skill}" is shadowed by provider "${definition.provider}"`)
      }
    }
  })().catch(error => ctx.logger?.warn?.(`flowgate: shadow check failed: ${errorMessage(error)}`))
}

function errorMessage(error) {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}
