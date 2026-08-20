import { chmod } from 'node:fs/promises';
import * as esbuild from 'esbuild';

/**
 * Bundles the CLI to a single ESM file with a shebang.
 *
 * Bundling is deliberate: `tasks` is invoked constantly — by you in a terminal and
 * by the extension on every board render — so startup cost matters, and a single
 * file has no module resolution to do at runtime.
 */
const watch = process.argv.includes('--watch');

/**
 * The bundle carries a shebang, so it must also carry the executable bit — otherwise a
 * symlink onto PATH fails with "permission denied". esbuild preserves the mode when it
 * overwrites an existing file, which hides this on every build except a clean one, so
 * setting it here rather than in a setup script is what makes it reliable.
 */
const executable = {
  name: 'executable',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) await chmod(options.outfile, 0o755);
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/index.ts'],
  outfile: 'dist/tasks.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // The agent skill ships inside the binary — see src/skill.ts.
  loader: { '.md': 'text' },
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
  plugins: [executable],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
