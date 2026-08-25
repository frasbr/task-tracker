# The webview is vanilla TypeScript

The board is built with `document.createElement` and `textContent`, with no UI framework. It is
a handful of columns and a detail panel, and a framework's styling layer fights VSCode's theme
inheritance more than it helps.

If the webview's state handling gets genuinely hairy, Preact is the escape hatch. Say so before
reaching for it, rather than leaving it to be found in a diff.

## Consequences

Task titles and notes are arbitrary text written by whoever used the CLI, and a webview shares
an origin with the rest of the extension. Building nodes instead of concatenating HTML is what
keeps that from being an injection route, so it is a rule and not a style preference.
