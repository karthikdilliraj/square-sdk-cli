/**
 * cli.ts - Main CLI entry point. Wires together all modules.
 */

import { SquareClient, SquareError } from "square";
import { parseArgs } from "./args.ts";
import { buildRequest } from "./merge.ts";
import { load, save, setProfile, getProfile, listProfiles, useProfile } from "./config.ts";
import { resolveAuth } from "./auth.ts";
import { createClient as defaultCreateClient } from "./client.ts";
import { buildTree, resolvePath } from "./introspect.ts";
import { execute } from "./execute.ts";
import { print, renderError, bigIntReplacer } from "./output.ts";
import { renderRootHelp, renderNamespaceHelp, renderMethodHelp } from "./help.ts";

export interface RunDeps {
  createClient: (auth: { token: string; environment: "sandbox" | "production" }) => SquareClient;
}

const defaultDeps: RunDeps = {
  createClient: defaultCreateClient,
};

/**
 * Main run function. Returns exit code (0 = success, 1 = error).
 * @param argv - process.argv.slice(2)
 * @param deps - Injectable dependencies (for testing)
 * @param stdoutWrite - Override stdout writer (for testing)
 * @param stderrWrite - Override stderr writer (for testing)
 */
export async function run(
  argv: string[],
  deps: RunDeps = defaultDeps,
  stdoutWrite?: (msg: string) => void,
  stderrWrite?: (msg: string) => void
): Promise<number> {
  const stdout = stdoutWrite ?? ((msg: string) => process.stdout.write(msg + "\n"));
  const stderr = stderrWrite ?? ((msg: string) => process.stderr.write(msg + "\n"));

  const parsed = parseArgs(argv);
  const { positionals, flags, fields } = parsed;

  // ---- Config subcommands (no auth required) ----
  if (positionals[0] === "config") {
    return runConfigCommand(positionals.slice(1), flags, stdout, stderr);
  }

  // ---- Help (no auth required) ----
  // Any --help renders help from a tree built with a dummy-token client
  // (construction makes no network call).
  if (flags.help) {
    try {
      const dummyClient = deps.createClient({ token: "dummy", environment: "sandbox" });
      const tree = buildTree(dummyClient);

      if (positionals.length === 0) {
        stdout(renderRootHelp(tree));
        return 0;
      }
      if (positionals.length === 1) {
        const nsNode = tree.children.get(positionals[0]!);
        if (nsNode) {
          stdout(renderNamespaceHelp(nsNode));
          return 0;
        }
      } else {
        const resolveResult = resolvePath(tree, positionals);
        if (!("error" in resolveResult)) {
          stdout(
            renderMethodHelp(
              positionals.slice(0, -1).join(" "),
              resolveResult.method.name,
              resolveResult.method.arity
            )
          );
          return 0;
        }
      }
      stdout(renderRootHelp(tree));
      return 0;
    } catch {
      stdout("Square SDK CLI\n\nUse `square --help` for available namespaces.");
      return 0;
    }
  }

  // ---- API path ----

  // Resolve auth
  let auth: { token: string; environment: "sandbox" | "production" };
  try {
    const config = await load();
    const env = process.env as Record<string, string | undefined>;
    auth = resolveAuth(
      { profile: flags.profile, token: flags.token, env: flags.env },
      env,
      config
    );
  } catch (e: unknown) {
    const exitCode = renderError(e, { writeFn: stderr });
    return exitCode;
  }

  // Create client
  const client = deps.createClient(auth);

  // Build tree
  const tree = buildTree(client);

  // Namespace-level help (no method given)
  if (positionals.length === 1) {
    const nsNode = tree.children.get(positionals[0]!);
    if (nsNode) {
      stdout(renderNamespaceHelp(nsNode));
      return 0;
    }
  }

  // Need at least 2 positionals for namespace + method
  if (positionals.length < 2) {
    stdout(renderRootHelp(tree));
    return 0;
  }

  // Resolve path
  const resolveResult = resolvePath(tree, positionals);
  if ("error" in resolveResult) {
    stderr(`Error: ${resolveResult.error}`);
    stderr(`Valid options: ${resolveResult.validTokens.join(", ")}`);
    return 1;
  }

  // Build request
  let request: object;
  try {
    request = buildRequest(flags.json, fields);
  } catch (e: unknown) {
    renderError(e, { writeFn: stderr });
    return 1;
  }

  // Execute
  try {
    const streamMode = flags.stream === true;
    const result = execute(resolveResult.method, request, { stream: streamMode });

    if (streamMode) {
      // Stream mode: async iterable
      for await (const item of result as AsyncIterable<unknown>) {
        stdout(JSON.stringify(item, bigIntReplacer, 2));
      }
    } else {
      const value = await (result as Promise<unknown>);
      print(value, { writeFn: stdout });
    }

    return 0;
  } catch (e: unknown) {
    return renderError(e, { writeFn: stderr });
  }
}

// ---- Config command router ----

async function runConfigCommand(
  args: string[],
  flags: ReturnType<typeof parseArgs>["flags"] & { token?: string; env?: string },
  stdout: (msg: string) => void,
  stderr: (msg: string) => void
): Promise<number> {
  const subcommand = args[0];

  switch (subcommand) {
    case "set": {
      const profileName = args[1];
      if (!profileName) {
        stderr("Usage: square config set <profile> --token <token> [--env <environment>]");
        return 1;
      }
      if (!flags.token) {
        stderr("Error: --token is required for config set");
        return 1;
      }
      const environment = flags.env === "production" ? "production" : "sandbox";
      await setProfile(profileName, { token: flags.token, environment });
      stdout(`Profile "${profileName}" saved.`);
      return 0;
    }

    case "get": {
      const profileName = args[1];
      if (!profileName) {
        stderr("Usage: square config get <profile>");
        return 1;
      }
      const profile = await getProfile(profileName);
      if (!profile) {
        stderr(`Profile "${profileName}" not found.`);
        return 1;
      }
      // Mask token: show last 4 chars
      const maskedToken = maskToken(profile.token);
      stdout(JSON.stringify({ ...profile, token: maskedToken }, null, 2));
      return 0;
    }

    case "list": {
      const names = await listProfiles();
      if (names.length === 0) {
        stdout("No profiles configured.");
      } else {
        stdout("Profiles:");
        for (const name of names) {
          stdout(`  ${name}`);
        }
      }
      return 0;
    }

    case "use": {
      const profileName = args[1];
      if (!profileName) {
        stderr("Usage: square config use <profile>");
        return 1;
      }
      try {
        await useProfile(profileName);
        stdout(`Default profile set to "${profileName}".`);
        return 0;
      } catch (e: unknown) {
        return renderError(e, { writeFn: stderr });
      }
    }

    default: {
      stderr(`Unknown config subcommand: "${subcommand}". Use set, get, list, or use.`);
      return 1;
    }
  }
}

function maskToken(token: string): string {
  if (token.length <= 4) return "****";
  return "*".repeat(token.length - 4) + token.slice(-4);
}
