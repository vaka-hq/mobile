// Numbered skip icons for every skip interval, in the style of Material's replay_10 and forward_30:
// Material's circular arrow with the seconds drawn as its blocky digits (240 tall, 60 thick,
// corners of 40 on the 960 grid). Material ships digits only for 5, 10 and 30; 4 and 6 are drawn
// here on the same grid. Run with `vp run icons:skip` after changing the skip intervals.
import { writeFile } from 'node:fs/promises'

const intervals = [5, 10, 15, 30, 45, 60]

const arrows = {
  back: 'M339.5,851.5Q274,823 225.5,774.5Q177,726 148.5,660.5Q120,595 120,520L200,520Q200,637 281.5,718.5Q363,800 480,800Q597,800 678.5,718.5Q760,637 760,520Q760,403 678.5,321.5Q597,240 480,240L474,240L536,302L480,360L320,200L480,40L536,98L474,160L480,160Q555,160 620.5,188.5Q686,217 734.5,265.5Q783,314 811.5,379.5Q840,445 840,520Q840,595 811.5,660.5Q783,726 734.5,774.5Q686,823 620.5,851.5Q555,880 480,880Q405,880 339.5,851.5Z',
  forward:
    'M339.5,851.5Q274,823 225.5,774.5Q177,726 148.5,660.5Q120,595 120,520Q120,445 148.5,379.5Q177,314 225.5,265.5Q274,217 339.5,188.5Q405,160 480,160L486,160L424,98L480,40L640,200L480,360L424,302L486,240L480,240Q363,240 281.5,321.5Q200,403 200,520Q200,637 281.5,718.5Q363,800 480,800Q597,800 678.5,718.5Q760,637 760,520L840,520Q840,595 811.5,660.5Q783,726 734.5,774.5Q686,823 620.5,851.5Q555,880 480,880Q405,880 339.5,851.5Z',
}

// Each digit as [width, subpaths], drawn from its top-left corner. Outlines run clockwise and
// counters anticlockwise, so the counters stay open.
const digits = {
  0: [
    160,
    [
      'M40,240Q23,240 11.5,228.5Q0,217 0,200L0,40Q0,23 11.5,11.5Q23,0 40,0L120,0Q137,0 148.5,11.5Q160,23 160,40L160,200Q160,217 148.5,228.5Q137,240 120,240Z',
      'M60,180L100,180L100,60L60,60Z',
    ],
  ],
  1: [120, ['M60,240L60,60L0,60L0,0L120,0L120,240Z']],
  3: [
    160,
    [
      'M0,240L0,180L100,180L100,140L40,140L40,100L100,100L100,60L0,60L0,0L120,0Q137,0 148.5,11.5Q160,23 160,40L160,200Q160,217 148.5,228.5Q137,240 120,240Z',
    ],
  ],
  4: [160, ['M100,240L100,160L0,160L0,0L60,0L60,100L100,100L100,0L160,0L160,240Z']],
  5: [
    180,
    [
      'M0,240L0,180L120,180L120,140L0,140L0,0L180,0L180,60L60,60L60,100L140,100Q157,100 168.5,111.5Q180,123 180,140L180,200Q180,217 168.5,228.5Q157,240 140,240Z',
    ],
  ],
  6: [
    160,
    [
      'M40,240Q23,240 11.5,228.5Q0,217 0,200L0,40Q0,23 11.5,11.5Q23,0 40,0L160,0L160,60L60,60L60,100L120,100Q137,100 148.5,111.5Q160,123 160,140L160,200Q160,217 148.5,228.5Q137,240 120,240Z',
      'M60,180L100,180L100,140L60,140Z',
    ],
  ],
} satisfies Record<string, [number, string[]]>

/** The digits by character, for spelling out a number. */
const digitsByCharacter = new Map(Object.entries(digits))

const digitGap = 40

const digitTop = 400

// The arrow's circle is centred here.
const centreX = 480

/** Moves every coordinate pair of an absolute path by (dx, dy). */
function translate(path: string, dx: number, dy: number) {
  return path.replace(
    /(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/gu,
    (_: string, x: string, y: string) => {
      return `${Number(x) + dx},${Number(y) + dy}`
    },
  )
}

function numberPaths(seconds: number) {
  const glyphs = String(seconds)
    .split('')
    .flatMap((digit) => {
      const glyph = digitsByCharacter.get(digit)

      return glyph ? [glyph] : []
    })

  const width = glyphs.reduce((sum, [w]) => sum + w, 0) + digitGap * (glyphs.length - 1)
  let x = centreX - width / 2
  const paths = []

  for (const [w, subpaths] of glyphs) {
    for (const subpath of subpaths) {
      paths.push(translate(subpath, x, digitTop))
    }

    x += w + digitGap
  }

  return paths
}

function vector(pathData: string) {
  return `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="960"
    android:viewportHeight="960"
    android:tint="?attr/colorControlNormal">
  <path
      android:fillColor="@android:color/white"
      android:pathData="${pathData}"/>
</vector>
`
}

for (const [direction, arrow] of Object.entries(arrows)) {
  for (const seconds of intervals) {
    const name = `skip_${direction}_${seconds}`
    const pathData = [arrow, ...numberPaths(seconds)].join('')
    const directory = new URL('../assets/symbols/', import.meta.url)

    await writeFile(new URL(`${name}.xml`, directory), vector(pathData))
    await writeFile(
      new URL(`${name}.xml.d.ts`, directory),
      'declare const source: number\n\nexport default source\n',
    )
  }
}
