import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import PLAN_TEMPLATE from '../../../docs/plans/TEMPLATE.md';

/**
 * Scaffolding the plan directory.
 *
 * A board says what is being worked on and where it has got to. It does not say why the
 * work is shaped the way it is, and a single PLAN.md holding both rots: the durable half
 * migrates to AGENTS.md and the ADRs, the live half is already on the board, and what is
 * left is a husk. `docs/plans/` is where the reasoning goes instead, one numbered file per
 * piece of work, with tasks pointing back at their plan through `refs`.
 *
 * The template is compiled into this binary for the same reason the agent skill is: init
 * must work with no reference to the repository the CLI was built from.
 */

/** Project-relative. Not configurable — a convention is only portable while it is fixed. */
export const PLANS_DIR = join('docs', 'plans');

export const PLAN_TEMPLATE_NAME = 'TEMPLATE.md';

export type PlansOutcome = { kind: 'created'; path: string } | { kind: 'present'; path: string };

/**
 * Creates `docs/plans/` and the template inside it, once.
 *
 * The directory existing is what marks the convention as adopted, so a project that
 * deleted the template on purpose is not handed it back by the next `tasks init`.
 */
export async function installPlanTemplate(directory: string): Promise<PlansOutcome> {
  const dir = join(directory, PLANS_DIR);
  const path = join(dir, PLAN_TEMPLATE_NAME);

  if (await exists(dir)) return { kind: 'present', path };

  await mkdir(dir, { recursive: true });
  await writeFile(path, PLAN_TEMPLATE, 'utf8');
  return { kind: 'created', path };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
