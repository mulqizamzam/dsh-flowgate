import { readJsonFileSync } from './json-file.js'
import { loadSchemas, validateValue } from './schema.js'
import { FlowgateError, CODES } from './errors.js'
import { ARTIFACT_FIELDS_FILE, SCHEMAS_DIR } from './catalog.js'

const EVIDENCE_FIELDS = ['FACTS', 'ASSUMPTIONS', 'PROOF', 'UNKNOWN', 'DECISION']
const EVIDENCE_HEADING = /^##\s+EVIDENCE\s*$/
const HEADING = /^##\s+\S/
const FIELD_LINE = /^\s*([A-Z][A-Z0-9_ ]*):\s*(.*)$/

/** Load and validate the artifact field requirements shipped in assets/. */
export function loadArtifactFields(file = ARTIFACT_FIELDS_FILE, schemas = loadSchemas(SCHEMAS_DIR)) {
  const data = readJsonFileSync(file)
  const schema = schemas.get('artifact-fields')
  if (schema === undefined) {
    throw new FlowgateError(CODES.SCHEMA_INVALID, `${file}: schemas/artifact-fields.schema.json is not installed`)
  }
  const result = validateValue(data, schema, schema)
  if (!result.ok) {
    const first = result.errors[0]
    throw new FlowgateError(CODES.SCHEMA_INVALID, `${file}: ${first.message} at ${first.path}`)
  }
  return data
}

export function artifactMarker(artifactType) {
  return String(artifactType).replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

/**
 * Parse one stage output: the artifact block that starts at the artifact marker
 * line and the terminal evidence block that follows it.
 *
 * The parser never interprets prose; it records which declared fields appeared,
 * with which values, and whether the evidence block is structurally complete.
 *
 * One assistant message may carry several stage artifacts. `markers` names the
 * artifact markers of the run, and an artifact ends where the next marker
 * starts, so its fields and its evidence block are never read across the
 * artifact that follows it.
 */
export function parseStageOutput(text, artifactType, markers = []) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const marker = artifactMarker(artifactType)
  const markerIndex = lines.findIndex(line => line.trim() === marker)
  if (markerIndex < 0) return undefined
  const bound = findNextMarker(lines, markerIndex + 1, markers)
  const evidenceIndex = lines.findIndex((line, index) => index > markerIndex && index < bound && EVIDENCE_HEADING.test(line.trim()))
  if (evidenceIndex < 0) {
    return {
      artifact_type: artifactType,
      marker,
      fields: parseFields(lines.slice(markerIndex + 1, bound)),
      evidence: undefined,
      evidence_error: 'evidence block missing: no "## EVIDENCE" heading after the artifact',
      content: lines.slice(markerIndex, bound).join('\n'),
    }
  }
  const fields = parseFields(lines.slice(markerIndex + 1, evidenceIndex))
  const evidence = parseEvidenceBlock(lines.slice(evidenceIndex + 1, bound), evidenceIndex + 1)
  return {
    artifact_type: artifactType,
    marker,
    fields,
    evidence: evidence.fields,
    evidence_error: evidence.error,
    content: lines.slice(markerIndex, Math.min(bound, evidenceIndex + 1 + evidence.fieldLines)).join('\n'),
  }
}

/** The index of the next artifact marker after `from`, or the end of the text. */
function findNextMarker(lines, from, markers) {
  if (markers.length === 0) return lines.length
  const known = new Set(markers)
  for (let index = from; index < lines.length; index += 1) {
    if (known.has(lines[index].trim())) return index
  }
  return lines.length
}

function parseFields(lines) {
  const fields = {}
  for (const line of lines) {
    const match = FIELD_LINE.exec(line)
    if (match === null) continue
    const key = normaliseFieldName(match[1])
    const value = match[2].trim()
    if (!Object.prototype.hasOwnProperty.call(fields, key)) fields[key] = []
    fields[key].push(value)
  }
  return fields
}

function normaliseFieldName(name) {
  return String(name).trim().replace(/\s+/g, '_')
}

