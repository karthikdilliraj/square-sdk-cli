import { describe, expect, it } from "bun:test";
import { type CommandResult, type CommandRunner, createKeychain } from "../src/keychain";

function recorder(results: Partial<CommandResult> = {}) {
  const calls: { cmd: string[]; input?: string }[] = [];
  const run: CommandRunner = (cmd, input) => {
    calls.push({ cmd, input });
    return {
      status: results.status ?? 0,
      stdout: results.stdout ?? "",
      stderr: results.stderr ?? "",
    };
  };
  return { calls, run };
}

describe("keychain - macOS", () => {
  it("stores a token with security add-generic-password", () => {
    const { calls, run } = recorder();
    createKeychain("darwin", run).set("prod", "tok");
    expect(calls[0]!.cmd).toEqual([
      "security",
      "add-generic-password",
      "-U",
      "-a",
      "prod",
      "-s",
      "square-sdk-cli",
      "-w",
      "tok",
    ]);
  });

  it("reads and trims the token", () => {
    const { calls, run } = recorder({ stdout: "tok\n" });
    expect(createKeychain("darwin", run).get("prod")).toBe("tok");
    expect(calls[0]!.cmd).toContain("find-generic-password");
  });

  it("returns undefined when the entry is missing", () => {
    const { run } = recorder({ status: 44, stderr: "not found" });
    expect(createKeychain("darwin", run).get("prod")).toBeUndefined();
  });

  it("deletes an entry", () => {
    const { calls, run } = recorder();
    createKeychain("darwin", run).delete("prod");
    expect(calls[0]!.cmd).toContain("delete-generic-password");
  });

  it("surfaces a store failure", () => {
    const { run } = recorder({ status: 1, stderr: "denied" });
    expect(() => createKeychain("darwin", run).set("prod", "tok")).toThrow(
      /security failed: denied/,
    );
  });

  it("is always available", () => {
    expect(createKeychain("darwin", recorder().run).available()).toBe(true);
  });
});

describe("keychain - Linux", () => {
  it("stores the token on stdin for secret-tool", () => {
    const { calls, run } = recorder();
    createKeychain("linux", run).set("prod", "tok");
    expect(calls[0]!.cmd).toEqual([
      "secret-tool",
      "store",
      "--label",
      "Square CLI (prod)",
      "service",
      "square-sdk-cli",
      "profile",
      "prod",
    ]);
    expect(calls[0]!.input).toBe("tok");
  });

  it("looks a token up", () => {
    const { calls, run } = recorder({ stdout: "tok\n" });
    expect(createKeychain("linux", run).get("prod")).toBe("tok");
    expect(calls[0]!.cmd).toEqual([
      "secret-tool",
      "lookup",
      "service",
      "square-sdk-cli",
      "profile",
      "prod",
    ]);
  });

  it("clears an entry", () => {
    const { calls, run } = recorder();
    createKeychain("linux", run).delete("prod");
    expect(calls[0]!.cmd).toContain("clear");
  });

  it("reports availability from `which secret-tool`", () => {
    expect(createKeychain("linux", recorder({ status: 0 }).run).available()).toBe(true);
    expect(createKeychain("linux", recorder({ status: 1 }).run).available()).toBe(false);
  });
});

describe("keychain - unsupported platform", () => {
  it("is unavailable", () => {
    expect(createKeychain("win32", recorder().run).available()).toBe(false);
  });

  it("explains how to store the token instead", () => {
    expect(() => createKeychain("win32", recorder().run).set("p", "t")).toThrow(/not supported/);
  });
});
