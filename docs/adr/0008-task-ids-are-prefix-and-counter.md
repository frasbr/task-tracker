# Task IDs are `<prefix>-<n>` from a monotonic counter

An id is the project's prefix and a number, like `task-tracker-7`. The stored value is the
whole qualified string, not a bare number rendered with a prefix at display time. An id is the
handle people quote in commits and conversation, so it should say which project it belongs to.
Parsing splits on the last hyphen, which is why no hyphen-separated part of a prefix may be
digits only.

The number comes from a counter in the project's config, never from the tasks currently in the
store. Derive it from the store instead and deleting the highest task hands its number to the
next one, so every reference to the old task quietly points somewhere else.

## Consequences

This replaced random `t`-prefixed ids. Those are still recognised, so `tasks migrate-ids` can
convert an older store and rewrite references to them in task text. Changing a project's prefix
means running that migration.

Readable ids cost a safety property the opaque ones had for free. Those were built from an
alphabet without `i`, `l`, `o` or `u`, so a mistyped id failed loudly. `7` and `17` are both
real, so a slip on a destructive verb now lands somewhere. That is why `remove` confirms what it
is about to delete unless given `--force`.
