/**
 * version.ts - Resolve the CLI and Square SDK versions at runtime.
 *
 * Both are read from the package.json files next to the running module. The
 * module lives two levels below the package root in every layout we ship:
 * `src/version.ts` in dev/tests and `dist/square.js` in the published bundle,
 * so `import.meta.url` resolves to the same root either way.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Versions {
  cli: string;
  /** Undefined when the installed square package can't be located. */
  sdk?: string;
}

const FALLBACK_CLI_VERSION = "0.0.0-dev";

function readPackageVersion(dir: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" && parsed.version ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Find the installed `square` package version. Its package.json is not listed
 * in the package's "exports" map, so resolve the entry point and read the
 * package.json beside it.
 */
function resolveSdkVersion(packageRoot: string): string | undefined {
  try {
    const entry = createRequire(import.meta.url).resolve("square");
    const version = readPackageVersion(dirname(entry));
    if (version) return version;
  } catch {
    // Fall through to the conventional node_modules location.
  }
  return readPackageVersion(join(packageRoot, "node_modules", "square"));
}

export function getVersions(): Versions {
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  return {
    cli: readPackageVersion(packageRoot) ?? FALLBACK_CLI_VERSION,
    sdk: resolveSdkVersion(packageRoot),
  };
}

/** Human-readable one-liner for `square --version`. */
export function formatVersionLine(versions: Versions): string {
  return versions.sdk
    ? `square-sdk-cli ${versions.cli} (Square SDK ${versions.sdk})`
    : `square-sdk-cli ${versions.cli}`;
}
