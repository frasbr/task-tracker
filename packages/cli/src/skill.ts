import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import SKILL_MARKDOWN from '../../../.claude/skills/tasks/SKILL.md';

/**
 * Installing the agent skill.
 *
 * The skill is compiled into this binary rather than read from disk, so `tasks init`
 * can install it with no reference to the repository the CLI was built from. That is
 * what collapsed the old separate `tasks-init` script into this command.
 *
 * It installs once, globally, because the CLI it documents is also installed once
 * globally. A per-project copy would go stale in every project the moment the CLI
 * changed.
 */

export type SkillOutcome =
  | { kind: 'installed'; path: string }
  | { kind: 'current'; path: string }
  | { kind: 'updated'; path: string; backup: string }
  | { kind: 'skipped' };

/** Where skills live. `CLAUDE_SKILLS_DIR` overrides it, which is how the tests stay safe. */
export function skillsHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['CLAUDE_SKILLS_DIR'];
  return configured !== undefined && configured.trim() !== ''
    ? configured.trim()
    : join(homedir(), '.claude', 'skills');
}

export function skillPath(env?: NodeJS.ProcessEnv): string {
  return join(skillsHome(env), 'tasks', 'SKILL.md');
}

/**
 * Writes the skill, preserving anything the user changed by hand.
 *
 * A divergent file is backed up rather than overwritten. Someone who edited their copy
 * deliberately should not lose it to a routine `tasks init` in an unrelated project.
 */
export async function installSkill(env?: NodeJS.ProcessEnv): Promise<SkillOutcome> {
  const path = skillPath(env);

  let existing: string | undefined;
  try {
    existing = await readFile(path, 'utf8');
  } catch {
    existing = undefined;
  }

  if (existing === SKILL_MARKDOWN) return { kind: 'current', path };

  await mkdir(join(path, '..'), { recursive: true });

  if (existing === undefined) {
    await writeFile(path, SKILL_MARKDOWN, 'utf8');
    return { kind: 'installed', path };
  }

  const backup = `${path}.bak`;
  await copyFile(path, backup);
  await writeFile(path, SKILL_MARKDOWN, 'utf8');
  return { kind: 'updated', path, backup };
}
