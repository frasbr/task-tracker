# Zero runtime dependencies

The project ships with no runtime dependencies, and the count staying at zero is a feature.
Before adding one, check whether Node's standard library covers it. If you add one, say why in
the commit.

A tool installed globally and spawned on every board refresh pays a startup cost and carries a
supply-chain risk in proportion to what it pulls in. The argument parser and the document
format are both hand-rolled for that reason, and both are small enough that a library would
have cost more than it saved.
