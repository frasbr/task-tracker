# npm workspaces, not pnpm

The monorepo uses npm workspaces. It ships with Node, needs no extra install for anyone cloning
the repo, and produces a flat `node_modules` rather than the symlink layout that trips up
`vsce package`.

pnpm would be marginally better on disk and speed. Not worth the friction, and written down
here so the suggestion does not have to be re-argued.