function parseEvidenceBlock(lines, startLine) {
  const fields = []
  let fieldLines = 0
  let current
  for (const [offset, line] of lines.entries()) {
    const trimmed = line.trim()
    if (HEADING.test(trimmed)) {
      return {
        fields: undefined,
        error: `evidence block is not terminal: another heading appears at line ${startLine + offset + 1}`,
        fieldLines,
      }
    }
    const match = /^([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(trimmed)
    if (match !== null) {
      current = { name: match[1], value: match[2].trim() }
      fields.push(current)
      fieldLines = offset + 1
      continue
    }
    if (trimmed === '' || current === undefined) continue
    const continuation = trimmed.replace(/^[-*]\s+/, '')
    current.value = current.value === '' ? continuation : `${current.value} ${continuation}`
    fieldLines = offset + 1
  }
  if (fields.length === 0) {
    return { fields: undefined, error: 'evidence block has no FACTS/ASSUMPTIONS/PROOF/UNKNOWN/DECISION fields', fieldLines }
  }
  if (fields.length !== EVIDENCE_FIELDS.length) {
    return {
      fields: undefined,
      error: `evidence block incomplete: expected ${EVIDENCE_FIELDS.join(', ')}, found ${fields.map(field => field.name).join(', ')}`,
      fieldLines,
    }
  }
  for (const [index, expected] of EVIDENCE_FIELDS.entries()) {
    const actual = fields[index]
    if (actual.name !== expected) {
      return {
        fields: undefined,
        error: `evidence block out of order: expected ${expected} at position ${index + 1}, found ${actual.name}`,
        fieldLines,
      }
    }
    if (actual.value === '') {
      return { fields: undefined, error: `evidence field "${actual.name}" is empty; write "none" explicitly`, fieldLines }
    }
  }
  return {
    fields: Object.fromEntries(fields.map(field => [field.name, field.value])),
    error: undefined,
    fieldLines,
  }
}

/** Validate the artifact block against the declared minimum fields for its type. */
export function validateArtifactStructure(parsed, spec) {
  const errors = []
  if (parsed === undefined) {
    errors.push({ path: '#', message: 'artifact block missing: the expected marker line was not found' })
    return { ok: false, errors }
  }
  if (spec === undefined) {
    errors.push({ path: '#', message: `no field specification for artifact type "${parsed.artifact_type}"` })
    return { ok: false, errors }
  }
  for (const field of spec.required) {
    const values = parsed.fields[field] ?? []
    if (values.length === 0) {
      errors.push({ path: `#/${field}`, message: `required field ${field} is missing` })
      continue
    }
    if (values.every(value => value.trim() === '')) {
      errors.push({ path: `#/${field}`, message: `required field ${field} is empty; write "none" explicitly` })
    }
  }
  for (const [field, allowed] of Object.entries(spec.enumerated ?? {})) {
    for (const value of parsed.fields[field] ?? []) {
      if (!allowed.includes(value.toLowerCase())) {
        errors.push({
          path: `#/${field}`,
          message: `${field} value "${value}" is not one of ${allowed.join(', ')}`,
        })
      }
    }
  }
  if (parsed.evidence_error !== undefined) {
    errors.push({ path: '#/EVIDENCE', message: parsed.evidence_error })
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Parse machine-readable evidence declarations embedded in a stage output.
 * Each declaration is one `EVIDENCE_RECORD: {json}` line. Unknown keys are a
 * hard failure: a declaration may not invent evidence fields.
 */
export function parseEvidenceRecords(text) {
  const records = []
  const errors = []
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const allowed = new Set(['id', 'type', 'supports', 'command', 'result', 'observation_id'])
  for (const [index, line] of lines.entries()) {
    const match = /^\s*EVIDENCE_RECORD:\s*(\{.*\})\s*$/.exec(line)
    if (match === null) continue
    let record
    try {
      record = JSON.parse(match[1])
    } catch (error) {
      errors.push({ line: index + 1, message: `EVIDENCE_RECORD is not valid JSON: ${error.message}` })
      continue
    }
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      errors.push({ line: index + 1, message: 'EVIDENCE_RECORD must be a JSON object' })
      continue
    }
    const unknown = Object.keys(record).filter(key => !allowed.has(key))
    if (unknown.length > 0) {
      errors.push({ line: index + 1, message: `EVIDENCE_RECORD has unknown keys: ${unknown.join(', ')}` })
      continue
    }
    if (typeof record.id !== 'string' || record.id === '') {
      errors.push({ line: index + 1, message: 'EVIDENCE_RECORD must name the contract evidence id it satisfies' })
      continue
    }
    if (record.type !== undefined && typeof record.type !== 'string') {
      errors.push({ line: index + 1, message: 'EVIDENCE_RECORD type must be a string' })
      continue
    }
    if (record.supports !== undefined && (!Array.isArray(record.supports) || record.supports.some(item => typeof item !== 'string'))) {
      errors.push({ line: index + 1, message: 'EVIDENCE_RECORD supports must be an array of strings' })
      continue
    }
    if (record.result !== undefined && !['pass', 'fail', 'none', 'declared'].includes(record.result)) {
      errors.push({ line: index + 1, message: 'EVIDENCE_RECORD result must be pass, fail, none, or declared' })
      continue
    }
    records.push({
      id: record.id,
      type: record.type,
      supports: record.supports ?? [],
      command: typeof record.command === 'string' ? record.command : undefined,
      result: record.result ?? 'declared',
      observation_id: typeof record.observation_id === 'string' ? record.observation_id : undefined,
      line: index + 1,
    })
  }
  return { records, errors }
}

/** Convenience: validate the human-readable evidence block on its own. */
export function validateEvidenceBlock(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex(line => EVIDENCE_HEADING.test(line.trim()))
  if (start < 0) {
    throw new FlowgateError(CODES.ARTIFACT_SCHEMA_INVALID, 'evidence block missing: no "## EVIDENCE" heading')
  }
  const parsed = parseEvidenceBlock(lines.slice(start + 1), start + 1)
  if (parsed.error !== undefined) {
    throw new FlowgateError(CODES.ARTIFACT_SCHEMA_INVALID, parsed.error)
  }
  return EVIDENCE_FIELDS
}
