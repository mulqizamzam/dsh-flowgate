import { FlowgateError, CODES } from './errors.js'

export const NODE_KINDS = ['input', 'stage', 'gate', 'artifact', 'evidence']
export const EDGE_KINDS = ['input', 'derived_from', 'evidence_for', 'validated_by', 'ordering']
export const EDGE_POLICIES = ['invalidate', 'stale', 'revalidate', 'none']

export function nodeId(kind, ref) {
  return `${kind}:${ref}`
}

export function stageNode(skill) {
  return `stage:${slug(skill)}`
}

export function gateNode(skill) {
  return `gate:${slug(skill)}`
}

export function artifactNode(artifactType, artifactId) {
  return `artifact:${slug(artifactType)}:${slug(artifactId)}`
}

export function evidenceNode(evidenceId) {
  return `evidence:${slug(evidenceId)}`
}

export const INPUT_NODE = 'input:user-request'

/**
 * Build the declared dependency graph for a workflow plan.
 *
 * Ordering edges record stage sequence and never propagate invalidation.
 * Derived/input edges propagate. `requires_any` alternatives produce
 * `revalidate` edges because the plan cannot know which alternative will be
 * used; unknown relevance is conservative by design.
 */
export function buildPlanGraph(workflow, contracts) {
  const nodes = [{ id: INPUT_NODE, kind: 'input', label: 'user request' }]
  const edges = []
  const producers = new Map()
  for (const stage of workflow.stages) {
    const contract = contracts[stage.skill]
    if (contract === undefined) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `workflow "${workflow.name}": stage "${stage.skill}" has no contract`)
    }
    nodes.push({ id: stageNode(stage.skill), kind: 'stage', label: stage.skill })
    nodes.push({ id: gateNode(stage.skill), kind: 'gate', label: `gate:${stage.skill}` })
    for (const artifact of contract.produces) producers.set(artifact, stage.skill)
    edges.push({
      edge_id: `edge-gate-${slug(stage.skill)}`,
      from: stageNode(stage.skill),
      to: gateNode(stage.skill),
      kind: 'validated_by',
      policy: 'revalidate',
      rationale: `gate evaluates the ${stage.skill} stage`,
    })
  }
  for (const [index, stage] of workflow.stages.entries()) {
    const contract = contracts[stage.skill]
    if (index > 0) {
      const previous = workflow.stages[index - 1]
      edges.push({
        edge_id: `edge-order-${slug(previous.skill)}-${slug(stage.skill)}`,
        from: stageNode(previous.skill),
        to: stageNode(stage.skill),
        kind: 'ordering',
        policy: 'none',
        rationale: 'stage order only',
      })
    }
    const required = new Set([...contract.requires, ...contract.requires_any])
    if (required.has('user-request')) {
      edges.push({
        edge_id: `edge-input-${slug(stage.skill)}`,
        from: INPUT_NODE,
        to: stageNode(stage.skill),
        kind: 'input',
        policy: 'invalidate',
        rationale: `stage ${stage.skill} consumes the operator request`,
      })
    }
    for (const artifact of contract.requires) {
      const producer = producers.get(artifact)
      if (producer === undefined) continue
      edges.push({
        edge_id: `edge-derived-${slug(producer)}-${slug(stage.skill)}-${slug(artifact)}`,
        from: stageNode(producer),
        to: stageNode(stage.skill),
        kind: 'derived_from',
        policy: 'invalidate',
        rationale: `stage ${stage.skill} requires ${artifact}`,
      })
    }
    for (const artifact of contract.requires_any) {
      const producer = producers.get(artifact)
      if (producer === undefined) continue
      if (workflow.stages.findIndex(entry => entry.skill === producer) >= index) continue
      edges.push({
        edge_id: `edge-any-${slug(producer)}-${slug(stage.skill)}-${slug(artifact)}`,
        from: stageNode(producer),
        to: stageNode(stage.skill),
        kind: 'derived_from',
        policy: 'revalidate',
        rationale: `stage ${stage.skill} may consume ${artifact}; relevance must be revalidated`,
      })
    }
  }
  return normalizeGraph({ nodes, edges })
}

/** Add the artifact record and its producer/binding edges (inputs are node ids). */
export function addArtifact(graph, artifact, stageSkill, inputs = []) {
  const id = artifactNode(artifact.artifact_type, artifact.artifact_id)
  graph.nodes.push({ id, kind: 'artifact', label: artifact.artifact_type })
  graph.edges.push({
    edge_id: `edge-artifact-${slug(artifact.artifact_id)}-from-${slug(stageSkill)}`,
    from: stageNode(stageSkill),
    to: id,
    kind: 'derived_from',
    policy: 'invalidate',
    rationale: `artifact ${artifact.artifact_type} produced by ${stageSkill}`,
  })
  graph.edges.push({
    edge_id: `edge-artifact-${slug(artifact.artifact_id)}-gate`,
    from: id,
    to: gateNode(stageSkill),
    kind: 'validated_by',
    policy: 'revalidate',
    rationale: `gate ${stageSkill} validates ${artifact.artifact_type}`,
  })
  for (const input of inputs) {
    graph.edges.push({
      edge_id: `edge-artifact-${slug(artifact.artifact_id)}-input-${slug(input)}`,
      from: input,
      to: id,
      kind: 'input',
      policy: 'invalidate',
      rationale: `artifact derives from ${input}`,
    })
  }
  return normalizeGraph(graph)
}

