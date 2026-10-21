import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { SKILLS_DIR, shippedSkills } from '../lib/catalog.js'
import * as flowgate from '../lib/index.js'
import { tempStateDir } from './helpers.mjs'

const EXPECTED_COMMANDS = ['constrain', 'decide', 'flowgate', 'handoff', 'intent', 'prove', 'recover', 'research', 'review', 'slice', 'spec']
const FOREIGN_OWNER = 'a foreign plugin owns this name'

async function stack({ stateDir = tempStateDir(), withProvider = true } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillRegistry)
  if (withProvider) {
    await ctx.plugin(SkillFileSystem, {
      providerName: 'flowgate',
      includeDefaultRoots: false,
      customSkillDirs: [SKILLS_DIR],
      watch: false,
    })
  }
  const session = ctx.sessions.create(SessionId('flowgate-handler'))
  const steered = []
  const agent = { id: session.id, session, steer: message => steered.push(message) }
  await ctx.plugin(Object.assign(inner => { createScope(inner, agent) }, { inject: ['commands'] }))
  return { ctx, agent, steered, stateDir }
}

async function mount(options = {}) {
  const mounted = await stack(options)
  await mounted.ctx.plugin(flowgate, { stateDir: mounted.stateDir })
  return mounted
}

async function run(ctx, agent, line) {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  assert.notEqual(execution, undefined, `command line did not resolve: ${line}`)
  return execution.result
}

test('all eleven commands register against the host registry', async () => {
  const { ctx, agent } = await mount()
  const descriptors = ctx.commands.list(agent)
  assert.deepEqual(descriptors.map(descriptor => descriptor.name).sort(), EXPECTED_COMMANDS)
})

test('every registered command carries a non-empty description', async () => {
  const { ctx, agent } = await mount()
  for (const descriptor of ctx.commands.list(agent)) {
    assert.equal(typeof descriptor.description === 'string' && descriptor.description.trim().length > 0, true, `${descriptor.name}: description`)
  }
})

test('the flow command advertises an input hint', async () => {
  const { ctx, agent } = await mount()
  const definition = ctx.commands.find(agent, 'flowgate')
  assert.notEqual(definition, undefined)
  assert.equal(typeof definition.input?.hint === 'string' && definition.input.hint.length > 0, true)
})

test('every alias command resolves and steers its own skill', async () => {
  const { ctx, agent, steered } = await mount()
  for (const skill of shippedSkills(SKILLS_DIR)) {
    steered.length = 0
    const result = await run(ctx, agent, `/${skill} handle the ${skill} stage`)
    assert.equal(result.kind, 'success', `${skill}: ${result.text}`)
    assert.equal(steered.length, 1, `${skill}: exactly one steer call`)
    const text = steered[0].content[0].text
    assert.equal(text.includes(`<skill_content name="${skill}">`), true, `${skill}: wrong skill body`)
    assert.equal(steered[0].source.kind, 'user', `${skill}: source metadata`)
  }
})

test('each alias command steers the skill body of its own name only', async () => {
  const { ctx, agent, steered } = await mount()
  const others = shippedSkills(SKILLS_DIR).filter(skill => skill !== 'spec')
  const result = await run(ctx, agent, '/spec pin the boundary')
  assert.equal(result.kind, 'success', result.text)
  const text = steered[0].content[0].text
  assert.equal(text.includes('<skill_content name="spec">'), true)
  for (const other of others) {
    assert.equal(text.includes(`<skill_content name="${other}">`), false, `spec invocation leaked ${other}`)
  }
})

// PROOF: the reported failure — one name already owned elsewhere used to abort
// the whole plugin, taking every command registered after it down as well.
test('a command name already owned elsewhere does not abort flowgate', async () => {
  const { ctx, agent } = await stack()
  ctx.commands.register({
    name: 'review',
    description: FOREIGN_OWNER,
    handler: () => ({ kind: 'success', text: 'foreign' }),
  })

  await ctx.plugin(flowgate)

  const registered = ctx.commands.list(agent).map(descriptor => descriptor.name)
  assert.deepEqual(registered.sort(), [...EXPECTED_COMMANDS].sort())
  assert.equal(ctx.commands.find(agent, 'review').description, FOREIGN_OWNER)
  for (const name of EXPECTED_COMMANDS.filter(candidate => candidate !== 'review')) {
    assert.notEqual(ctx.commands.find(agent, name), undefined, `${name}: must survive an unrelated collision`)
  }
})

test('disposing the flowgate fiber removes every command it claimed', async () => {
  const { ctx, agent } = await stack()
  const fiber = await ctx.plugin(flowgate)
  assert.deepEqual(ctx.commands.list(agent).map(descriptor => descriptor.name).sort(), [...EXPECTED_COMMANDS].sort())

  await fiber.dispose()

  assert.deepEqual(ctx.commands.list(agent).map(descriptor => descriptor.name), [])
})

test('reloading flowgate after a clean dispose registers all eleven commands again', async () => {
  const { ctx, agent } = await stack()
  const first = await ctx.plugin(flowgate)
  await first.dispose()

  await ctx.plugin(flowgate)

  assert.deepEqual(ctx.commands.list(agent).map(descriptor => descriptor.name).sort(), [...EXPECTED_COMMANDS].sort())
})

