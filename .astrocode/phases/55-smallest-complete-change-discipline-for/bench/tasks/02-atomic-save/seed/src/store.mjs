import { writeFileSync } from 'node:fs'

export function saveJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}
