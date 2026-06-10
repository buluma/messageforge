import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

export default [
    js.configs.recommended,
    prettier,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                require: 'readonly',
                module: 'readonly',
                exports: 'writable',
                __dirname: 'readonly',
                __filename: 'readonly',
                process: 'readonly',
                console: 'readonly',
                Buffer: 'readonly',
                global: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                Promise: 'readonly',
                URL: 'readonly',
                fetch: 'readonly',
                setImmediate: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-console': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
            // Formatting is handled by Prettier; avoid style errors blocking CI.
            quotes: 'off',
            semi: 'off',
            'no-useless-escape': 'off',
            // This repo includes mixed runtime code (Node, browser bundles, plugin-embedded JS).
            // Avoid turning "no-undef" into a constant source of noise; rely on tests/runtime.
            'no-undef': 'off',
        },
    },
    {
        files: ['plugins/**/*.js'],
        rules: {
            'no-restricted-syntax': [
                'warn',
                {
                    // Focus on the most common regression: plain-text replies.
                    // Media/reaction/admin ops can remain on sock.sendMessage for now.
                    selector:
                        "CallExpression[callee.object.name='sock'][callee.property.name='sendMessage'] > ObjectExpression:nth-child(2) Property[key.name='text']",
                    message:
                        'Prefer ctx.safeSend() for plain-text replies in plugins (keeps pacing consistent). If this is intentional, refactor to ctx.safeSend or add a local justification comment.',
                },
            ],
        },
    },
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            globals: {
                jest: 'readonly',
                describe: 'readonly',
                test: 'readonly',
                expect: 'readonly',
                beforeAll: 'readonly',
                afterAll: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
            },
        },
    },
    {
        ignores: [
            'node_modules/**',
            '.claude/**',
            'eslint.config.mjs',
            'smm/js/**',
            'data/**',
            'session/**',
            'sessions/**',
            'temp/**',
            'logs/**',
            'coverage/**',
        ],
    },
];
