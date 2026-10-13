import { readFileSync } from 'node:fs'

export function parseJsonStrict(text, source) {
  const duplicate = findDuplicateKey(text)
  if (duplicate !== undefined) {
    throw new Error(`${source}: duplicate key "${duplicate}"`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${source}: invalid JSON: ${error.message}`)
  }
}

export function readJsonFileSync(path) {
  return parseJsonStrict(readFileSync(path, 'utf8'), path)
}

function findDuplicateKey(text) {
  const stack = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      const end = scanString(text, index)
      if (isKeyPosition(text, end + 1)) {
        const keys = stack[stack.length - 1]
        if (keys !== undefined) {
          const key = text.slice(index + 1, end)
          if (keys.has(key)) return key
          keys.add(key)
        }
      }
      index = end + 1
      continue
    }
    if (char === '{') {
      stack.push(new Set())
      index += 1
      continue
    }
    if (char === '}') {
      stack.pop()
      index += 1
      continue
    }
    index += 1
  }
  return undefined
}

function scanString(text, start) {
  let index = start + 1
  while (index < text.length) {
    const char = text[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '"') return index
    index += 1
  }
  return text.length
}

function isKeyPosition(text, start) {
  let index = start
  while (index < text.length && isWhitespace(text[index])) index += 1
  return text[index] === ':'
}

function isWhitespace(char) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}
