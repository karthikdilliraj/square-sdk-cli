import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { renderCompletion } from "../src/completion";
import { buildTree } from "../src/introspect";
import { createMockClient } from "./fixtures/mockClient";

const tree = buildTree(createMockClient());

function hasCommand(name: string): boolean {
  return spawnSync("which", [name]).status === 0;
}

describe("completion - bash", () => {
  const script = renderCompletion("bash", tree);

  it("registers a completion function", () => {
    expect(script).toContain("complete -F _square square");
  });

  it("offers namespaces, methods and flags", () => {
    expect(script).toContain('"payments")');
    expect(script).toContain('"terminal actions")');
    expect(script).toContain("create");
    expect(script).toContain("--json-output");
  });

  it("offers built-in commands at the root", () => {
    expect(script).toContain('"search completion config whoami doctor');
  });

  it("is valid bash", () => {
    const result = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
    expect(result.status).toBe(0);
  });
});

describe("completion - zsh", () => {
  const script = renderCompletion("zsh", tree);

  it("starts with compdef and offers candidates", () => {
    expect(script.startsWith("#compdef square")).toBe(true);
    expect(script).toContain('"payments")');
    expect(script).toContain("candidates=(list create");
  });

  it("is valid zsh when zsh is installed", () => {
    if (!hasCommand("zsh")) return;
    const result = spawnSync("zsh", ["-n"], { input: script, encoding: "utf8" });
    expect(result.status).toBe(0);
  });
});

describe("completion - fish", () => {
  const script = renderCompletion("fish", tree);

  it("registers a completion function", () => {
    expect(script).toContain("complete -c square -f -a '(__square_complete)'");
    expect(script).toContain('case "payments"');
    expect(script).toContain("--json-output");
  });
});
