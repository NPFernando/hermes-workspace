//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      'vite.config.ts',
      'dist/**',
      'build/**',
      'coverage/**',
      'node_modules/**',
      'server-entry.js',
      'public/sw.js',
      'scripts/**',
      '**/*.test.{ts,tsx}',
      'electron/server-bundle.cjs',
      'native-dashboard/assets/**',
      'services/**',
      'playground-ws-worker/**',
      'e2e/**',
    ],
  },
  {
    // server-entry.js is a plain Node bootstrap file and is intentionally not
    // part of the TypeScript project used by the shared parser configuration.
    // CI lints changed files with --no-ignore, so override the project parser
    // setting explicitly instead of relying on the ignore list.
    files: ['server-entry.js'],
    languageOptions: {
      parserOptions: { project: false },
    },
  },
  {
    // Block client-side imports of server-only MCP input types.
    // `src/types/mcp-input.ts` may carry secret-bearing fields and must
    // never be referenced from screens or shared components.
    files: ['src/screens/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/types/mcp-input',
              message:
                'mcp-input.ts is server-only (carries unmasked secrets). Import McpClientInput from @/types/mcp instead.',
            },
          ],
          patterns: [
            {
              group: ['**/types/mcp-input', '**/types/mcp-input.ts'],
              message:
                'mcp-input.ts is server-only (carries unmasked secrets). Import McpClientInput from @/types/mcp instead.',
            },
          ],
        },
      ],
    },
  },
]
