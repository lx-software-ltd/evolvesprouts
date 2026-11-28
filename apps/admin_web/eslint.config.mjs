import { fixupConfigRules } from '@eslint/compat';
import * as espree from 'espree';
import nextConfig from 'eslint-config-next';

// fixupConfigRules stays until eslint-plugin-react declares ESLint 10 support.
// Without it, react/jsx-equals-spacing, react/jsx-tag-spacing,
// react/jsx-curly-spacing, and react/jsx-one-expression-per-line throw
// sourceCode.isSpaceBetweenTokens. Issue #402 tracks removal.
const eslintConfig = [
  ...fixupConfigRules(nextConfig),
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      parser: espree,
    },
  },
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              importNames: ['CSSProperties'],
              message: 'Use CSS classes/files instead of CSSProperties.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message: 'Inline style props are not allowed. Move styling to CSS files.',
        },
        {
          selector: "TSTypeReference[typeName.name='CSSProperties']",
          message: 'CSSProperties types are not allowed. Move styling to CSS files.',
        },
        {
          selector: "TSTypeReference[typeName.right.name='CSSProperties']",
          message: 'React.CSSProperties is not allowed. Move styling to CSS files.',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{tsx,jsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message: 'Inline style props are not allowed. Move styling to CSS files.',
        },
        {
          selector: "TSTypeReference[typeName.name='CSSProperties']",
          message: 'CSSProperties types are not allowed. Move styling to CSS files.',
        },
        {
          selector: "TSTypeReference[typeName.right.name='CSSProperties']",
          message: 'React.CSSProperties is not allowed. Move styling to CSS files.',
        },
        {
          selector: "JSXOpeningElement[name.name='svg']",
          message:
            'Do not embed inline SVG in app code. Add a file under src/components/icons/svg/ and import it with SVGR.',
        },
      ],
    },
  },
  {
    ignores: ['node_modules/**', 'e2e/**', 'playwright.config.ts', 'coverage/**'],
  },
];

export default eslintConfig;
