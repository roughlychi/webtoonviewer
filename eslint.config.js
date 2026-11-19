import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/'] },
  js.configs.recommended,
  { files: ['js/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['test/**/*.js', 'eslint.config.js'], languageOptions: { globals: globals.node } },
  { rules: { eqeqeq: 'error', 'no-var': 'error', 'prefer-const': 'error' } },
];
