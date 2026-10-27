import { defineConfig } from 'eslint/config';
import node from '@yaniv120892/dev-config/eslint/node';

export default defineConfig(
  { ignores: ['docs/'] },
  node,
  { files: ['bin/shipyard'] },
  {
    // Zero runtime dependencies: runtime code imports node: builtins and local files only.
    files: ['server.js', 'bin/shipyard', 'lib/**/*.js', 'scripts/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\.\\.?/|node:)',
              message: 'runtime code imports node: builtins and local files only',
            },
          ],
        },
      ],
    },
  },
);
