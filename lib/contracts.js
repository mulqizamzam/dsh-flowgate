import { readJsonFileSync } from './json-file.js'
import { loadSchemas, validateValue } from './schema.js'
import { FlowgateError, CODES } from './errors.js'
import { CONTRACTS_FILE, SCHEMAS_DIR, shippedSkills } from './catalog.js'

const CHECK_TYPES = [
  'artifact_fields',
  'artifact_schema',
  'evidence_block',
  'evidence_validation',
  'evidence_current',
]

/**
 * Validate a contracts document and return the normalized contract map.
 * Schema version 1 is a known migratable version: it is upgraded
 * deterministically to the v2 shape (declared evidence only) and marked
 * `legacy` so callers can report the provenance of the migration.
 */
export function validateContracts(data, source, skills = shippedSkills(), schemas = loadSchemas(SCHEMAS_DIR)) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: top level must be an object`)
  }
  if (data.schema_version === 1) {
    return normalizeLegacyContracts(data, source, skills, schemas)
  }
  return validateV2Contracts(data, source, skills, schemas, false)
}

function validateV2Contracts(data, source, skills, schemas, legacy) {
  const fileSchema = schemas.get('contracts-file')
  if (fileSchema === undefined) {
    throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: schemas/contracts-file.schema.json is not installed`)
  }
  const result = validateValue(data, fileSchema, fileSchema)
  if (!result.ok) {
    const first = result.errors[0]
    throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: ${first.message} at ${first.path}`)
  }

  const contractSchema = schemas.get('stage-contract')
  if (contractSchema === undefined) {
    throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: schemas/stage-contract.schema.json is not installed`)
  }
  const vocabulary = {
    artifacts: [...data.vocabulary.artifacts],
    categories: [...data.vocabulary.categories],
    risk_levels: [...data.vocabulary.risk_levels],
  }
  const skillsSet = new Set(skills)
  const artifacts = new Set(vocabulary.artifacts)
  const contracts = {}
  const producedArtifacts = new Set()

  for (const [name, contract] of Object.entries(data.contracts)) {
    if (!skillsSet.has(name)) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" does not name a shipped skill`)
    }
    const contractResult = validateValue(contract, contractSchema, contractSchema)
    if (!contractResult.ok) {
      const first = contractResult.errors[0]
      throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}": ${first.message} at ${first.path}`)
    }
    for (const artifact of contract.produces) {
      if (!artifacts.has(artifact)) {
        throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" produces unknown artifact "${artifact}"`)
      }
      if (producedArtifacts.has(artifact)) {
        throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: artifact "${artifact}" is produced by more than one contract`)
      }
      producedArtifacts.add(artifact)
    }
    if (contract.produces.length !== 1) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" must produce exactly one artifact`)
    }
    for (const artifact of [...contract.consumes, ...contract.requires, ...contract.requires_any]) {
      if (!artifacts.has(artifact)) {
        throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" references unknown artifact "${artifact}"`)
      }
    }
    for (const artifact of [...contract.requires, ...contract.requires_any]) {
      if (!contract.consumes.includes(artifact)) {
        throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" requires "${artifact}" not listed in consumes`)
      }
    }
    if (contract.produces.some(artifact => contract.consumes.includes(artifact))) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" produces and consumes the same artifact`)
    }
    for (const category of contract.categories) {
      if (!vocabulary.categories.includes(category)) {
        throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" has unknown category "${category}"`)
      }
    }
    const evidenceIds = new Set()
    for (const requirement of contract.evidence) {
      if (evidenceIds.has(requirement.id)) {
        throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" repeats evidence id "${requirement.id}"`)
      }
      evidenceIds.add(requirement.id)
      if (!data.evidence_types.includes(requirement.type)) {
        throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" evidence "${requirement.id}" has unknown type "${requirement.type}"`)
      }
      for (const provenance of requirement.accepted_provenance) {
        if (!data.provenance_kinds.includes(provenance)) {
          throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" evidence "${requirement.id}" accepts unknown provenance "${provenance}"`)
        }
      }
      for (const ref of requirement.bind_to_inputs) {
        if (!artifacts.has(ref)) {
          throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" evidence "${requirement.id}" binds unknown artifact "${ref}"`)
        }
      }
    }
    const checkIds = new Set()
    for (const check of contract.checks) {
      if (checkIds.has(check.id)) {
        throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" repeats check id "${check.id}"`)
      }
      checkIds.add(check.id)
      if (!data.check_types.includes(check.type) || !CHECK_TYPES.includes(check.type)) {
        throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" check "${check.id}" has unknown type "${check.type}"`)
      }
    }
    if (!contract.checks.some(check => check.type === 'evidence_current')) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: contract "${name}" has no evidence_current check`)
    }
    contracts[name] = contract
  }

  for (const skill of skills) {
    if (contracts[skill] === undefined) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: shipped skill "${skill}" has no contract entry`)
    }
  }

  return {
    vocabulary,
    contracts,
    contract_version: data.contract_version,
    evidence_types: [...data.evidence_types],
    provenance_kinds: [...data.provenance_kinds],
    check_types: [...data.check_types],
    side_effect_classes: [...data.side_effect_classes],
    retry_policies: [...data.retry_policies],
    legacy,
  }
}

