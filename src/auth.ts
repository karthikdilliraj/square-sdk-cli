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
}

type EnvVars = Record<string, string | undefined>;

function resolveEnvironment(flags: AuthFlags, env: EnvVars): "sandbox" | "production" {
  // --env flag takes precedence over env var
  if (flags.env) {
    return flags.env === "production" ? "production" : "sandbox";
  }
  const envVal = env["SQUARE_ENVIRONMENT"];
  if (envVal === "production") return "production";
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
    return { token: profile.token, environment: profile.environment };
  }

  // 2. --token flag or SQUARE_ACCESS_TOKEN
  const token = flags.token ?? env["SQUARE_ACCESS_TOKEN"];
  if (token) {
    const environment = resolveEnvironment(flags, env);
    return { token, environment };
  }

  // 3. Default profile
  if (config.defaultProfile) {
    const profile = config.profiles[config.defaultProfile];
    if (profile) {
      return { token: profile.token, environment: profile.environment };
    }
  }

  throw new Error(
    "No authentication found. Provide --token, set SQUARE_ACCESS_TOKEN, use --profile, or configure a default profile with `square config use <profile>`."
  );
}
