import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { SKILLS_DIR, SCHEMAS_DIR } from '../lib/catalog.js'
import { FlowgateController } from '../lib/controller.js'
import { loadContracts } from '../lib/contracts.js'
import { enforcementRecord, hostCapabilityMatrix, capabilitySummary } from '../lib/host.js'
import { loadArtifactFields } from '../lib/artifact.js'
import { loadSchemas } from '../lib/schema.js'
import { loadWorkflows } from '../lib/workflows.js'
import * as flowgate from '../lib/index.js'
import { LOGIN_COMMAND, recordDiagnosis, recordIntent, tempStateDir } from './helpers.mjs'

const LIVE_SESSION = 'flowgate-live'

async function mountLive() {
  const stateDir = tempStateDir('flowgate-live-')
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    providerName: 'flowgate',
    includeDefaultRoots: false,
    customSkillDirs: [SKILLS_DIR],
    watch: false,
  })
  const session = ctx.sessions.create(SessionId(LIVE_SESSION))
  const steered = []
  const agent = { id: session.id, session, steer: message => steered.push(message) }
  await ctx.plugin(Object.assign(inner => { createScope(inner, agent) }, { inject: ['commands'] }))
  await ctx.plugin(flowgate, { stateDir })
  return { ctx, session, agent, steered, stateDir }
}

async function runCommand(ctx, agent, line) {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  assert.notEqual(execution, undefined, `command line did not resolve: ${line}`)
  return execution.result
}

function runIdOf(text) {
  const match = /flowgate: run ([a-z0-9-]+) started/.exec(text)
  assert.notEqual(match, null, text)
  return match[1]
}

function controllerFor(stateDir) {
  return new FlowgateController({
    stateDir,
    workflows: loadWorkflows(),
    contracts: loadContracts(),
    artifactFields: loadArtifactFields(),
    schemas: loadSchemas(SCHEMAS_DIR),
  })
}

function emitToolCall(ctx, session, callId, command) {
  ctx.emit('session/event', session, {
    type: 'tool/call',
    data: { callId, name: 'bash', arguments: JSON.stringify({ command }) },
  })
}

function emitToolResult(ctx, session, callId, { isError, excerpt }) {
  ctx.emit('session/event', session, {
    type: 'tool/result',
    data: {
      message: {
        toolCallId: callId,
        isError,
        content: [{ type: 'text', text: excerpt }],
      },
    },
  })
}

test('the live host verifies command registration and skill resolution', async () => {
  const { ctx, agent } = await mountLive()
  const matrix = hostCapabilityMatrix({ commands: ctx.commands, skills: ctx.skills })
  const byId = new Map(matrix.map(entry => [entry.id, entry]))
  assert.equal(byId.get('commands.register').status, 'verified')
  assert.equal(byId.get('skills.resolve').status, 'verified')
  assert.equal(capabilitySummary(matrix), '8 verified, 2 unsupported, 0 unknown')
  assert.deepEqual(
    ctx.commands.list(agent).map(descriptor => descriptor.name).sort(),
    ['constrain', 'decide', 'flowgate', 'handoff', 'intent', 'prove', 'recover', 'review', 'slice', 'spec'],
  )
})

test('the live host path resolves every skill the composed message needs', async () => {
  const { ctx, agent, steered } = await mountLive()
  const result = await runCommand(ctx, agent, '/flowgate investigate the failing login')
  assert.equal(result.kind, 'success', result.text)
  const message = steered[0].content[0].text
  for (const skill of ['intent', 'recover', 'handoff']) {
    assert.equal(message.includes(`<skill_content name="${skill}">`), true, `${skill}: live body must be embedded`)
  }
  for (const skill of ['intent', 'recover', 'handoff']) {
    const definition = await ctx.skills.get(skill)
    assert.notEqual(definition, undefined, `${skill}: must resolve through the live registry`)
    assert.equal(definition.invocation.userInvocable, true)
  }
})

