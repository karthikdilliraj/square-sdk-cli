/**
 * config.ts - Profile-based configuration management.
 */

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface Profile {
  /** Absent when the token lives in the OS keychain. */
  token?: string;
  environment: "sandbox" | "production";
  /** Token is stored in the OS keychain rather than the config file. */
  keychain?: boolean;
}

export interface Config {
  defaultProfile?: string;
  profiles: Record<string, Profile>;
}

export function getConfigPath(): string {
  const override = process.env["SQUARE_CLI_CONFIG"];
  if (override) return override;

  const xdg = process.env["XDG_CONFIG_HOME"];
  const base = xdg ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "square-cli", "config.json");
}

export async function load(): Promise<Config> {
  const configPath = getConfigPath();

  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { profiles: {} };
    throw e;
  }

  await ensureOwnerOnlyPermissions(configPath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse config at ${configPath}: ${msg}`);
  }
  return validateConfig(parsed, configPath);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Check the parsed config's shape so a hand-edited file fails here with a
 * clear message rather than later with an unrelated crash.
 */
function validateConfig(parsed: unknown, configPath: string): Config {
  const fail = (problem: string): never => {
    throw new Error(`Invalid config at ${configPath}: ${problem}`);
  };

  if (!isObject(parsed)) fail("expected a JSON object");
  const cfg = parsed as Record<string, unknown>;

  const profiles = cfg["profiles"] ?? {};
  if (!isObject(profiles)) fail(`"profiles" must be an object`);

  for (const [name, profile] of Object.entries(profiles as Record<string, unknown>)) {
    if (!isObject(profile)) fail(`profile "${name}" must be an object`);
    const p = profile as Record<string, unknown>;
    if (p["keychain"] !== undefined && typeof p["keychain"] !== "boolean") {
      fail(`profile "${name}" has a non-boolean "keychain"`);
    }
    const usesKeychain = p["keychain"] === true;
    if (!usesKeychain && (typeof p["token"] !== "string" || p["token"] === "")) {
      fail(`profile "${name}" is missing a "token"`);
    }
    if (p["environment"] !== "sandbox" && p["environment"] !== "production") {
      fail(
        `profile "${name}" has environment ${JSON.stringify(p["environment"])}; expected "sandbox" or "production"`,
      );
    }
  }

  const defaultProfile = cfg["defaultProfile"];
  if (defaultProfile !== undefined && typeof defaultProfile !== "string") {
    fail(`"defaultProfile" must be a string`);
  }

  return { ...cfg, profiles } as Config;
}

/**
 * The token store must not be readable by other users. New files are created
 * 0600; this also re-tightens an existing file that lost its mode (e.g. after
 * being copied or restored from a backup). Best effort — a read-only file
 * surfaces its own error later.
 */
async function ensureOwnerOnlyPermissions(configPath: string): Promise<void> {
  if (process.platform === "win32") return;
  try {
    const { mode } = await stat(configPath);
    if (mode & 0o077) await chmod(configPath, 0o600);
  } catch {
    // Ignore: reading the file will report anything that matters.
  }
}

/**
 * Write the config atomically: a crash mid-write must not truncate every saved
 * profile. The temp file is created next to the target (same filesystem, so
 * rename is atomic) and renamed into place.
 */
export async function save(cfg: Config): Promise<void> {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);

  await mkdir(dir, { recursive: true, mode: 0o700 });

  const content = JSON.stringify(cfg, null, 2);
  const tmpPath = path.join(
    dir,
    `.${path.basename(configPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tmpPath, content, { mode: 0o600 });
    await rename(tmpPath, configPath);
  } catch (e) {
    try {
      await unlink(tmpPath);
    } catch {
      // Nothing to clean up.
    }
    throw e;
  }
}

export async function setProfile(name: string, partial: Partial<Profile>): Promise<void> {
  const cfg = await load();
  const existing = cfg.profiles[name] ?? { token: "", environment: "sandbox" as const };
  cfg.profiles[name] = { ...existing, ...partial } as Profile;
  await save(cfg);
}

/** Replace a profile wholesale (used when moving its token to the keychain). */
export async function putProfile(name: string, profile: Profile): Promise<void> {
  const cfg = await load();
  cfg.profiles[name] = profile;
  await save(cfg);
}

export async function getProfile(name: string): Promise<Profile | undefined> {
  const cfg = await load();
  return cfg.profiles[name];
}

export async function listProfiles(): Promise<string[]> {
  const cfg = await load();
  return Object.keys(cfg.profiles);
}

export async function useProfile(name: string): Promise<void> {
  const cfg = await load();
  if (!cfg.profiles[name]) {
    throw new Error(
      `Profile "${name}" does not exist. Use "config set ${name} --token <TOKEN>" to create it.`,
    );
  }
  cfg.defaultProfile = name;
  await save(cfg);
}

/**
 * Delete a profile. If it was the default, the default is cleared.
 * Returns true when the removed profile was the default.
 */
export async function removeProfile(name: string): Promise<boolean> {
  const cfg = await load();
  if (!cfg.profiles[name]) {
    throw new Error(`Profile "${name}" does not exist.`);
  }
  delete cfg.profiles[name];
  const wasDefault = cfg.defaultProfile === name;
  if (wasDefault) delete cfg.defaultProfile;
  await save(cfg);
  return wasDefault;
}
