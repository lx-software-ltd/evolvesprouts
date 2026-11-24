import { describe, expect, it } from 'vitest';

import { deferStaticChunkScripts } from '../../scripts/defer-static-scripts.mjs';

const FRAMEWORK_CHUNK = '/_next/static/chunks/framework.js';
const PAGE_CHUNK = '/_next/static/chunks/page.js';
const POLYFILL_CHUNK = '/_next/static/chunks/polyfill.js';

function pageHtml(body = ''): string {
  return `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;
}

describe('deferStaticChunkScripts', () => {
  it('moves async Next chunks behind the hero largest-contentful-paint signal', () => {
    const html = pageHtml(
      [
        `<script src="${FRAMEWORK_CHUNK}" async=""></script>`,
        '<script>(self.__next_f=self.__next_f||[]).push([0])</script>',
        `<script src="${POLYFILL_CHUNK}" noModule=""></script>`,
        `<script src="${PAGE_CHUNK}" async=""></script>`,
      ].join(''),
    );

    const updated = deferStaticChunkScripts(html);

    expect(updated).not.toContain(`src="${FRAMEWORK_CHUNK}" async=""></script>`);
    expect(updated).not.toContain(`src="${PAGE_CHUNK}" async=""></script>`);
    expect(updated).toContain(`<script src="${POLYFILL_CHUNK}" noModule=""></script>`);
    expect(updated).toContain('(self.__next_f=self.__next_f||[]).push([0])');

    const loader = updated.match(/<script>\(function\(\)\{var sources=(.*?);var started/)?.[1];
    expect(JSON.parse(loader ?? 'null')).toEqual([FRAMEWORK_CHUNK, PAGE_CHUNK]);
    expect(updated).toContain('largest-contentful-paint');
    expect(updated).toContain('#hero-banner img[fetchpriority=\\"high\\"]');
    expect(updated).toContain('setTimeout(run,1500)');
    expect(updated.endsWith('</script></body></html>')).toBe(true);
  });

  it('starts chunks on the next task when the page has no hero image', () => {
    const updated = deferStaticChunkScripts(
      pageHtml(`<script src="${PAGE_CHUNK}" async=""></script>`),
    );

    expect(updated).toContain('if(!hero){arm();return;}');
  });

  it('leaves documents without Next chunks unchanged', () => {
    const html = pageHtml('<p>Hello</p>');

    expect(deferStaticChunkScripts(html)).toBe(html);
  });

  it('refuses a chunk script Next did not mark async', () => {
    const html = pageHtml(`<script src="${PAGE_CHUNK}" defer=""></script>`);

    expect(() => deferStaticChunkScripts(html)).toThrow(/non-async chunk script/);
  });
});
