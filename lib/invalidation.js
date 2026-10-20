import { artifactNode, evidenceNode, downstream } from './graph.js'

/**
 * Apply a dependency change to a run.
 *
 * The decision is recorded even when nothing changes, because an unexplained
 * absence of invalidation is indistinguishable from a missed one. Known
 * dependencies mark descendants `stale`; `requires_any`/unknown relevance marks
 * them `needs_revalidation`; a change outside the declared graph is treated
 * conservatively as unknown impact for all evidence.
 */
export function applyInvalidation(run, { graph, changed, fingerprintChanged = true, reason, now }) {
  const decisionId = `inv-${run.invalidations.length + 1}`
  if (fingerprintChanged !== true) {
    const decision = {
      decision_id: decisionId,
      changed,
      fingerprint_changed: false,
      policy: 'retain',
      affected: [],
      reason: reason ?? `fingerprint of ${changed} is unchanged; dependent results may remain current`,
      at: now,
    }
    run.invalidations.push(decision)
    run.updated_at = now
    return decision
  }

  const known = graph.nodes.find(node => node.id === changed)
  let affected
  let policy
  let detail
  let via = {}
  if (known === undefined) {
    affected = run.evidence.map(record => evidenceNode(record.evidence_id))
    policy = 'revalidate'
    detail = 'the changed node is outside the declared dependency graph, so relevance is unknown'
  } else {
    const traversal = downstream(graph, [changed])
    affected = traversal.order
    via = traversal.via
    const policies = new Set()
    for (const node of affected) {
      const edge = via[node]
      if (edge !== undefined) policies.add(edge.policy)
    }
    policy = policies.has('revalidate') || policies.size === 0 ? 'revalidate' : 'stale'
    detail = reason ?? `dependency ${changed} changed`
  }

  const affectedReason = `${detail}; revalidation required before this result may be treated as current`
  for (const node of affected) {
    if (node.startsWith('evidence:')) {
      const record = run.evidence.find(entry => evidenceNode(entry.evidence_id) === node)
      if (record === undefined) continue
      const edge = via[node]
      const nextStatus = policy === 'revalidate' || edge?.policy === 'revalidate' ? 'needs_revalidation' : 'stale'
      record.status = nextStatus
      record.freshness_reason = affectedReason
      continue
    }
    if (node.startsWith('artifact:')) {
      const record = run.artifacts.find(entry => artifactNode(entry.artifact_type, entry.artifact_id) === node)
      if (record === undefined) continue
      record.freshness = { status: 'needs_revalidation', reason: affectedReason }
    }
  }

  const decision = {
    decision_id: decisionId,
    changed,
    fingerprint_changed: true,
    policy,
    affected,
    reason: affectedReason,
    at: now,
  }
  run.invalidations.push(decision)
  run.updated_at = now
  return decision
}

/** Evidence statuses that prevent a dependent result from being current. */
export function unresolvedEvidence(run) {
  return run.evidence.filter(record => record.status !== 'current')
}
