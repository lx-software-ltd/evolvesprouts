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
const CHUNK_SCRIPT_TAG_PATTERN =
  /<script\b([^>]*?)\ssrc="(\/_next\/static\/chunks\/[^"]+)"([^>]*)><\/script>/g;
const HERO_LCP_FALLBACK_MS = 1500;

function isNomoduleChunk(attributes) {
  return /\bnoModule\b/i.test(attributes);
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
  const withoutEagerChunks = html.replace(
    CHUNK_SCRIPT_TAG_PATTERN,
    (tag, before, src, after) => {
      const attributes = `${before} ${after}`;
      if (isNomoduleChunk(attributes)) {
        return tag;
      }
      if (!/\basync\b/.test(attributes)) {
        throw new Error(
          `Refusing to rewrite non-async chunk script ${src}. Update defer-static-scripts.mjs.`,
        );
      }
      sources.push(src);
      return '';
    },
  );

  if (sources.length === 0) {
    return html;
  }

  if (!withoutEagerChunks.includes('</body>')) {
    throw new Error('defer-static-scripts: HTML is missing </body>.');
  }

  const loader = buildDeferredChunkLoader(sources);
  return withoutEagerChunks.replace('</body>', `${loader}</body>`);
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
