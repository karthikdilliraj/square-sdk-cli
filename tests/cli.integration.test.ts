import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { run } from "../src/cli";
import { createMockClient } from "./fixtures/mockClient";

// Dependency injection: createClient always returns mock
const deps = { createClient: (_auth: any) => createMockClient() as any };

let originalEnv: Record<string, string | undefined> = {};
let tmpConfigPath: string;

beforeEach(() => {
  // Save env
  originalEnv = {
    SQUARE_CLI_CONFIG: process.env["SQUARE_CLI_CONFIG"],
    SQUARE_ACCESS_TOKEN: process.env["SQUARE_ACCESS_TOKEN"],
    SQUARE_ENVIRONMENT: process.env["SQUARE_ENVIRONMENT"],
  };
  // Use temp config
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sq-cli-int-"));
  tmpConfigPath = path.join(dir, "config.json");
  process.env["SQUARE_CLI_CONFIG"] = tmpConfigPath;
  // Provide a dummy token for API calls (will be injected mock anyway)
  process.env["SQUARE_ACCESS_TOKEN"] = "test-dummy-token";
  delete process.env["SQUARE_ENVIRONMENT"];
});

afterEach(() => {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fs.rmSync(path.dirname(tmpConfigPath), { recursive: true });
  } catch {}
});

describe("cli integration - help", () => {
  it("--help exits 0 and lists namespaces", async () => {
    const output: string[] = [];
    const exitCode = await run(["--help"], deps, (msg) => output.push(msg));
    expect(exitCode).toBe(0);
    const combined = output.join("\n");
    expect(combined).toMatch(/payments/i);
  });

  it("payments --help exits 0 and lists methods", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "--help"], deps, (msg) => output.push(msg));
    expect(exitCode).toBe(0);
    const combined = output.join("\n");
    expect(combined).toMatch(/list/i);
    expect(combined).toMatch(/create/i);
  });
});

describe("cli integration - API calls", () => {
  it("payments list prints array and exits 0", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "list"], deps, (msg) => output.push(msg));
    expect(exitCode).toBe(0);
    const combined = output.join("\n");
    // Should output JSON array
    expect(combined).toContain("[");
    expect(combined).toContain("pay1");
  });

  it("payments create with --json and field flag passes correct request", async () => {
    let capturedRequest: unknown = null;
    const capturingDeps = {
      createClient: (_auth: any) => {
        const real = createMockClient() as any;
        // Wrap payments.create to capture the request
        const origPayments = real.payments;
        Object.defineProperty(real, "payments", {
          get() {
            const p = origPayments;
            const origCreate = p.create.bind(p);
            p.create = (req: unknown) => {
              capturedRequest = req;
              return origCreate(req);
            };
            return p;
          },
        });
        return real;
      },
    };
    const exitCode = await run(
      ["payments", "create", "--json", '{"currency":"USD"}', "--amountMoney.amount", "100"],
      capturingDeps,
      () => {}
    );
    expect(exitCode).toBe(0);
    expect(capturedRequest).toBeDefined();
    expect((capturedRequest as any).currency).toBe("USD");
    expect((capturedRequest as any).amountMoney?.amount).toBe(100);
  });

  it("API error returns exit code 1", async () => {
    const errDeps = {
      createClient: (_auth: any) => {
        const m = createMockClient() as any;
        // Override payments.throwingMethod to test error path
        return m;
      },
    };
    const errorOutput: string[] = [];
    // Use throwingMethod which always throws SquareError
    const exitCode = await run(
      ["payments", "throwingMethod"],
      errDeps,
      () => {},
      (msg) => errorOutput.push(msg)
    );
    expect(exitCode).toBe(1);
    expect(errorOutput.join("")).toMatch(/422|INVALID_REQUEST/i);
  });
});

describe("cli integration - config subcommands (no auth required)", () => {
  it("config list works without auth env", async () => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
    const output: string[] = [];
    const exitCode = await run(["config", "list"], deps, (msg) => output.push(msg));
    expect(exitCode).toBe(0);
  });

  it("config set and get round-trip", async () => {
    const output: string[] = [];
    await run(["config", "set", "testprofile", "--token", "mytoken123", "--env", "sandbox"], deps, (msg) => output.push(msg));
    const getOutput: string[] = [];
    const exitCode = await run(["config", "get", "testprofile"], deps, (msg) => getOutput.push(msg));
    expect(exitCode).toBe(0);
    // Token should be masked (last 4 chars visible)
    expect(getOutput.join("")).toMatch(/3123|\*{4}/);
  });

  it("config use sets default profile", async () => {
    // First set a profile
    await run(["config", "set", "myprofile", "--token", "tok", "--env", "sandbox"], deps, () => {});
    // Then use it
    const exitCode = await run(["config", "use", "myprofile"], deps, () => {});
    expect(exitCode).toBe(0);
  });

  it("config use unknown profile exits 1", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["config", "use", "unknown"], deps, () => {}, (msg) => errOut.push(msg));
    expect(exitCode).toBe(1);
  });
});
