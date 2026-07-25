import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'out/**', 'build/**', 'coverage/**', 'node_modules/**', '*.lock']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-misused-promises': 'error'
    }
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly'
      }
    }
  }
);