test('the live run records tool results the host actually emitted', async () => {
  const { ctx, session, agent, stateDir } = await mountLive()
  const started = await runCommand(ctx, agent, '/flowgate investigate the failing login')
  const runId = runIdOf(started.text)
  const controller = controllerFor(stateDir)
  recordIntent(controller, controller.load(runId))

  emitToolCall(ctx, session, 'call-1', LOGIN_COMMAND)
  emitToolResult(ctx, session, 'call-1', { isError: true, excerpt: '1 failing assertion' })

  const diagnosis = recordDiagnosis(controller, controller.load(runId), { withoutObservation: true })
  assert.equal(diagnosis.gate, 'passed', diagnosis.reasons?.map(reason => reason.code).join(','))

  const stored = controller.load(runId)
  const repro = stored.evidence.filter(entry => entry.contract_evidence_id === 'repro_observed').at(-1)
  assert.equal(repro.provenance.kind, 'observed_command')
  assert.equal(repro.provenance.command, LOGIN_COMMAND)
  assert.equal(stored.observations.length, 1)
  assert.equal(stored.observations[0].command, LOGIN_COMMAND)
  assert.equal(stored.observations[0].exit_code, null)
  assert.equal(stored.observations[0].is_error, true)
  assert.equal(repro.validation.method, 'observed_command_match')
})

test('an assistant message containing an artifact is recorded through the live session event', async () => {
  const { ctx, session, agent, stateDir } = await mountLive()
  const started = await runCommand(ctx, agent, '/flowgate investigate the failing login')
  const runId = runIdOf(started.text)
  const controller = controllerFor(stateDir)
  const text = intentTextForLive()
  ctx.emit('session/event', session, {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text }] } },
  })
  const stored = controller.load(runId)
  assert.equal(stored.artifacts.length, 1)
  assert.equal(stored.artifacts[0].artifact_type, 'Intent')
  assert.equal(stored.gates.find(entry => entry.stage === 'intent').status, 'passed')
})

function intentTextForLive() {
  return [
    'INTENT',
    'GOAL: the failing login is diagnosed',
    'NON_GOALS: none',
    'SUCCESS_CRITERIA: the reproduction fails on demand',
    'UNKNOWNS: none',
    '',
    '## EVIDENCE',
    'FACTS: the request names a login failure',
    'ASSUMPTIONS: none',
    'PROOF: none',
    'UNKNOWN: none',
    'DECISION: investigate the login',
  ].join('\n')
}

test('enforcement is reported as validated on the live host, never as enforced', async () => {
  const { ctx, agent, stateDir } = await mountLive()
  const started = await runCommand(ctx, agent, '/flowgate investigate the failing login')
  const runId = runIdOf(started.text)
  const controller = controllerFor(stateDir)
  recordIntent(controller, controller.load(runId))
  const report = controller.report(runId).report
  assert.equal(report.enforcement.level, 'validated')
  assert.equal(report.enforcement.pre_step, 'available_not_used')
  assert.ok(report.limitations.length >= 3)
  assert.equal(JSON.stringify(report).includes('"enforced"'), false)
  const record = enforcementRecord()
  assert.equal(record.limitations.some(line => line.includes('no verified host control prevents an agent from continuing')), true)
})

test('the plugin never subscribes to agent/pre-step for gate enforcement', () => {
  const source = readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8')
  assert.equal(source.includes("'agent/pre-step'"), false, 'flowgate must not install a pre-step rejection hook')
  assert.equal(source.includes('session/event'), true, 'the observer must subscribe to session/event')
  const hostSource = readFileSync(fileURLToPath(new URL('../lib/host.js', import.meta.url)), 'utf8')
  assert.equal(hostSource.includes("'agent/pre-step'"), true, 'the capability matrix must still record that the hook exists')
  assert.equal(hostSource.includes("level: 'validated'"), true)
})

test('a plugin load against the live host registers and disposes cleanly', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    providerName: 'flowgate',
    includeDefaultRoots: false,
    customSkillDirs: [SKILLS_DIR],
    watch: false,
  })
  const session = ctx.sessions.create(SessionId('flowgate-dispose'))
  const agent = { id: session.id, session, steer: () => {} }
  await ctx.plugin(Object.assign(inner => { createScope(inner, agent) }, { inject: ['commands'] }))
  const fiber = await ctx.plugin(flowgate, { stateDir: tempStateDir('flowgate-dispose-') })
  assert.equal(ctx.commands.list(agent).length, 10)
  await fiber.dispose()
  assert.deepEqual(ctx.commands.list(agent), [])
})
