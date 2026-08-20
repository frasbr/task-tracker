/**
 * Markdown imported as text.
 *
 * esbuild inlines these at build time (`--loader:.md=text`), which is what lets the
 * `tasks` binary carry the agent skill inside it instead of reading it from a checkout.
 */
declare module '*.md' {
  const contents: string;
  export default contents;
}
