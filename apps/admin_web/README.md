# Admin Web

`admin_web` is the admin sign-in app for Evolve Sprouts.

## Development

```bash
npm install
npm run dev
```

## Required environment variables

Set these variables before running or building the app:

- `NEXT_PUBLIC_COGNITO_DOMAIN`
- `NEXT_PUBLIC_COGNITO_CLIENT_ID`
- `NEXT_PUBLIC_COGNITO_USER_POOL_ID`
- `NEXT_PUBLIC_API_BASE_URL`

`NEXT_PUBLIC_API_BASE_URL` accepts:

- an absolute API URL (example: `https://api.evolvesprouts.com`). The current base has no stage prefix.

## Assets admin page

After authentication, the app renders the first admin module: **Assets**.
This screen supports:

- listing assets with filters and pagination
- creating and updating asset metadata
- deleting assets
- viewing and managing access grants for restricted assets

Current admin workflow is PDF-focused:

- asset type is fixed to `document`
- content type is fixed to `application/pdf`
- creating an asset requires selecting a PDF file
- file upload runs automatically after metadata creation
- failed uploads can be retried from the editor panel

If backend asset endpoints are unavailable in an environment, the UI surfaces
the API error response directly for easier diagnostics.

## ESLint

Lint runs on ESLint 10. `eslint.config.mjs` still wraps `eslint-config-next` with `@eslint/compat` `fixupConfigRules`. `eslint-plugin-react` 7.37.5 does not declare ESLint 10 support. Without the wrapper, `react/jsx-equals-spacing`, `react/jsx-tag-spacing`, `react/jsx-curly-spacing`, and `react/jsx-one-expression-per-line` throw `sourceCode.isSpaceBetweenTokens is not a function`. Those rules are off in the current config. JS-family files use the direct `espree` devDependency as their parser. Issue #402 stays open until the plugin declares ESLint 10 support and the wrapper can be removed.

## Build

```bash
npm run build
```

The static output is generated in `out/`.

## Admin API type contract

Admin web API types are generated from `docs/api/admin.yaml`.

- Generate/update committed types:

  ```bash
  npm run generate:admin-api-types
  ```

- Validate that committed generated types match YAML:

  ```bash
  npm run check:admin-api-types
  ```

`npm run lint` runs the API type drift check before ESLint.
