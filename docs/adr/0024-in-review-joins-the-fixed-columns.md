# A fifth fixed column, `in-review`

This amends [ADR 0023](0023-the-four-columns-are-fixed.md). The set of columns stays fixed —
0023's actual load-bearing claim, that this tool manages one person's local board on one
machine and the columns do not get renamed out from under whatever depends on them, is
unaffected by adding a name to it. What changes is which names are in the set: `backlog`,
`priority`, `in-progress`, `in-review`, `done`, fixed as a union in `task.ts`. `done` stays
terminal — the only one code branches on. See
[docs/plans/0004-in-review-column.md](../plans/0004-in-review-column.md) for the argument in
full; this is the decision record.

0023 argued the fifth column away on evidence that was true at the time:

> What the flexibility bought was a `review` column for a project that wants one. Nothing on
> this machine, across every project it has tracked, ever used it.

That evidence no longer holds. There is now a real gap: an agent's last move is `tasks move <id>
done`, which means the board has one signal for "code exists" and no signal for "someone other
than the agent has looked at it." `in-review` means the implementation is finished and is
waiting on a review — by a human or another agent — and gives that state a column instead of a
note nothing reads.

Adding a name is not the same move as reopening the set. This is not a reversal of 0023 back
toward per-project configurability; the column is still baked into the schema, chosen once, for
everyone who uses this tool. It amends the list, not the mechanism.

## Consequences

- `TaskStatus` is a union of five now, off the `STATUSES` tuple in `task.ts`, with `in-review`
  ordered between `in-progress` and `done`.
- `.tasks/config.json` may still carry a legacy `statuses` key from before ADR 0019 was reversed.
  It is accepted and ignored when it names any subset of the five fixed columns — this repo's own
  config, still holding the original four, is exactly that case — and is a hard error naming the
  value when it names anything else.
- A prerequisite sitting in `in-review` still reads as blocked, same as any column that is not
  `done`. Review is not finished.
- The board renders a fifth column and the sidebar tree gets a fourth expandable group; neither
  needed a per-name table to do it, per 0023's original design.
- Moving a task into or out of `in-review` is a hand action, per the skill. Nothing automates it,
  and `/code-review` is not wired to the board — both are explicitly out of scope for this
  change.
