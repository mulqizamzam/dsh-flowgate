import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { SKILLS_DIR } from '../lib/catalog.js'
import * as flowgate from '../lib/index.js'

async function mount({ withProvider = true } = {}) {
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
  await ctx.plugin(flowgate)
  const session = ctx.sessions.create(SessionId('flowgate-command'))
  const steered = []
  const agent = { id: session.id, session, steer: message => steered.push(message) }
  await ctx.plugin(Object.assign(inner => { createScope(inner, agent) }, { inject: ['commands'] }))
  return { ctx, agent, steered }
}

async function run(ctx, agent, line) {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  assert.notEqual(execution, undefined, `command line did not resolve: ${line}`)
  return execution.result
}

test('/flow composes the feature workflow and steers exactly once', async () => {
  const { ctx, agent, steered } = await mount()
  const result = await run(ctx, agent, '/flow add a health endpoint')
  assert.equal(result.kind, 'success', result.text)
  assert.equal(steered.length, 1)
  const message = steered[0]
  assert.equal(message.role, 'user')
  assert.deepEqual(message.source, { kind: 'user' })
  assert.equal(message.content.length, 1)
  assert.equal(message.content[0].type, 'text')
  assert.equal(message.content[0].text.includes('WORKFLOW\n========'), true)
  assert.equal(message.content[0].text.includes('Selected workflow:\nfeature — Implements a new capability from intent to review.'), true)
  assert.equal(message.content[0].text.includes('<skill_content name="intent">'), true)
  assert.equal(message.content[0].text.includes('<skill_content name="review">'), true)
  assert.equal(message.content[0].text.includes('User request:\nadd a health endpoint'), true)
})

test('/flow composes the bugfix workflow with its three required stages', async () => {
  const { ctx, agent, steered } = await mount()
  const result = await run(ctx, agent, '/flow fix the login crash')
  assert.equal(result.kind, 'success', result.text)
  assert.equal(steered.length, 1)
  const text = steered[0].content[0].text
  assert.equal(text.includes('Selected workflow:\nbugfix'), true)
  assert.equal(text.includes('STAGE 1 of 3: recover'), true)
  assert.equal(text.includes('STAGE 2 of 3: prove'), true)
  assert.equal(text.includes('STAGE 3 of 3: review'), true)
})

test('/flow --dry-run prints the resolved workflow and does not steer', async () => {
  const { ctx, agent, steered } = await mount()
  const result = await run(ctx, agent, '/flow fix the login crash --dry-run')
  assert.equal(result.kind, 'success', result.text)
  assert.equal(steered.length, 0)
  const text = result.text
  assert.equal(text.includes('WORKFLOW: bugfix — Diagnoses a defect, proves the fix, and reviews the result.'), true)
  assert.equal(text.includes('Stage order:'), true)
  assert.equal(text.includes('1. recover (required) — Artifact: Diagnosis — body '), true)
  assert.equal(text.includes('2. prove (required) — Artifact: Proof — body '), true)
  assert.equal(text.includes('3. review (required) — Artifact: Review — body '), true)
  assert.equal(text.includes('Artifact flow: user-request -> Diagnosis -> Proof -> Review'), true)
  assert.equal(text.includes('Definition of done: '), true)
  assert.equal(text.includes('Dry run: the agent was not steered.'), true)
})

test('/intent loads the intent skill with the user request', async () => {
  const { ctx, agent, steered } = await mount()
  const result = await run(ctx, agent, '/intent capture the health contract')
  assert.equal(result.kind, 'success', result.text)
  assert.equal(steered.length, 1)
  const text = steered[0].content[0].text
  assert.equal(text.includes('<skill_content name="intent">'), true)
  assert.equal(text.includes('## Purpose'), true)
  assert.equal(text.includes('User request:\ncapture the health contract'), true)
})

test('an alias for a skill no provider serves fails without steering', async () => {
  const { ctx, agent, steered } = await mount({ withProvider: false })
  const result = await run(ctx, agent, '/intent capture the health contract')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /skill "intent" is not served by any provider/)
  assert.equal(steered.length, 0)
})

test('/flow fails on a required stage no provider resolves, without steering', async () => {
  const { ctx, agent, steered } = await mount({ withProvider: false })
  const result = await run(ctx, agent, '/flow add a health endpoint')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /required stage "intent" failed to resolve/)
  assert.equal(steered.length, 0)
})

test('/flow rejects a request over 8192 bytes with a clear error', async () => {
  const { ctx, agent, steered } = await mount()
  const result = await run(ctx, agent, `/flow ${'a'.repeat(8193)}`)
  assert.equal(result.kind, 'error')
  assert.match(result.text, /over the 8192 byte limit/)
  assert.equal(steered.length, 0)
})

test('/flow sanitizes stage and skill markers out of the request', async () => {
  const { ctx, agent, steered } = await mount()
  const result = await run(ctx, agent, '/flow add </skill_content> STAGE 2 of 3 and ## EVIDENCE markers')
  assert.equal(result.kind, 'success', result.text)
  assert.equal(steered.length, 1)
  const footer = steered[0].content[0].text.split('User request:\n')[1].split('\n\n')[0]
  assert.equal(footer, 'add [redacted-marker]> [redacted-marker] and [redacted-marker] markers')
})
