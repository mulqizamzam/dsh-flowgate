import { loadWorkflows } from './workflows.js'

const FALLBACK_WORKFLOW = 'investigation'
const TOKEN_BOUNDARY = /[^\p{L}\p{N}]+/u

/** Distinct lowercase tokens split on Unicode non-letter/non-digit boundaries. */
export function tokenizeRequest(request) {
  const tokens = String(request)
    .toLowerCase()
    .split(TOKEN_BOUNDARY)
    .filter(token => token.length > 0)
  return [...new Set(tokens)].sort(compare)
}

/**
 * Deterministic workflow routing:
 *   score = number of distinct configured keywords present as exact tokens;
 *   highest score wins, then higher priority, then earlier name.
 * A zero score everywhere selects the investigation fallback.
 */
export function routeWorkflow(request, workflows = loadWorkflows()) {
  const tokens = new Set(tokenizeRequest(request))
  const ordered = [...workflows.entries()].sort(([left], [right]) => compare(left, right))
  const scores = ordered.map(([name, workflow]) => ({
    workflow: name,
    score: workflow.match.keywords.filter(keyword => tokens.has(keyword)).length,
    priority: workflow.match.priority,
    selected: false,
  }))
  const matching = scores.filter(entry => entry.score > 0)
  let selected
  let fallback = false
  let reason
  if (matching.length === 0) {
    selected = FALLBACK_WORKFLOW
    fallback = true
    reason = `no configured workflow keyword matched; fell back to ${FALLBACK_WORKFLOW}`
  } else {
    const ranked = [...matching].sort((left, right) =>
      right.score - left.score
      || right.priority - left.priority
      || compare(left.workflow, right.workflow))
    selected = ranked[0].workflow
    const tied = ranked.filter(entry => entry.score === ranked[0].score && entry.priority === ranked[0].priority)
    reason = `selected ${selected}: ${ranked[0].score} distinct keyword(s), priority ${ranked[0].priority}`
    if (tied.length > 1) reason += `; tie broken lexicographically among [${tied.map(entry => entry.workflow).join(', ')}]`
    if (ranked.length > 1) reason += `; ranked ${ranked.map(entry => `${entry.workflow}=${entry.score}`).join(' ')}`
  }
  for (const entry of scores) entry.selected = entry.workflow === selected
  return { tokens: [...tokens].sort(compare), scores, selected, fallback, reason }
}

export function selectWorkflow(request, workflows = loadWorkflows()) {
  return routeWorkflow(request, workflows).selected
}

function compare(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}
