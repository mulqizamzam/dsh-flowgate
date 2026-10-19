import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { SKILLS_DIR, shippedSkills } from './catalog.js'
import { loadContracts, validateArtifactChain } from './contracts.js'
import { loadWorkflows } from './workflows.js'
import { composeWorkflow } from './flow.js'

export const name = 'dsh-flowgate'
export const inject = ['skills', 'commands']

const DRY_RUN_FLAG = /(?:^|\s)--dry-run(?=\s|$)/

export async function apply(ctx) {
  const contracts = loadContracts()
  const workflows = loadWorkflows()
  for (const [workflowName, workflow] of workflows) {
    validateArtifactChain(workflow, contracts.contracts, `workflow ${workflowName}`)
  }
  registerCommands(ctx, contracts, workflows)
  await warnOnShadowedSkills(ctx)
}

/**
 * Own every flowgate command in one effect, registered before apply's first
 * await.
 *
 * Two properties are load-bearing. Registering after an await lets an
 * interrupted or re-entrant generation keep a partial command set alive while
 * the next generation inserts into the same global layer, so a reload can
 * collide with its own residue; and one effect makes teardown atomic, so a
 * fiber never leaves half its commands behind. A name already owned by another
 * plugin is reported and skipped: a single collision must not silently take
 * down the other commands.
 */
function registerCommands(ctx, contracts, workflows) {
  ctx.effect(function* () {
    const definitions = shippedSkills().map(skill => ({
      name: skill,
      description: `Load ${skill} skill.`,
      handler: invocation => loadSkill(ctx, invocation, skill),
    }))
    definitions.push({
      name: 'flowgate',
      description: 'Compose a workflow from the request.',
      input: { hint: 'describe the work; add --dry-run to preview without steering' },
      handler: invocation => runFlow(ctx, invocation, contracts, workflows),
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
    ctx.logger.warn(`flowgate: command "/${definition.name}" is already registered; the existing owner is kept`)
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

async function runFlow(ctx, invocation, contracts, workflows) {
  const rawInput = invocation.rawInput
  const dryRun = DRY_RUN_FLAG.test(rawInput)
  const request = rawInput.replace(DRY_RUN_FLAG, ' ').trim()
  try {
    const composed = await composeWorkflow(request, { ctx, contracts, workflows })
    if (dryRun) {
      return { kind: 'success', text: dryRunText(composed) }
    }
    steer(invocation.agent, composed.message)
    return { kind: 'success', text: `flowgate: steered ${composed.workflow.name} (${composed.stages.length} stages)` }
  } catch (error) {
    return { kind: 'error', text: `flowgate: ${errorMessage(error)}` }
  }
}

function dryRunText(composed) {
  const lines = [
    `WORKFLOW: ${composed.workflow.name} — ${composed.workflow.description}`,
    'Stage order:',
  ]
  for (const [index, stage] of composed.stages.entries()) {
    const bodyBytes = Buffer.byteLength(stage.definition.content, 'utf8')
    lines.push(`${index + 1}. ${stage.skill} (${stage.required ? 'required' : 'optional'}) — Artifact: ${stage.artifact} — body ${bodyBytes} bytes`)
  }
  const artifacts = ['user-request', ...composed.stages.map(stage => stage.artifact)]
  lines.push(`Artifact flow: ${artifacts.join(' -> ')}`)
  if (composed.skipped.length > 0) {
    lines.push(`Skipped: ${composed.skipped.join(', ')}`)
  }
  lines.push(`Definition of done: ${composed.workflow.completion}`)
  lines.push('Dry run: the agent was not steered.')
  return lines.join('\n')
}

function steer(agent, text) {
  agent.steer(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

async function warnOnShadowedSkills(ctx) {
  const skillsRoot = realpathSync(SKILLS_DIR)
  for (const skill of shippedSkills()) {
    let definition
    try {
      definition = await ctx.skills.get(skill)
    } catch (error) {
      ctx.logger.warn(`flowgate: skill "${skill}" could not be resolved: ${errorMessage(error)}`)
      continue
    }
    if (definition === undefined) {
      ctx.logger.warn(`flowgate: skill "${skill}" is not served by any provider`)
      continue
    }
    if (definition.path !== join(skillsRoot, skill, 'SKILL.md')) {
      ctx.logger.warn(`flowgate: skill "${skill}" is shadowed by provider "${definition.provider}"`)
    }
  }
}

function errorMessage(error) {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}
