import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DownloadProgress,
  LogLine,
  ModelStatus,
  StepProgress,
  StudioInfo
} from '../../shared/types'
import { fitAspect, formatBytes, loadSourceImage, pngToUrl, type SourceImage } from './image'

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
  const [source, setSource] = useState<SourceImage | null>(null)
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
  const fileInput = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)

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

  const [width, height] = useMemo<[number, number]>(() => {
    if (mode === 'edit' && sizeId === MATCH_INPUT && source) {
      return fitAspect(
        source.width,
        source.height,
        Math.min(1024, Math.max(source.width, source.height))
      )
    }
    const preset = SIZE_PRESETS.find((p) => p.id === sizeId) ?? SIZE_PRESETS[0]
    return [preset.w, preset.h]
  }, [mode, sizeId, source])

  const acceptFile = useCallback(async (file: File | Blob, name: string) => {
    setError(null)
    try {
      const img = await loadSourceImage(file, name)
      setSource((old) => {
        if (old) URL.revokeObjectURL(old.url)
        return img
      })
      setMode('edit')
      setSizeId(MATCH_INPUT)
    } catch {
      setError(`Could not read "${name}" as an image.`)
    }
  }, [])

  const editResult = useCallback(
    (r: Result) => {
      acceptFile(new Blob([r.png as BlobPart], { type: 'image/png' }), `result-${r.id}.png`)
    },
    [acceptFile]
  )

  const generate = useCallback(async () => {
    if (!prompt.trim() || busy) return
    if (mode === 'edit' && !source) {
      setError('Add an image to edit first.')
      return
    }
    setBusy(true)
    setError(null)
    setProgress(null)
    try {
      const parsedSeed = seed.trim() === '' ? -1 : Number.parseInt(seed, 10)
      const res = await window.studio.generate({
        prompt: prompt.trim(),
        initImage: mode === 'edit' ? source!.bytes : undefined,
        width,
        height,
        steps,
        guidance,
        seed: Number.isFinite(parsedSeed) ? parsedSeed : -1
      })
      const id = nextId.current++
      setResults((prev) => [
        { id, url: pngToUrl(res.png), prompt: prompt.trim(), mode, width, height, ...res },
        ...prev
      ])
      setSelected(id)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }, [prompt, busy, mode, source, seed, width, height, steps, guidance])

  const save = useCallback(async (r: Result) => {
    const path = await window.studio.saveImage(r.png, `local-image-${r.mode}-${r.seed ?? r.id}.png`)
    if (path) setError(null)
  }, [])

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) acceptFile(file, file.name)
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
              if (source) setSizeId(MATCH_INPUT)
            }}
          >
            Edit
          </button>
        </div>

        {mode === 'edit' && (
          <div className="field">
            <label>Image to edit</label>
            <button
              className={`dropzone ${source ? 'has-image' : ''}`}
              onClick={() => fileInput.current?.click()}
            >
              {source ? (
                <>
                  <img src={source.url} alt="" />
                  <span className="dropzone-caption">
                    {source.name} · {source.width}×{source.height} · click to replace
                  </span>
                </>
              ) : (
                <span>
                  Drop an image here
                  <br />
                  <small>or click to choose (PNG, JPEG, WebP)</small>
                </span>
              )}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) acceptFile(f, f.name)
                e.target.value = ''
              }}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="prompt">
            {mode === 'create' ? 'Describe the image' : 'Describe the edit'}
          </label>
          <textarea
            id="prompt"
            rows={5}
            value={prompt}
            placeholder={
              mode === 'create'
                ? 'A lighthouse on a rocky coast at dusk, volumetric light, 35mm photo'
                : 'Turn it into a watercolor painting, keep the composition'
            }
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate()
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="size">Output size</label>
          <select id="size" value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
            {mode === 'edit' && source && <option value={MATCH_INPUT}>Match input aspect</option>}
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
              busy || !prompt.trim() || status.state === 'loading' || (mode === 'edit' && !source)
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
                    <button className="secondary" onClick={() => editResult(current)}>
                      Edit this image
                    </button>
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

      {dragOver && <div className="drop-hint">Drop to edit this image</div>}
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
