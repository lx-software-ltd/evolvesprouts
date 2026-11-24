/**
 * Fails if required NEXT_PUBLIC_* vars for public www build are unset or empty.
 * Keep the variable list in sync with `.github/workflows/deploy-public-www-staging.yml`
 * "Build public website" step env block.
 */
const REQUIRED = [
  'NEXT_PUBLIC_API_BASE_URL',
  'NEXT_PUBLIC_WWW_CRM_API_KEY',
  'NEXT_PUBLIC_WWW_PROXY_ALLOWED_HOSTS',
  'NEXT_PUBLIC_SITE_ORIGIN',
];

let failed = false;
for (const name of REQUIRED) {
  const value = process.env[name]?.trim() ?? '';
  if (!value) {
    console.error(`Missing or empty required env: ${name}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
