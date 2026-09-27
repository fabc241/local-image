// Headless end-to-end check of the model configuration used by the app.
//   node scripts/smoke.ts [outDir]
// Loads FLUX.2 [klein] 4B with the app's config, generates one image, then
// edits it, and prints every native log line so backend placement and layer
// streaming can be verified.
import fs from 'node:fs'
import path from 'node:path'
import { loadModel, unloadModel, diffusion, subscribeServerLogs } from '@qvac/sdk'
import { DIFFUSION_MODEL, MODEL_CONFIG } from '../src/main/modelConfig.ts'

const outDir = process.argv[2] ?? 'smoke-out'
fs.mkdirSync(outDir, { recursive: true })

const unsubscribe = subscribeServerLogs((log) => {
  console.log(`[log] [${log.level}] [${log.namespace}] ${log.message}`)
})

const modelConfig = MODEL_CONFIG
console.log(
  '▸ modelConfig',
  JSON.stringify(modelConfig, (k, v) => (k.endsWith('ModelSrc') ? v.name : v))
)

let lastPct = -1
const modelId = await loadModel({
  modelSrc: DIFFUSION_MODEL,
  modelType: 'sdcpp-generation',
  modelConfig,
  onProgress: (p) => {
    const pct = Math.floor(p.percentage)
    if (pct !== lastPct && pct % 5 === 0) {
      lastPct = pct
      console.log(
        `▸ download ${p.downloadKey ?? ''} ${pct}% (${(p.downloaded / 1e9).toFixed(2)}/${(p.total / 1e9).toFixed(2)} GB)`
      )
    }
  }
})
console.log('▸ loaded', modelId)

async function run(label: string, params: Parameters<typeof diffusion>[0]) {
  const { progressStream, outputs, stats } = diffusion(params)
  for await (const { step, totalSteps, elapsedMs } of progressStream) {
    console.log(`▸ ${label} step ${step}/${totalSteps} (${elapsedMs} ms)`)
  }
  const [png] = await outputs
  const file = path.join(outDir, `${label}.png`)
  fs.writeFileSync(file, png!)
  console.log(`▸ ${label} saved ${file}`, JSON.stringify(await stats))
  return png!
}

const created = await run('txt2img', {
  modelId,
  prompt: 'a red fox sitting in fresh snow, golden hour, photo',
  width: 512,
  height: 512,
  steps: 4,
  guidance: 3.5,
  cfg_scale: 1,
  seed: 42
})

await run('edit', {
  modelId,
  prompt: 'turn this into an oil painting with thick brush strokes',
  init_image: created,
  width: 512,
  height: 512,
  steps: 4,
  guidance: 3.5,
  cfg_scale: 1,
  seed: 42
})

await unloadModel({ modelId, clearStorage: false })
unsubscribe()
console.log('▸ done')
process.exit(0)