/**
 * Add an evidence record with edges that model what a change can reach: each
 * bound artifact feeds the evidence, and the evidence feeds the gate of the
 * stage that produced it. Direction matters — `downstream` walks these edges to
 * find dependents, so a changed artifact marks its evidence, and changed
 * evidence marks its gate.
 */
export function addEvidence(graph, evidence, boundTo = []) {
  const id = evidenceNode(evidence.evidence_id)
  graph.nodes.push({ id, kind: 'evidence', label: evidence.contract_evidence_id })
  for (const artifactId of boundTo) {
    graph.edges.push({
      edge_id: `edge-evidence-${slug(evidence.evidence_id)}-${slug(artifactId)}`,
      from: artifactId,
      to: id,
      kind: 'input',
      policy: 'invalidate',
      rationale: `evidence supports ${artifactId}`,
    })
  }
  const producer = evidence.producer?.stage
  if (typeof producer === 'string' && producer !== '') {
    graph.edges.push({
      edge_id: `edge-evidence-${slug(evidence.evidence_id)}-gate`,
      from: id,
      to: gateNode(producer),
      kind: 'validated_by',
      policy: 'revalidate',
      rationale: `gate ${producer} requires this evidence`,
    })
  }
  return normalizeGraph(graph)
}

export function normalizeGraph(graph) {
  const nodes = [...graph.nodes].sort((left, right) => compare(left.id, right.id))
  const edges = [...graph.edges].sort((left, right) => compare(left.edge_id, right.edge_id))
  return { nodes, edges }
}

/** Structural validation: endpoints, duplicate ids, enums, and prohibited cycles. */
export function validateGraph(graph) {
  const nodeIds = new Set()
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `graph: duplicate node id "${node.id}"`)
    }
    if (!NODE_KINDS.includes(node.kind)) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `graph: node "${node.id}" has unknown kind "${node.kind}"`)
    }
    nodeIds.add(node.id)
  }
  const edgeIds = new Set()
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.edge_id)) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `graph: duplicate edge id "${edge.edge_id}"`)
    }
    edgeIds.add(edge.edge_id)
    for (const endpoint of [edge.from, edge.to]) {
      if (!nodeIds.has(endpoint)) {
        throw new FlowgateError(
          CODES.DEPENDENCY_DANGLING_REFERENCE,
          `graph: edge "${edge.edge_id}" references unknown node "${endpoint}"`,
          'Declare the missing node before the edge that points at it.',
        )
      }
    }
    if (!EDGE_KINDS.includes(edge.kind)) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `graph: edge "${edge.edge_id}" has unknown kind "${edge.kind}"`)
    }
    if (!EDGE_POLICIES.includes(edge.policy)) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `graph: edge "${edge.edge_id}" has unknown policy "${edge.policy}"`)
    }
    if (edge.from === edge.to) {
      throw new FlowgateError(CODES.DEPENDENCY_CYCLE, `graph: edge "${edge.edge_id}" is a self-loop on "${edge.from}"`)
    }
  }
  const cycle = findCycle(graph.edges)
  if (cycle !== undefined) {
    throw new FlowgateError(CODES.DEPENDENCY_CYCLE, `graph: dependency cycle ${cycle.join(' -> ')}`, 'Remove the edge that closes the cycle; only acyclic dependency relations are accepted.')
  }
  return true
}

function findCycle(edges) {
  const adjacency = new Map()
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, [])
    adjacency.get(edge.from).push(edge.to)
  }
  for (const targets of adjacency.values()) targets.sort(compare)
  const state = new Map()
  const stack = []
  const walk = node => {
    state.set(node, 'visiting')
    stack.push(node)
    for (const next of adjacency.get(node) ?? []) {
      const status = state.get(next)
      if (status === 'visiting') {
        const start = stack.indexOf(next)
        return [...stack.slice(start), next]
      }
      if (status === undefined) {
        const found = walk(next)
        if (found !== undefined) return found
      }
    }
    stack.pop()
    state.set(node, 'done')
    return undefined
  }
  for (const node of [...adjacency.keys()].sort(compare)) {
    if (state.get(node) === undefined) {
      const found = walk(node)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/**
 * Deterministic forward traversal: the nodes that depend on `sources`, in
 * breadth-first order with lexicographic ties. Ordering-only edges are excluded
 * by default because stage order is not evidence dependency.
 */
export function downstream(graph, sources, options = {}) {
  const includeOrdering = options.includeOrdering === true
  const forward = new Map()
  for (const edge of graph.edges) {
    if (!includeOrdering && edge.kind === 'ordering') continue
    if (!forward.has(edge.from)) forward.set(edge.from, [])
    forward.get(edge.from).push(edge)
  }
  for (const list of forward.values()) list.sort((left, right) => compare(left.edge_id, right.edge_id))
  const seen = new Set()
  const order = []
  const via = {}
  let frontier = [...new Set(sources)].sort(compare)
  for (const source of frontier) seen.add(source)
  while (frontier.length > 0) {
    const next = []
    for (const node of frontier) {
      for (const edge of forward.get(node) ?? []) {
        if (seen.has(edge.to)) continue
        seen.add(edge.to)
        via[edge.to] = edge
        next.push(edge.to)
      }
    }
    next.sort(compare)
    order.push(...next)
    frontier = next
  }
  return { order, via }
}

/** The nodes a change to `changed` can affect, excluding the change itself. */
export function affectedByChange(graph, changed, options = {}) {
  return downstream(graph, [changed], options).order
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function compare(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}
