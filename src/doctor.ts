/**
 * doctor.ts - Diagnose the local setup: runtime, config file, credentials,
 * keychain availability and (unless offline) API reachability.
 */

import { stat } from "node:fs/promises";
import type { SquareClient } from "square";
import type { ResolvedAuth } from "./auth.ts";
import { getConfigPath, load } from "./config.ts";
import type { Keychain } from "./keychain.ts";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  createClient: (auth: Pick<ResolvedAuth, "token" | "environment">) => SquareClient;
  keychain: Keychain;
  /** Resolves credentials, throwing a user-facing message on failure. */
  resolveAuth: () => Promise<ResolvedAuth>;
  /** Skip the API round-trip. */
  offline?: boolean;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function runtimeCheck(): DoctorCheck {
  if (typeof Bun !== "undefined") {
    return { name: "Runtime", ok: true, detail: `bun ${Bun.version}` };
  }
  return { name: "Runtime", ok: true, detail: `node ${process.versions.node}` };
}

/** Check the config file's existence and permissions. */
async function configCheck(): Promise<DoctorCheck> {
  const configPath = getConfigPath();
  try {
    const { mode } = await stat(configPath);
    const permissions = (mode & 0o777).toString(8).padStart(3, "0");
    const loose = process.platform !== "win32" && (mode & 0o077) !== 0;
    return {
      name: "Config",
      ok: !loose,
      detail: loose
        ? `${configPath} is ${permissions}; it should be 0600 (run: chmod 600 ${configPath})`
        : `${configPath} (${permissions})`,
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { name: "Config", ok: true, detail: `${configPath} (not created yet)` };
    }
    return { name: "Config", ok: false, detail: message(e) };
  }
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [runtimeCheck()];
  checks.push(await configCheck());

  let keychainProfiles: string[] = [];
  try {
    const config = await load();
    keychainProfiles = Object.entries(config.profiles)
      .filter(([, profile]) => profile.keychain)
      .map(([name]) => name);
  } catch {
    // A malformed config is reported by the auth check below.
  }

  if (keychainProfiles.length > 0) {
    const available = options.keychain.available();
    checks.push({
      name: "Keychain",
      ok: available,
      detail: available
        ? `in use for ${keychainProfiles.join(", ")}`
        : `unavailable, but needed by ${keychainProfiles.join(", ")}; re-run config set without --keychain`,
    });
  }

  let auth: ResolvedAuth | undefined;
  try {
    auth = await options.resolveAuth();
    checks.push({
      name: "Auth",
      ok: true,
      detail: `${auth.source} (${auth.environment})`,
    });
  } catch (e) {
    checks.push({ name: "Auth", ok: false, detail: message(e) });
  }

  if (options.offline) {
    checks.push({ name: "API", ok: true, detail: "skipped (--offline)" });
  } else if (auth) {
    try {
      const client = options.createClient(auth);
      const { merchant } = await client.merchants.get({ merchantId: "me" });
      checks.push({
        name: "API",
        ok: true,
        detail: merchant?.businessName
          ? `reachable — ${merchant.businessName} (${auth.environment})`
          : `reachable (${auth.environment})`,
      });
    } catch (e) {
      checks.push({ name: "API", ok: false, detail: message(e) });
    }
  } else {
    checks.push({ name: "API", ok: false, detail: "skipped because authentication failed" });
  }

  return { ok: checks.every((check) => check.ok), checks };
}

/** Human-readable report for the terminal. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines = report.checks.map(
    (check) => `${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`,
  );
  lines.push("");
  lines.push(report.ok ? "All checks passed." : "Some checks failed.");
  return lines.join("\n");
}
