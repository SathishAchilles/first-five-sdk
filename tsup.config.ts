import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };
const define = { __SDK_VERSION__: JSON.stringify(version) };

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    target: 'es2019',
    define,
    outExtension: () => ({ js: '.mjs' }),
  },
  {
    entry: { firstfive: 'src/iife.ts' },
    format: ['iife'],
    minify: true,
    target: 'es2019',
    define,
    outExtension: () => ({ js: '.iife.min.js' }),
  },
]);
