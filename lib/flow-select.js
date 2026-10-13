import { loadWorkflows } from './workflows.js'

const FALLBACK_WORKFLOW = 'investigation'

export function selectWorkflow(request, workflows = loadWorkflows()) {
  const tokens = tokenize(request)
  const ordered = [...workflows.entries()].sort((left, right) => compareNames(left[0], right[0]))
  let best = null
  let bestCount = 0
  for (const [name, workflow] of ordered) {
    const count = workflow.match.keywords.filter(keyword => tokens.has(keyword)).length
    if (count === 0) continue
    if (best === null || count > bestCount || (count === bestCount && workflow.match.priority > best.match.priority)) {
      best = workflow
      bestCount = count
    }
  }
  return best === null ? FALLBACK_WORKFLOW : best.name
}

function tokenize(request) {
  const words = String(request).toLowerCase().split(/[^a-z0-9]+/)
  return new Set(words.filter(word => word.length > 0))
}

function compareNames(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}
