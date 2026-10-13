import { renderSkillContent } from '@deepseek-ai/dsh-skill'

const MAX_REQUEST_BYTES = 8192
const MAX_MESSAGE_BYTES = 40960
const REDACTED_MARKER = '[redacted-marker]'
const SANITIZE_PATTERNS = [/<skill_content/gi, /<\/skill_content/gi, /## EVIDENCE/gi, /STAGE \d+ of \d+/gi]
const GATE_RULE = 'Advancing to the next stage without a complete evidence block is a failure of the current stage.'

export function sanitizeRequest(request) {
  let sanitized = String(request)
  for (const pattern of SANITIZE_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTED_MARKER)
  }
  return sanitized
}

export function assertRequestSize(request) {
  const bytes = Buffer.byteLength(String(request), 'utf8')
  if (bytes > MAX_REQUEST_BYTES) {
    throw new Error(`user request is ${bytes} bytes, over the ${MAX_REQUEST_BYTES} byte limit`)
  }
}

export function composeWorkflowMessage({ workflow, stages, request, skipped = [] }) {
  assertRequestSize(request)
  const safeRequest = sanitizeRequest(request)
  const sections = [
    header(workflow, stages, safeRequest, skipped),
    ...stages.map((stage, index) => stageBlock(index + 1, stages.length, stage)),
    footer(safeRequest),
  ]
  const message = sections.join('\n\n')
  const size = Buffer.byteLength(message, 'utf8')
  if (size > MAX_MESSAGE_BYTES) {
    throw new Error(`composed message is ${size} bytes, over the ${MAX_MESSAGE_BYTES} byte limit`)
  }
  return message
}

function header(workflow, stages, safeRequest, skipped) {
  const lines = [
    'WORKFLOW',
    '========',
    '',
    'Goal:',
    safeRequest,
    '',
    'Selected workflow:',
    `${workflow.name} — ${workflow.description}`,
    '',
    'Execution order:',
  ]
  for (const [index, stage] of stages.entries()) {
    lines.push(`${index + 1}. ${stage.skill} (${stage.required ? 'required' : 'optional'}) — ${stage.purpose}`)
    lines.push(`   Artifact: ${stage.artifact}`)
    lines.push(`   Provider: ${stage.provider}`)
  }
  if (skipped.length > 0) {
    lines.push('', 'Skipped stages:')
    for (const skill of skipped) lines.push(`- ${skill}`)
  }
  lines.push(
    '',
    'Workflow rules:',
    ...workflow.rules.map(rule => `- ${rule}`),
    '',
    'Evidence protocol:',
    'Every stage output must end with a ## EVIDENCE block containing FACTS, ASSUMPTIONS, PROOF, UNKNOWN, and DECISION. An empty field is written as "none". Advancing to the next stage without a complete evidence block is a failure of the current stage.',
    '',
    'Definition of done:',
    workflow.completion,
  )
  return lines.join('\n')
}

function stageBlock(position, total, stage) {
  return [
    `STAGE ${position} of ${total}: ${stage.skill}`,
    `Purpose: ${stage.purpose}`,
    `Produces: ${stage.artifact}`,
    `Required: ${stage.required ? 'yes' : 'no'}`,
    `Gate: emit the ${stage.artifact} artifact with a complete ## EVIDENCE block before advancing; advancing without them is a failure of this stage.`,
    '',
    renderSkillContent(stage.definition),
  ].join('\n')
}

function footer(safeRequest) {
  return [
    'User request:',
    safeRequest,
    '',
    GATE_RULE,
  ].join('\n')
}
