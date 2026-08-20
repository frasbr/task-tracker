import * as esbuild from 'esbuild';

/**
 * Two bundles, two targets:
 *
 *   extension.js — runs in the VSCode extension host. CommonJS, because the host's
 *                  module loader expects it. `vscode` is external; the host injects it.
 *   webview.js   — runs in the webview's browser context. ESM, no Node APIs available.
 *
 * These never share code with @task-tracker/core. The extension reaches the store
 * only by spawning the CLI — see AGENTS.md, "Boundaries that must not be crossed".
 */
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  {
    entryPoints: ['src/extension.ts'],
    outfile: 'out/extension.js',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['vscode'],
    sourcemap: true,
    logLevel: 'info',
  },
  {
    entryPoints: ['src/webview/main.ts'],
    outfile: 'out/webview.js',
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'esm',
    sourcemap: true,
    logLevel: 'info',
  },
];

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
