/**
 * e2e for the process-boundary behavior that unit tests can't reach: a real
 * pipe closing early (EPIPE) and buffered writes surviving `process.exit`.
 *
 * Each case runs a tiny harness that wires the same helpers as bin/square.ts.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");

function writeHarness(body: string): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "square-cli-e2e-"));
  const file = join(dir, "harness.ts");
  writeFileSync(file, body);
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const imports = `
import { guardBrokenPipe } from ${JSON.stringify(join(repoRoot, "src/epipe.ts"))};
`;

describe("e2e - broken pipe", () => {
  it("exits 0 without a stack trace when the reader goes away", async () => {
    const harness = writeHarness(`${imports}
guardBrokenPipe([process.stdout, process.stderr]);
process.stdout.write("ready\\n");
const payload = "x".repeat(64 * 1024);
for (let i = 0; i < 200; i++) {
  process.stdout.write(payload);
  await Bun.sleep(1);
}
`);
    const proc = Bun.spawn(["bun", harness.file], {
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const reader = proc.stdout.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain("ready");
      // Emulates `| head -1`: the consumer closes while the writer still has data.
      await reader.cancel();

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
    } finally {
      proc.kill();
      harness.cleanup();
    }
  }, 15_000);
});

describe("e2e - natural exit", () => {
  it("flushes a payload larger than the pipe buffer without process.exit", async () => {
    const harness = writeHarness(`${imports}
const payload = "y".repeat(1024 * 1024);
process.stdout.write(payload);
// Mirrors bin/square.ts: set the code and let the runtime flush on exit,
// with an unref'd timer as the only forced exit.
process.exitCode = 0;
setTimeout(() => process.exit(0), 2000).unref();
`);
    const proc = Bun.spawn(["bun", harness.file], {
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
      expect(stdout.length).toBe(1024 * 1024);
      expect(stdout).toBe("y".repeat(1024 * 1024));
    } finally {
      proc.kill();
      harness.cleanup();
    }
  }, 15_000);
});

describe("e2e - real CLI over a pipe", () => {
  it("writes complete help output to a pipe", async () => {
    const proc = Bun.spawn(["bun", join(repoRoot, "bin/square.ts"), "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Namespaces:");
    expect(stdout.trimEnd().endsWith("--help                Show this help message")).toBe(true);
  }, 15_000);
});
