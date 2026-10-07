'use strict';

const { sukka } = require('eslint-config-sukka');

module.exports = sukka(
  {
    ignores: {
      customGlobs: ['**/*.conf', '**/*.txt', 'other-repo-mirrors/**'],
    },
    js: {
      disableNoConsoleInCLI: ['Build/**'],
    },
    node: true,
    ts: true,
    pnpm: false,
    yaml: false,
  },
  {
    files: ['**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}'],
    rules: {
      'no-else-return': ['error', { allowElseIf: false }],
      'sukka/prefer-single-boolean-return': 'error',
      'vibe-proof/no-chain-array-higher-order-functions': 'error',
      'vibe-proof/prefer-array-some': 'error',
      'sukka/unicorn/logical-assignment-operators': ['error', 'always'],
      'sukka/unicorn/filename-case': ['error', {
        cases: { kebabCase: true, snakeCase: true },
        checkDirectories: false,
      }],
      'sukka/prefer-const-enum': 'off',
      // Preserve the existing lint scope; new preset rules need a separate code migration.
      'vibe-proof/prefer-hoisted-regex': 'off',
      'vibe-proof/prefer-array-from-mapper': 'off',
      'sukka/no-array-from-length-spread': 'off',
      'vibe-proof/prefer-indexed-array-loop': 'off',
      'sukka/avoid-string-starts-with-single-char': 'off',
      'sukka/unicorn/prefer-split-limit': 'off',
      'sukka/prefer-slice-over-split-index': 'off',
      'sukka/prefer-foxts-error-util': 'off',
      'vibe-proof/prefer-array-reduce-to-object': 'off',
      'vibe-proof/prefer-throw-if-no-entry': 'off',
      'sukka/unicorn/no-declarations-before-early-exit': 'off',
      'vibe-proof/prefer-array-at-for-last-item': 'off',
      'sukka/prefer-foxts-noop': 'off',
      'sukka/prefer-foxts-array-utils': 'off',
      'sukka/unicorn/prefer-url-href': 'off',
      'sukka/prefer-foxts-wait': 'off',
      'sukka/prefer-nullthrow': 'off',
      'sukka/prefer-foxts-object-size': 'off',
      'vibe-proof/prefer-static-collator': 'off',
      'vibe-proof/no-constant-array-includes': 'off',
      'sukka/unicorn/no-useless-continue': 'off',
      'sukka/unicorn/no-useless-recursion': 'off',
      'vibe-proof/prefer-timer-args': 'off',
      'autofix/valid-typeof': 'off',
      '@stylistic/comma-dangle': 'off',
      '@stylistic/member-delimiter-style': 'off',
      '@stylistic/operator-linebreak': 'off',
      '@stylistic/indent': 'off',
      '@stylistic/implicit-arrow-linebreak': 'off',
      '@stylistic/function-paren-newline': 'off',
    },
  }
);
