/**
 * cli.ts - Main CLI entry point. Wires together all modules.
 */

import { appendFileSync, writeFileSync } from "node:fs";
import type { SquareClient } from "square";
import { parseArgs } from "./args.ts";
import { parseEnvironment, type ResolvedAuth, resolveAuth } from "./auth.ts";
import { type ClientOptions, createClient as defaultCreateClient } from "./client.ts";
import { ROOT_COMMANDS, renderCompletion, type Shell, SUPPORTED_SHELLS } from "./completion.ts";
import {
  getConfigPath,
  getProfile,
  load,
  type Profile,
  putProfile,
  removeProfile,
  setProfile,
  useProfile,
} from "./config.ts";
import { formatDoctorReport, runDoctor } from "./doctor.ts";
import { execute } from "./execute.ts";
import { renderMethodHelp, renderNamespaceHelp, renderRootHelp } from "./help.ts";
import {
  bindMethod,
  buildTree,
  findNamespace,
  isReadOnlyMethod,
  resolvePath,
  searchTree,
} from "./introspect.ts";
import { createKeychain, type Keychain } from "./keychain.ts";
import { buildRequest, ensureIdempotencyKey, readJsonArg } from "./merge.ts";
import {
  bigIntReplacer,
  formatJson,
  print,
  renderError,
  renderTable,
  selectFields,
} from "./output.ts";
import { type Prompter, terminalPrompter } from "./prompt.ts";
import { formatVersionLine, getVersions } from "./version.ts";

export interface RunDeps {
  createClient: (
    auth: Pick<ResolvedAuth, "token" | "environment">,
    options?: ClientOptions,
  ) => SquareClient;
  /** Terminal input (confirmations, hidden token entry, stdin). Defaults to the real terminal. */
  prompter?: Prompter;
  /** Keychain backend. Defaults to the OS keychain for this platform. */
  keychain?: Keychain;
}

const defaultDeps: RunDeps = {
  createClient: defaultCreateClient,
  prompter: terminalPrompter,
  keychain: createKeychain(),
};

export interface RunOptions {
  /** Injectable dependencies (for testing). */
  deps?: RunDeps;
  /** Override the stdout writer (for testing). */
  stdout?: (msg: string) => void;
  /** Override the stderr writer (for testing). */
  stderr?: (msg: string) => void;
}

/**
 * Main run function. Returns exit code (0 = success, 1 = error).
 * @param argv - process.argv.slice(2)
 * @param options - Injectable dependencies and output writers (for testing)
 */
