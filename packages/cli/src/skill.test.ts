import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { installSkills, skillPath, skillsHome } from './skill.ts';

let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'task-tracker-skills-'));
  env = { CLAUDE_SKILLS_DIR: home };
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('skillsHome', () => {
  it('honours CLAUDE_SKILLS_DIR', () => {
    assert.equal(skillsHome({ CLAUDE_SKILLS_DIR: '/somewhere' }), '/somewhere');
  });

  it('falls back to ~/.claude/skills', () => {
    const path = skillsHome({});
    assert.match(path, /\.claude[/\\]skills$/);
  });

  it('ignores an empty override rather than writing to the filesystem root', () => {
    assert.match(skillsHome({ CLAUDE_SKILLS_DIR: '   ' }), /\.claude[/\\]skills$/);
  });
});

describe('installSkills', () => {
  it('writes both skills on a first run', async () => {
    const outcomes = await installSkills(env);
    assert.deepEqual(
      outcomes.map((outcome) => [outcome.name, outcome.kind]),
      [
        ['tasks', 'installed'],
        ['plans', 'installed'],
      ],
    );

    const tasks = await readFile(skillPath('tasks', env), 'utf8');
    assert.match(tasks, /^---\nname: tasks\n/, 'must carry the skill frontmatter');
    assert.match(tasks, /tasks add/, 'must document the verbs');

    const plans = await readFile(skillPath('plans', env), 'utf8');
    assert.match(plans, /^---\nname: plans\n/, 'must carry the skill frontmatter');
    assert.match(plans, /docs\/plans/, 'must say where plans live');
  });

  it('is embedded in the binary, not read from a checkout', async () => {
    // Nothing in the source tree is consulted: the only paths touched are the targets.
    await installSkills(env);
    for (const name of ['tasks', 'plans']) {
      const written = await readFile(skillPath(name, env), 'utf8');
      assert.ok(written.length > 1000, `${name} should be substantial, not a stub`);
    }
  });

  it('reports no change on a second run', async () => {
    await installSkills(env);
    const outcomes = await installSkills(env);
    assert.deepEqual(
      outcomes.map((outcome) => outcome.kind),
      ['current', 'current'],
    );
  });

  it('backs up a hand-edited copy before replacing it', async () => {
    await installSkills(env);
    const path = skillPath('plans', env);
    await writeFile(path, 'my own version', 'utf8');

    const outcome = (await installSkills(env)).find((each) => each.name === 'plans');
    assert.equal(outcome?.kind, 'updated');
    assert.ok(outcome?.kind === 'updated' && outcome.backup.endsWith('.bak'));
    assert.equal(await readFile(`${path}.bak`, 'utf8'), 'my own version');
    assert.notEqual(await readFile(path, 'utf8'), 'my own version');
  });

  it('leaves the other skill alone when one was hand-edited', async () => {
    await installSkills(env);
    await writeFile(skillPath('plans', env), 'my own version', 'utf8');

    const outcomes = await installSkills(env);
    assert.equal(outcomes.find((each) => each.name === 'tasks')?.kind, 'current');
  });

  it('creates the directory tree when nothing exists yet', async () => {
    const nested = join(home, 'deep', 'deeper');
    const outcomes = await installSkills({ CLAUDE_SKILLS_DIR: nested });
    assert.ok(outcomes.every((outcome) => outcome.kind === 'installed'));
  });

  it('leaves an unrelated skill alone', async () => {
    await mkdir(join(home, 'other'), { recursive: true });
    await writeFile(join(home, 'other', 'SKILL.md'), 'not ours', 'utf8');
    await installSkills(env);
    assert.equal(await readFile(join(home, 'other', 'SKILL.md'), 'utf8'), 'not ours');
  });
});
