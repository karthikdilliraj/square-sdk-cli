/**
 * config.ts - Profile-based configuration management.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface Profile {
  token: string;
  environment: "sandbox" | "production";
}

export interface Config {
  defaultProfile?: string;
  profiles: Record<string, Profile>;
}

function getConfigPath(): string {
  const override = process.env["SQUARE_CLI_CONFIG"];
  if (override) return override;

  const xdg = process.env["XDG_CONFIG_HOME"];
  const base = xdg ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "square-cli", "config.json");
}

export async function load(): Promise<Config> {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return { profiles: {} };
  }

  const raw = fs.readFileSync(configPath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return parsed as Config;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse config at ${configPath}: ${msg}`);
  }
}

export async function save(cfg: Config): Promise<void> {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);

  fs.mkdirSync(dir, { recursive: true });
  const content = JSON.stringify(cfg, null, 2);
  fs.writeFileSync(configPath, content, { mode: 0o600 });
}

export async function setProfile(name: string, partial: Partial<Profile>): Promise<void> {
  const cfg = await load();
  const existing = cfg.profiles[name] ?? { token: "", environment: "sandbox" as const };
  cfg.profiles[name] = { ...existing, ...partial } as Profile;
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
    throw new Error(`Profile "${name}" does not exist. Use "config set ${name} --token <TOKEN>" to create it.`);
  }
  cfg.defaultProfile = name;
  await save(cfg);
}
