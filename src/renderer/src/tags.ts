// Reference-image tags for multi-image editing.
//
// FLUX.2 [klein] attends to every reference image, but its text encoder never
// sees them: `@image1` in the prompt is just words. The model links a tag to an
// image through what the prompt says about it, so each reference can carry a
// short label that is spelled out next to its tag before generation.

export const TAG_PATTERN = /@image(\d+)\b/g

// One colour per reference slot, used for the badge and the prompt highlight.
export const TAG_COLORS = ['#7c6cff', '#2fbf8f', '#f5a524', '#f06292']

export function tagFor(index: number): string {
  return `@image${index + 1}`
}

export function tagColor(index: number): string {
  return TAG_COLORS[index % TAG_COLORS.length]
}

export interface PromptSegment {
  text: string
  // Zero-based reference index for a tag, or undefined for plain text.
  ref?: number
  // True when the tag points at an image that isn't loaded.
  unknown?: boolean
}

export function segmentPrompt(prompt: string, refCount: number): PromptSegment[] {
  const out: PromptSegment[] = []
  let last = 0
  for (const m of prompt.matchAll(TAG_PATTERN)) {
    const start = m.index ?? 0
    if (start > last) out.push({ text: prompt.slice(last, start) })
    const ref = Number(m[1]) - 1
    out.push({ text: m[0], ref, unknown: ref < 0 || ref >= refCount })
    last = start + m[0].length
  }
  if (last < prompt.length) out.push({ text: prompt.slice(last) })
  return out
}

export function referencedIndexes(prompt: string): Set<number> {
  return new Set([...prompt.matchAll(TAG_PATTERN)].map((m) => Number(m[1]) - 1))
}

export function unknownTags(prompt: string, refCount: number): string[] {
  const bad = segmentPrompt(prompt, refCount)
    .filter((s) => s.unknown)
    .map((s) => s.text)
  return [...new Set(bad)]
}

// After removing reference `removed`, shift higher tags down so they keep
// pointing at the same pictures. Tags for the removed image become plain
// "image" text rather than silently pointing at a different picture.
export function renumberAfterRemoval(prompt: string, removed: number): string {
  return prompt.replace(TAG_PATTERN, (tag, n: string) => {
    const index = Number(n) - 1
    if (index === removed) return 'image'
    if (index > removed) return tagFor(index - 1)
    return tag
  })
}

// Move tags along with an image that moved from `from` to `to`.
export function renumberAfterMove(prompt: string, from: number, to: number): string {
  return prompt.replace(TAG_PATTERN, (tag, n: string) => {
    const index = Number(n) - 1
    if (index === from) return tagFor(to)
    if (from < to && index > from && index <= to) return tagFor(index - 1)
    if (from > to && index >= to && index < from) return tagFor(index + 1)
    return tag
  })
}

// The prompt actually sent to the model: every tag gets its label spelled out
// once, e.g. "@image1 (the orange cat)".
export function expandPrompt(prompt: string, labels: string[]): string {
  const seen = new Set<number>()
  return (
    prompt
      .replace(TAG_PATTERN, (tag, n: string) => {
        const index = Number(n) - 1
        const label = labels[index]?.trim()
        if (!label || seen.has(index)) return tag
        seen.add(index)
        return `${tag} (${label})`
      })
      // Picking a tag adds a trailing space; drop it before punctuation.
      .replace(/ +([,.;:!?])/g, '$1')
  )
}

// "@im" typed just before the caret: returns where the partial tag starts and
// what has been typed after "@", or null when the caret isn't in a tag.
export function activeTagQuery(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const m = /(^|[^\w@])@([\w-]*)$/.exec(text.slice(0, caret))
  if (!m) return null
  return { start: caret - m[2].length - 1, query: m[2].toLowerCase() }
}
