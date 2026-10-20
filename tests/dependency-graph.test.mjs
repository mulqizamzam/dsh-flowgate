import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INPUT_NODE,
  addArtifact,
  addEvidence,
  affectedByChange,
  artifactNode,
  buildPlanGraph,
  downstream,
  normalizeGraph,
  stageNode,
  validateGraph,
} from '../lib/graph.js'
import { loadContracts } from '../lib/contracts.js'
import { loadWorkflows } from '../lib/workflows.js'

const contracts = loadContracts()
const workflows = loadWorkflows()

function plan(workflowName = 'investigation') {
  return buildPlanGraph(workflows.get(workflowName), contracts.contracts)
}

function edge(id, from, to, kind = 'input', policy = 'invalidate') {
  return { edge_id: id, from, to, kind, policy, rationale: 'test fixture' }
}

test('the plan graph for every shipped workflow is acyclic and complete', () => {
  for (const [name, workflow] of workflows) {
    const graph = plan(name)
    assert.equal(validateGraph(graph), true, `${name}: plan graph must validate`)
    const stages = graph.nodes.filter(node => node.kind === 'stage').map(node => node.id).sort()
    assert.deepEqual(stages, workflow.stages.map(stage => stageNode(stage.skill)).sort(), `${name}: one stage node per stage`)
    assert.ok(graph.nodes.some(node => node.id === INPUT_NODE), `${name}: input node must exist`)
    assert.ok(graph.edges.every(entry => entry.kind !== 'ordering' || entry.policy === 'none'), `${name}: ordering edges never invalidate`)
  }
})

test('derived edges connect the producer stage to the consumer stage', () => {
  const graph = plan('feature')
  const derived = graph.edges.filter(entry => entry.kind === 'derived_from')
  const pairs = derived.map(entry => `${entry.from}->${entry.to}`)
  assert.ok(pairs.includes('stage:intent->stage:spec'), 'Intent feeds spec')
  assert.ok(pairs.includes('stage:spec->stage:slice'), 'Spec feeds slice')
  assert.ok(pairs.includes('stage:slice->stage:prove'), 'SlicePlan feeds prove through requires_any')
  assert.ok(pairs.includes('stage:prove->stage:review'), 'Proof feeds review')
  const anyEdge = derived.find(entry => entry.from === 'stage:slice' && entry.to === 'stage:prove')
  assert.equal(anyEdge.policy, 'revalidate', 'requires_any alternatives must be revalidated')
})

test('a dangling edge endpoint is rejected with a stable code', () => {
  const graph = plan()
  graph.edges.push(edge('edge-dangling', INPUT_NODE, 'stage:ghost'))
  assert.throws(() => validateGraph(graph), error => {
    assert.equal(error.code, 'DEPENDENCY_DANGLING_REFERENCE')
    assert.match(error.message, /stage:ghost/)
    return true
  })
})

test('a self-loop and a two-node cycle are both rejected', () => {
  const selfLoop = plan()
  selfLoop.edges.push(edge('edge-self', INPUT_NODE, INPUT_NODE))
  assert.throws(() => validateGraph(selfLoop), /self-loop/)

  const cycle = plan()
  cycle.edges.push(edge('edge-cycle', stageNode('handoff'), stageNode('intent')))
  assert.throws(() => validateGraph(cycle), error => {
    assert.equal(error.code, 'DEPENDENCY_CYCLE')
    assert.match(error.message, /intent/)
    return true
  })
})

test('duplicate nodes, unknown kinds, and unknown policies are rejected', () => {
  const duplicate = plan()
  duplicate.nodes.push({ id: INPUT_NODE, kind: 'input', label: 'twice' })
  assert.throws(() => validateGraph(duplicate), /duplicate node id/)

  const badKind = plan()
  badKind.nodes.push({ id: 'mystery:1', kind: 'mystery', label: 'x' })
  assert.throws(() => validateGraph(badKind), /unknown kind/)

  const badPolicy = plan()
  badPolicy.edges.push(edge('edge-policy', INPUT_NODE, stageNode('intent'), 'input', 'sometimes'))
  assert.throws(() => validateGraph(badPolicy), /unknown policy/)
})

