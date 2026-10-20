import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { FlowgateError, CODES } from './errors.js'

export const MAX_REQUEST_BYTES = 8192
export const MAX_MESSAGE_BYTES = 40960
const REDACTED_MARKER = '[redacted-marker]'

const SANITIZE_PATTERNS = [
  [/<skill_content/gi, REDACTED_MARKER],
  [/<\/skill_content/gi, REDACTED_MARKER],
  [/## EVIDENCE/gi, REDACTED_MARKER],
  [/EVIDENCE_RECORD\s*:/gi, REDACTED_MARKER],
  [/^WORKFLOW\s*$/gim, REDACTED_MARKER],
  [/STAGE \d+ of \d+/gi, REDACTED_MARKER],
]

const GATE_RULE = 'Advancing to the next stage without a complete evidence block is a failure of the current stage.'

/** Remove control characters that could alter framing, keeping tab and newline. */
export function stripControlCharacters(request) {
  return String(request).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

/**
 * Sanitize the untrusted operator request only. Skill bodies are host-rendered
 * content and are never rewritten.
 */
export function sanitizeRequest(request) {
  let sanitized = stripControlCharacters(request)
  for (const [pattern, replacement] of SANITIZE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement)
  }
  return sanitized
}

export function assertRequestSize(request) {
  const bytes = Buffer.byteLength(String(request), 'utf8')
  if (bytes > MAX_REQUEST_BYTES) {
    throw new FlowgateError(
      CODES.FLOW_REQUEST_TOO_LARGE,
      `user request is ${bytes} bytes, over the ${MAX_REQUEST_BYTES} byte limit`,
      'Shorten the request; Flowgate rejects oversized input rather than truncating it.',
    )
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
    throw new FlowgateError(
      CODES.COMPOSITION_TOO_LARGE,
      `composed message is ${size} bytes, over the ${MAX_MESSAGE_BYTES} byte limit`,
      'Remove a stage or shrink the request; Flowgate never shortens skill bodies to fit.',
    )
  }
  return message
}

export function composedBytes(message) {
  return Buffer.byteLength(message, 'utf8')
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
    'Every stage output must end with a ## EVIDENCE block containing FACTS, ASSUMPTIONS, PROOF, UNKNOWN, and DECISION. An empty field is written as "none". Stage evidence may also declare EVIDENCE_RECORD: {"id": "<contract evidence id>", "type": "<evidence type>", "command": "<observed command>", "result": "pass|fail"}; the controller accepts it only when it matches the stage contract.',
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
