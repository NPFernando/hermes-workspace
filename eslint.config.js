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
      'dist.failed.*/**',
      'dist.rollback.*/**',
      'build/**',
      'coverage/**',
      'node_modules/**',
      'server-entry.js',
      'server-entry.js.failed.*',
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
