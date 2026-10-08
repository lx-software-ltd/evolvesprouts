#!/usr/bin/env node
/**
 * Keep docs/architecture/lambdas.md aligned with Lambda directories and
 * reject construct ids that repeat the product prefix.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const libDir = path.join(repoRoot, 'backend/infrastructure/lib');
const lambdaDir = path.join(repoRoot, 'backend/lambda');
const docPath = path.join(repoRoot, 'docs/architecture/lambdas.md');

function walkTs(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    if (statSync(fullPath).isDirectory()) {
      walkTs(fullPath, files);
      continue;
    }
    if (name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function mentioned(docText, dirName) {
  const pattern = new RegExp(`backend/lambda/${dirName}(?![A-Za-z0-9_])`);
  return pattern.test(docText);
}

const cdkText = walkTs(libDir)
  .map((filePath) => readFileSync(filePath, 'utf8'))
  .join('\n');
const docText = readFileSync(docPath, 'utf8');

const handlerDirs = new Set();
for (const match of cdkText.matchAll(/lambda\/([a-z0-9_]+)\//g)) {
  handlerDirs.add(match[1]);
}

const diskDirs = readdirSync(lambdaDir).filter((name) => {
  if (name.startsWith('.')) {
    return false;
  }
  return statSync(path.join(lambdaDir, name)).isDirectory();
});

const errors = [];
for (const dirName of new Set([...handlerDirs, ...diskDirs])) {
  if (!mentioned(docText, dirName)) {
    errors.push(`docs/architecture/lambdas.md does not mention backend/lambda/${dirName}`);
  }
}

for (const match of docText.matchAll(/backend\/lambda\/([a-z0-9_]+)/g)) {
  const dirName = match[1];
  if (!diskDirs.includes(dirName)) {
    errors.push(`lambdas.md mentions backend/lambda/${dirName}, which is not a backend/lambda directory`);
  }
}

// Renaming these replaces the live CloudFormation function. Do not add ids.
const knownPrefixedIds = new Set([
  'EvolvesproutsAdminFunction',
  'EvolvesproutsMigrationFunction',
]);

const constructIds = new Set();
const constructIdPatterns = [
  /createPythonFunction\(\s*"([A-Za-z0-9]+)"/g,
  /\.create\(\s*"([A-Za-z0-9]+)"/g,
  /new\s+PythonLambda\(\s*[^,\n]+,\s*"([A-Za-z0-9]+)"/g,
  /new\s+lambda\.Function\(\s*[^,\n]+,\s*"([A-Za-z0-9]+)"/g,
  /new\s+lambda\.DockerImageFunction\(\s*[^,\n]+,\s*"([A-Za-z0-9]+)"/g,
  /new\s+NodejsFunction\(\s*[^,\n]+,\s*"([A-Za-z0-9]+)"/g,
];
for (const pattern of constructIdPatterns) {
  for (const match of cdkText.matchAll(pattern)) {
    constructIds.add(match[1]);
  }
}
for (const constructId of constructIds) {
  if (/evolvesprouts/i.test(constructId) && !knownPrefixedIds.has(constructId)) {
    errors.push(
      `Lambda construct id "${constructId}" repeats the product prefix and would deploy as evolvesprouts-${constructId}`,
    );
  }
}
for (const knownId of knownPrefixedIds) {
  if (!constructIds.has(knownId)) {
    errors.push(`${knownId} is no longer declared; remove it from knownPrefixedIds`);
  }
}

if (errors.length > 0) {
  console.error('Lambda docs check failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Lambda docs check passed.');
