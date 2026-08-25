/**
 * Task document names: `<prefix>-<n>-<slug>.md`.
 *
 * Kept away from the `vscode` module, the same way interpret.ts is, so the naming and
 * parsing can be tested without an editor around them. task-document.ts wraps these in
 * `vscode.Uri`; nothing here knows a `Uri` exists.
 */

/** Tab names stay readable; the id at the front is what actually identifies the task. */
const SLUG_MAX_LENGTH = 50;

/**
 * The full document name for a task. The id is the identity; the slug is cosmetic and
 * may go stale the moment the title changes — that split is what makes renaming safe,
 * since only the id half is ever compared. A title that slugs to nothing (emoji only,
 * say) drops the trailing part entirely rather than leaving a dangling hyphen.
 */
export function documentName(id: string, title: string): string {
  const slug = slugify(title);
  return slug === '' ? `${id}.md` : `${id}-${slug}.md`;
}

/**
 * The id a document name identifies. Splits on the first `-<digits>` found, which is
 * unambiguous only because a project's prefix may not contain a digit-only segment (see
 * `checkPrefix` in core/config.ts) — otherwise a prefix like `foo-2` would make
 * `foo-2-7-slug.md` parse as id `foo-2` instead of `foo-2-7`.
 */
export function idFromDocumentName(name: string): string {
  const match = /^(.+?-\d+)(?:-.*)?\.md$/.exec(name);
  return match ? match[1]! : name;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
}
