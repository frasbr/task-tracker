# Prettier only, no ESLint

Formatting is enforced. Linting is not. `strict` TypeScript with the extra compiler flags
catches most of what an ESLint config would, and an ESLint config is ongoing maintenance nobody
working here will do.

Reconsider if real bugs start slipping through that a lint rule would have caught. Until then,
adding a linter is adding a thing to maintain.
