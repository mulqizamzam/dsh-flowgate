#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GATE_ORDER, gateFile } from '../lib/gates.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined

const gates = GATE_ORDER.map((name, index) => ({ name, order: index + 1, file: gateFile(name) }))
  .filter(gate => only === undefined || gate.name === only || String(gate.order) === only)

if (gates.length === 0) {
  console.error(`unknown gate: ${only}`)
  process.exit(2)
}

for (const gate of gates) {
  const path = `${root}${gate.file}`
  if (!existsSync(path)) {
    console.error(`GATE ${gate.order}/${GATE_ORDER.length} ${gate.name}: FAIL — file ${gate.file} is missing`)
    process.exit(1)
  }
  console.log(`\n=== GATE ${gate.order}/${GATE_ORDER.length}: ${gate.name} (${gate.file}) ===`)
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', gate.file], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.error !== undefined) {
    console.error(`GATE ${gate.order}/${GATE_ORDER.length} ${gate.name}: FAIL — ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`\nGATE ${gate.order}/${GATE_ORDER.length} ${gate.name}: FAIL (exit ${result.status}); later gates were not run.`)
    process.exit(result.status === null ? 1 : result.status)
  }
  console.log(`GATE ${gate.order}/${GATE_ORDER.length} ${gate.name}: PASS`)
}

if (only === undefined) {
  console.log(`\nAll ${GATE_ORDER.length} gates passed in order.`)
}
