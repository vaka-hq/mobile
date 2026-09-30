import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

const generatedFiles = [
  'android/**',
  '.expo/**',
  'expo-env.d.ts',
  'src/locales/**/messages.ts',
  'coverage/**',
  // Captured site pages stay byte-for-byte as the sites serve them.
  'src/**/fixtures/**',
]

const toolingFiles = ['.claude/**', 'tools/oxlint/anti-slop/**']

/** Compiled before anything that reads the translations: the app, its type check and its build. */
const translated = { dependsOn: ['i18n:compile'] }

/**
 * Every command is a task run with `vp run <name>`. None is cached: most build or install the
 * app, and the checks are quick enough to run in full.
 */
const tasks = {
  // The development app on the connected device, and Metro alone once it is installed.
  android: { ...translated, command: 'env APP_VARIANT=development expo run:android' },
  start: { ...translated, command: 'expo start --dev-client' },
  // The signed production app on the connected device; see the README for the signing key.
  'android:release': {
    ...translated,
    command: 'env APP_VARIANT=production expo run:android --variant release',
  },
  // Regenerates android/ after native changes, for the variant in APP_VARIANT.
  generate: { ...translated, command: 'expo prebuild --platform android' },
  export: { ...translated, command: 'expo export --platform android' },
  check: { ...translated, command: ['vp check --fix', 'tsc --noEmit', 'vp test run'] },
  typecheck: { ...translated, command: 'tsc --noEmit' },
  lint: 'vp lint --fix',
  test: 'vp test run',
  // Reaches the real services, so it is kept apart from the checks.
  'test:live': 'env VAKA_LIVE_TESTS=1 vp test run live',
  'i18n:compile': 'lingui compile --strict',
  'i18n:extract': 'lingui extract --clean',
  'icons:generate': 'node scripts/generate-icons.ts',
  'icons:skip': 'node scripts/generate-skip-icons.ts',
  'licenses:generate': 'node scripts/generate-licenses.ts',
}

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  run: { cache: false, tasks },
  staged: { '*': 'vp check --fix' },
  fmt: {
    ignorePatterns: [...generatedFiles, ...toolingFiles],
    semi: false,
    singleQuote: true,
    jsxSingleQuote: true,
    sortImports: { newlinesBetween: false },
    sortPackageJson: { sortScripts: true },
  },
  lint: {
    ignorePatterns: [...generatedFiles, ...toolingFiles],
    jsPlugins: [{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' }],
    options: { typeAware: true },
    rules: {
      // React Native's AbortSignal lacks what the DOM types promise; use `stopIfAborted`.
      'no-restricted-properties': [
        'error',
        {
          property: 'throwIfAborted',
          message:
            'React Native has no AbortSignal.throwIfAborted; use stopIfAborted from @/lib/abort.',
        },
      ],
      'oxc/no-accumulating-spread': 'error',
      'anti-slop/no-array-filter-map': 'error',
      'anti-slop/no-reduce-accumulator-copy': 'error',
      'anti-slop/no-chained-type-assertions': 'error',
      'anti-slop/no-conditional-empty-object-spread': 'error',
      'anti-slop/no-known-value-widening': 'error',
      'anti-slop/no-module-mocking': 'error',
      'anti-slop/no-object-parameters': 'error',
      'anti-slop/no-reflect-apply': 'error',
      'anti-slop/no-reflect-get': 'error',
      'anti-slop/no-runtime-typeof': 'error',
      'anti-slop/no-shape-in-symbol-names': 'error',
      'anti-slop/no-unknown-parameters': 'error',
      'anti-slop/no-unknown-returns': 'error',
      'anti-slop/no-unknown-type-aliases': 'error',
      'anti-slop/no-unsafe-dictionary-type': 'error',
      'anti-slop/no-widen-then-assert': 'error',
      'anti-slop/require-readable-spacing': 'error',
      'anti-slop/require-safety-comment-for-type-assertion': 'error',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          fix: { imports: 'safe-fix', variables: 'off' },
        },
      ],
      'typescript/no-floating-promises': 'error',
      'typescript/no-misused-promises': 'error',
    },
  },
  test: {
    // Live tests reach the real services; run them with `vp run test:live`.
    exclude: [
      ...(process.env.VAKA_LIVE_TESTS ? [] : ['**/*.live.test.ts']),
      '**/node_modules/**',
      '**/dist/**',
    ],
    include: ['config/**/*.test.ts', 'src/**/*.test.ts'],
  },
})
