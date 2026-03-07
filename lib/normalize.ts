/**
 * Normalizes translated Chinese subtitle text.
 * - Collapses whitespace
 * - Removes spaces after/before Chinese punctuation
 * - Removes unnecessary spaces between CJK characters
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/([，。！？；：、""\u201C\u201D])\s+/g, "$1")
    .replace(/\s+([，。！？；：、""\u201C\u201D])/g, "$1")
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2")
    .trim();
}
