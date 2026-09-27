import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DownloadProgress,
  LogLine,
  ModelStatus,
  StepProgress,
  StudioInfo
} from '../../shared/types'
import { MAX_REFERENCE_IMAGES } from '../../shared/types'
import { PromptEditor, type PromptEditorHandle } from './components/PromptEditor'
import { ReferenceTray } from './components/ReferenceTray'
import { fitAspect, formatBytes, loadSourceImage, pngToUrl, type RefImage } from './image'
import {
  expandPrompt,
  referencedIndexes,
  renumberAfterMove,
  renumberAfterRemoval,
  tagFor,
  unknownTags
} from './tags'

type Mode = 'create' | 'edit'

interface Result {
  id: number
  url: string
  png: Uint8Array
  prompt: string
  mode: Mode
  width: number
  height: number
  seed?: number
  denoiseMs?: number
  vaeMs?: number
  totalMs?: number
}

const SIZE_PRESETS = [
  { id: 'sq1024', label: 'Square 1024', w: 1024, h: 1024 },
  { id: 'sq768', label: 'Square 768', w: 768, h: 768 },
  { id: 'sq512', label: 'Square 512', w: 512, h: 512 },
  { id: 'portrait', label: 'Portrait 3:4', w: 768, h: 1024 },
  { id: 'landscape', label: 'Landscape 4:3', w: 1024, h: 768 },
  { id: 'wide', label: 'Wide 16:9', w: 1024, h: 576 }
] as const

const MATCH_INPUT = 'match'
const LOG_LIMIT = 400

