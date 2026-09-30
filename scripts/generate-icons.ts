// Draws the Vaka app icon, three lines of text with the middle one read aloud as a sound wave, on
// a midnight field, and writes every image made from it. Run with `vp run icons:generate`.
//
// Android only: the adaptive icon's field and mark as separate layers, a themed (monochrome)
// layer, the flattened icon for older launchers, and the mark alone for the splash screen. The mark is drawn on the full 1024 canvas of an adaptive icon layer (108 dp),
// inside its central safe zone. Keep `android.adaptiveIcon.backgroundColor` and the splash
// screen's `backgroundColor` in `app.config.ts` at the colour this prints.
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** The field, top to bottom; the lines; and the wave, left to right. */
const colors = {
  field: ['#1F2F57', '#101832'],
  lines: '#EEF1FA',
  wave: ['#FFC46B', '#FF7A59'],
} as const

/**
 * How large the mark is drawn: it is laid out to the edge of the safe zone, and drawn smaller so
 * it sits in the launcher's shape with room around it, as other icons do.
 */
const markScale = 0.74

const round = (value: number) => Math.round(value * 10) / 10

const stops = (list: readonly string[]) =>
  list
    .map((color, index) => `<stop offset="${index / (list.length - 1)}" stop-color="${color}"/>`)
    .join('')

const stroke = (d: string, paint: string, width: number) =>
  `<path d="${d}" fill="none" stroke="${paint}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`

/** Two gentle periods of a sine across the middle line. */
const wave = Array.from({ length: 49 }, (_, index) => {
  const x = 272 + (480 * index) / 48
  const y = 512 + 56 * Math.sin((index / 48) * Math.PI * 4)

  return `${index === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`
}).join(' ')

/** The wave's gradient is laid across the canvas, so the whole stroke shares one blend. */
const markDefs = `<linearGradient id="line" gradientUnits="userSpaceOnUse" x1="272" y1="512" x2="752" y2="512">${stops(colors.wave)}</linearGradient>`

/** The lines and the wave, all centred on the icon, the shorter bottom line too. */
const mark = `${stroke('M272 382 H752', colors.lines, 56)}${stroke(wave, 'url(#line)', 56)}${stroke('M342 642 H682', colors.lines, 56)}`

const fieldDefs = `<linearGradient id="field" x1="0" y1="0" x2="0" y2="1">${stops(colors.field)}</linearGradient><radialGradient id="glow" cx="50%" cy="30%" r="70%"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.14"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>`

const field =
  '<rect width="1024" height="1024" fill="url(#field)"/><rect width="1024" height="1024" fill="url(#glow)"/>'

const svg = (inner: string, defs = '') =>
  `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${inner}</svg>`

/** The mark alone, at its size in the icon. */
const placed = svg(
  `<g transform="translate(512 512) scale(${markScale}) translate(-512 -512)">${mark}</g>`,
  markDefs,
)

/** The whole icon, field and mark, as one full-bleed layer. */
const flattened = svg(
  `${field}<g transform="translate(512 512) scale(${markScale}) translate(-512 -512)">${mark}</g>`,
  `${fieldDefs}${markDefs}`,
)

const images = fileURLToPath(new URL('../assets/images/', import.meta.url))

await mkdir(images, { recursive: true })

async function raster(markup: string, size: number, file: string) {
  await sharp(Buffer.from(markup)).resize(size, size).png().toFile(`${images}${file}`)
  console.log('wrote', `assets/images/${file}`, `${size}x${size}`)
}

const channels = (hex: string) =>
  [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))

/** The field's middle colour, for places that take a single colour. */
const middle = `#${channels(colors.field[0])
  .map((value, index) => Math.round((value + (channels(colors.field[1])[index] ?? 0)) / 2))
  .map((value) => value.toString(16).padStart(2, '0'))
  .join('')}`.toUpperCase()

// The flattened icon, for launchers older than adaptive icons.
await raster(flattened, 1024, 'icon.png')

// The splash screen's mark, alone on a clear canvas; Android sets it on the field's colour.
await raster(placed, 1024, 'splash-icon.png')

// Adaptive icon: the field and the mark as separate layers, so the launcher can move them apart.
await raster(svg(field, fieldDefs), 1024, 'android-icon-background.png')

await raster(placed, 1024, 'android-icon-foreground.png')

// Android 13+ themed icon: the mark's shape in white.
const alpha = await sharp(Buffer.from(placed))
  .resize(1024, 1024)
  .ensureAlpha()
  .extractChannel('alpha')
  .toBuffer()

await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#FFFFFF' } })
  .joinChannel(alpha)
  .png()
  .toFile(`${images}android-icon-monochrome.png`)

console.log('wrote', 'assets/images/android-icon-monochrome.png', '1024x1024')

console.log(`android.adaptiveIcon.backgroundColor: ${middle}`)
