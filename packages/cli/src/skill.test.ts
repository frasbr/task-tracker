import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { installSkill, skillPath, skillsHome } from './skill.ts';

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

describe('installSkill', () => {
  it('writes the skill on a first run', async () => {
    const outcome = await installSkill(env);
    assert.equal(outcome.kind, 'installed');

    const written = await readFile(skillPath(env), 'utf8');
    assert.match(written, /^---\nname: tasks\n/, 'must carry the skill frontmatter');
    assert.match(written, /tasks add/, 'must document the verbs');
  });

  it('is embedded in the binary, not read from a checkout', async () => {
    // Nothing in the source tree is consulted: the only path touched is the target.
    await installSkill(env);
    const written = await readFile(skillPath(env), 'utf8');
    assert.ok(written.length > 1000, 'the skill should be substantial, not a stub');
  });

  it('reports no change on a second run', async () => {
    await installSkill(env);
    assert.equal((await installSkill(env)).kind, 'current');
  });

  it('backs up a hand-edited copy before replacing it', async () => {
    await installSkill(env);
    const path = skillPath(env);
    await writeFile(path, 'my own version', 'utf8');

    const outcome = await installSkill(env);
    assert.equal(outcome.kind, 'updated');
    assert.ok(outcome.kind === 'updated' && outcome.backup.endsWith('.bak'));
    assert.equal(await readFile(`${path}.bak`, 'utf8'), 'my own version');
    assert.notEqual(await readFile(path, 'utf8'), 'my own version');
  });

  it('creates the directory tree when nothing exists yet', async () => {
    const nested = join(home, 'deep', 'deeper');
    assert.equal((await installSkill({ CLAUDE_SKILLS_DIR: nested })).kind, 'installed');
  });

  it('leaves an unrelated skill alone', async () => {
    await mkdir(join(home, 'other'), { recursive: true });
    await writeFile(join(home, 'other', 'SKILL.md'), 'not ours', 'utf8');
    await installSkill(env);
    assert.equal(await readFile(join(home, 'other', 'SKILL.md'), 'utf8'), 'not ours');
  });
});
