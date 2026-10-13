import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse as parseYaml } from 'yaml'
import { SKILLS_DIR } from '../lib/catalog.js'
import { loadContracts } from '../lib/contracts.js'

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_FILE_BYTES = 24000

const contracts = loadContracts()
const vocabulary = contracts.vocabulary

function skillFiles() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ name: entry.name, file: join(SKILLS_DIR, entry.name, 'SKILL.md') }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function parseFrontmatter(raw, file) {
  const lines = raw.split('\n')
  assert.equal(lines[0].replace(/\r$/, ''), '---', `${file}: first line must be ---`)
  let closing = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].replace(/\r$/, '') === '---') {
      closing = index
      break
    }
  }
  assert.notEqual(closing, -1, `${file}: frontmatter closing --- missing`)
  const data = parseYaml(lines.slice(1, closing).join('\n'))
  assert.equal(typeof data, 'object', `${file}: frontmatter must parse to an object`)
  assert.notEqual(data, null, `${file}: frontmatter must parse to an object`)
  return data
}

function frontmatterOf(entry) {
  return parseFrontmatter(readFileSync(entry.file, 'utf8'), entry.file)
}

test('every shipped skill file respects the 24000 byte size limit', () => {
  for (const { name, file } of skillFiles()) {
    const size = statSync(file).size
    assert.ok(size <= MAX_FILE_BYTES, `${file}: ${size} bytes exceeds the ${MAX_FILE_BYTES} byte limit (${name})`)
  }
})

test('every shipped skill parses with a kebab-case name matching its directory', () => {
  for (const entry of skillFiles()) {
    const data = frontmatterOf(entry)
    assert.equal(typeof data.name, 'string', `${entry.file}: frontmatter name must be a string`)
    assert.ok(KEBAB_CASE.test(data.name), `${entry.file}: name "${data.name}" is not kebab-case`)
    assert.equal(data.name, entry.name, `${entry.file}: frontmatter name does not match directory name "${entry.name}"`)
  }
})

test('every shipped skill description contains Use when within 400 characters', () => {
  for (const entry of skillFiles()) {
    const data = frontmatterOf(entry)
    assert.equal(typeof data.description, 'string', `${entry.file}: description must be a string`)
    assert.ok(data.description.includes('Use when'), `${entry.file}: description must contain "Use when"`)
    assert.ok(data.description.length <= 400, `${entry.file}: description is ${data.description.length} characters, over the 400 limit`)
  }
})

test('every shipped skill frontmatter matches its contract', () => {
  for (const entry of skillFiles()) {
    const data = frontmatterOf(entry)
    const contract = contracts.contracts[entry.name]
    assert.ok(contract !== undefined, `${entry.file}: no contract entry for skill "${entry.name}"`)
    assert.equal(data.produces, contract.produces[0], `${entry.file}: produces must equal contract produces[0] "${contract.produces[0]}"`)
    assert.ok(vocabulary.risk_levels.includes(data.risk_level), `${entry.file}: risk_level "${String(data.risk_level)}" is not in the vocabulary`)
  }
})
