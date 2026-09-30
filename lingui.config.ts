import { defineConfig } from '@lingui/cli'
import { formatter } from '@lingui/format-po'

export default defineConfig({
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['<rootDir>/src'],
      exclude: ['**/node_modules/**'],
    },
  ],
  compileNamespace: 'ts',
  fallbackLocales: {
    default: 'en',
  },
  format: formatter({ lineNumbers: false }),
  locales: ['en', 'sv'],
  sourceLocale: 'en',
})
