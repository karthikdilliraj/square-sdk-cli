/**
 * cli.ts - Main CLI entry point. Wires together all modules.
 */

import type { SquareClient } from "square";
import { parseArgs } from "./args.ts";
import { buildRequest, readJsonArg, ensureIdempotencyKey } from "./merge.ts";
import { load, setProfile, getProfile, useProfile, removeProfile } from "./config.ts";
import { resolveAuth, parseEnvironment, type ResolvedAuth } from "./auth.ts";
import { createClient as defaultCreateClient } from "./client.ts";
import { buildTree, findNamespace, resolvePath, isReadOnlyMethod } from "./introspect.ts";
import { execute } from "./execute.ts";
import { print, renderError, bigIntReplacer } from "./output.ts";
import { renderRootHelp, renderNamespaceHelp, renderMethodHelp } from "./help.ts";
import { terminalPrompter, type Prompter } from "./prompt.ts";

export interface RunDeps {
  createClient: (auth: Pick<ResolvedAuth, "token" | "environment">) => SquareClient;
  /** Terminal input (confirmations, hidden token entry, stdin). Defaults to the real terminal. */
  prompter?: Prompter;
}

const defaultDeps: RunDeps = {
  createClient: defaultCreateClient,
  prompter: terminalPrompter,
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

  const prompter = deps.prompter ?? terminalPrompter;

  const parsed = parseArgs(argv);
  const { positionals, flags, fields } = parsed;

  // ---- Config subcommands (no auth required) ----
  if (positionals[0] === "config") {
    return runConfigCommand(positionals.slice(1), flags, prompter, stdout, stderr);
  }

  // ---- whoami (built-in, needs auth) ----
  if (positionals[0] === "whoami") {
    if (flags.help) {
      stdout("Usage: square whoami [--profile <name>] [--json-output]\n\nShow the merchant, environment, and token source in use.");
      return 0;
    }
    return runWhoami(deps, flags, stdout, stderr);
  }

  // ---- Help and command validation (no auth required) ----
  // The SDK tree is built from a dummy-token client (construction makes no
  // network call), so help and unknown-command errors never need credentials.
  const shapeTree = buildTree(deps.createClient({ token: "dummy", environment: "sandbox" }));

  if (positionals.length === 0) {
    stdout(renderRootHelp(shapeTree));
    return 0;
  }

  // Every positional is a namespace (e.g. `payments`, `terminal actions`): show its help
  const nsNode = findNamespace(shapeTree, positionals);
  if (nsNode) {
    stdout(renderNamespaceHelp(nsNode, positionals.join(" ")));
    return 0;
  }

  const shapeResult = resolvePath(shapeTree, positionals);
  if (flags.help) {
    if ("error" in shapeResult) {
      stdout(renderRootHelp(shapeTree));
    } else {
      stdout(
        renderMethodHelp(
          positionals.slice(0, -1).join(" "),
          shapeResult.method.name,
          shapeResult.method.arity
        )
      );
    }
    return 0;
  }
  if ("error" in shapeResult) {
    stderr(`Error: ${shapeResult.error}`);
    return 1;
  }

  // ---- API path ----

  // Resolve auth
  let auth: ResolvedAuth;
  try {
    auth = await resolveAuthFromFlags(flags);
  } catch (e: unknown) {
    return renderError(e, { writeFn: stderr });
  }

  // Resolve the method again on the real, authenticated client
  const resolveResult = resolvePath(buildTree(deps.createClient(auth)), positionals);
  if ("error" in resolveResult) {
    stderr(`Error: ${resolveResult.error}`);
    return 1;
  }

  // Build request
  let request: object;
  let maxItems: number | undefined;
  let maxPages: number | undefined;
  try {
    maxItems = parseLimit(flags.maxItems, "--max-items");
    maxPages = parseLimit(flags.maxPages, "--max-pages");
    if (flags.json !== undefined && typeof flags.json !== "string") {
      throw new Error("--json requires a value: a JSON string, @file, or - for stdin");
    }
    request = buildRequest(
      flags.json === undefined ? undefined : readJsonArg(flags.json),
      fields
    );
  } catch (e: unknown) {
    renderError(e, { writeFn: stderr });
    return 1;
  }

  const raw = flags.jsonOutput === true;
  const methodName = resolveResult.method.name;
  const readOnly = isReadOnlyMethod(methodName);

  // Write calls get a fresh idempotencyKey unless one was given
  const generatedKey = readOnly ? undefined : ensureIdempotencyKey(request, methodName);

  // Dry run: show what would be sent, without calling the API
  if (flags.dryRun) {
    print(
      {
        dryRun: true,
        environment: auth.environment,
        method: positionals.join(" "),
        request,
      },
      { raw, writeFn: stdout }
    );
    return 0;
  }

  // Production writes need confirmation (or --yes)
  if (auth.environment === "production" && !readOnly && !flags.yes) {
    const command = positionals.join(" ");
    if (!prompter.isInteractive()) {
      stderr(`✗ Error: Refusing to run "${command}" against PRODUCTION without confirmation. Pass --yes to proceed.`);
      return 1;
    }
    const ok = await prompter.confirm(`About to run "${command}" against PRODUCTION. Continue? [y/N] `);
    if (!ok) {
      stderr("Aborted.");
      return 1;
    }
  }

  if (generatedKey) stderr(`Using idempotencyKey ${generatedKey} (pass --idempotencyKey to retry safely)`);

  // Execute
  try {
    const streamMode = flags.stream === true;
    const result = execute(resolveResult.method, request, { stream: streamMode, maxItems, maxPages });

    if (streamMode) {
      // Stream mode: one compact JSON object per line (NDJSON)
      for await (const item of result as AsyncIterable<unknown>) {
        stdout(JSON.stringify(item, bigIntReplacer));
      }
    } else {
      const value = await (result as Promise<unknown>);
      print(value, { raw, writeFn: stdout });
    }

    return 0;
  } catch (e: unknown) {
    return renderError(e, { writeFn: stderr });
  }
}

