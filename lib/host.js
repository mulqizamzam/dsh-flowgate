import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = fileURLToPath(new URL('../', import.meta.url))

const DECLARATIONS = {
  commands: 'node_modules/@deepseek-ai/dsh-commands/lib/types/types.d.ts',
  agent: 'node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts',
  session: 'node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts',
  sessionTypes: 'node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts',
  skill: 'node_modules/@deepseek-ai/dsh-skill/lib/types/index.d.ts',
}

/** Read an installed declaration file; returns undefined when the host is absent. */
export function readDeclaration(key) {
  const relative = DECLARATIONS[key]
  if (relative === undefined) return undefined
  try {
    return readFileSync(join(pluginRoot, relative), 'utf8')
  } catch {
    return undefined
  }
}

/** Whether the installed host declares an event or method, with the file it came from. */
export function declaredHook(key, needle) {
  const text = readDeclaration(key)
  if (text === undefined) return { declared: false, evidence: `${key}: declaration file not installed` }
  return {
    declared: text.includes(needle),
    evidence: `${DECLARATIONS[key]} contains ${JSON.stringify(needle)}`,
  }
}

/**
 * The verified host capability matrix. Every entry names the evidence used and
 * the product guarantee it permits; an entry is never `verified` without both.
 *
 * `runtime` is optional so the matrix can be inspected without a live mount;
 * declared API checks always run against the installed package.
 */
export function hostCapabilityMatrix({ commands, skills } = {}) {
  const entries = []
  const add = (id, status, evidence, effect) => entries.push({ id, status, evidence, effect })

  add(
    'commands.register',
    typeof commands?.register === 'function' ? 'verified' : 'unsupported',
    'node_modules/@deepseek-ai/dsh-commands/lib/types/types.d.ts (register) + runtime ctx.commands.register; covered by tests/report-and-command-e2e.test.mjs',
    'Eleven command registrations; teardown through the host effect.',
  )
  add(
    'commands.execute',
    'verified',
    'ctx.commands.execute(agent, line, [], signal) drives a registered handler; used by tests/e2e-handler.test.mjs',
    'Command behavior (dry-run, status, report, resume) is exercised at the real registry boundary.',
  )
  add(
    'skills.resolve',
    typeof skills?.get === 'function' ? 'verified' : 'unsupported',
    'node_modules/@deepseek-ai/dsh-skill/lib/types/index.d.ts (SkillRegistry.get) + runtime ctx.skills.get; tests/skill-load.test.mjs',
    'A stage resolves to a real skill body; a missing required skill fails preflight.',
  )
  add(
    'skills.render',
    'verified',
    '@deepseek-ai/dsh-skill renderSkillContent; tests/composition-security.test.mjs verifies byte-identical bodies',
    'Composed messages carry the host-rendered body unchanged.',
  )
  add(
    'steering',
    'verified',
    'node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts (Agent.steer) + createUserMessage; tests/report-and-command-e2e.test.mjs',
    'The only path from a command to agent execution.',
  )
  add(
    'session.events',
    declaredHook('session', "'session/event'").declared ? 'verified' : 'unsupported',
    declaredHook('session', "'session/event'").evidence,
    'The observer can see assistant messages and tool results; it never fabricates them.',
  )
  add(
    'tool.observation',
    declaredHook('sessionTypes', "'tool/result'").declared ? 'verified' : 'unsupported',
    declaredHook('sessionTypes', "'tool/result'").evidence,
    'Evidence provenance can be upgraded to observed_command only when a matching tool result was seen.',
  )
  add(
    'agent.pre-step',
    declaredHook('agent', "'agent/pre-step'").declared ? 'verified' : 'unsupported',
    declaredHook('agent', "'agent/pre-step'").evidence,
    'A hook exists that can reject a step, but rejecting a step also rejects remediation steps; Flowgate does not use it for gate enforcement and reports `validated`, not `enforced`.',
  )
  add(
    'host.state-directory',
    'unsupported',
    'No plugin state-directory service is declared in the installed @deepseek-ai packages; persistence is plugin-owned.',
    'State lives in the documented plugin directory (config > DSH_FLOWGATE_STATE_DIR > $DSH_HOME/flowgate-state).',
  )
  add(
    'continuation.block',
    'unsupported',
    'agent/pre-step can reject a step but cannot distinguish a prohibited continuation from a remediation step; no tool-boundary denial hook is declared.',
    'Stage gates are application validation; Flowgate labels them as validated and discloses the limitation in every report.',
  )
  return entries
}

/** Describe, without inflating, the strongest enforcement the host supports. */
export function enforcementRecord(matrix = hostCapabilityMatrix()) {
  const blocking = matrix.find(entry => entry.id === 'continuation.block')
  return {
    level: 'validated',
    pre_step: 'available_not_used',
    limitations: [
      'Stage gates are validated after the agent emits an artifact; no verified host control prevents an agent from continuing.',
      'agent/pre-step exists but rejecting a step would also block the remediation steps a failed gate requires, so it is not used as a gate lock.',
      blocking === undefined ? 'No continuation-blocking capability is claimed.' : blocking.effect,
    ],
  }
}

/** One-line summary used in the capability document and tests. */
export function capabilitySummary(matrix) {
  const counts = { verified: 0, unsupported: 0, unknown: 0 }
  for (const entry of matrix) counts[entry.status] += 1
  return `${counts.verified} verified, ${counts.unsupported} unsupported, ${counts.unknown} unknown`
}
