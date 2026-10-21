/** Lowercase, strip accents, and collapse whitespace for label checks. */

/**
 * @param {string} [value]
 * @returns {string}
 */
export function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
