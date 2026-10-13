const FIELDS = ['FACTS', 'ASSUMPTIONS', 'PROOF', 'UNKNOWN', 'DECISION']

export function validateEvidenceBlock(markdown) {
  const lines = String(markdown).split('\n')
  const start = lines.findIndex(line => line.trim() === '## EVIDENCE')
  if (start < 0) {
    throw new Error('evidence block missing: no "## EVIDENCE" heading')
  }
  const found = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line.startsWith('## ')) break
    const match = /^(FACTS|ASSUMPTIONS|PROOF|UNKNOWN|DECISION):/.exec(line)
    if (match !== null) found.push(match[1])
  }
  if (found.length !== FIELDS.length) {
    throw new Error(`evidence block incomplete: expected ${FIELDS.join(', ')}, found ${found.join(', ') || 'none'}`)
  }
  for (let index = 0; index < FIELDS.length; index += 1) {
    if (found[index] !== FIELDS[index]) {
      throw new Error(`evidence block out of order: expected ${FIELDS[index]} at position ${index + 1}, found ${found[index]}`)
    }
  }
  return FIELDS
}
