import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { SKILLS_DIR, shippedSkills } from '../lib/catalog.js'
import { composeWorkflowMessage } from '../lib/flow-compose.js'
import { loadContracts } from '../lib/contracts.js'
import { loadWorkflows } from '../lib/workflows.js'

const workflows = loadWorkflows()
const contracts = loadContracts()

function definitionOf(name) {
  return {
    name,
    provider: 'flowgate-test',
    resourceBase: { kind: 'directory', path: `${SKILLS_DIR}/${name}` },
    content: readFileSync(fileURLToPath(new URL(`../assets/skills/${name}/SKILL.md`, import.meta.url)), 'utf8'),
  }
}

test('every composed stage block is byte-identical to the host renderSkillContent output', () => {
  for (const [workflowName, workflow] of workflows) {
    const stages = workflow.stages.map(stage => ({
      skill: stage.skill,
      purpose: stage.purpose,
      required: stage.required,
      artifact: contracts.contracts[stage.skill].produces[0],
      provider: 'flowgate-test',
      definition: definitionOf(stage.skill),
    }))
    const message = composeWorkflowMessage({ workflow, stages, request: 'x'.repeat(32), skipped: [] })
    for (const stage of stages) {
      const render = renderSkillContent(stage.definition)
      const occurrences = message.split(render).length - 1
      assert.equal(occurrences, 1, `${workflowName}: ${stage.skill} render must appear exactly once`)
      assert.equal(message.includes(render), true, `${workflowName}: ${stage.skill} render missing`)
    }
  }
})

test('the stage block carries the render immediately after its gate line', () => {
  const workflow = workflows.get('feature')
  const stages = workflow.stages.map(stage => ({
    skill: stage.skill,
    purpose: stage.purpose,
    required: stage.required,
    artifact: contracts.contracts[stage.skill].produces[0],
    provider: 'flowgate-test',
    definition: definitionOf(stage.skill),
  }))
  const message = composeWorkflowMessage({ workflow, stages, request: 'x'.repeat(32), skipped: [] })
  for (const stage of stages) {
    const render = renderSkillContent(stage.definition)
    const header = `STAGE ${stages.indexOf(stage) + 1} of ${stages.length}: ${stage.skill}\nPurpose: ${stage.purpose}\nProduces: ${stage.artifact}\nRequired: ${stage.required ? 'yes' : 'no'}\nGate: emit the ${stage.artifact} artifact with a complete ## EVIDENCE block before advancing; advancing without them is a failure of this stage.\n\n`
    assert.equal(message.includes(header + render), true, `${stage.skill}: header and render must be adjacent`)
  }
})

test('every shipped skill renders through the host renderer', () => {
  for (const skill of shippedSkills(SKILLS_DIR)) {
    const render = renderSkillContent(definitionOf(skill))
    assert.equal(render.startsWith(`<skill_content name="${skill}">`), true)
    assert.equal(render.endsWith('</skill_content>'), true)
    assert.equal(render.includes('<skill_instructions>'), true)
  }
})
