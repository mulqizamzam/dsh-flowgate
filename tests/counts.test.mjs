import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { derivedCounts } from '../lib/counts.js'

const README_FILE = fileURLToPath(new URL('../README.md', import.meta.url))
const BEGIN_MARKER = '<!-- COUNTS:BEGIN -->'
const END_MARKER = '<!-- COUNTS:END -->'

const EXPECTED_LABELS = [
  ['Skills', 'skills'],
  ['Workflows', 'workflows'],
  ['Contracts', 'contracts'],
  ['Alias commands', 'aliases'],
  ['Commands', 'commands'],
  ['Artifact types', 'artifacts'],
  ['Test gates', 'gates'],
]

function countsRegion() {
  const readme = readFileSync(README_FILE, 'utf8')
  const start = readme.indexOf(BEGIN_MARKER)
  const end = readme.indexOf(END_MARKER)
  assert.notEqual(start, -1, 'README.md must carry the COUNTS:BEGIN marker')
  assert.notEqual(end, -1, 'README.md must carry the COUNTS:END marker')
  assert.ok(end > start, 'README.md COUNTS markers are out of order')
  return readme.slice(start, end)
}

test('README carries the generated counts region', () => {
  const region = countsRegion()
  for (const [label] of EXPECTED_LABELS) {
    assert.ok(region.includes(`| ${label} |`), `README counts region must list ${label}`)
  }
})

test('every count asserted in README matches lib/counts.js', () => {
  const counts = derivedCounts()
  const region = countsRegion()
  for (const [label, key] of EXPECTED_LABELS) {
    assert.ok(region.includes(`| ${label} | ${counts[key]} |`), `README says ${label} is not ${counts[key]}; run node scripts/gen-readme.mjs`)
  }
})

test('the derived counts match the PRD totals', () => {
  const counts = derivedCounts()
  assert.equal(counts.skills, 8)
  assert.equal(counts.workflows, 5)
  assert.equal(counts.contracts, 8)
  assert.equal(counts.aliases, 8)
  assert.equal(counts.commands, 9)
  assert.equal(counts.artifacts, 8)
  assert.equal(counts.gates, 14)
})
