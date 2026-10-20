import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { FlowgateError, CODES } from './errors.js'
import { canonical } from './canonical.js'
import { parseJsonStrict } from './json-file.js'

/**
 * A deliberately small JSON Schema subset. It supports every keyword Flowgate
 * ships in `schemas/` and rejects any keyword it does not understand, so a
 * schema cannot silently weaken a check by using an unsupported constraint.
 */

const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description'])

export const SUPPORTED_KEYWORDS = new Set([
  ...ANNOTATIONS,
  '$ref',
  'type',
  'enum',
  'const',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'minProperties',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'definitions',
])

/** Throw when a schema uses a keyword outside the supported set or a malformed keyword value. */
export function assertSchemaDefinition(schema, source) {
  checkSchema(schema, source, '#')
  return schema
}

function checkSchema(schema, source, path) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new FlowgateError(CODES.SCHEMA_INVALID, `${source}${path}: schema must be an object`)
  }
  if (typeof schema.$ref === 'string') {
    if (!schema.$ref.startsWith('#/')) {
      throw new FlowgateError(CODES.SCHEMA_INVALID, `${source}${path}: $ref must be a local reference (#/...)`)
    }
    for (const key of Object.keys(schema)) {
      if (key !== '$ref' && !ANNOTATIONS.has(key)) {
        throw new FlowgateError(CODES.SCHEMA_INVALID, `${source}${path}: "$ref" cannot be combined with "${key}"`)
      }
    }
    return
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw new FlowgateError(CODES.SCHEMA_INVALID, `${source}${path}: unsupported schema keyword "${key}"`)
    }
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (types.length === 0) {
      throw new FlowgateError(CODES.SCHEMA_INVALID, `${source}${path}: type array must not be empty`)
    }
    for (const type of types) {
      if (typeof type !== 'string' || !TYPES.has(type)) {
        throw new FlowgateError(CODES.SCHEMA_INVALID, `${source}${path}: unknown type "${String(type)}"`)
      }
    }
  }
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    throw new FlowgateError(CODES.SCHEMA_INVALID, `${source}${path}: enum must be an array`)
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some(item => typeof item !== 'string')) {
      throw new FlowgateError(CODES.SCHEMA_INVALID, `${source}${path}: required must be an array of strings`)
    }
  }
  if (schema.properties !== undefined) {
    assertPlainObject(schema.properties, `${source}${path}: properties must be an object`)
    for (const [key, child] of Object.entries(schema.properties)) {
      checkSchema(child, source, `${path}/${escapePointer(key)}`)
    }
  }
  if (schema.additionalProperties !== undefined
    && typeof schema.additionalProperties !== 'boolean') {
    checkSchema(schema.additionalProperties, source, `${path}/additionalProperties`)
  }
  if (schema.items !== undefined) checkSchema(schema.items, source, `${path}/items`)
  if (schema.definitions !== undefined) {
    assertPlainObject(schema.definitions, `${source}${path}: definitions must be an object`)
    for (const [key, child] of Object.entries(schema.definitions)) {
      checkSchema(child, source, `${path}/definitions/${escapePointer(key)}`)
    }
  }
  for (const combinator of ['oneOf', 'anyOf', 'allOf']) {
    if (schema[combinator] === undefined) continue
    if (!Array.isArray(schema[combinator]) || schema[combinator].length === 0) {
      throw new FlowgateError(CODES.SCHEMA_INVALID, `${source}${path}: ${combinator} must be a non-empty array`)
    }
    for (const [index, child] of schema[combinator].entries()) {
      checkSchema(child, source, `${path}/${combinator}/${index}`)
    }
  }
  if (schema.not !== undefined) checkSchema(schema.not, source, `${path}/not`)
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') {
      throw new FlowgateError(CODES.SCHEMA_INVALID, `${source}${path}: pattern must be a string`)
    }
    try {
      new RegExp(schema.pattern, 'u')
    } catch {
      throw new FlowgateError(CODES.SCHEMA_INVALID, `${source}${path}: pattern is not a valid regular expression`)
    }
  }
}

function assertPlainObject(value, message) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new FlowgateError(CODES.SCHEMA_INVALID, message)
  }
}

/**
 * Validate a value. Returns every violation rather than stopping at the first,
 * so a report can list all check failures in one pass.
 */
export function validateValue(value, schema, root = schema) {
  const errors = []
  checkValue(value, schema, root, '#', errors)
  return { ok: errors.length === 0, errors }
}

export function assertValid(value, schema, source, code = CODES.SCHEMA_INVALID, root = schema) {
  const result = validateValue(value, schema, root)
  if (!result.ok) {
    const first = result.errors[0]
    throw new FlowgateError(code, `${source}: ${first.message} at ${first.path}`, 'Correct the value or the schema; Flowgate rejects unknown or invalid data.')
  }
  return value
}

