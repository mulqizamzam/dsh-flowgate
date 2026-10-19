import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectWorkflow } from '../lib/flow-select.js'
import { loadWorkflows } from '../lib/workflows.js'

const workflows = loadWorkflows()

const ROUTING_TABLE = [
  ['add a health endpoint', 'feature'],
  ['implement the retry policy', 'feature'],
  ['build a cache layer', 'feature'],
  ['create a new skill', 'feature'],
  ['feature flag for telemetry', 'feature'],
  ['fix the login crash', 'bugfix'],
  ['the parser is broken again', 'bugfix'],
  ['a regression in the billing path', 'bugfix'],
  ['crash on startup', 'bugfix'],
  ['a bug in the serializer', 'bugfix'],
  ['investigate the memory growth', 'investigation'],
  ['diagnose the flaky test', 'investigation'],
  ['the failing endpoint needs understanding', 'investigation'],
  ['help me understand the state machine', 'investigation'],
  ['migrate the config format', 'migration'],
  ['upgrade the react version', 'migration'],
  ['deprecate the v1 api', 'migration'],
  ['port the plugin to dsh', 'migration'],
  ['refactor the router', 'migration'],
  ['release to production', 'release'],
  ['deploy to production tonight', 'release'],
  ['ship the release', 'release'],
  ['launch the production build', 'release'],
  ['production rollout', 'release'],
]

test('the routing table sends every request to its PRD workflow', () => {
  for (const [request, expected] of ROUTING_TABLE) {
    assert.equal(selectWorkflow(request, workflows), expected, `request: ${request}`)
  }
})

test('whole-word matching does not route "fail" as the keyword "failing"', () => {
  assert.equal(selectWorkflow('why does the job fail', workflows), 'investigation')
})

const PROPERTY_CASES = [
  { name: 'empty request', request: '', expected: 'investigation' },
  { name: 'whitespace only', request: '   \n\t  ', expected: 'investigation' },
  { name: 'punctuation only', request: '---!!!???...,,,', expected: 'investigation' },
  { name: 'single keyword', request: 'add', expected: 'feature' },
  { name: '10k words with one keyword at the end', request: `${'word '.repeat(10000)}add`, expected: 'feature' },
  { name: '10k words without keywords', request: 'word '.repeat(10000), expected: 'investigation' },
  { name: 'keyword as substring is not a match', request: 'adding adder additional', expected: 'investigation' },
  { name: 'keyword glued to other letters is not a match', request: 'readd sadness', expected: 'investigation' },
  { name: 'repeated keyword counts once', request: 'add add add add', expected: 'feature' },
  { name: 'repeated competing keywords tie then break lexicographically', request: 'fix add fix add', expected: 'bugfix' },
  { name: 'uppercase keywords match', request: 'ADD A FEATURE', expected: 'feature' },
  { name: 'mixed case competing keywords', request: 'Fix The Crash', expected: 'bugfix' },
  { name: 'unicode only', request: 'héllo wörld café naïve', expected: 'investigation' },
  { name: 'unicode around a keyword', request: 'café add naïve', expected: 'feature' },
  { name: 'cyrillic around a keyword', request: 'сломайте add пожалуйста', expected: 'feature' },
  { name: 'hyphenated word keeps whole-word parts', request: 'health-check add', expected: 'feature' },
  { name: 'numbers are not keywords', request: 'add 42 endpoints', expected: 'feature' },
  { name: 'newlines and tabs separate words', request: 'add\ta\nfeature', expected: 'feature' },
  { name: 'stage markers in the request do not change routing', request: 'STAGE 1 of 5: add', expected: 'feature' },
  { name: 'skill markers in the request do not change routing', request: '<skill_content name="add">', expected: 'feature' },
]

test('the twenty property cases route deterministically', () => {
  assert.equal(PROPERTY_CASES.length, 20, 'the property table must hold twenty cases')
  for (const propertyCase of PROPERTY_CASES) {
    assert.equal(selectWorkflow(propertyCase.request, workflows), propertyCase.expected, propertyCase.name)
  }
})

test('the highest keyword count wins over lexicographic order', () => {
  assert.equal(selectWorkflow('add and implement and fix', workflows), 'feature')
  assert.equal(selectWorkflow('fix and broken and add', workflows), 'bugfix')
  assert.equal(selectWorkflow('why and diagnose and fix', workflows), 'investigation')
})

test('higher priority wins when counts are equal', () => {
  assert.equal(selectWorkflow('fix and add', workflows), 'bugfix')
  assert.equal(selectWorkflow('build and fix', workflows), 'bugfix')
})

test('no keyword match falls back to investigation', () => {
  assert.equal(selectWorkflow('hello world', workflows), 'investigation')
  assert.equal(selectWorkflow('zzzzz', workflows), 'investigation')
})

test('selection is pure: same input gives the same output', () => {
  const request = 'add a health endpoint and fix the crash'
  const first = selectWorkflow(request, workflows)
  const second = selectWorkflow(request, workflows)
  const third = selectWorkflow(request, workflows)
  assert.equal(first, second)
  assert.equal(second, third)
})

test('selection never depends on the default loader argument', () => {
  assert.equal(selectWorkflow('fix the login crash'), 'bugfix')
})