export async function run(argv: string[], options: RunOptions = {}): Promise<number> {
  const deps = options.deps ?? defaultDeps;
  const stdout = options.stdout ?? ((msg: string) => process.stdout.write(msg + "\n"));
  const stderr = options.stderr ?? ((msg: string) => process.stderr.write(msg + "\n"));

  const prompter = deps.prompter ?? terminalPrompter;
  const keychain = deps.keychain ?? createKeychain();

  const parsed = parseArgs(argv);
  const { positionals, flags, fields } = parsed;
  const jsonOutput = flags.jsonOutput === true;

  // ---- --version (no auth required) ----
  if (flags.version) {
    if (flags.jsonOutput) {
      stdout(JSON.stringify(getVersions()));
    } else {
      stdout(formatVersionLine(getVersions()));
    }
    return 0;
  }

  // ---- Config subcommands (no auth required) ----
  if (positionals[0] === "config") {
    return runConfigCommand(positionals.slice(1), flags, prompter, keychain, stdout, stderr);
  }

  // ---- whoami (built-in, needs auth) ----
  if (positionals[0] === "whoami") {
    if (flags.help) {
      stdout(
        "Usage: square whoami [--profile <name>] [--json-output]\n\nShow the merchant, environment, and token source in use.",
      );
      return 0;
    }
    return runWhoami(deps, flags, keychain, stdout, stderr);
  }

  // ---- Help and command validation (no auth required) ----
  // The SDK tree is built from a dummy-token client (construction makes no
  // network call), so help and unknown-command errors never need credentials.
  const shapeTree = buildTree(deps.createClient({ token: "dummy", environment: "sandbox" }));

  // ---- completion (built-in, no auth required) ----
  if (positionals[0] === "completion") {
    if (flags.help) {
      stdout(
        "Usage: square completion <bash|zsh|fish>\n\nPrint a completion script for your shell, e.g.\n  square completion zsh > ~/.zsh/completions/_square",
      );
      return 0;
    }
    const shell = positionals[1];
    if (!shell) {
      stderr("Usage: square completion <bash|zsh|fish>");
      return 1;
    }
    if (!SUPPORTED_SHELLS.includes(shell as Shell)) {
      stderr(`Error: Unknown shell "${shell}". Expected bash, zsh, or fish.`);
      return 1;
    }
    stdout(renderCompletion(shell as Shell, shapeTree));
    return 0;
  }

  // ---- doctor (built-in; checks auth and, unless --offline, the API) ----
  if (positionals[0] === "doctor") {
    if (flags.help) {
      stdout(
        "Usage: square doctor [--offline] [--profile <name>] [--json-output]\n\nCheck runtime, config file, credentials, keychain and API reachability.",
      );
      return 0;
    }
    return runDoctorCommand(deps, flags, keychain, stdout, stderr);
  }

  // ---- search (built-in, no auth required) ----
  if (positionals[0] === "search") {
    if (flags.help) {
      stdout(
        'Usage: square search <term>\n\nList namespaces, methods and built-in commands whose name contains <term>.\nQuote multi-word terms to match a path, e.g. square search "terminal actions".',
      );
      return 0;
    }
    const term = positionals.slice(1).join(" ");
    if (!term.trim()) {
      stderr("Usage: square search <term>");
      return 1;
    }
    const limit = 100;
    const needle = term.trim().toLowerCase();
    const builtinMatches = ROOT_COMMANDS.filter((name) => name.includes(needle)).map((name) => ({
      path: name,
      kind: "namespace" as const,
    }));
    const matches = [...builtinMatches, ...searchTree(shapeTree, term, limit)].slice(0, limit);
    if (matches.length === 0) {
      stdout(`No matches for "${term}".`);
      return 0;
    }
    for (const match of matches) stdout(match.path);
    if (matches.length === limit) {
      stderr(`Showing the first ${limit} matches. Use a more specific term.`);
    }
    return 0;
  }

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
      stdout(renderMethodHelp(positionals.slice(0, -1).join(" "), shapeResult.method.name));
    }
    return 0;
  }
  if ("error" in shapeResult) {
    stderr(`Error: ${shapeResult.error}`);
    return 1;
  }

  // ---- API path ----

  // Transport flags are validated before auth so a bad value is the reported
  // problem even without a token.
  let clientOptions: ClientOptions;
  try {
    clientOptions = {};
    const timeoutInSeconds = parseTimeout(flags.timeout);
    const maxRetries = parseRetries(flags.retry);
    if (timeoutInSeconds !== undefined) clientOptions.timeoutInSeconds = timeoutInSeconds;
    if (maxRetries !== undefined) clientOptions.maxRetries = maxRetries;
  } catch (e: unknown) {
    return renderError(e, { writeFn: stderr, json: jsonOutput });
  }

  // Resolve auth
  let auth: ResolvedAuth;
  try {
    auth = await resolveAuthFromFlags(flags, keychain);
  } catch (e: unknown) {
    return renderError(e, { writeFn: stderr, json: jsonOutput });
  }

  // Execute on the authenticated client. The command shape was already
  // validated against the dummy client above, so walk straight to the
  // namespace instead of rebuilding the whole SDK tree a second time.
  const method = bindMethod(
    deps.createClient(auth, clientOptions),
    positionals.slice(0, -1),
    positionals[positionals.length - 1]!,
  );
  if (!method) {
    stderr(`Error: Unknown method "${positionals.join(" ")}"`);
    return 1;
  }

  // Build request
  let request: object;
  let maxItems: number | undefined;
  let maxPages: number | undefined;
  let selectPaths: string[] | undefined;
  try {
    maxItems = parseLimit(flags.maxItems, "--max-items");
    maxPages = parseLimit(flags.maxPages, "--max-pages");
    selectPaths = parseSelect(flags.select);
    if (flags.rawPage && flags.stream) {
      throw new Error("--raw-page cannot be combined with --stream");
    }
    if (flags.table && flags.stream) {
      throw new Error("--table cannot be combined with --stream");
    }
    if (flags.table && flags.rawPage) {
      throw new Error("--table cannot be combined with --raw-page");
    }
    if (flags.table && jsonOutput) {
      throw new Error("--table cannot be combined with --json-output");
    }
    if (flags.output !== undefined && typeof flags.output !== "string") {
      throw new Error("--output requires a file path");
    }
    if (flags.json !== undefined && typeof flags.json !== "string") {
      throw new Error("--json requires a value: a JSON string, @file, or - for stdin");
    }
    request = buildRequest(flags.json === undefined ? undefined : readJsonArg(flags.json), fields);
  } catch (e: unknown) {
    return renderError(e, { writeFn: stderr, json: jsonOutput });
  }

  const raw = jsonOutput;
  const methodName = method.name;
  const readOnly = isReadOnlyMethod(methodName);

  // Dry run: show what would be sent, without calling the API.
  // No idempotency key is generated: it would never reach the API.
  if (flags.dryRun) {
    print(
      {
        dryRun: true,
        environment: auth.environment,
        method: positionals.join(" "),
        request,
      },
      { raw, writeFn: stdout },
    );
    return 0;
  }

  // Production writes need confirmation (or --yes)
  if (auth.environment === "production" && !readOnly && !flags.yes) {
    const command = positionals.join(" ");
    if (!prompter.isInteractive()) {
      return renderError(
        new Error(
          `Refusing to run "${command}" against PRODUCTION without confirmation. Pass --yes to proceed.`,
        ),
        { writeFn: stderr, json: jsonOutput },
      );
    }
    const ok = await prompter.confirm(
      `About to run "${command}" against PRODUCTION. Continue? [y/N] `,
    );
    if (!ok) {
      return renderError(new Error("Aborted."), { writeFn: stderr, json: jsonOutput });
    }
  }

  // Write calls get a fresh idempotencyKey unless one was given. Generated
  // only now so a dry run or an aborted confirmation never mints an unused key.
  const generatedKey = readOnly ? undefined : ensureIdempotencyKey(request, methodName);
  if (generatedKey)
    stderr(`Using idempotencyKey ${generatedKey} (pass --idempotencyKey to retry safely)`);

  // Execute
  const verbose = flags.verbose === true;
  const streamMode = flags.stream === true;
  const startedAt = Date.now();
  if (verbose) stderr(`→ ${positionals.join(" ")} (${auth.environment}; auth: ${auth.source})`);

  try {
    const result = execute(method, request, {
      stream: streamMode,
      rawPage: flags.rawPage === true,
      maxItems,
      maxPages,
    });
    const emit = createEmitter(typeof flags.output === "string" ? flags.output : undefined, stdout);

    if (streamMode) {
      // Stream mode: one compact JSON object per line (NDJSON)
      let count = 0;
      for await (const item of result as AsyncIterable<unknown>) {
        const selected = selectPaths ? selectFields(item, selectPaths) : item;
        emit(JSON.stringify(selected, bigIntReplacer));
        count++;
      }
      if (verbose)
        stderr(`← ${count} item${count === 1 ? "" : "s"} in ${Date.now() - startedAt} ms`);
    } else {
      let value = await (result as Promise<unknown>);
      if (selectPaths) value = selectFields(value, selectPaths);
      if (flags.table === true) {
        if (!Array.isArray(value)) {
          throw new Error("--table requires a list result");
        }
        emit(renderTable(value, selectPaths));
      } else {
        emit(formatJson(value, raw));
      }
      if (verbose) stderr(`← done in ${Date.now() - startedAt} ms`);
    }

    return 0;
  } catch (e: unknown) {
    return renderError(e, { writeFn: stderr, verbose, json: jsonOutput });
  }
}

