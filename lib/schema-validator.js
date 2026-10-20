/**
 * Schema Registry and Validator for dsh-flowgate v2 M2
 * Uses schemastery (z) for validation, consistent with dsh-codebase
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import z from '@deepseek-ai/schemastery'

class SchemaRegistry {
  constructor() {
    this.schemas = new Map()
  }

  async loadSchemas(schemaDir) {
    const files = readdirSync(schemaDir).filter(f => f.endsWith('.schema.json'))
    for (const file of files) {
      const name = file.replace('.schema.json', '')
      const path = join(schemaDir, file)
      const content = readFileSync(path, 'utf-8')
      const schema = JSON.parse(content)
      this.schemas.set(name, schema)
    }
  }

  hasSchema(name) {
    return this.schemas.has(name)
  }

  getSchema(name) {
    const schema = this.schemas.get(name)
    if (!schema) throw new Error(`Schema "${name}" not found`)
    return schema
  }

  compileSchema(schema) {
    return this.jsonSchemaToSchemastery(schema)
  }

  jsonSchemaToSchemastery(schema) {
    if (schema.type === 'object' && schema.properties) {
      const obj = z.object({})
      for (const [key, prop] of Object.entries(schema.properties)) {
        const propSchema = this.jsonSchemaToSchemastery(prop)
        if (schema.required?.includes(key)) {
          obj.set(key, propSchema.required())
        } else {
          obj.set(key, propSchema)
        }
      }
      return obj
    }

    if (schema.type === 'string' && schema.enum) {
      return z.union(schema.enum.map(v => z.const(v)))
    }

    if (schema.type === 'string' && schema.const !== undefined) {
      return z.const(schema.const)
    }

    if (schema.type === 'string' && schema.pattern) {
      return z.string().pattern(new RegExp(schema.pattern))
    }

    if (schema.type === 'string' && schema.format) {
      return z.string()
    }

    if (schema.type === 'string') {
      let s = z.string()
      if (schema.minLength !== undefined) s = s.min(schema.minLength)
      if (schema.maxLength !== undefined) s = s.max(schema.maxLength)
      return s
    }

    if (schema.type === 'integer') {
      let n = z.number().step(1)
      if (schema.minimum !== undefined) n = n.min(schema.minimum)
      if (schema.maximum !== undefined) n = n.max(schema.maximum)
      return n
    }

    if (schema.type === 'number') {
      let n = z.number()
      if (schema.minimum !== undefined) n = n.min(schema.minimum)
      if (schema.maximum !== undefined) n = n.max(schema.maximum)
      return n
    }

    if (schema.type === 'boolean') {
      return z.boolean()
    }

    if (schema.type === 'array' && schema.items) {
      return z.array(this.jsonSchemaToSchemastery(schema.items))
    }

    if (schema.allOf) {
      return z.intersect(schema.allOf.map(s => this.jsonSchemaToSchemastery(s)))
    }

    if (schema.anyOf) {
      return z.union(schema.anyOf.map(s => this.jsonSchemaToSchemastery(s)))
    }
    if (schema.oneOf) {
      return z.union(schema.oneOf.map(s => this.jsonSchemaToSchemastery(s)))
    }

    return z.any()
  }

  validate(schemaName, data) {
    const schema = this.getSchema(schemaName)
    const compiled = this.compileSchema(schema)
    
    try {
      // Use strict mode to reject unknown properties
      const result = compiled(data, { strict: true })
      return { valid: true, errors: [] }
    } catch (error) {
      if (error && error.issues) {
        return {
          valid: false,
          errors: error.issues.map(issue => ({
            path: issue.path?.join('.') || 'root',
            message: issue.message,
            code: this.mapErrorCode(issue)
          }))
        }
      }
      return {
        valid: false,
        errors: [{ path: 'root', message: String(error), code: 'VALIDATION_ERROR' }]
      }
    }
  }

  mapErrorCode(issue) {
    const message = issue.message?.toLowerCase() || ''
    if (message.includes('unknown') || message.includes('unexpected') || message.includes('extra')) {
      return 'UNKNOWN_FIELD'
    }
    if (message.includes('enum') || message.includes('expected one of') || message.includes('invalid')) {
      return 'INVALID_ENUM'
    }
    if (message.includes('required') || message.includes('missing')) {
      return 'REQUIRED_FIELD'
    }
    if (message.includes('type') || message.includes('expected')) {
      return 'TYPE_MISMATCH'
    }
    if (message.includes('pattern')) {
      return 'PATTERN_MISMATCH'
    }
    if (message.includes('format')) {
      return 'FORMAT_MISMATCH'
    }
    return 'VALIDATION_ERROR'
  }
}

const schemaRegistry = new SchemaRegistry()

export async function createValidator(schemaDir) {
  await schemaRegistry.loadSchemas(schemaDir)
  return schemaRegistry
}

export function validate(schemaName, data) {
  return schemaRegistry.validate(schemaName, data)
}