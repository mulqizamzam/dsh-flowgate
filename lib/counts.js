import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CONTRACTS_FILE, SKILLS_DIR, WORKFLOWS_DIR, shippedSkills } from './catalog.js'
import { loadContracts } from './contracts.js'
import { loadWorkflows } from './workflows.js'

const testsDir = fileURLToPath(new URL('../tests/', import.meta.url))

export function derivedCounts() {
  const skills = shippedSkills(SKILLS_DIR)
  const contracts = loadContracts(CONTRACTS_FILE)
  const workflows = loadWorkflows(WORKFLOWS_DIR)
  const artifactTypes = new Set(Object.values(contracts.contracts).flatMap(contract => contract.produces))
  return {
    skills: skills.length,
    workflows: workflows.size,
    contracts: Object.keys(contracts.contracts).length,
    aliases: skills.length,
    commands: skills.length + 1,
    artifacts: artifactTypes.size,
    gates: gateCount(),
  }
}

// The counts gate runs twice in the test command (PRD section 14 ordering), so gates are test files plus one.
function gateCount() {
  const files = readdirSync(testsDir).filter(name => name.endsWith('.test.mjs'))
  return files.length + 1
}
