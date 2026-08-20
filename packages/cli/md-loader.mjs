import { readFile } from 'node:fs/promises';

/** Turns any `.md` import into a module whose default export is the file's text. */
export async function load(url, context, nextLoad) {
  if (url.endsWith('.md')) {
    const source = await readFile(new URL(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(source)};`,
    };
  }
  return nextLoad(url, context);
}
