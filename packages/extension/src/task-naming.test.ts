import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { documentName, idFromDocumentName } from './task-naming.ts';

describe('documentName', () => {
  it('slugifies the title after the id', () => {
    assert.equal(
      documentName('tt-7', 'Watch the store and push changes'),
      'tt-7-watch-the-store-and-push-changes.md',
    );
  });

  it('collapses punctuation and whitespace into single hyphens', () => {
    assert.equal(
      documentName('tt-7', "Fix auth's redirect  loop!!"),
      'tt-7-fix-auth-s-redirect-loop.md',
    );
  });

  it('drops the slug entirely when the title has nothing sluggable', () => {
    assert.equal(documentName('tt-7', '🎉🎉🎉'), 'tt-7.md');
  });

  it('drops the slug for an empty title', () => {
    assert.equal(documentName('tt-7', ''), 'tt-7.md');
  });

  it('caps the slug so tab names stay readable', () => {
    const title = 'a '.repeat(60).trim();
    const name = documentName('tt-7', title);
    assert.ok(name.length < 'tt-7-'.length + 60 + '.md'.length);
    assert.doesNotMatch(name, /-\.md$/, 'must not leave a dangling hyphen before .md');
  });

  it('works with a hyphenated prefix', () => {
    assert.equal(documentName('task-tracker-12', 'Ship it'), 'task-tracker-12-ship-it.md');
  });
});

describe('idFromDocumentName', () => {
  it('recovers the id from a fully slugged name', () => {
    assert.equal(idFromDocumentName('tt-7-watch-the-store-and-push-changes.md'), 'tt-7');
  });

  it('recovers the id from a bare name with no slug', () => {
    assert.equal(idFromDocumentName('tt-7.md'), 'tt-7');
  });

  it('finds the id before a numeric-looking slug', () => {
    assert.equal(idFromDocumentName('tt-12-2026-roadmap.md'), 'tt-12');
  });

  it('handles a hyphenated prefix', () => {
    assert.equal(idFromDocumentName('task-tracker-12-ship-it.md'), 'task-tracker-12');
  });

  it('round-trips through documentName for any title', () => {
    for (const title of ['Fix auth redirect loop', '', '🎉🎉🎉', 'a'.repeat(200)]) {
      const name = documentName('tt-42', title);
      assert.equal(idFromDocumentName(name), 'tt-42');
    }
  });
});
