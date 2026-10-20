/**
 * The fixed v2 gate order. The runner executes exactly this list and stops at
 * the first failing gate, so a missing or renamed gate cannot silently reduce
 * coverage.
 */
export const GATE_ORDER = Object.freeze([
  'structural',
  'json-schema',
  'host-capabilities',
  'skill-load',
  'contracts',
  'workflows',
  'dependency-graph',
  'artifact-registry',
  'evidence-registry',
  'transition-rules',
  'invalidation',
  'checkpoint',
  'recovery-safety',
  'routing',
  'composition-security',
  'persistence',
  'report-and-command-e2e',
  'live-host-verification',
])

export function gateFile(name) {
  return `tests/${name}.test.mjs`
}