async function resolveAuthFromFlags(flags: ReturnType<typeof parseArgs>["flags"]): Promise<ResolvedAuth> {
  const config = await load();
  const env = process.env as Record<string, string | undefined>;
  return resolveAuth({ profile: flags.profile, token: flags.token, env: flags.env }, env, config);
}

// ---- whoami ----

async function runWhoami(
  deps: RunDeps,
  flags: ReturnType<typeof parseArgs>["flags"],
  stdout: (msg: string) => void,
  stderr: (msg: string) => void
): Promise<number> {
  try {
    const auth = await resolveAuthFromFlags(flags);
    const client = deps.createClient(auth);
    const { merchant } = await client.merchants.get({ merchantId: "me" });
    print(
      {
        environment: auth.environment,
        tokenSource: auth.source,
        merchant: {
          id: merchant?.id,
          businessName: merchant?.businessName,
          country: merchant?.country,
          currency: merchant?.currency,
          status: merchant?.status,
          mainLocationId: merchant?.mainLocationId,
        },
      },
      { raw: flags.jsonOutput === true, writeFn: stdout }
    );
    return 0;
  } catch (e: unknown) {
    return renderError(e, { writeFn: stderr });
  }
}

// ---- Config command router ----

async function runConfigCommand(
  args: string[],
  flags: ReturnType<typeof parseArgs>["flags"],
  prompter: Prompter,
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
      let environment: "sandbox" | "production" = "sandbox";
      try {
        if (flags.env !== undefined) environment = parseEnvironment(String(flags.env), "--env");
      } catch (e: unknown) {
        return renderError(e, { writeFn: stderr });
      }

      // Token sources: --token - (stdin), hidden prompt when --token is omitted,
      // or an inline value (which ends up in shell history).
      let token: string;
      try {
        if (flags.token === "-") {
          token = prompter.readStdin().trim();
        } else if (typeof flags.token === "string") {
          token = flags.token;
        } else if (prompter.isInteractive()) {
          token = (await prompter.secret("Access token: ")).trim();
        } else {
          stderr("Error: --token is required for config set (use --token - to read it from stdin)");
          return 1;
        }
      } catch (e: unknown) {
        return renderError(e, { writeFn: stderr });
      }
      if (!token) {
        stderr("Error: token is empty");
        return 1;
      }

      await setProfile(profileName, { token, environment });
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
      const cfg = await load();
      const names = Object.keys(cfg.profiles);
      if (names.length === 0) {
        stdout("No profiles configured.");
        return 0;
      }
      const width = Math.max(...names.map((n) => n.length));
      stdout("Profiles:");
      for (const name of names) {
        const marker = name === cfg.defaultProfile ? "*" : " ";
        stdout(`${marker} ${name.padEnd(width)}  ${cfg.profiles[name]!.environment}`);
      }
      if (cfg.defaultProfile) stdout("\n(* = default)");
      return 0;
    }

    case "remove": {
      const profileName = args[1];
      if (!profileName) {
        stderr("Usage: square config remove <profile>");
        return 1;
      }
      try {
        const wasDefault = await removeProfile(profileName);
        stdout(`Profile "${profileName}" removed.${wasDefault ? " It was the default; no default is set now." : ""}`);
        return 0;
      } catch (e: unknown) {
        return renderError(e, { writeFn: stderr });
      }
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
      stderr(`Unknown config subcommand: "${subcommand}". Use set, get, list, use, or remove.`);
      return 1;
    }
  }
}

/** Parse an optional positive-integer flag value. */
function parseLimit(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (typeof value !== "string" || !Number.isInteger(n) || n < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return n;
}

function maskToken(token: string): string {
  if (token.length <= 4) return "****";
  return "*".repeat(token.length - 4) + token.slice(-4);
}
