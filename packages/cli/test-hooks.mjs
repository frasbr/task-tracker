import { register } from 'node:module';

/**
 * Lets `node --test` load the `.md` import in src/skill.ts.
 *
 * esbuild inlines markdown as text when it bundles, but the tests run the TypeScript
 * sources directly and Node has no loader for `.md`. This teaches it one, so the skill
 * has exactly one canonical copy — the markdown file — rather than a generated
 * TypeScript mirror that could drift from it.
 */
register('./md-loader.mjs', import.meta.url);
