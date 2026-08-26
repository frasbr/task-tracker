/**
 * Argument parsing.
 *
 * Deliberately tiny and dependency-free. The surface is small enough that a library
 * would cost more than it saves, and hand-rolling keeps the error messages ours —
 * which matters, because half the readers of those messages are agents.
 *
 * Supported shapes: `--flag=value`, `--flag value`, and bare `--flag` for the known
 * booleans. Everything after `--` is a positional, which is how a note that begins
 * with a dash gets through.
 */

export class UsageError extends Error {
  override readonly name = 'UsageError';
}

const BOOLEAN_FLAGS = new Set([
  'json',
  'help',
  'version',
  'skip-skill',
  'skip-plans',
  'markdown',
  'force',
]);

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: ReadonlyMap<string, string | true>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  let passthrough = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;

    if (passthrough) {
      positionals.push(token);
      continue;
    }

    if (token === '--') {
      passthrough = true;
      continue;
    }

    if (token === '-h') {
      flags.set('help', true);
      continue;
    }

    if (token === '-C') {
      const dir = argv[i + 1];
      if (dir === undefined) throw new UsageError('-C needs a directory.');
      flags.set('C', dir);
      i += 1;
      continue;
    }

    if (token === '-p') {
      const prefix = argv[i + 1];
      if (prefix === undefined) throw new UsageError('-p needs a value, as -p <prefix>.');
      flags.set('prefix', prefix);
      i += 1;
      continue;
    }

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    if (body === '') {
      throw new UsageError(
        `'--' on its own separates flags from arguments; '${token}' is not a flag.`,
      );
    }

    const equals = body.indexOf('=');
    if (equals >= 0) {
      flags.set(body.slice(0, equals), body.slice(equals + 1));
      continue;
    }

    if (BOOLEAN_FLAGS.has(body)) {
      flags.set(body, true);
      continue;
    }

    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new UsageError(`--${body} needs a value, as --${body}=<value>.`);
    }
    flags.set(body, next);
    i += 1;
  }

  return { command: positionals.shift(), positionals, flags };
}

/** A flag's value, or undefined if it was not given. Errors if it was given as a bare switch. */
export function flagValue(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  if (value === undefined) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value, as --${name}=<value>.`);
  return value;
}

/** A comma-separated flag as a list. `--tags=` yields an empty list, which clears the field. */
export function flagList(args: ParsedArgs, name: string): string[] | undefined {
  const value = flagValue(args, name);
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

export function flagSet(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

/** Rejects flags a command does not understand, rather than ignoring a typo. */
export function rejectUnknownFlags(
  args: ParsedArgs,
  allowed: readonly string[],
  command: string,
): void {
  const known = new Set([...allowed, 'json', 'help', 'C']);
  const unknown = [...args.flags.keys()].filter((flag) => !known.has(flag));
  if (unknown.length > 0) {
    throw new UsageError(
      `${command}: unknown flag${unknown.length > 1 ? 's' : ''} ${unknown
        .map((flag) => `--${flag}`)
        .join(', ')}. Run \`tasks ${command} --help\` to see what it accepts.`,
    );
  }
}
