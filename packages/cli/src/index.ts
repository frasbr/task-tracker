import { run } from './run.ts';

/**
 * `tasks` — the only writer of the task store.
 *
 * Everything real lives in `run.ts`, which takes its output sinks as arguments so the
 * verbs can be tested without spawning a process. This file connects that to a terminal.
 */

process.exitCode = await run(
  process.argv.slice(2),
  {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    input: readStdin,
  },
  process.cwd(),
);

/** Only `update --markdown` asks for this, so nothing reads the stream until it does. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
