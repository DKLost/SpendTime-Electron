import { randomUUID } from 'node:crypto'
import type { IdGen } from '@application/ports'

export function createUuidGen(): IdGen {
  function next(): string {
    return randomUUID()
  }
  return { next }
}
