import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import PLANS_MARKDOWN from '../../../.claude/skills/plans/SKILL.md';
import TASKS_MARKDOWN from '../../../.claude/skills/tasks/SKILL.md';

/**
 * Installing the agent skills.
 *
 * They are compiled into this binary rather than read from disk, so `tasks init` can
 * install them with no reference to the repository the CLI was built from.
 *
 * They install once, globally, because the CLI they document is also installed once
 * globally. A per-project copy would go stale in every project the moment the CLI
 * changed.
 *
 * There are two. `tasks` teaches the board, `plans` teaches the documents the board's
 * work is cut from — the half of the workflow that would otherwise have to be copied
 * into each project by hand.
 */

/** Name is the directory under the skills home, and the name in the file's frontmatter. */
interface AgentSkill {
  name: string;
  markdown: string;
}

const SKILLS: readonly AgentSkill[] = [
  { name: 'tasks', markdown: TASKS_MARKDOWN },
  { name: 'plans', markdown: PLANS_MARKDOWN },
];

export type SkillOutcome =
  | { kind: 'installed'; name: string; path: string }
  | { kind: 'current'; name: string; path: string }
  | { kind: 'updated'; name: string; path: string; backup: string };

/** Where skills live. `CLAUDE_SKILLS_DIR` overrides it, which is how the tests stay safe. */
export function skillsHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['CLAUDE_SKILLS_DIR'];
  return configured !== undefined && configured.trim() !== ''
    ? configured.trim()
    : join(homedir(), '.claude', 'skills');
}

export function skillPath(name: string, env?: NodeJS.ProcessEnv): string {
  return join(skillsHome(env), name, 'SKILL.md');
}

/** Installs every skill, in the order they are declared above. */
export async function installSkills(env?: NodeJS.ProcessEnv): Promise<SkillOutcome[]> {
  const outcomes: SkillOutcome[] = [];
  for (const skill of SKILLS) outcomes.push(await installOne(skill, env));
  return outcomes;
}

/**
 * Writes one skill, preserving anything the user changed by hand.
 *
 * A divergent file is backed up rather than overwritten. Someone who edited their copy
 * deliberately should not lose it to a routine `tasks init` in an unrelated project.
 */
async function installOne({ name, markdown }: AgentSkill, env?: NodeJS.ProcessEnv) {
  const path = skillPath(name, env);

  let existing: string | undefined;
  try {
    existing = await readFile(path, 'utf8');
  } catch {
    existing = undefined;
  }

  if (existing === markdown) return { kind: 'current', name, path } as const;

  await mkdir(join(path, '..'), { recursive: true });

  if (existing === undefined) {
    await writeFile(path, markdown, 'utf8');
    return { kind: 'installed', name, path } as const;
  }

  const backup = `${path}.bak`;
  await copyFile(path, backup);
  await writeFile(path, markdown, 'utf8');
  return { kind: 'updated', name, path, backup } as const;
}
