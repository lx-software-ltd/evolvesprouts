import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/**',
      'cdk.out/**',
      'node_modules/**',
      'scripts/patch-bundled-aws-cdk-lib-deps.js',
      // CloudFront Functions runtime sources. Kept byte-identical with siutindei.
      'lib/functions/**',
      'test/public-www-edge-verify.test.mjs',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': 'off',
    },
  }
);
