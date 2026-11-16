/**
 * Patches bundled dependencies inside aws-cdk-lib that npm overrides cannot
 * reach (they are nested with inBundle: true in the lockfile).
 *
 * minimatch GHSA-g3hv-75wg-m249 is fixed only in 11.0.1+. aws-cdk-lib still
 * bundles 10.2.6. Copy the direct minimatch dependency over that tree, then
 * record the patched version in package-lock.json. Dependabot reads the
 * lockfile, not node_modules, and a security job for the bundled 10.2.6 fails
 * as security_update_not_possible. npm ci keeps an inBundle version written
 * here. npm install restores 10.2.6 from the published tarball, so this script
 * writes 11.x back before the install finishes.
 *
 * Remove this workaround once aws-cdk-lib ships minimatch >= 11.0.1.
 */

const fs = require("fs");
const path = require("path");

const LOCKFILE = path.join(__dirname, "..", "package-lock.json");
const BUNDLED_MINIMATCH = "node_modules/aws-cdk-lib/node_modules/minimatch";

/**
 * @param {string} bundledFolderName - directory name under aws-cdk-lib/node_modules
 * @param {string} npmPackageName - package to copy from (top-level dependency)
 * @param {(name: string) => string} resolveSourceRoot - returns filesystem path to package root
 */
function patchBundledDep(bundledFolderName, npmPackageName, resolveSourceRoot) {
  const bundledDir = path.join(
    __dirname,
    "..",
    "node_modules",
    "aws-cdk-lib",
    "node_modules",
    bundledFolderName,
  );

  if (!fs.existsSync(bundledDir)) {
    return;
  }

  const sourceDir = resolveSourceRoot(npmPackageName);

  const bundledPkg = JSON.parse(
    fs.readFileSync(path.join(bundledDir, "package.json"), "utf8"),
  );
  const sourcePkg = JSON.parse(
    fs.readFileSync(path.join(sourceDir, "package.json"), "utf8"),
  );

  if (bundledPkg.version === sourcePkg.version) {
    return;
  }

  fs.cpSync(sourceDir, bundledDir, { recursive: true });

  const updatedPkg = JSON.parse(
    fs.readFileSync(path.join(bundledDir, "package.json"), "utf8"),
  );
  console.log(
    `patched aws-cdk-lib bundled ${npmPackageName}: ${bundledPkg.version} -> ${updatedPkg.version}`,
  );
}

/**
 * GHSA-g3hv-75wg-m249 is fixed in 11.0.1, with no 10.x backport.
 * @param {string} version
 */
function minimatchIsPatched(version) {
  const [major, minor, patch] = String(version)
    .split(".")
    .map((part) => Number(part));
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch)
  ) {
    return false;
  }
  if (major > 11) {
    return true;
  }
  if (major < 11) {
    return false;
  }
  if (minor > 0) {
    return true;
  }
  return patch >= 1;
}

/**
 * @param {{ version: string, dependencies?: Record<string, string>, engines?: Record<string, string> }} sourcePkg
 */
function syncBundledMinimatchLockfile(sourcePkg) {
  const raw = fs.readFileSync(LOCKFILE, "utf8");
  const data = JSON.parse(raw);
  const entry = data.packages?.[BUNDLED_MINIMATCH];
  if (!entry) {
    return;
  }

  const dependencies = sourcePkg.dependencies ?? {};
  const engines = sourcePkg.engines ?? entry.engines;
  const unchanged =
    entry.version === sourcePkg.version &&
    JSON.stringify(entry.dependencies) === JSON.stringify(dependencies) &&
    JSON.stringify(entry.engines) === JSON.stringify(engines);
  if (unchanged) {
    return;
  }

  entry.version = sourcePkg.version;
  entry.dependencies = dependencies;
  entry.engines = engines;
  fs.writeFileSync(LOCKFILE, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`lockfile aws-cdk-lib bundled minimatch -> ${sourcePkg.version}`);
}

patchBundledDep("minimatch", "minimatch", (name) =>
  path.dirname(require.resolve(`${name}/package.json`)),
);

const sourcePkg = JSON.parse(
  fs.readFileSync(require.resolve("minimatch/package.json"), "utf8"),
);
if (!minimatchIsPatched(sourcePkg.version)) {
  throw new Error(
    `minimatch ${sourcePkg.version} does not include the GHSA-g3hv-75wg-m249 fix (11.0.1+)`,
  );
}
syncBundledMinimatchLockfile(sourcePkg);
