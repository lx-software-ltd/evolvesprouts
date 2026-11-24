/**
 * Next's static export emits async chunk tags in the document. On a fast
 * collect those chunks finish before the hero paints, so Lighthouse treats
 * them as part of the LCP critical path. The hero is already in the HTML.
 * Hold the chunk downloads until that image is the largest paint, then load
 * them in document order. Pages without that image start on the next task.
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const BUILD_OUTPUT_DIRECTORY = resolve('out');
const CHUNK_SRC_PATTERN = /^\/_next\/static\/chunks\/[A-Za-z0-9._-]+$/;
const HERO_LCP_FALLBACK_MS = 1500;
const SCRIPT_OPEN = '<script';
const SCRIPT_CLOSE = '</script>';

function readDoubleQuotedAttribute(openTag, name) {
  const marker = ` ${name}="`;
  const start = openTag.indexOf(marker);
  if (start === -1) {
    return null;
  }
  const valueStart = start + marker.length;
  const valueEnd = openTag.indexOf('"', valueStart);
  if (valueEnd === -1) {
    return null;
  }
  return openTag.slice(valueStart, valueEnd);
}

function readScriptElement(html, start) {
  if (!html.startsWith(SCRIPT_OPEN, start)) {
    return null;
  }
  const openEnd = html.indexOf('>', start);
  if (openEnd === -1) {
    return null;
  }
  const openTag = html.slice(start, openEnd + 1);
  if (openTag.endsWith('/>')) {
    return { openTag, end: openEnd + 1 };
  }
  const close = html.indexOf(SCRIPT_CLOSE, openEnd);
  if (close === -1) {
    return null;
  }
  return { openTag, end: close + SCRIPT_CLOSE.length };
}

function classifyChunkOpenTag(openTag) {
  const src = readDoubleQuotedAttribute(openTag, 'src');
  if (!src?.startsWith('/_next/static/chunks/')) {
    return { kind: 'keep' };
  }
  if (!CHUNK_SRC_PATTERN.test(src)) {
    throw new Error(
      `Refusing unexpected chunk path ${src}. Update defer-static-scripts.mjs.`,
    );
  }
  if (/\bnoModule\b/i.test(openTag)) {
    return { kind: 'keep' };
  }
  if (!/\basync\b/.test(openTag)) {
    throw new Error(
      `Refusing to rewrite non-async chunk script ${src}. Update defer-static-scripts.mjs.`,
    );
  }
  return { kind: 'defer', src };
}

function buildDeferredChunkLoader(sources) {
  const serializedSources = JSON.stringify(sources);
  return (
    '<script>(function(){var sources=' +
    serializedSources +
    ';var started=false;function run(){if(started)return;started=true;' +
    'for(var index=0;index<sources.length;index+=1){var script=document.createElement("script");' +
    'script.src=sources[index];script.async=false;document.body.appendChild(script);}}' +
    'function arm(){setTimeout(run,0);}' +
    'var hero=document.querySelector("#hero-banner img[fetchpriority=\\"high\\"]");' +
    'if(!hero){arm();return;}' +
    'try{var observer=new PerformanceObserver(function(list){var entries=list.getEntries();' +
    'for(var index=0;index<entries.length;index+=1){var element=entries[index].element;' +
    'if(element&&element.tagName==="IMG"&&element.getAttribute("fetchpriority")==="high"){' +
    'observer.disconnect();arm();return;}}});' +
    'observer.observe({type:"largest-contentful-paint",buffered:true});}' +
    'catch(error){arm();}' +
    'setTimeout(run,' +
    HERO_LCP_FALLBACK_MS +
    ');})();</script>'
  );
}

export function deferStaticChunkScripts(html) {
  const sources = [];
  let cursor = 0;
  let rewritten = '';

  while (cursor < html.length) {
    const start = html.indexOf(SCRIPT_OPEN, cursor);
    if (start === -1) {
      rewritten += html.slice(cursor);
      break;
    }
    const element = readScriptElement(html, start);
    if (!element) {
      rewritten += html.slice(cursor);
      break;
    }
    rewritten += html.slice(cursor, start);
    const decision = classifyChunkOpenTag(element.openTag);
    if (decision.kind === 'defer') {
      sources.push(decision.src);
    } else {
      rewritten += html.slice(start, element.end);
    }
    cursor = element.end;
  }

  if (sources.length === 0) {
    return html;
  }

  const bodyClose = rewritten.lastIndexOf('</body>');
  if (bodyClose === -1) {
    throw new Error('defer-static-scripts: HTML is missing </body>.');
  }

  const loader = buildDeferredChunkLoader(sources);
  return `${rewritten.slice(0, bodyClose)}${loader}${rewritten.slice(bodyClose)}`;
}

async function collectHtmlFiles(directoryPath) {
  const htmlFiles = [];
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      htmlFiles.push(...(await collectHtmlFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.html')) {
      htmlFiles.push(entryPath);
    }
  }

  return htmlFiles;
}

async function main() {
  const outputDirectoryStats = await stat(BUILD_OUTPUT_DIRECTORY).catch(() => null);
  if (!outputDirectoryStats?.isDirectory()) {
    throw new Error(
      `Build output directory "${BUILD_OUTPUT_DIRECTORY}" not found. Run "next build" first.`,
    );
  }

  const htmlFiles = await collectHtmlFiles(BUILD_OUTPUT_DIRECTORY);
  let rewrittenFiles = 0;

  for (const htmlPath of htmlFiles) {
    const html = await readFile(htmlPath, 'utf8');
    const updatedHtml = deferStaticChunkScripts(html);
    if (updatedHtml === html) {
      continue;
    }
    await writeFile(htmlPath, updatedHtml, 'utf8');
    rewrittenFiles += 1;
  }

  console.log(
    `Deferred Next chunk scripts in ${rewrittenFiles}/${htmlFiles.length} HTML files.`,
  );
}

const isDirectRun = process.argv[1]?.endsWith('defer-static-scripts.mjs') ?? false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
