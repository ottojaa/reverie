import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import globals from 'globals';

const paddingRules = {
    'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'always', prev: '*', next: 'block-like' },
        { blankLine: 'always', prev: '*', next: 'if' },
        { blankLine: 'always', prev: 'if', next: '*' },
        { blankLine: 'always', prev: 'directive', next: '*' },
        { blankLine: 'always', prev: '*', next: 'directive' },
    ],
};

export default [
    { ignores: ['**/dist/**', '**/node_modules/**', '**/.nx/**', '**/routeTree.gen.ts'] },
    js.configs.recommended,
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parser: tsParser,
            parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
            globals: {
                ...globals.node,
                ...globals.browser,
                React: 'readonly',
                JSX: 'readonly',
                NodeJS: 'readonly',
                RequestInit: 'readonly',
            },
        },
        rules: {
            ...paddingRules,
            'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
        },
    },
    {
        files: ['**/*.js', '**/*.jsx'],
        languageOptions: {
            parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
            globals: { ...globals.node, ...globals.browser },
        },
        rules: {
            ...paddingRules,
            'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
        },
    },
    eslintConfigPrettier,
];