test('traversal walks dependents forward, not prerequisites backwards', () => {
  const graph = plan()
  const order = affectedByChange(graph, INPUT_NODE)
  assert.ok(order.includes(stageNode('intent')), 'a changed input affects the stage that consumes it')
  assert.ok(order.includes(stageNode('recover')), 'the effect propagates to later consumers')
  assert.equal(order.includes(INPUT_NODE), false, 'the changed node is not its own dependent')
})

test('ordering-only edges never propagate a change by default', () => {
  const ordered = normalizeGraph({
    nodes: ['stage:alpha', 'stage:beta'].map(id => ({ id, kind: 'stage', label: id })),
    edges: [edge('edge-order-alpha-beta', 'stage:alpha', 'stage:beta', 'ordering', 'none')],
  })
  assert.deepEqual(affectedByChange(ordered, 'stage:alpha'), [], 'an ordering edge must not invalidate the next stage')
  assert.deepEqual(affectedByChange(ordered, 'stage:alpha', { includeOrdering: true }), ['stage:beta'])

  const feature = plan('feature')
  const order = affectedByChange(feature, stageNode('intent'))
  assert.ok(order.includes(stageNode('spec')), 'a derived dependency still propagates')
  assert.equal(order.includes(stageNode('intent')), false)
})

test('reverse traversal is deterministic across repeated runs', () => {
  const graph = plan('feature')
  const first = affectedByChange(graph, INPUT_NODE)
  const second = affectedByChange(plan('feature'), INPUT_NODE)
  assert.deepEqual(first, second)
  assert.deepEqual(first, downstream(graph, [INPUT_NODE]).order)
  assert.equal(new Set(first).size, first.length, 'traversal never repeats a node')
})

test('artifacts and evidence are wired so a change reaches both', () => {
  let graph = plan()
  const artifact = {
    artifact_id: 'art-001',
    artifact_type: 'Intent',
    digest: 'sha256:abc',
    status: 'valid',
    producer: { stage: 'intent', attempt_id: 'att-001' },
    inputs: [{ ref: INPUT_NODE, digest: 'sha256:req' }],
  }
  const artifactId = artifactNode('Intent', 'art-001')
  graph = addArtifact(graph, artifact, 'intent', [INPUT_NODE])
  const evidence = {
    evidence_id: 'ev-001',
    contract_evidence_id: 'request_recorded',
    status: 'current',
    producer: { stage: 'intent', attempt_id: 'att-001' },
    binds_to: [{ ref: `artifact:Intent:art-001`, digest: 'sha256:abc' }],
  }
  graph = addEvidence(graph, evidence, [artifactId])
  assert.equal(validateGraph(graph), true)

  const order = affectedByChange(graph, INPUT_NODE)
  assert.ok(order.includes(artifactId), 'input change reaches the artifact')
  assert.ok(order.includes('evidence:ev-001'), 'artifact change reaches its evidence')
  assert.ok(order.includes('gate:intent'), 'evidence change reaches the gate')

  const evidenceOrder = affectedByChange(graph, 'evidence:ev-001')
  assert.deepEqual(evidenceOrder, ['gate:intent'], 'evidence feeds the gate and nothing else')
})

test('a normalisation preserves nodes and edges while sorting them', () => {
  const graph = plan()
  const normalized = normalizeGraph(graph)
  assert.deepEqual(normalized.nodes.map(node => node.id), [...normalized.nodes.map(node => node.id)].sort())
  assert.deepEqual(normalized.edges.map(entry => entry.edge_id), [...normalized.edges.map(entry => entry.edge_id)].sort())
  assert.equal(normalized.nodes.length, graph.nodes.length)
  assert.equal(normalized.edges.length, graph.edges.length)
})
