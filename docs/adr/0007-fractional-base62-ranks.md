# Manual ordering uses fractional base-62 rank strings

A task's position within its column is a string over a base-62 alphabet ordered so that ASCII
comparison is the sort order. Inserting between two neighbours means finding a string strictly
between their ranks, which is always possible. Moving one card never rewrites any other task's
rank.

Integer positions would make every drag a write across the whole column. In a single-file store
that means rewriting every line and fighting the watcher, for a gesture that moved one card.

## Consequences

Repeated insertion into the same gap grows keys a character at a time. Each write checks the
column and renumbers it once the keys pass the length limit, rather than waiting for them to
get absurd. Ranks are canonical too, never ending in the lowest digit, so two strings cannot
describe the same position.
