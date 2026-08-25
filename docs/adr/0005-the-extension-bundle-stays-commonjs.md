# The extension bundle stays CommonJS

The extension package must not declare `"type": "module"`. The VSCode extension host expects a
CommonJS bundle, and in a package marked ESM a `.js` file loads as ESM whatever is in it.

So `node --test` over the extension's `.ts` sources prints a `MODULE_TYPELESS_PACKAGE_JSON`
warning on every run. Adding `"type": "module"` silences the warning and breaks the shipped
extension. Live with the noise.
