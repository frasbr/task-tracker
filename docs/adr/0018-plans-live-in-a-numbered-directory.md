# Plans live in a numbered directory, and hold no state

A single `PLAN.md` does not survive contact with the work. This repo's own ran to 33KB, and
by the time the first release worked, five of its seven sections had migrated: the locked
decisions to `docs/adr/`, the data model and components to AGENTS.md, the build order to the
board itself, the deferred items to a wishlist. What was left was a husk nothing referenced.

The content that rotted was the content that had a better home. What has no other home is the
argument behind a piece of work: the problem, the spec, what was ruled out, and why the steps
go in that order. That is per feature, not per project, so it gets a file per feature.

`docs/plans/NNNN-slug.md`, flat and numbered like the ADRs. `tasks init` creates the directory
and a `TEMPLATE.md`, so the convention travels to other projects with the CLI rather than by
being copied by hand. `--skip-plans` opts out.

A plan holds no task list and no progress. The board holds those. The two are joined by `refs`:
every task cut from a plan carries the plan's path, which needed no schema change because a ref
is already any path.

A second agent skill, `plans`, ships and installs the same way as `tasks`. The convention is
worth nothing if an agent has to be told it exists in each new project, and `tasks init` is
already the thing that travels.

## Consequences

- The CLI now has an opinion about a directory outside `.tasks/`. It is the second thing `init`
  writes into the project, after `.gitignore`.
- `docs/plans/` is not configurable. A convention is portable only while it is fixed, and a
  project that wants a different layout can pass `--skip-plans`.
- The directory existing is what marks the convention as adopted. A project that deletes the
  template is not handed it back on the next init.
- Flat numbering means no hierarchy. A plan that grows big enough to want children is the signal
  to write a second plan, not to nest.
- Two skills now ship in the binary rather than one. `skill.ts` holds the list; nothing discovers
  them from disk, so a third has to be added there deliberately.
