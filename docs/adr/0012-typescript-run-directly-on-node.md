# TypeScript, run directly on Node 22.18+

The project is TypeScript with `strict`, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`, on Node 22.18 or later so native type stripping runs the `.ts`
sources as they are. Tests need no transform step. esbuild produces the two shipped bundles and
nothing else.

The language was close to forced, since the VSCode extension host runs JS. The extra strictness
is cheap insurance in a repo where agents write most of the code. Dropping the transform gets
rid of the tooling most likely to rot in a project nobody is paid to maintain.

## Consequences

Imports carry explicit `.ts` extensions and type-only imports must say `import type`, because
`allowImportingTsExtensions` and `verbatimModuleSyntax` are both on. Older Node versions cannot
run the tests.
