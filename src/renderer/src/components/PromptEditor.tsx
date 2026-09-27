import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { RefImage } from '../image'
import { activeTagQuery, segmentPrompt, tagColor, tagFor } from '../tags'

export interface PromptEditorHandle {
  insertTag: (index: number) => void
}

interface Props {
  id: string
  value: string
  placeholder: string
  refs: RefImage[]
  onChange: (value: string) => void
  onSubmit: () => void
}

interface Suggest {
  start: number
  query: string
  active: number
}

// Textarea with colour-highlighted @imageN tags and an "@" autocomplete menu.
// The highlight layer sits behind a transparent textarea with identical text
// metrics, so tags light up without replacing native editing.
export const PromptEditor = forwardRef<PromptEditorHandle, Props>(function PromptEditor(
  { id, value, placeholder, refs, onChange, onSubmit },
  ref
) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const backdrop = useRef<HTMLDivElement>(null)
  const [suggest, setSuggest] = useState<Suggest | null>(null)

  const segments = useMemo(() => segmentPrompt(value, refs.length), [value, refs.length])

  const options = useMemo(() => {
    if (!suggest) return []
    return refs
      .map((r, index) => ({ r, index }))
      .filter(({ r, index }) => {
        const q = suggest.query
        return !q || `image${index + 1}`.startsWith(q) || r.label.toLowerCase().includes(q)
      })
  }, [suggest, refs])

  const replaceRange = (start: number, end: number, text: string): void => {
    const next = value.slice(0, start) + text + value.slice(end)
    onChange(next)
    const caret = start + text.length
    requestAnimationFrame(() => {
      textarea.current?.focus()
      textarea.current?.setSelectionRange(caret, caret)
    })
  }

  const insertAtCaret = (index: number): void => {
    const el = textarea.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const before = value.slice(0, start)
    const pad = before && !/\s$/.test(before) ? ' ' : ''
    replaceRange(start, end, `${pad}${tagFor(index)} `)
  }

  useImperativeHandle(ref, () => ({ insertTag: insertAtCaret }))

  const refreshSuggest = (el: HTMLTextAreaElement): void => {
    if (refs.length === 0 || el.selectionStart !== el.selectionEnd) {
      setSuggest(null)
      return
    }
    const q = activeTagQuery(el.value, el.selectionStart)
    setSuggest(q ? { ...q, active: 0 } : null)
  }

  const pick = (index: number): void => {
    if (!suggest) return
    const end = suggest.start + 1 + suggest.query.length
    replaceRange(suggest.start, end, `${tagFor(index)} `)
    setSuggest(null)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (suggest && options.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const delta = e.key === 'ArrowDown' ? 1 : -1
        setSuggest({
          ...suggest,
          active: (suggest.active + delta + options.length) % options.length
        })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(options[Math.min(suggest.active, options.length - 1)].index)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSuggest(null)
        return
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit()
  }

  return (
    <div className="prompt-editor">
      <div className="prompt-box">
        <div className="prompt-backdrop" ref={backdrop} aria-hidden>
          {segments.map((s, i) =>
            s.ref === undefined ? (
              <span key={i}>{s.text}</span>
            ) : (
              <mark
                key={i}
                className={s.unknown ? 'tag-unknown' : 'tag'}
                style={s.unknown ? undefined : { ['--tag' as string]: tagColor(s.ref) }}
              >
                {s.text}
              </mark>
            )
          )}
          {/* Keeps the backdrop as tall as the textarea when text ends in a newline. */}
          {'​'}
        </div>
        <textarea
          id={id}
          ref={textarea}
          rows={5}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => {
            onChange(e.target.value)
            refreshSuggest(e.target)
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') refreshSuggest(e.currentTarget)
          }}
          onClick={(e) => refreshSuggest(e.currentTarget)}
          onBlur={() => setTimeout(() => setSuggest(null), 120)}
          onScroll={(e) => {
            if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop
          }}
        />
        {suggest && options.length > 0 && (
          <ul className="tag-menu" role="listbox">
            {options.map(({ r, index }, i) => (
              <li
                key={r.id}
                role="option"
                aria-selected={i === suggest.active}
                className={i === suggest.active ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(index)
                }}
                onMouseEnter={() => setSuggest({ ...suggest, active: i })}
              >
                <img src={r.url} alt="" />
                <span className="tag-chip" style={{ ['--tag' as string]: tagColor(index) }}>
                  {tagFor(index)}
                </span>
                <span className="tag-menu-label">{r.label || r.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {refs.length > 0 && (
        <div className="tag-chips">
          <span className="hint">Insert:</span>
          {refs.map((r, index) => (
            <button
              key={r.id}
              type="button"
              className="tag-chip"
              style={{ ['--tag' as string]: tagColor(index) }}
              title={`Insert ${tagFor(index)} at the cursor`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertAtCaret(index)}
            >
              {tagFor(index)}
              {r.label && <span className="tag-chip-label">{r.label}</span>}
            </button>
          ))}
          <span className="hint">or type @</span>
        </div>
      )}
    </div>
  )
})
