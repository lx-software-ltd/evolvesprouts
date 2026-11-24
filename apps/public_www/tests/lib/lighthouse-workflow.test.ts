import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const workflowPath = path.resolve(
  process.cwd(),
  '..',
  '..',
  '.github',
  'workflows',
  'lighthouse-public-www.yml',
);

describe('public website Lighthouse workflow', () => {
  it('audits with the app install of LHCI', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    const runLines = workflow
      .split('\n')
      .filter((line) => line.includes('run:'))
      .join('\n');

    expect(workflow).toContain('dry-run: "true"');
    expect(runLines).toContain(
      './node_modules/.bin/lhci autorun --config="$CONFIG_PATH"',
    );
    expect(runLines).not.toContain('npx');
  });
});
