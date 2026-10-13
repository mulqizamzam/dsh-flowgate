import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assetsDir = fileURLToPath(new URL('../assets/', import.meta.url))

export const SKILLS_DIR = join(assetsDir, 'skills')
export const WORKFLOWS_DIR = join(assetsDir, 'workflows')
export const CONTRACTS_FILE = join(assetsDir, 'contracts.json')

export function shippedSkills(dir = SKILLS_DIR) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right))
}
