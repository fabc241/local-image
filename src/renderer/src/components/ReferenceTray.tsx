import { useRef } from 'react'
import type { RefImage } from '../image'
import { tagColor, tagFor } from '../tags'

interface Props {
  refs: RefImage[]
  max: number
  referenced: Set<number>
  onAddFiles: (files: File[]) => void
  onRemove: (index: number) => void
  onMove: (from: number, to: number) => void
  onLabel: (index: number, label: string) => void
  onInsertTag: (index: number) => void
}

export function ReferenceTray(props: Props): React.JSX.Element {
  const { refs, max, referenced, onAddFiles, onRemove, onMove, onLabel, onInsertTag } = props
  const fileInput = useRef<HTMLInputElement>(null)
  const canAdd = refs.length < max

  return (
    <div className="ref-tray">
      {refs.map((r, index) => (
        <div
          key={r.id}
          className={`ref-card ${refs.length > 1 && !referenced.has(index) ? 'unreferenced' : ''}`}
          style={{ ['--tag' as string]: tagColor(index) }}
        >
          <div className="ref-thumb">
            <img src={r.url} alt={r.label || r.name} />
            <button
              type="button"
              className="tag-chip ref-badge"
              title={`Insert ${tagFor(index)} into the prompt`}
              onClick={() => onInsertTag(index)}
            >
              {tagFor(index)}
            </button>
            <div className="ref-tools">
              {index > 0 && (
                <button type="button" title="Move left" onClick={() => onMove(index, index - 1)}>
                  ‹
                </button>
              )}
              {index < refs.length - 1 && (
                <button type="button" title="Move right" onClick={() => onMove(index, index + 1)}>
                  ›
                </button>
              )}
              <button type="button" title="Remove" onClick={() => onRemove(index)}>
                ×
              </button>
            </div>
          </div>
          <input
            className="ref-label"
            placeholder="What is it? e.g. the cat"
            value={r.label}
            maxLength={60}
            onChange={(e) => onLabel(index, e.target.value)}
          />
        </div>
      ))}

      {canAdd && (
        <button
          type="button"
          className={`ref-add ${refs.length === 0 ? 'empty' : ''}`}
          onClick={() => fileInput.current?.click()}
        >
          <span className="ref-add-plus">+</span>
          {refs.length === 0 ? (
            <span>
              Drop images here or click to choose
              <br />
              <small>Up to {max} · PNG, JPEG, WebP</small>
            </span>
          ) : (
            <span>Add image as {tagFor(refs.length)}</span>
          )}
        </button>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          if (files.length) onAddFiles(files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
