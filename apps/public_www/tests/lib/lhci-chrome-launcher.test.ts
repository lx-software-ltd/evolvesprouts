import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('@lhci/cli chrome-launcher override', () => {
  it('resolves the CommonJS 0.15 launcher LHCI calls', () => {
    const requireFromLhci = createRequire(require.resolve('@lhci/cli/package.json'));
    const chromeLauncher = requireFromLhci('chrome-launcher') as {
      Launcher: { getInstallations: () => string[] };
    };
    const pkg = requireFromLhci(
      requireFromLhci.resolve('chrome-launcher/package.json'),
    ) as { version: string };

    expect(typeof chromeLauncher.Launcher.getInstallations).toBe('function');
    // @lhci/cli declares chrome-launcher ^0.13.4. 0.15.2 is outside that range
    // and is pinned in package.json so the install drops glob 7, inflight, and
    // rimraf 3 while LHCI can still require() the launcher.
    expect(pkg.version).toBe('0.15.2');
  });
});
