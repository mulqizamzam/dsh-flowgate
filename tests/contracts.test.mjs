import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SKILLS_DIR, shippedSkills, WORKFLOWS_DIR } from '../lib/catalog.js'
import { loadContracts, validateArtifactChain, validateContracts } from '../lib/contracts.js'
import { loadWorkflows } from '../lib/workflows.js'

const SOURCE = 'contracts.test.mjs'

function contractsFixture(skills) {
  return {
    schema_version: 1,
    vocabulary: {
      artifacts: ['Intent', 'Spec', 'user-request'],
      categories: ['frame', 'specify'],
      risk_levels: ['low'],
    },
    contracts: Object.fromEntries(skills.map(name => [name, {
      produces: name === 'intent' ? ['Intent'] : ['Spec'],
      consumes: name === 'intent' ? ['user-request'] : ['Intent'],
      categories: [name === 'intent' ? 'frame' : 'specify'],
      risk_level: 'low',
    }])),
  }
}

test('every shipped skill has exactly one contract entry', () => {
  const { contracts } = loadContracts()
  const declared = Object.keys(contracts).sort()
  const shipped = shippedSkills(SKILLS_DIR).sort()
  assert.deepEqual(declared, shipped, 'contract entries must equal the shipped skill set')
})

test('contract vocabularies are closed', () => {
  const { vocabulary, contracts } = loadContracts()
  for (const [name, contract] of Object.entries(contracts)) {
    for (const artifact of [...contract.produces, ...contract.consumes]) {
      assert.ok(vocabulary.artifacts.includes(artifact), `${name}: artifact "${artifact}" is outside the vocabulary`)
    }
    for (const category of contract.categories) {
      assert.ok(vocabulary.categories.includes(category), `${name}: category "${category}" is outside the vocabulary`)
    }
    assert.ok(vocabulary.risk_levels.includes(contract.risk_level), `${name}: risk_level "${contract.risk_level}" is outside the vocabulary`)
  }
})

test('no contract produces an artifact it consumes', () => {
  const { contracts } = loadContracts()
  for (const [name, contract] of Object.entries(contracts)) {
    for (const artifact of contract.produces) {
      assert.ok(!contract.consumes.includes(artifact), `${name}: produces and consumes "${artifact}"`)
    }
  }
})

test('loader rejects a contract that names an unshipped skill', () => {
  const data = contractsFixture(['intent', 'ghost'])
  assert.throws(() => validateContracts(data, SOURCE, ['intent']), /does not name a shipped skill/)
})

test('loader rejects a shipped skill with no contract entry', () => {
  const data = contractsFixture(['intent'])
  assert.throws(() => validateContracts(data, SOURCE, ['intent', 'spec']), /has no contract entry/)
})

test('loader rejects an unknown produced artifact', () => {
  const data = contractsFixture(['intent', 'spec'])
  data.contracts.intent.produces = ['Ghost']
  assert.throws(() => validateContracts(data, SOURCE, ['intent', 'spec']), /produces unknown artifact "Ghost"/)
})

test('loader rejects an unknown consumed artifact', () => {
  const data = contractsFixture(['intent', 'spec'])
  data.contracts.spec.consumes = ['Ghost']
  assert.throws(() => validateContracts(data, SOURCE, ['intent', 'spec']), /consumes unknown artifact "Ghost"/)
})

test('loader rejects an unknown category', () => {
  const data = contractsFixture(['intent', 'spec'])
  data.contracts.intent.categories = ['ghost']
  assert.throws(() => validateContracts(data, SOURCE, ['intent', 'spec']), /unknown category "ghost"/)
})

test('loader rejects an unknown risk_level', () => {
  const data = contractsFixture(['intent', 'spec'])
  data.contracts.intent.risk_level = 'extreme'
  assert.throws(() => validateContracts(data, SOURCE, ['intent', 'spec']), /unknown risk_level "extreme"/)
})

test('loader rejects a missing schema_version', () => {
  const data = contractsFixture(['intent', 'spec'])
  delete data.schema_version
  assert.throws(() => validateContracts(data, SOURCE, ['intent', 'spec']), /schema_version must be 1/)
})

test('loader rejects a produce and consume self-loop', () => {
  const data = contractsFixture(['intent', 'spec'])
  data.contracts.intent.consumes = ['Intent']
  assert.throws(() => validateContracts(data, SOURCE, ['intent', 'spec']), /produces and consumes the same artifact "Intent"/)
})

test('every shipped workflow artifact chain validates', () => {
  const { contracts } = loadContracts()
  for (const [name, workflow] of loadWorkflows(WORKFLOWS_DIR)) {
    assert.doesNotThrow(() => validateArtifactChain(workflow, contracts, `${SOURCE}: ${name}`))
  }
})

test('artifact chain validation rejects a stage whose input no prior stage produced', () => {
  const { contracts } = loadContracts()
  const workflow = {
    name: 'broken-chain',
    stages: [
      { skill: 'intent', required: true, purpose: 'Capture intent.' },
      { skill: 'slice', required: true, purpose: 'Slice before any spec exists.' },
    ],
  }
  assert.throws(
    () => validateArtifactChain(workflow, contracts, SOURCE),
    /stage 2 "slice" consumes "Spec", not produced by any prior stage or the user request/,
  )
})
