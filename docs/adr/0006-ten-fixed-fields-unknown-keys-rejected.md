# Ten fixed fields, and unknown keys are an error

A task is ten fields. Adding an eleventh is a design decision, not an implementation detail.
Validation fails loudly on any key it does not recognise, on every surface that accepts a
write. The store, a patch and a task document alike.

Agents write to this store, and an agent given latitude invents a plausible field. `priority`,
`assignee`, `due`. A permissive schema would accept one, ignore it, and nobody would notice for
weeks. Rejecting the key has a real cost, because a genuinely useful field now has to be added
by hand. Worth paying.
