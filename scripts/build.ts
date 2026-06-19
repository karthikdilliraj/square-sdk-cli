/**
 * build.ts - Bundle the CLI to a node-runnable JS file for npm distribution.
 * `square` stays an external dependency (installed alongside), only our src is
 * bundled. A `#!/usr/bin/env node` shebang is prepended so `npm i -g` works.
 */

const out = "dist/square.js";

const result = await Bun.build({
  entrypoints: ["bin/square.ts"],
  target: "node",
  external: ["square"],
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// strip any shebang the bundler carried over from the source entry, then
// prepend a single node shebang.
const code = (await result.outputs[0]!.text()).replace(/^#!.*\n/, "");
await Bun.write(out, `#!/usr/bin/env node\n${code}`);

// make executable
const { chmodSync } = await import("node:fs");
chmodSync(out, 0o755);

console.log(`Built ${out}`);
