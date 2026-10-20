import { createHash } from 'node:crypto'

/**
 * Deterministic JSON: object keys sorted recursively, arrays preserved.
 * Two values with the same canonical form are byte-identical.
 */
export function canonical(value) {
  return JSON.stringify(sortValue(value))
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    const sorted = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue
      sorted[key] = sortValue(value[key])
    }
    return sorted
  }
  return value
}

export function digestOf(value) {
  return `sha256:${createHash('sha256').update(canonical(value), 'utf8').digest('hex')}`
}

export function digestText(text) {
  return `sha256:${createHash('sha256').update(String(text), 'utf8').digest('hex')}`
}

export function clones(value) {
  return JSON.parse(JSON.stringify(value))
}

/** Byte length of a value's canonical form. */
export function canonicalBytes(value) {
  return Buffer.byteLength(canonical(value), 'utf8')
}
