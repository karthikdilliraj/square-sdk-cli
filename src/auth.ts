/**
 * auth.ts - Resolve authentication from flags, environment, and config.
 */

import type { Config } from "./config.ts";

export interface AuthFlags {
  profile?: string;
  token?: string;
  env?: string;
}

export interface ResolvedAuth {
  token: string;
  environment: "sandbox" | "production";
  /** Where the token came from, e.g. `profile "prod"` or `SQUARE_ACCESS_TOKEN`. */
  source: string;
}

type EnvVars = Record<string, string | undefined>;

/**
 * Validate an environment name. Throws on anything other than "sandbox" or
 * "production" so a typo (e.g. "prod") never silently falls back to sandbox.
 */
export function parseEnvironment(value: string, source: string): "sandbox" | "production" {
  if (value === "sandbox" || value === "production") return value;
  throw new Error(`Invalid ${source} "${value}". Expected "sandbox" or "production".`);
}

function resolveEnvironment(flags: AuthFlags, env: EnvVars): "sandbox" | "production" {
  // --env flag takes precedence over env var
  if (flags.env !== undefined) return parseEnvironment(String(flags.env), "--env");
  const envVal = env["SQUARE_ENVIRONMENT"];
  if (envVal) return parseEnvironment(envVal, "SQUARE_ENVIRONMENT");
  return "sandbox";
}

/**
 * Resolve auth with precedence:
 * 1) --profile flag (must exist in config)
 * 2) --token flag or SQUARE_ACCESS_TOKEN env var (env SQUARE_ENVIRONMENT or --env, default "sandbox")
 * 3) default profile from config
 */
export function resolveAuth(
  flags: AuthFlags,
  env: EnvVars,
  config: Config
): ResolvedAuth {
  // 1. --profile flag
  if (flags.profile !== undefined) {
    const profile = config.profiles[flags.profile];
    if (!profile) {
      throw new Error(
        `Profile "${flags.profile}" not found. Available profiles: ${Object.keys(config.profiles).join(", ") || "(none)"}`
      );
    }
    return { token: profile.token, environment: profile.environment, source: `profile "${flags.profile}"` };
  }

  // 2. --token flag or SQUARE_ACCESS_TOKEN
  const token = flags.token ?? env["SQUARE_ACCESS_TOKEN"];
  if (token) {
    const environment = resolveEnvironment(flags, env);
    return { token, environment, source: flags.token ? "--token" : "SQUARE_ACCESS_TOKEN" };
  }

  // 3. Default profile
  if (config.defaultProfile) {
    const profile = config.profiles[config.defaultProfile];
    if (profile) {
      return {
        token: profile.token,
        environment: profile.environment,
        source: `default profile "${config.defaultProfile}"`,
      };
    }
  }

  throw new Error(
    "No authentication found. Provide --token, set SQUARE_ACCESS_TOKEN, use --profile, or configure a default profile with `square config use <profile>`."
  );
}
