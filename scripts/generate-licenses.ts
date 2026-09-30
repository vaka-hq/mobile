// The open-source licences shown under Settings → About: every package the app depends on
// directly, with its version, licence and licence text as installed, and the native Android
// libraries bundled with it, listed below. Run with `vp run licenses:generate` after adding,
// removing or upgrading a dependency, and update `nativeLibraries` when the native ones change.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const root = new URL('../', import.meta.url)

const manifest = z
  .object({ dependencies: z.record(z.string(), z.string()) })
  .parse(JSON.parse(await readFile(new URL('package.json', root), 'utf8')))

/** What a dependency's manifest says about itself; licence and repository have two forms. */
const packageManifest = z.object({
  version: z.string(),
  license: z
    .union([z.string(), z.object({ type: z.string() }).transform((value) => value.type)])
    .nullish(),
  repository: z
    .union([z.string(), z.object({ url: z.string() }).transform((value) => value.url)])
    .nullish(),
})

/** A direct dependency's folder: pnpm links each one at the top of node_modules. */
function packageDirectory(name: string) {
  return path.join(fileURLToPath(root), 'node_modules', name)
}

async function licenceText(directory: string) {
  const files = await readdir(directory)
  const file = files.find((entry) => /^(?:licen[cs]e|copying)(?:\.(?:md|txt))?$/iu.test(entry))

  return file ? reflow(await readFile(path.join(directory, file), 'utf8')) : null
}

/**
 * Joins the hard-wrapped lines of each paragraph, so the text wraps to the phone's width instead
 * of breaking where an 80-column file did.
 */
function reflow(text: string) {
  return text
    .trim()
    .split(/\n\s*\n/u)
    .map((paragraph: string) => paragraph.replace(/\s*\n\s*/gu, ' ').trim())
    .join('\n\n')
}

function repositoryUrl(url: string | null | undefined) {
  return url ? url.replace(/^git\+/u, '').replace(/\.git$/u, '') : null
}

const licences = []

/**
 * Native Android libraries bundled into the app, with the versions Gradle resolves for a
 * release build (`./gradlew :app:dependencies --configuration releaseRuntimeClasspath`). All are
 * Apache 2.0; JNA is offered under Apache 2.0 or LGPL 2.1, and is used here under Apache 2.0.
 */
const nativeLibraries = [
  { name: 'AndroidX Media3 (ExoPlayer)', version: '1.9.0' },
  { name: 'Coil', version: '3.2.0' },
  { name: 'Java Native Access (JNA)', version: '5.18.1' },
  { name: 'Jetpack Compose', version: '1.11.0-beta02' },
  { name: 'Jetpack Compose Material 3', version: '1.5.0-alpha17' },
  { name: 'Kotlin standard library', version: '2.2.20' },
  { name: 'Material Symbols', version: '' },
  { name: 'OkHttp', version: '4.12.0' },
  { name: 'Vosk', version: '0.3.75' },
]

const apache = reflow(await readFile(new URL('scripts/licenses/Apache-2.0.txt', root), 'utf8'))

for (const name of Object.keys(manifest.dependencies).sort()) {
  const directory = packageDirectory(name)

  const installed = packageManifest.parse(
    JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')),
  )

  licences.push({
    name,
    version: installed.version,
    license: installed.license ?? null,
    repository: repositoryUrl(installed.repository),
    text: await licenceText(directory),
  })
}

for (const library of nativeLibraries) {
  licences.push({ ...library, license: 'Apache-2.0', repository: null, text: apache })
}

// Packages from one repository share its licence; some are published without their own copy.
for (const entry of licences) {
  entry.text ??=
    licences.find((other) => other.text && other.repository === entry.repository)?.text ?? null
}

await writeFile(
  new URL('src/about/licenses.json', root),
  `${JSON.stringify(
    licences.map(({ repository: _repository, ...entry }) => entry),
    null,
    2,
  )}\n`,
)

console.log(`Wrote ${licences.length} licences`)