async function resolveAuthFromFlags(
  flags: ReturnType<typeof parseArgs>["flags"],
  keychain: Keychain,
): Promise<ResolvedAuth> {
  const config = await load();
  const env = process.env as Record<string, string | undefined>;

  // Keychain profiles carry no token in the file. Only look one up for the
  // profile actually in play, so unrelated profiles never touch the keychain.
  const tokenFromEnv = flags.token ?? env["SQUARE_ACCESS_TOKEN"];
  const name = flags.profile ?? (tokenFromEnv ? undefined : config.defaultProfile);
  const profile = name ? config.profiles[name] : undefined;
  if (name && profile?.keychain && !profile.token) {
    const token = keychain.get(name);
    if (token) profile.token = token;
  }

  return resolveAuth({ profile: flags.profile, token: flags.token, env: flags.env }, env, config);
}

// ---- whoami ----

async function runWhoami(
  deps: RunDeps,
  flags: ReturnType<typeof parseArgs>["flags"],
  keychain: Keychain,
  stdout: (msg: string) => void,
  stderr: (msg: string) => void,
): Promise<number> {
  try {
    const auth = await resolveAuthFromFlags(flags, keychain);
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
      { raw: flags.jsonOutput === true, writeFn: stdout },
    );
    return 0;
  } catch (e: unknown) {
    return renderError(e, {
      writeFn: stderr,
      verbose: flags.verbose === true,
      json: flags.jsonOutput === true,
    });
  }
}