/** Deterministic upgrade of the v1 contracts document to the v2 contract shape. */
function normalizeLegacyContracts(data, source, skills, schemas) {
  const vocabulary = data.vocabulary
  const contracts = {}
  for (const [name, contract] of Object.entries(data.contracts)) {
    const produces = [...contract.produces]
    contracts[name] = {
      contract_version: 2,
      produces,
      consumes: [...contract.consumes],
      requires: [...contract.requires],
      requires_any: [...contract.requires_any],
      categories: [...contract.categories],
      risk_level: contract.risk_level,
      evidence: [
        {
          id: `${name}_evidence`,
          type: 'declared_evidence',
          supports: [...produces],
          bind_to_inputs: contract.requires.length > 0 ? [...contract.requires] : ['user-request'],
          accepted_provenance: ['operator_input', 'observed_command', 'observed_tool', 'agent_statement'],
          freshness_policy: 'invalidate_on_dependency_change',
        },
      ],
      checks: [
        { id: `${name}_fields`, type: 'artifact_fields' },
        { id: `${name}_schema`, type: 'artifact_schema' },
        { id: `${name}_evidence_block`, type: 'evidence_block' },
        { id: `${name}_evidence_valid`, type: 'evidence_validation' },
        { id: `${name}_evidence_current`, type: 'evidence_current' },
      ],
      dependencies: { unknown_impact_policy: 'needs_revalidation' },
      completion: {
        required_checks: 'all',
        missing_prerequisite: 'blocked',
        unmet_criterion: 'failed',
        checker_error: 'error',
      },
      recovery: { checkpoint_eligible: true, require_current_evidence: true },
      side_effects: {
        class: name === 'prove' || name === 'handoff' ? 'local_write' : 'read_only',
        retry_policy: 'safe_idempotent',
      },
    }
  }
  const normalized = {
    schema_version: 2,
    contract_version: 2,
    vocabulary,
    evidence_types: ['operator_input', 'artifact_inspection', 'command_execution', 'test_execution', 'review_result', 'declared_evidence'],
    provenance_kinds: ['operator_input', 'observed_command', 'observed_tool', 'agent_statement'],
    check_types: [...CHECK_TYPES],
    side_effect_classes: ['read_only', 'local_write', 'external_mutation'],
    retry_policies: ['safe_idempotent', 'manual_approval_required', 'not_retryable'],
    contracts,
  }
  return validateV2Contracts(normalized, `${source} (migrated from schema_version 1)`, skills, schemas, true)
}

export function loadContracts(file = CONTRACTS_FILE) {
  const schemas = loadSchemas(SCHEMAS_DIR)
  return validateContracts(readJsonFileSync(file), file, shippedSkills(), schemas)
}

/**
 * Validate that every stage in a workflow consumes artifacts that the operator
 * request or an earlier stage produces. Requires/requires_any are evaluated in
 * stage order, so an optional stage cannot satisfy a later required input that
 * would otherwise be absent.
 */
export function validateArtifactChain(workflow, contracts, source) {
  const available = new Set(['user-request'])
  for (const [index, stage] of workflow.stages.entries()) {
    const contract = contracts[stage.skill]
    if (contract === undefined) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: stage ${index + 1} "${stage.skill}" has no contract`)
    }
    for (const required of contract.requires) {
      if (!available.has(required)) {
        throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: stage ${index + 1} "${stage.skill}" requires "${required}", not produced by any prior stage or the user request`)
      }
    }
    if (contract.requires_any.length > 0 && !contract.requires_any.some(artifact => available.has(artifact))) {
      throw new FlowgateError(CODES.CONTRACT_INVALID, `${source}: stage ${index + 1} "${stage.skill}" requires at least one of [${contract.requires_any.join(', ')}], none available`)
    }
    for (const produced of contract.produces) available.add(produced)
  }
}

export function artifactOf(contract) {
  return contract.produces[0]
}
