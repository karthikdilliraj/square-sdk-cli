/**
 * keychain.ts - Store access tokens in the OS keychain instead of the config file.
 *
 * macOS uses `security`, Linux uses `secret-tool` (libsecret). Windows is not
 * supported; callers should fall back to the 0600 config file. The command
 * runner is injectable so the command construction is testable without touching
 * a real keychain.
 */

import { spawnSync } from "node:child_process";

export interface Keychain {
  /** Whether a supported keychain tool is available on this platform. */
  available(): boolean;
  set(profile: string, token: string): void;
  get(profile: string): string | undefined;
  delete(profile: string): void;
}

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (cmd: string[], input?: string) => CommandResult;

const SERVICE = "square-sdk-cli";

const defaultRunner: CommandRunner = (cmd, input) => {
  const result = spawnSync(cmd[0]!, cmd.slice(1), { input, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
};

function failure(tool: string, result: CommandResult): Error {
  const detail = result.stderr.trim() || `exit code ${result.status}`;
  return new Error(`${tool} failed: ${detail}`);
}

export function createKeychain(
  platform: NodeJS.Platform = process.platform,
  run: CommandRunner = defaultRunner,
): Keychain {
  if (platform === "darwin") {
    return {
      available: () => true,
      set(profile, token) {
        const result = run([
          "security",
          "add-generic-password",
          "-U",
          "-a",
          profile,
          "-s",
          SERVICE,
          "-w",
          token,
        ]);
        if (result.status !== 0) throw failure("security", result);
      },
      get(profile) {
        const result = run([
          "security",
          "find-generic-password",
          "-a",
          profile,
          "-s",
          SERVICE,
          "-w",
        ]);
        return result.status === 0 ? result.stdout.trim() : undefined;
      },
      delete(profile) {
        run(["security", "delete-generic-password", "-a", profile, "-s", SERVICE]);
      },
    };
  }

  if (platform === "linux") {
    return {
      available: () => run(["which", "secret-tool"]).status === 0,
      set(profile, token) {
        const result = run(
          [
            "secret-tool",
            "store",
            "--label",
            `Square CLI (${profile})`,
            "service",
            SERVICE,
            "profile",
            profile,
          ],
          token,
        );
        if (result.status !== 0) throw failure("secret-tool", result);
      },
      get(profile) {
        const result = run(["secret-tool", "lookup", "service", SERVICE, "profile", profile]);
        return result.status === 0 ? result.stdout.trim() || undefined : undefined;
      },
      delete(profile) {
        run(["secret-tool", "clear", "service", SERVICE, "profile", profile]);
      },
    };
  }

  const unsupported = (): never => {
    throw new Error(
      `The OS keychain is not supported on ${platform}. Store the token in the config file instead (omit --keychain).`,
    );
  };

  return {
    available: () => false,
    set: unsupported,
    get: () => undefined,
    delete: unsupported,
  };
}