function runIdOf(text) {
  const match = /flowgate: run ([a-z0-9-]+) started/.exec(text)
  assert.notEqual(match, null, text)
  return match[1]
}

test('a dry run resolves the workflow without creating a run or steering', async () => {
  const { ctx, agent, steered, stateDir } = await mount()
  const result = await run(ctx, agent, '/flowgate --dry-run add a health endpoint')
  assert.equal(result.kind, 'success', result.text)
  assert.match(result.text, /WORKFLOW: feature — /)
  assert.match(result.text, /Routing: /)
  assert.match(result.text, /1\. intent \(required\) — Artifact: Intent/)
  assert.match(result.text, /Dry run: no run was created, no state was written, and the agent was not steered\./)
  assert.equal(steered.length, 0)
  assert.equal(existsSync(join(stateDir, 'runs')), false, 'a dry run must not write state')
})

test('starting a run persists state and steers exactly one composed message', async () => {
  const { ctx, agent, steered, stateDir } = await mount()
  const result = await run(ctx, agent, '/flowgate add a health endpoint')
  assert.equal(result.kind, 'success', result.text)
  assert.match(result.text, /flowgate: run run-[a-z0-9-]+ started — workflow feature, stage 1\/7 intent/)
  assert.equal(steered.length, 1)
  const message = steered[0].content[0].text
  assert.equal(message.startsWith('WORKFLOW\n========'), true)
  assert.match(message, /STAGE 1 of 7: intent/)
  assert.match(message, /STAGE 7 of 7: review/)
  assert.match(message, /## EVIDENCE/)
  const runId = runIdOf(result.text)
  assert.equal(existsSync(join(stateDir, 'runs', runId, 'state.json')), true)
})

test('status, report, and resume read the same persisted state the run recorded', async () => {
  const { ctx, agent, stateDir } = await mount()
  const started = await run(ctx, agent, '/flowgate add a health endpoint')
  const runId = runIdOf(started.text)

  const status = await run(ctx, agent, `/flowgate --status ${runId}`)
  assert.equal(status.kind, 'success', status.text)
  assert.match(status.text, new RegExp(`RUN ${runId}`))
  assert.match(status.text, /Status: running/)
  assert.match(status.text, /Workflow: feature \(7 stages, contract v2\)/)
  assert.match(status.text, /1\. intent \[required\] -> Intent :: gate pending/)
  assert.match(status.text, /Last valid checkpoint: none/)

  const report = await run(ctx, agent, `/flowgate --report ${runId} --json`)
  assert.equal(report.kind, 'success', report.text)
  const parsed = JSON.parse(report.text)
  assert.equal(parsed.run_id, runId)
  assert.equal(parsed.status, 'running')
  assert.equal(parsed.workflow.name, 'feature')
  assert.equal(parsed.stages.length, 7)
  assert.equal(parsed.stages[0].skill, 'intent')
  assert.equal(parsed.stages[1].skill, 'research')
  assert.equal(parsed.stages[1].required, false)
  assert.equal(parsed.stages[2].skill, 'decide')
  assert.equal(parsed.enforcement.level, 'validated')
  assert.equal(parsed.gates.every(gate => gate.status === 'pending'), true)
  assert.deepEqual(parsed.artifacts, [])

  const textReport = await run(ctx, agent, `/flowgate --report ${runId}`)
  assert.equal(textReport.kind, 'success')
  assert.match(textReport.text, new RegExp(`RUN ${runId}`))
  assert.match(textReport.text, /Enforcement: validated \(pre-step: available_not_used\)/)
  assert.match(textReport.text, /Status: running/)
  assert.equal(existsSync(join(stateDir, 'runs', runId, 'state.json')), true)
})

test('resume refuses a run with no valid checkpoint and reports the code', async () => {
  const { ctx, agent } = await mount()
  const started = await run(ctx, agent, '/flowgate add a health endpoint')
  const runId = runIdOf(started.text)
  const result = await run(ctx, agent, `/flowgate --resume ${runId}`)
  assert.equal(result.kind, 'error')
  assert.match(result.text, /RESUME_BLOCKED/)
  assert.match(result.text, /no valid checkpoint exists/)
})

test('an unknown or repeated option is refused instead of guessed', async () => {
  const { ctx, agent, steered } = await mount()
  const unknown = await run(ctx, agent, '/flowgate --deploy add a health endpoint')
  assert.equal(unknown.kind, 'error')
  assert.match(unknown.text, /COMMAND_INVALID: unknown \/flowgate option "--deploy"/)
  const repeated = await run(ctx, agent, '/flowgate --status a --status b')
  assert.equal(repeated.kind, 'error')
  assert.match(repeated.text, /repeated/)
  const both = await run(ctx, agent, '/flowgate --dry-run --status x')
  assert.equal(both.kind, 'error')
  assert.match(both.text, /only one of/)
  assert.equal(steered.length, 0)
})

test('a status request for an unknown run fails closed', async () => {
  const { ctx, agent } = await mount()
  const result = await run(ctx, agent, '/flowgate --status run-does-not-exist')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /RUN_NOT_FOUND/)
})
