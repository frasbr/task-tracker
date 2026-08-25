# Task document headers are not YAML

A task document's header is a `key: value` line where the value is the rest of the line
verbatim, plus lists written inline as `[a, b]` or one `  - item` per line.

It is small enough to hand-edit without surprises, a title containing a colon needs no quoting,
and it adds no dependency to a project that has none. A real YAML parser would accept far more
than this format is willing to mean, and every extra thing it accepts is another shape someone
has to be told is unsupported.
