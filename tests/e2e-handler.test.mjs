import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { SKILLS_DIR, shippedSkills } from '../lib/catalog.js'
import * as flowgate from '../lib/index.js'

const EXPECTED_COMMANDS = ['constrain', 'flow', 'handoff', 'intent', 'prove', 'recover', 'review', 'slice', 'spec']
const FOREIGN_OWNER = 'a foreign plugin owns this name'

async function stack() {
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
  const session = ctx.sessions.create(SessionId('flowgate-handler'))
  const steered = []
  const agent = { id: session.id, session, steer: message => steered.push(message) }
  await ctx.plugin(Object.assign(inner => { createScope(inner, agent) }, { inject: ['commands'] }))
  return { ctx, agent, steered }
}

async function mount() {
  const mounted = await stack()
  await mounted.ctx.plugin(flowgate)
  return mounted
}

async function run(ctx, agent, line) {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  assert.notEqual(execution, undefined, `command line did not resolve: ${line}`)
  return execution.result
}

test('all nine commands register against the host registry', async () => {
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
  const definition = ctx.commands.find(agent, 'flow')
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

test('reloading flowgate after a clean dispose registers all nine commands again', async () => {
  const { ctx, agent } = await stack()
  const first = await ctx.plugin(flowgate)
  await first.dispose()

  await ctx.plugin(flowgate)

  assert.deepEqual(ctx.commands.list(agent).map(descriptor => descriptor.name).sort(), [...EXPECTED_COMMANDS].sort())
})
