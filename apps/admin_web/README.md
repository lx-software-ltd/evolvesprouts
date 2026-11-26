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

## ESLint 10 compatibility

This app currently keeps a temporary ESLint 10 compatibility shim because the
Next.js lint dependency graph still includes plugins that are not fully
ESLint-10-native.

- `eslint.config.js` wraps `eslint-config-next` via `@eslint/compat`
  `fixupConfigRules(...)`.
- `eslint.config.js` uses `espree` for JS-family files to avoid parser/runtime
  mismatches while linting config files.
- `package.json` overrides `typescript-eslint` to `8.55.1-alpha.4` to pick up
  ESLint 10 support in the parser/scope-manager stack.

When upstream `eslint-config-next` dependencies ship stable ESLint 10 support,
remove the compatibility shim and the override.

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
