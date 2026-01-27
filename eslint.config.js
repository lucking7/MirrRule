'use strict';

const { sukka } = require('eslint-config-sukka');

module.exports = sukka(
  {
    ignores: ['**/*.conf', '**/*.txt', 'other-repo-mirrors/**'],
    js: {
      disableNoConsoleInCLI: ['Build/**'],
    },
    node: true,
    ts: true,
    yaml: false,
  },
  {
    rules: {
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
