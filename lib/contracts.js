import { readJsonFileSync } from './json-file.js'
import { CONTRACTS_FILE, shippedSkills } from './catalog.js'

export function validateContracts(data, source, skills = shippedSkills()) {
  assertObject(data, `${source}: top level must be an object`)
  assertSchemaVersion(data, source)
  const vocabulary = validateVocabulary(data.vocabulary, source)
  assertObject(data.contracts, `${source}: contracts must be an object`)
  for (const [name, contract] of Object.entries(data.contracts)) {
    validateContractEntry(name, contract, vocabulary, source)
  }
  const shipped = new Set(skills)
  const declared = new Set(Object.keys(data.contracts))
  for (const name of declared) {
    if (!shipped.has(name)) {
      throw new Error(`${source}: contract "${name}" does not name a shipped skill`)
    }
  }
  for (const name of shipped) {
    if (!declared.has(name)) {
      throw new Error(`${source}: shipped skill "${name}" has no contract entry`)
    }
  }
  return { vocabulary, contracts: data.contracts }
}

export function loadContracts(file = CONTRACTS_FILE) {
  return validateContracts(readJsonFileSync(file), file)
}

export function validateArtifactChain(workflow, contracts, source) {
  const available = new Set(['user-request'])
  const stages = workflow.stages
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index]
    const contract = contracts[stage.skill]
    if (contract === undefined) {
      throw new Error(`${source}: stage ${index + 1} "${stage.skill}" has no contract`)
    }
    for (const required of contract.requires) {
      if (!available.has(required)) {
        throw new Error(`${source}: stage ${index + 1} "${stage.skill}" requires "${required}", not produced by any prior stage or the user request`)
      }
    }
    if (contract.requires_any.length > 0) {
      const anyAvailable = contract.requires_any.some(artifact => available.has(artifact))
      if (!anyAvailable) {
        throw new Error(`${source}: stage ${index + 1} "${stage.skill}" requires at least one of [${contract.requires_any.join(', ')}], none available`)
      }
    }
    for (const produced of contract.produces) available.add(produced)
  }
}

function validateVocabulary(vocabulary, source) {
  assertObject(vocabulary, `${source}: vocabulary must be an object`)
  const artifacts = assertStringArray(vocabulary.artifacts, `${source}: vocabulary.artifacts must be an array of strings`)
  const categories = assertStringArray(vocabulary.categories, `${source}: vocabulary.categories must be an array of strings`)
  const riskLevels = assertStringArray(vocabulary.risk_levels, `${source}: vocabulary.risk_levels must be an array of strings`)
  return { artifacts, categories, risk_levels: riskLevels }
}

function validateContractEntry(name, contract, vocabulary, source) {
  assertObject(contract, `${source}: contract "${name}" must be an object`)
  const produces = assertStringArray(contract.produces, `${source}: contract "${name}" produces must be an array of strings`)
  const consumes = assertStringArray(contract.consumes, `${source}: contract "${name}" consumes must be an array of strings`)
  const requires = assertStringArray(contract.requires, `${source}: contract "${name}" requires must be an array of strings`)
  const requiresAny = assertStringArray(contract.requires_any, `${source}: contract "${name}" requires_any must be an array of strings`)
  const categories = assertStringArray(contract.categories, `${source}: contract "${name}" categories must be an array of strings`)
  for (const artifact of produces) {
    if (!vocabulary.artifacts.includes(artifact)) {
      throw new Error(`${source}: contract "${name}" produces unknown artifact "${artifact}"`)
    }
  }
  for (const artifact of consumes) {
    if (!vocabulary.artifacts.includes(artifact)) {
      throw new Error(`${source}: contract "${name}" consumes unknown artifact "${artifact}"`)
    }
  }
  for (const artifact of requires) {
    if (!vocabulary.artifacts.includes(artifact)) {
      throw new Error(`${source}: contract "${name}" requires unknown artifact "${artifact}"`)
    }
    if (!consumes.includes(artifact)) {
      throw new Error(`${source}: contract "${name}" requires artifact "${artifact}" not listed in consumes`)
    }
  }
  for (const artifact of requiresAny) {
    if (!vocabulary.artifacts.includes(artifact)) {
      throw new Error(`${source}: contract "${name}" requires_any unknown artifact "${artifact}"`)
    }
    if (!consumes.includes(artifact)) {
      throw new Error(`${source}: contract "${name}" requires_any artifact "${artifact}" not listed in consumes`)
    }
  }
  for (const category of categories) {
    if (!vocabulary.categories.includes(category)) {
      throw new Error(`${source}: contract "${name}" has unknown category "${category}"`)
    }
  }
  if (!vocabulary.risk_levels.includes(contract.risk_level)) {
    throw new Error(`${source}: contract "${name}" has unknown risk_level "${String(contract.risk_level)}"`)
  }
  for (const artifact of produces) {
    if (consumes.includes(artifact)) {
      throw new Error(`${source}: contract "${name}" produces and consumes the same artifact "${artifact}"`)
    }
  }
}

export function assertObject(value, message) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(message)
  }
}

export function assertSchemaVersion(data, source) {
  if (data.schema_version !== 1) {
    throw new Error(`${source}: schema_version must be 1`)
  }
}

function assertStringArray(value, message) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(message)
  }
  return value
}
