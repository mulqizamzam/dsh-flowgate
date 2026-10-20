import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SCHEMAS_DIR } from '../lib/catalog.js'
import { assertSchemaDefinition, loadSchemas, validateValue } from '../lib/schema.js'
import { parseJsonStrict } from '../lib/json-file.js'
import { FlowgateError } from '../lib/errors.js'
import { loadContracts } from '../lib/contracts.js'
import { startRun, intentText } from './helpers.mjs'

const schemas = loadSchemas(SCHEMAS_DIR)
const pluginRoot = fileURLToPath(new URL('../', import.meta.url))

test('every shipped schema passes its own definition check', () => {
  assert.equal(schemas.size, 10)
  for (const [name, schema] of schemas) {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', `${name}: missing $schema`)
    assert.equal(typeof schema.$id, 'string', `${name}: missing $id`)
    assert.equal(typeof schema.title, 'string', `${name}: missing title`)
    assertSchemaDefinition(schema, name)
  }
})

test('an unsupported schema keyword fails closed', () => {
  assert.throws(
    () => assertSchemaDefinition({ type: 'object', nonsense: true }, 'probe'),
    error => error instanceof FlowgateError && error.code === 'SCHEMA_INVALID',
  )
})

test('unknown properties are rejected when additionalProperties is false', () => {
  const result = validateValue({ name: 'intent', extra: true }, schemas.get('stage-contract'))
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(error => error.keyword === 'additionalProperties' && error.message.includes('extra')))
})

test('an unknown enum member is rejected', () => {
  const workflow = {
    schema_version: 1,
    name: 'probe',
    description: 'probe workflow',
    match: { keywords: ['probe'], priority: 10 },
    stages: [{ skill: 'intent', required: true, purpose: 'probe' }],
    rules: ['probe'],
    on_optional_missing: 'explode',
    completion: 'probe complete',
  }
  const result = validateValue(workflow, schemas.get('workflow'))
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(error => error.path.endsWith('/on_optional_missing')))
})

test('duplicate JSON keys fail closed', () => {
  assert.throws(
    () => parseJsonStrict('{"a": 1, "a": 2}', 'probe'),
    /duplicate key "a"/,
  )
})

test('malformed JSON fails closed', () => {
  assert.throws(() => parseJsonStrict('{"a": ', 'probe'), /invalid JSON/)
})

test('local $ref resolution validates nested definitions', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: { type: 'array', items: { $ref: '#/definitions/item' } },
    },
    definitions: {
      item: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } },
    },
  }
  assertSchemaDefinition(schema, 'probe')
  assert.equal(validateValue({ items: [{ id: 'a' }] }, schema).ok, true)
  const bad = validateValue({ items: [{ id: 1 }] }, schema)
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some(error => error.path === '#/items/0/id'))
})

test('uniqueItems and pattern constraints are enforced', () => {
  const schema = {
    type: 'array',
    uniqueItems: true,
    items: { type: 'string', pattern: '^[a-z]+$' },
  }
  assertSchemaDefinition(schema, 'probe')
  assert.equal(validateValue(['a', 'b'], schema).ok, true)
  assert.equal(validateValue(['a', 'a'], schema).ok, false)
  assert.equal(validateValue(['A'], schema).ok, false)
})

test('the contracts file rejects unknown top-level fields and wrong versions', () => {
  const raw = JSON.parse(readFileSync(join(pluginRoot, 'assets/contracts.json'), 'utf8'))
  const extra = { ...raw, unexpected: true }
  assert.equal(validateValue(extra, schemas.get('contracts-file')).ok, false)
  const wrongVersion = { ...raw, schema_version: 3 }
  assert.equal(validateValue(wrongVersion, schemas.get('contracts-file')).ok, false)
  assert.ok(loadContracts().contract_version === 2)
})

test('the run-state schema accepts a real persisted run and rejects a smuggled field', async () => {
  const stack = await startRun()
  stack.controller.recordStageOutput(stack.run.run_id, intentText())
  const state = stack.controller.status(stack.run.run_id)
  const accepted = validateValue(state, schemas.get('run-state'))
  assert.equal(accepted.ok, true, accepted.errors.map(error => `${error.path}: ${error.message}`).join('; '))
  const mutated = { ...state, smuggled: true }
  const rejected = validateValue(mutated, schemas.get('run-state'))
  assert.equal(rejected.ok, false)
  assert.ok(rejected.errors.some(error => error.path === '#/smuggled'))
})

test('a state with an invalid status enum is rejected', async () => {
  const stack = await startRun()
  const state = stack.controller.status(stack.run.run_id)
  const rejected = validateValue({ ...state, status: 'almost-done' }, schemas.get('run-state'))
  assert.equal(rejected.ok, false)
})
