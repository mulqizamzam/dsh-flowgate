#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { derivedCounts } from '../lib/counts.js'

const README_FILE = fileURLToPath(new URL('../README.md', import.meta.url))
const BEGIN_MARKER = '<!-- COUNTS:BEGIN -->'
const END_MARKER = '<!-- COUNTS:END -->'

const ROWS = [
  ['Skills', 'skills'],
  ['Workflows', 'workflows'],
  ['Contracts', 'contracts'],
  ['Alias commands', 'aliases'],
  ['Commands', 'commands'],
  ['Artifact types', 'artifacts'],
  ['Test gates', 'gates'],
]

const counts = derivedCounts()
const region = [
  BEGIN_MARKER,
  '',
  '| Count | Value |',
  '| --- | --- |',
  ...ROWS.map(([label, key]) => `| ${label} | ${counts[key]} |`),
  '',
  END_MARKER,
].join('\n')

const current = readFileSync(README_FILE, 'utf8')
const start = current.indexOf(BEGIN_MARKER)
const end = current.indexOf(END_MARKER)
if (start < 0 || end < 0 || end <= start) {
  console.error('README.md is missing an ordered COUNTS region; add the markers and rerun.')
  process.exit(1)
}
const next = current.slice(0, start) + region + current.slice(end + END_MARKER.length)
if (next === current) {
  console.log('README counts region already current.')
  process.exit(0)
}
writeFileSync(README_FILE, next)
console.log(`README counts region regenerated: ${ROWS.map(([label, key]) => `${label}=${counts[key]}`).join(' ')}`)
