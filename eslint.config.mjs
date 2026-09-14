import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default defineConfig(
  // The icon renderer is a plain Electron entry point, so it is CommonJS and not part of the app.
  // A worktree under .claude is another session's copy of this tree; its files are not ours to
  // judge, and the ignores above are written against this tree's paths rather than that one's.
  // The gates are plain JavaScript run by node before a commit, so the rule that every function
  // states its return type has nothing to state it in.
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      '.claude/**',
      'tools/icons/**',
      'tools/hook/**',
      'tools/gate/**',
      // electron-builder loads its hooks with require, so this one has no choice about being CommonJS.
      'tools/build/**'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        },
        extraFileExtensions: ['.vue'],
        parser: tseslint.parser
      }
    }
  },
  {
    files: ['**/*.{ts,mts,tsx,vue}'],
    rules: {
      'vue/require-default-prop': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/block-lang': [
        'error',
        {
          script: {
            lang: 'ts'
          }
        }
      ]
    }
  },
  eslintConfigPrettier
)
