export default [
  {
    files: ['**/*.js', 'bin/shipyard'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
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
  { files: ['test/**'], rules: { 'no-restricted-imports': 'off' } },
  { ignores: ['node_modules/', 'docs/'] },
];