function checkValue(value, schema, root, path, errors) {
  if (schema.$ref !== undefined) {
    const target = resolveRef(root, schema.$ref, path, errors)
    if (target !== undefined) checkValue(value, target, root, path, errors)
    return
  }

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push({ path, keyword: 'type', message: `expected ${describeTypes(schema.type)}, got ${describeValue(value)}` })
    return
  }

  if (schema.enum !== undefined && !schema.enum.some(option => canonical(option) === canonical(value))) {
    errors.push({ path, keyword: 'enum', message: `value is not one of ${schema.enum.map(item => JSON.stringify(item)).join(', ')}` })
  }

  if (schema.const !== undefined && canonical(schema.const) !== canonical(value)) {
    errors.push({ path, keyword: 'const', message: `expected constant ${JSON.stringify(schema.const)}` })
  }

  if (schema.allOf !== undefined) {
    for (const [index, child] of schema.allOf.entries()) {
      checkValue(value, child, root, `${path}/allOf/${index}`, errors)
    }
  }
  if (schema.anyOf !== undefined) {
    const passes = schema.anyOf.filter(child => validateValue(value, child, root).ok)
    if (passes.length === 0) errors.push({ path, keyword: 'anyOf', message: 'value matches none of the allowed shapes' })
  }
  if (schema.oneOf !== undefined) {
    const matches = schema.oneOf.filter(child => validateValue(value, child, root).ok)
    if (matches.length !== 1) {
      errors.push({ path, keyword: 'oneOf', message: `value must match exactly one shape (matched ${matches.length})` })
    }
  }
  if (schema.not !== undefined && validateValue(value, schema.not, root).ok) {
    errors.push({ path, keyword: 'not', message: 'value must not match the excluded shape' })
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    checkObject(value, schema, root, path, errors)
  } else if (Array.isArray(value)) {
    checkArray(value, schema, root, path, errors)
  } else if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) {
      errors.push({ path, keyword: 'minLength', message: `string is shorter than ${schema.minLength} characters` })
    }
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) {
      errors.push({ path, keyword: 'maxLength', message: `string is longer than ${schema.maxLength} characters` })
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push({ path, keyword: 'pattern', message: `string does not match /${schema.pattern}/` })
    }
  } else if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, keyword: 'minimum', message: `number is below ${schema.minimum}` })
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, keyword: 'maximum', message: `number is above ${schema.maximum}` })
    }
  }
}

function checkObject(value, schema, root, path, errors) {
  const properties = schema.properties ?? {}
  const required = schema.required ?? []
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push({ path: `${path}/${escapePointer(key)}`, keyword: 'required', message: `missing required property "${key}"` })
    }
  }
  if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
    errors.push({ path, keyword: 'minProperties', message: `object has fewer than ${schema.minProperties} properties` })
  }
  for (const [key, child] of Object.entries(value)) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      checkValue(child, properties[key], root, `${path}/${escapePointer(key)}`, errors)
      continue
    }
    if (schema.additionalProperties === false) {
      errors.push({ path: `${path}/${escapePointer(key)}`, keyword: 'additionalProperties', message: `unknown property "${key}"` })
    } else if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
      checkValue(child, schema.additionalProperties, root, `${path}/${escapePointer(key)}`, errors)
    }
  }
}

function checkArray(value, schema, root, path, errors) {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    errors.push({ path, keyword: 'minItems', message: `array has fewer than ${schema.minItems} items` })
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    errors.push({ path, keyword: 'maxItems', message: `array has more than ${schema.maxItems} items` })
  }
  if (schema.uniqueItems === true) {
    const seen = new Set()
    for (const item of value) {
      const key = canonical(item)
      if (seen.has(key)) {
        errors.push({ path, keyword: 'uniqueItems', message: 'array contains a duplicate item' })
        break
      }
      seen.add(key)
    }
  }
  if (schema.items !== undefined) {
    for (const [index, item] of value.entries()) {
      checkValue(item, schema.items, root, `${path}/${index}`, errors)
    }
  }
}

function resolveRef(root, ref, path, errors) {
  const segments = ref.slice(2).split('/').map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
  let node = root
  for (const segment of segments) {
    if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, segment)) {
      errors.push({ path, keyword: '$ref', message: `unresolvable reference "${ref}"` })
      return undefined
    }
    node = node[segment]
  }
  return node
}

function matchesType(value, declared) {
  const types = Array.isArray(declared) ? declared : [declared]
  return types.some(type => matchesSingleType(value, type))
}

function matchesSingleType(value, type) {
  switch (type) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
    case 'array': return Array.isArray(value)
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    default: return false
  }
}

function describeTypes(declared) {
  return Array.isArray(declared) ? declared.join('|') : declared
}

function describeValue(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function escapePointer(key) {
  return String(key).replace(/~/g, '~0').replace(/\//g, '~1')
}

/** Load every `<name>.schema.json` below a directory and validate the schema itself. */
export function loadSchemas(dir) {
  const schemas = new Map()
  const files = readdirSync(dir).filter(name => name.endsWith('.schema.json')).sort()
  for (const file of files) {
    const name = basename(file, '.schema.json')
    const schema = parseJsonStrict(readFileSync(join(dir, file), 'utf8'), join(dir, file))
    assertSchemaDefinition(schema, join(dir, file))
    schemas.set(name, schema)
  }
  return schemas
}

export function schemaNamed(schemas, name) {
  const schema = schemas.get(name)
  if (schema === undefined) {
    throw new FlowgateError(CODES.SCHEMA_INVALID, `missing schema "${name}"`)
  }
  return schema
}
