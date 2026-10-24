import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'qa/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['dev/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', Buffer: 'readonly' },
    },
  },
);
