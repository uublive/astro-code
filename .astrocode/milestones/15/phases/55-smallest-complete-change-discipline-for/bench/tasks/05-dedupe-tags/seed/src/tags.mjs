export function normalizeTags(list) {
  if (!Array.isArray(list)) throw new TypeError('tags must be an array')
  return list.map((t) => String(t).trim())
}