function App(): React.JSX.Element {
  const [info, setInfo] = useState<StudioInfo | null>(null)
  const [status, setStatus] = useState<ModelStatus>({ state: 'idle' })
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({})
  const [logs, setLogs] = useState<LogLine[]>([])
  const [showLogs, setShowLogs] = useState(false)

  const [mode, setMode] = useState<Mode>('create')
  const [prompt, setPrompt] = useState('')
  const [refs, setRefs] = useState<RefImage[]>([])
  const [sizeId, setSizeId] = useState<string>('sq1024')
  const [steps, setSteps] = useState(4)
  const [guidance, setGuidance] = useState(3.5)
  const [seed, setSeed] = useState('')

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<StepProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const nextId = useRef(1)
  const nextRefId = useRef(1)
  const promptEditor = useRef<PromptEditorHandle>(null)

  useEffect(() => {
    window.studio.info().then(setInfo)
    const offs = [
      window.studio.onStatus(setStatus),
      window.studio.onDownload((p) => setDownloads((d) => ({ ...d, [p.file]: p }))),
      window.studio.onStep(setProgress),
      window.studio.onLog((l) => setLogs((prev) => [...prev.slice(-(LOG_LIMIT - 1)), l]))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const ready = status.state === 'ready'
  const current = results.find((r) => r.id === selected) ?? results[0] ?? null
  const editRefs = useMemo(() => (mode === 'edit' ? refs : []), [mode, refs])
  const first = editRefs[0]

  const [width, height] = useMemo<[number, number]>(() => {
    if (sizeId === MATCH_INPUT && first) {
      return fitAspect(
        first.width,
        first.height,
        Math.min(1024, Math.max(first.width, first.height))
      )
    }
    const preset = SIZE_PRESETS.find((p) => p.id === sizeId) ?? SIZE_PRESETS[0]
    return [preset.w, preset.h]
  }, [sizeId, first])

  const labels = useMemo(() => editRefs.map((r) => r.label), [editRefs])
  const sentPrompt = useMemo(() => expandPrompt(prompt.trim(), labels), [prompt, labels])
  const badTags = useMemo(() => unknownTags(prompt, editRefs.length), [prompt, editRefs.length])
  const referenced = useMemo(() => referencedIndexes(prompt), [prompt])

  // Appends images to the tray (up to the limit) and switches to Edit mode.
  const addFiles = useCallback(async (files: (File | Blob)[], names: string[], replace = false) => {
    setError(null)
    const loaded: RefImage[] = []
    for (let i = 0; i < files.length; i++) {
      try {
        const img = await loadSourceImage(files[i], names[i])
        loaded.push({ ...img, id: nextRefId.current++, label: '' })
      } catch {
        setError(`Could not read "${names[i]}" as an image.`)
      }
    }
    if (loaded.length === 0) return
    setRefs((prev) => {
      const base = replace ? [] : prev
      if (replace) prev.forEach((r) => URL.revokeObjectURL(r.url))
      const room = MAX_REFERENCE_IMAGES - base.length
      if (loaded.length > room) {
        setError(`Up to ${MAX_REFERENCE_IMAGES} images; extra images were skipped.`)
        loaded.slice(room).forEach((r) => URL.revokeObjectURL(r.url))
      }
      return [...base, ...loaded.slice(0, room)]
    })
    setMode('edit')
    setSizeId(MATCH_INPUT)
  }, [])

  const removeRef = useCallback((index: number) => {
    setRefs((prev) => {
      URL.revokeObjectURL(prev[index].url)
      return prev.filter((_, i) => i !== index)
    })
    setPrompt((p) => renumberAfterRemoval(p, index))
  }, [])

  const moveRef = useCallback((from: number, to: number) => {
    setRefs((prev) => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
    setPrompt((p) => renumberAfterMove(p, from, to))
  }, [])

  const setLabel = useCallback((index: number, label: string) => {
    setRefs((prev) => prev.map((r, i) => (i === index ? { ...r, label } : r)))
  }, [])

  const resultBlob = (r: Result): Blob => new Blob([r.png as BlobPart], { type: 'image/png' })

  const generate = useCallback(async () => {
    if (!prompt.trim() || busy) return
    if (mode === 'edit' && editRefs.length === 0) {
      setError('Add at least one image to edit.')
      return
    }
    if (badTags.length > 0) {
      setError(`${badTags.join(', ')} doesn't match any image in the tray.`)
      return
    }
    setBusy(true)
    setError(null)
    setProgress(null)
    try {
      const parsedSeed = seed.trim() === '' ? -1 : Number.parseInt(seed, 10)
      const res = await window.studio.generate({
        prompt: sentPrompt,
        initImages: editRefs.map((r) => r.bytes),
        width,
        height,
        steps,
        guidance,
        seed: Number.isFinite(parsedSeed) ? parsedSeed : -1
      })
      const id = nextId.current++
      setResults((prev) => [
        { id, url: pngToUrl(res.png), prompt: sentPrompt, mode, width, height, ...res },
        ...prev
      ])
      setSelected(id)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }, [prompt, busy, mode, editRefs, badTags, sentPrompt, seed, width, height, steps, guidance])

  const save = useCallback(async (r: Result) => {
    const path = await window.studio.saveImage(r.png, `local-image-${r.mode}-${r.seed ?? r.id}.png`)
    if (path) setError(null)
  }, [])

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    if (files.length)
      addFiles(
        files,
        files.map((f) => f.name)
      )
  }

  return (
    <div
      className={`app ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <header className="titlebar">
        <span className="brand">Local Image</span>
        <StatusPill status={status} busy={busy} />
      </header>

      <aside className="panel">
        <div className="segmented" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'create'}
            className={mode === 'create' ? 'active' : ''}
            onClick={() => {
              setMode('create')
              if (sizeId === MATCH_INPUT) setSizeId('sq1024')
            }}
          >
            Create
          </button>
          <button
            role="tab"
            aria-selected={mode === 'edit'}
            className={mode === 'edit' ? 'active' : ''}
            onClick={() => {
              setMode('edit')
              if (refs.length) setSizeId(MATCH_INPUT)
            }}
          >
            Edit
          </button>
        </div>

        {mode === 'edit' && (
          <div className="field">
            <label>
              Images to edit{' '}
              <span className="hint">
                · {refs.length}/{MAX_REFERENCE_IMAGES}
              </span>
            </label>
            <ReferenceTray
              refs={refs}
              max={MAX_REFERENCE_IMAGES}
              referenced={referenced}
              onAddFiles={(files) =>
                addFiles(
                  files,
                  files.map((f) => f.name)
                )
              }
              onRemove={removeRef}
              onMove={moveRef}
              onLabel={setLabel}
              onInsertTag={(i) => promptEditor.current?.insertTag(i)}
            />
            {refs.length > 1 && (
              <small className="hint">
                Several images are combined in one result; each one adds generation time.
              </small>
            )}
          </div>
        )}

        <div className="field">
          <label htmlFor="prompt">
            {mode === 'create' ? 'Describe the image' : 'Describe the edit'}
          </label>
          <PromptEditor
            ref={promptEditor}
            id="prompt"
            value={prompt}
            refs={editRefs}
            onChange={setPrompt}
            onSubmit={generate}
            placeholder={
              mode === 'create'
                ? 'A lighthouse on a rocky coast at dusk, volumetric light, 35mm photo'
                : refs.length > 1
                  ? `Put the cat from ${tagFor(0)} on the sofa from ${tagFor(1)}, keep the lighting of ${tagFor(1)}`
                  : 'Turn it into a watercolor painting, keep the composition'
            }
          />
          {badTags.length > 0 && (
            <small className="warn">
              {badTags.join(', ')} doesn&apos;t match any image in the tray.
            </small>
          )}
          {editRefs.length > 0 && sentPrompt !== prompt.trim() && prompt.trim() && (
            <small className="hint sent-prompt">
              <strong>Sent to the model:</strong> {sentPrompt}
            </small>
          )}
        </div>

        <div className="field">
          <label htmlFor="size">Output size</label>
          <select id="size" value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
            {mode === 'edit' && first && (
              <option value={MATCH_INPUT}>Match {tagFor(0)} aspect</option>
            )}
            {SIZE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <small className="hint">
            {width} × {height}px
          </small>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="steps">Steps</label>
            <input
              id="steps"
              type="number"
              min={1}
              max={50}
              value={steps}
              onChange={(e) => setSteps(clamp(Number(e.target.value), 1, 50))}
            />
          </div>
          <div className="field">
            <label htmlFor="guidance">Guidance</label>
            <input
              id="guidance"
              type="number"
              min={1}
              max={10}
              step={0.5}
              value={guidance}
              onChange={(e) => setGuidance(clamp(Number(e.target.value), 1, 10))}
            />
          </div>
          <div className="field">
            <label htmlFor="seed">Seed</label>
            <input
              id="seed"
              inputMode="numeric"
              placeholder="random"
              value={seed}
              onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>
        </div>

        <div className="actions">
          {busy ? (
            <button className="secondary" onClick={() => window.studio.cancel()}>
              Cancel
            </button>
          ) : null}
          <button
            className="primary"
            disabled={
              busy ||
              !prompt.trim() ||
              status.state === 'loading' ||
              (mode === 'edit' && refs.length === 0) ||
              badTags.length > 0
            }
            onClick={generate}
          >
            {busy ? 'Generating…' : mode === 'create' ? 'Generate' : 'Apply edit'}
            {!busy && <kbd>⌘↵</kbd>}
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        {info && <EngineCard info={info} />}
      </aside>

      <main className="stage">
        {!ready && !busy && results.length === 0 ? (
          <SetupCard
            info={info}
            status={status}
            downloads={downloads}
            onLoad={() => window.studio.loadModel()}
          />
        ) : (
          <div className="canvas">
            {busy && (
              <div className="progress-overlay">
                <div className="spinner" />
                <div>
                  {status.state === 'loading'
                    ? 'Loading model…'
                    : progress
                      ? `Step ${progress.step} of ${progress.totalSteps}`
                      : 'Encoding prompt…'}
                </div>
                {progress && (
                  <div className="bar">
                    <div style={{ width: `${(progress.step / progress.totalSteps) * 100}%` }} />
                  </div>
                )}
              </div>
            )}
            {current ? (
              <figure className="result">
                <img src={current.url} alt={current.prompt} />
                <figcaption>
                  <span className="caption-prompt">{current.prompt}</span>
                  <span className="caption-meta">
                    {current.width}×{current.height}
                    {current.seed !== undefined && ` · seed ${current.seed}`}
                    {current.denoiseMs !== undefined && ` · denoise ${secs(current.denoiseMs)}`}
                    {current.vaeMs !== undefined && ` · VAE ${secs(current.vaeMs)}`}
                  </span>
                  <span className="caption-actions">
                    <button className="secondary" onClick={() => save(current)}>
                      Save PNG…
                    </button>
                    <button
                      className="secondary"
                      title="Start a new edit with only this image"
                      onClick={() =>
                        addFiles([resultBlob(current)], [`result-${current.id}.png`], true)
                      }
                    >
                      Edit this image
                    </button>
                    {refs.length < MAX_REFERENCE_IMAGES && (
                      <button
                        className="secondary"
                        title={`Add to the edit tray as ${tagFor(refs.length)}`}
                        onClick={() =>
                          addFiles([resultBlob(current)], [`result-${current.id}.png`])
                        }
                      >
                        Add as {tagFor(refs.length)}
                      </button>
                    )}
                  </span>
                </figcaption>
              </figure>
            ) : (
              !busy && (
                <div className="empty">
                  <p>Model ready.</p>
                  <p className="muted">
                    Write a prompt to create an image, or drop a picture anywhere to edit it.
                  </p>
                </div>
              )
            )}
          </div>
        )}

        {results.length > 1 && (
          <div className="history">
            {results.map((r) => (
              <button
                key={r.id}
                className={r.id === current?.id ? 'active' : ''}
                onClick={() => setSelected(r.id)}
                title={r.prompt}
              >
                <img src={r.url} alt="" />
              </button>
            ))}
          </div>
        )}
      </main>

      <footer className={`logbar ${showLogs ? 'open' : ''}`}>
        <button className="link" onClick={() => setShowLogs((s) => !s)}>
          {showLogs ? '▾' : '▸'} Engine log ({logs.length})
        </button>
        {showLogs && (
          <pre className="log">
            {logs.map((l, i) => (
              <div key={i} className={`log-${l.level}`}>
                [{l.level}] [{l.namespace}] {l.message}
              </div>
            ))}
          </pre>
        )}
      </footer>

      {dragOver && <div className="drop-hint">Drop images to add them to the edit</div>}
    </div>
  )
}

function StatusPill({ status, busy }: { status: ModelStatus; busy: boolean }): React.JSX.Element {
  const [label, tone] =
    status.state === 'ready'
      ? [busy ? 'Generating' : 'Ready', busy ? 'busy' : 'ok']
      : status.state === 'loading'
        ? ['Loading model', 'busy']
        : status.state === 'error'
          ? ['Error', 'bad']
          : ['Model not loaded', 'idle']
  return (
    <span className={`pill pill-${tone}`}>
      <span className="dot" />
      {label}
    </span>
  )
}

function EngineCard({ info }: { info: StudioInfo }): React.JSX.Element {
  const diffusion = info.models[0]
  return (
    <dl className="engine">
      <dt>Model</dt>
      <dd>FLUX.2 [klein] 4B · {diffusion?.quantization}</dd>
      <dt>Compute</dt>
      <dd>{info.gpuBackend.replace(/,/g, ', ')}</dd>
      <dt>Layer streaming</dt>
      <dd>{info.streamLayers ? `on · ${info.memoryBudgetGiB} GiB budget` : 'off'}</dd>
      <dt>Weights</dt>
      <dd>{info.streamLayers ? 'diffusion in RAM, streamed' : 'all on GPU'}</dd>
    </dl>
  )
}

function SetupCard(props: {
  info: StudioInfo | null
  status: ModelStatus
  downloads: Record<string, DownloadProgress>
  onLoad: () => void
}): React.JSX.Element {
  const { info, status, downloads, onLoad } = props
  const total = info?.models.reduce((n, m) => n + m.sizeBytes, 0) ?? 0
  return (
    <div className="setup">
      <h1>Local image generation with FLUX.2</h1>
      <p className="muted">
        Everything runs on this Mac. The first launch downloads the models ({formatBytes(total)});
        later launches load them from the local model cache.
      </p>
      <ul className="models">
        {info?.models.map((m) => {
          const d = downloads[m.file]
          const pct = d ? Math.min(100, d.percentage) : 0
          return (
            <li key={m.name}>
              <div className="model-row">
                <span className="model-name">{m.name}</span>
                <span className="muted">{formatBytes(m.sizeBytes)}</span>
              </div>
              {status.state === 'loading' && (
                <div className="bar">
                  <div style={{ width: `${pct}%` }} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {status.state === 'error' && <div className="error">{status.message}</div>}
      <button className="primary" disabled={status.state === 'loading'} onClick={onLoad}>
        {status.state === 'loading' ? 'Downloading & loading…' : 'Download & load model'}
      </button>
    </div>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo
}

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function cleanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export default App