// ---- doctor ----

async function runDoctorCommand(
  deps: RunDeps,
  flags: ReturnType<typeof parseArgs>["flags"],
  keychain: Keychain,
  stdout: (msg: string) => void,
  stderr: (msg: string) => void,
): Promise<number> {
  const report = await runDoctor({
    createClient: (auth) => deps.createClient(auth),
    keychain,
    offline: flags.offline === true,
    resolveAuth: () => resolveAuthFromFlags(flags, keychain),
  });
  stdout(flags.jsonOutput === true ? JSON.stringify(report) : formatDoctorReport(report));
  return report.ok ? 0 : 1;
}

// ---- Config command router ----

async function runConfigCommand(
  args: string[],
  flags: ReturnType<typeof parseArgs>["flags"],
  prompter: Prompter,
  keychain: Keychain,
  stdout: (msg: string) => void,
  stderr: (msg: string) => void,
): Promise<number> {
  const subcommand = args[0];

  switch (subcommand) {
    case "set": {
      const profileName = args[1];
      if (!profileName) {
        stderr("Usage: square config set <profile> --token <token> [--env <environment>]");
        return 1;
      }
      let environment: "sandbox" | "production" | undefined;
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
          token = (await prompter.readStdin()).trim();
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

      // Only send the environment when --env was given: setProfile merges over
      // the existing profile, so a plain token rotation must not reset it.
      const existing = await getProfile(profileName);
      if (flags.keychain) {
        if (!keychain.available()) {
          stderr(
            `Error: no supported keychain on this platform. Omit --keychain to store the token in ${getConfigPath()}.`,
          );
          return 1;
        }
        try {
          keychain.set(profileName, token);
        } catch (e: unknown) {
          return renderError(e, { writeFn: stderr, json: flags.jsonOutput === true });
        }
        await putProfile(profileName, {
          environment: environment ?? existing?.environment ?? "sandbox",
          keychain: true,
        });
        stdout(`Profile "${profileName}" saved (token in keychain).`);
        return 0;
      }

      if (existing?.keychain) {
        // Moved back to file storage: drop the stale keychain entry.
        try {
          keychain.delete(profileName);
        } catch {
          // Best effort; the file token is what will be used.
        }
      }
      // Replace the profile so no stale keychain flag survives.
      await putProfile(profileName, {
        token,
        environment: environment ?? existing?.environment ?? "sandbox",
      });
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
      // Mask token: show last 4 chars, or point at the keychain.
      const maskedToken = profile.keychain
        ? "(stored in keychain)"
        : maskToken(profile.token ?? "");
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
        const profile = cfg.profiles[name]!;
        const marker = name === cfg.defaultProfile ? "*" : " ";
        const suffix = profile.keychain ? "  (keychain)" : "";
        stdout(`${marker} ${name.padEnd(width)}  ${profile.environment}${suffix}`);
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
        const profile = await getProfile(profileName);
        if (profile?.keychain) {
          try {
            keychain.delete(profileName);
          } catch {
            // Best effort: the profile is removed from config either way.
          }
        }
        const wasDefault = await removeProfile(profileName);
        stdout(
          `Profile "${profileName}" removed.${wasDefault ? " It was the default; no default is set now." : ""}`,
        );
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

/** Parse `--timeout`: a positive number of seconds (fractions allowed). */
function parseTimeout(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (typeof value !== "string" || !Number.isFinite(n) || n <= 0) {
    throw new Error("--timeout must be a positive number of seconds");
  }
  return n;
}

/** Parse `--retry`: a non-negative integer (0 disables retries). */
function parseRetries(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (typeof value !== "string" || !Number.isInteger(n) || n < 0) {
    throw new Error("--retry must be a non-negative integer (0 disables retries)");
  }
  return n;
}

/** Parse `--select`: a comma-separated list of dotted field paths. */
function parseSelect(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("--select requires a comma-separated list of fields");
  }
  const paths = value
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean);
  if (paths.length === 0) {
    throw new Error("--select requires at least one field path");
  }
  return paths;
}

/**
 * Result writer: stdout normally, or a file with `--output`. A file is
 * truncated once, then appended per line so `--stream` still writes incrementally.
 */
function createEmitter(
  file: string | undefined,
  stdout: (msg: string) => void,
): (line: string) => void {
  if (!file) return (line) => stdout(line);
  writeFileSync(file, "");
  return (line) => appendFileSync(file, `${line}\n`);
}

function maskToken(token: string): string {
  if (token.length <= 4) return "****";
  return "*".repeat(token.length - 4) + token.slice(-4);
}
