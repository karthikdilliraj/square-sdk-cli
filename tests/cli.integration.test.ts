import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { run } from "../src/cli";
import type { Prompter } from "../src/prompt";
import { createMockClient } from "./fixtures/mockClient";

function fakePrompter(opts: {
  interactive: boolean;
  confirm?: boolean;
  secret?: string;
  stdin?: string;
}) {
  const calls = { confirm: [] as string[], secret: [] as string[] };
  const prompter: Prompter = {
    isInteractive: () => opts.interactive,
    confirm: async (q) => {
      calls.confirm.push(q);
      return opts.confirm ?? false;
    },
    secret: async (q) => {
      calls.secret.push(q);
      return opts.secret ?? "";
    },
    readStdin: async () => opts.stdin ?? "",
  };
  return { prompter, calls };
}

/** Deps whose payments.create records the request it was called with. */
function capturingCreateDeps(prompter?: Prompter) {
  const captured: { request?: any } = {};
  return {
    captured,
    deps: {
      prompter,
      createClient: (_auth: any) => {
        const m = createMockClient() as any;
        const p = m.payments;
        p.create = async (req: unknown) => {
          captured.request = req;
          return { payment: { id: "new-pay" } };
        };
        Object.defineProperty(m, "payments", { get: () => p });
        return m;
      },
    },
  };
}

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
    const exitCode = await run(["--help"], { deps, stdout: (msg) => output.push(msg) });
    expect(exitCode).toBe(0);
    const combined = output.join("\n");
    expect(combined).toMatch(/payments/i);
  });

  it("payments --help exits 0 and lists methods", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "--help"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    const combined = output.join("\n");
    expect(combined).toMatch(/list/i);
    expect(combined).toMatch(/create/i);
  });

  it("help does not leak implementation details like arity", async () => {
    const output: string[] = [];
    await run(["payments"], { deps, stdout: (msg) => output.push(msg) });
    await run(["payments", "create", "--help"], { deps, stdout: (msg) => output.push(msg) });
    expect(output.join("\n")).not.toContain("arity");
  });
});

describe("cli integration - nested help", () => {
  it("lists nested methods with their full path", async () => {
    const output: string[] = [];
    const exitCode = await run(["terminal", "actions"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);

    const lines = output.join("\n").split("\n");
    expect(lines[0]).toBe("Namespace: terminal actions");
    const methodLines = lines.filter((line) => line.startsWith("  terminal actions "));
    expect(methodLines.length).toBeGreaterThan(0);
    for (const line of methodLines) {
      expect(line).toMatch(/^ {2}terminal actions [a-zA-Z]+$/);
    }
  });

  it("method help names the full command and documents the = form", async () => {
    const output: string[] = [];
    const exitCode = await run(["terminal", "actions", "create", "--help"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);

    const text = output.join("\n");
    expect(text).toContain("Method: terminal actions create");
    expect(text).toContain("square terminal actions create [options]");
    expect(text).toContain("--<field.path>=<value>");
  });
});

describe("cli integration - -- terminator", () => {
  it("treats tokens after -- as namespaces, not flags", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["--", "--help"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Unknown namespace "--help"/);
  });

  it("lets search take a term that looks like a flag", async () => {
    const output: string[] = [];
    const exitCode = await run(["search", "--", "--help"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(output.join("\n")).toMatch(/No matches for "--help"/);
  });
});

describe("cli integration - API calls", () => {
  it("payments list prints array and exits 0", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "list"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    const combined = output.join("\n");
    // Should output JSON array
    expect(combined).toContain("[");
    expect(combined).toContain("pay1");
  });

  it("executes on the authenticated client, not the shape client", async () => {
    const output: string[] = [];
    const splitDeps = {
      createClient: (auth: any) => {
        const mock = createMockClient() as any;
        const payments = mock.payments;
        const marker = auth.token === "dummy" ? "shape" : "real";
        payments.list = async () => [{ id: marker }];
        Object.defineProperty(mock, "payments", { get: () => payments });
        return mock;
      },
    };
    const exitCode = await run(["payments", "list", "--json-output"], {
      deps: splitDeps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(output[0]!)).toEqual([{ id: "real" }]);
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
      { deps: capturingDeps, stdout: () => {} },
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
    const exitCode = await run(["payments", "throwingMethod"], {
      deps: errDeps,
      stdout: () => {},
      stderr: (msg) => errorOutput.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errorOutput.join("")).toMatch(/422|INVALID_REQUEST/i);
  });
});

describe("cli integration - config subcommands (no auth required)", () => {
  it("config list works without auth env", async () => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
    const output: string[] = [];
    const exitCode = await run(["config", "list"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
  });

  it("config set and get round-trip", async () => {
    const output: string[] = [];
    await run(["config", "set", "testprofile", "--token", "mytoken123", "--env", "sandbox"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    const getOutput: string[] = [];
    const exitCode = await run(["config", "get", "testprofile"], {
      deps,
      stdout: (msg) => getOutput.push(msg),
    });
    expect(exitCode).toBe(0);
    // Token should be masked (last 4 chars visible)
    expect(getOutput.join("")).toMatch(/3123|\*{4}/);
  });

  it("config use sets default profile", async () => {
    // First set a profile
    await run(["config", "set", "myprofile", "--token", "tok", "--env", "sandbox"], {
      deps,
      stdout: () => {},
    });
    // Then use it
    const exitCode = await run(["config", "use", "myprofile"], { deps, stdout: () => {} });
    expect(exitCode).toBe(0);
  });

  it("config use unknown profile exits 1", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["config", "use", "unknown"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
  });
});

describe("cli integration - output modes", () => {
  it("--json-output prints compact JSON", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "list", "--json-output"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(output.length).toBe(1);
    expect(output[0]).not.toContain("\n");
    expect(JSON.parse(output[0]!)).toHaveLength(3);
  });

  it("--stream prints one compact JSON object per line", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "list", "--stream"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(output.length).toBe(3);
    for (const line of output) {
      expect(line).not.toContain("\n");
      expect(JSON.parse(line).id).toMatch(/^pay/);
    }
  });
});

describe("cli integration - dry run", () => {
  it("prints the request and does not call the API", async () => {
    let called = false;
    const spyDeps = {
      createClient: (_auth: any) => {
        const m = createMockClient() as any;
        const p = m.payments;
        p.create = () => {
          called = true;
        };
        Object.defineProperty(m, "payments", { get: () => p });
        return m;
      },
    };
    const output: string[] = [];
    const exitCode = await run(["payments", "create", "--amountMoney.amount", "100", "--dry-run"], {
      deps: spyDeps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(called).toBe(false);
    const printed = JSON.parse(output.join("\n"));
    expect(printed).toEqual({
      dryRun: true,
      environment: "sandbox",
      method: "payments create",
      request: { amountMoney: { amount: 100 } },
    });
  });

  it("does not generate an idempotency key for a write", async () => {
    const output: string[] = [];
    const exitCode = await run(
      ["payments", "create", "--amountMoney.amount", "100", "--dry-run", "--json-output"],
      { deps, stdout: (msg) => output.push(msg) },
    );
    expect(exitCode).toBe(0);
    expect(JSON.parse(output[0]!).request.idempotencyKey).toBeUndefined();
  });
});

describe("cli integration - --json sources", () => {
  it("reads the request body from @file", async () => {
    const bodyPath = path.join(path.dirname(tmpConfigPath), "body.json");
    fs.writeFileSync(bodyPath, '{"sourceId":"cnon:card"}');
    const output: string[] = [];
    const exitCode = await run(["payments", "create", "--json", `@${bodyPath}`, "--dry-run"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(output.join("\n")).request).toMatchObject({ sourceId: "cnon:card" });
  });

  it("missing @file exits 1 with a clear error", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "create", "--json", "@/nonexistent/body.json"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Cannot read --json file/);
  });

  it("keeps a field value that starts with --", async () => {
    const output: string[] = [];
    const exitCode = await run(
      ["payments", "create", "--note=--hello", "--dry-run", "--json-output"],
      { deps, stdout: (msg) => output.push(msg) },
    );
    expect(exitCode).toBe(0);
    expect(JSON.parse(output[0]!).request).toEqual({ note: "--hello" });
  });

  it("reports a field path conflict clearly", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "create", "--json", '{"a":{"b":1}}', "--a.b.c", "2"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Invalid field path "a\.b\.c".*already a number/);
  });
});

describe("cli integration - environment validation", () => {
  it("rejects a mistyped --env on API calls", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list", "--env", "prod"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Invalid --env "prod"/);
  });

  it("config set rejects a mistyped --env", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["config", "set", "p", "--token", "tok", "--env", "prod"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Invalid --env/);
  });
});

describe("cli integration - config set environment preservation", () => {
  function savedProfile(name: string): { token: string; environment: string } {
    return JSON.parse(fs.readFileSync(tmpConfigPath, "utf8")).profiles[name];
  }

  it("keeps a profile's environment when --env is omitted", async () => {
    await run(["config", "set", "prod", "--token", "t1", "--env", "production"], {
      deps,
      stdout: () => {},
    });
    const exitCode = await run(["config", "set", "prod", "--token", "t2"], {
      deps,
      stdout: () => {},
    });
    expect(exitCode).toBe(0);
    expect(savedProfile("prod")).toEqual({ token: "t2", environment: "production" });
  });

  it("still defaults a new profile to sandbox", async () => {
    await run(["config", "set", "fresh", "--token", "t"], { deps, stdout: () => {} });
    expect(savedProfile("fresh")).toEqual({ token: "t", environment: "sandbox" });
  });
});

describe("cli integration - profile environment override", () => {
  beforeEach(async () => {
    await run(["config", "set", "sbx", "--token", "t1", "--env", "sandbox"], {
      deps,
      stdout: () => {},
    });
    await run(["config", "set", "prod", "--token", "t2", "--env", "production"], {
      deps,
      stdout: () => {},
    });
  });

  /** Records every auth object passed to createClient; the last one is the real call. */
  function capturingAuth() {
    const calls: { token: string; environment: string }[] = [];
    const depsWithAuth = {
      createClient: (auth: any) => {
        calls.push(auth);
        return createMockClient() as any;
      },
    };
    return { calls, deps: depsWithAuth };
  }

  const lastAuth = (calls: { token: string; environment: string }[]) => calls[calls.length - 1];

  it("uses the profile's environment when --env is absent", async () => {
    const spy = capturingAuth();
    const exitCode = await run(["locations", "list", "--profile", "prod"], {
      deps: spy.deps,
      stdout: () => {},
    });
    expect(exitCode).toBe(0);
    expect(lastAuth(spy.calls)).toMatchObject({ token: "t2", environment: "production" });
  });

  it("lets an explicit --env override the profile's environment", async () => {
    const spy = capturingAuth();
    const exitCode = await run(["locations", "list", "--profile", "sbx", "--env", "production"], {
      deps: spy.deps,
      stdout: () => {},
    });
    expect(exitCode).toBe(0);
    expect(lastAuth(spy.calls)).toMatchObject({ token: "t1", environment: "production" });
  });

  it("rejects an invalid --env on a profile instead of ignoring it", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["locations", "list", "--profile", "prod", "--env", "prod"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Invalid --env "prod"/);
  });

  it("does not let SQUARE_ENVIRONMENT redirect a profile", async () => {
    process.env["SQUARE_ENVIRONMENT"] = "production";
    const spy = capturingAuth();
    const exitCode = await run(["locations", "list", "--profile", "sbx"], {
      deps: spy.deps,
      stdout: () => {},
    });
    expect(exitCode).toBe(0);
    expect(lastAuth(spy.calls)).toMatchObject({ environment: "sandbox" });
  });
});

describe("cli integration - version", () => {
  it("--version prints CLI and SDK versions without auth", async () => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
    const output: string[] = [];
    const exitCode = await run(["--version"], { deps, stdout: (msg) => output.push(msg) });
    expect(exitCode).toBe(0);
    expect(output.join("\n")).toMatch(
      /^square-sdk-cli \d+\.\d+\.\d+ \(Square SDK \d+\.\d+\.\d+\)$/,
    );
  });

  it("--version --json-output prints machine-readable versions", async () => {
    const output: string[] = [];
    const exitCode = await run(["--version", "--json-output"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output[0]!);
    expect(parsed.cli).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.sdk).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("root help mentions --version", async () => {
    const output: string[] = [];
    await run(["--help"], { deps, stdout: (msg) => output.push(msg) });
    expect(output.join("\n")).toContain("--version");
  });
});

describe("cli integration - help and unknown commands without auth", () => {
  beforeEach(() => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
  });

  it("no args shows root help, exit 0", async () => {
    const output: string[] = [];
    const exitCode = await run([], { deps, stdout: (msg) => output.push(msg) });
    expect(exitCode).toBe(0);
    expect(output.join("\n")).toMatch(/Namespaces:/);
  });

  it("namespace with no method shows namespace help without a token", async () => {
    const output: string[] = [];
    const errOut: string[] = [];
    const exitCode = await run(["payments"], {
      deps,
      stdout: (msg) => output.push(msg),
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(errOut).toEqual([]);
    expect(output.join("\n")).toMatch(/Namespace: payments/);
  });

  it("nested namespace shows its help with the full path", async () => {
    const output: string[] = [];
    const exitCode = await run(["terminal", "actions"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    const combined = output.join("\n");
    expect(combined).toMatch(/Namespace: terminal actions/);
    expect(combined).toMatch(/terminal actions create/);
  });

  it("nested namespace --help shows namespace help, not root help", async () => {
    const output: string[] = [];
    const exitCode = await run(["terminal", "actions", "--help"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(output.join("\n")).toMatch(/Namespace: terminal actions/);
  });

  it("unknown namespace exits 1 with an error instead of auth failure", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["bogus"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Unknown namespace "bogus"/);
  });

  it("unknown method exits 1 before checking auth", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "nope"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Unknown method "nope"/);
  });

  it("a valid method still requires auth", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/No authentication found/);
  });
});

describe("cli integration - paging limits", () => {
  it("--max-items caps collected results", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "list", "--max-items", "2", "--json-output"], {
      deps,
      stdout: (m) => output.push(m),
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(output[0]!).map((p: any) => p.id)).toEqual(["pay1", "pay2"]);
  });

  it("--max-pages caps streamed results", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "list", "--max-pages", "1", "--stream"], {
      deps,
      stdout: (m) => output.push(m),
    });
    expect(exitCode).toBe(0);
    expect(output.length).toBe(2); // mock pages hold 2 items
  });

  it("rejects a non-positive --max-items", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list", "--max-items", "0"], {
      deps,
      stdout: () => {},
      stderr: (m) => errOut.push(m),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/--max-items must be a positive integer/);
  });
});

describe("cli integration - auto idempotency key", () => {
  it("adds a key to write calls and reports it on stderr", async () => {
    const { deps: d, captured } = capturingCreateDeps();
    const errOut: string[] = [];
    const exitCode = await run(["payments", "create"], {
      deps: d,
      stdout: () => {},
      stderr: (m) => errOut.push(m),
    });
    expect(exitCode).toBe(0);
    expect(captured.request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(errOut.join("\n")).toContain(captured.request.idempotencyKey);
  });

  it("keeps a key the user passed", async () => {
    const { deps: d, captured } = capturingCreateDeps();
    const errOut: string[] = [];
    await run(["payments", "create", "--idempotencyKey", "mine"], {
      deps: d,
      stdout: () => {},
      stderr: (m) => errOut.push(m),
    });
    expect(captured.request.idempotencyKey).toBe("mine");
    expect(errOut).toEqual([]);
  });

  it("does not add a key to read calls", async () => {
    const output: string[] = [];
    await run(["locations", "get", "--locationId", "L1", "--dry-run"], {
      deps,
      stdout: (m) => output.push(m),
    });
    expect(JSON.parse(output.join("\n")).request).toEqual({ locationId: "L1" });
  });
});

describe("cli integration - raw page mode", () => {
  it("prints one page envelope with its cursor", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "list", "--raw-page", "--json-output"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output[0]!);
    expect(parsed.data.map((p: any) => p.id)).toEqual(["pay1", "pay2"]);
    expect(parsed.cursor).toBe("cursor-1");
  });

  it("rejects --raw-page combined with --stream", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list", "--raw-page", "--stream"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/cannot be combined with --stream/);
  });
});

describe("cli integration - verbose", () => {
  it("reports the call and duration on stderr while stdout stays JSON", async () => {
    const output: string[] = [];
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list", "--verbose", "--json-output"], {
      deps,
      stdout: (msg) => output.push(msg),
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(output[0]!)).toHaveLength(3);
    const stderrText = errOut.join("\n");
    expect(stderrText).toMatch(/→ payments list \(sandbox; auth: SQUARE_ACCESS_TOKEN\)/);
    expect(stderrText).toMatch(/← done in \d+ ms/);
  });

  it("counts streamed items", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list", "--verbose", "--stream"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(errOut.join("\n")).toMatch(/← 3 items in \d+ ms/);
  });
});

describe("cli integration - transport flags", () => {
  function capturingClient() {
    const options: unknown[] = [];
    return {
      options,
      deps: {
        createClient: (_auth: any, opts?: unknown) => {
          options.push(opts);
          return createMockClient() as any;
        },
      },
    };
  }

  it("passes --timeout and --retry to the client", async () => {
    const spy = capturingClient();
    const exitCode = await run(["payments", "list", "--timeout", "5", "--retry", "0"], {
      deps: spy.deps,
      stdout: () => {},
    });
    expect(exitCode).toBe(0);
    expect(spy.options.at(-1)).toEqual({ timeoutInSeconds: 5, maxRetries: 0 });
  });

  it("passes no transport options by default", async () => {
    const spy = capturingClient();
    await run(["payments", "list"], { deps: spy.deps, stdout: () => {} });
    expect(spy.options.at(-1)).toEqual({});
  });

  it("rejects an invalid --timeout before checking auth", async () => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list", "--timeout", "soon"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/--timeout must be a positive number/);
    expect(errOut.join("\n")).not.toMatch(/No authentication/);
  });

  it("rejects a negative --retry", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list", "--retry", "-1"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/--retry must be a non-negative integer/);
  });
});

describe("cli integration - typo suggestions", () => {
  it("suggests a namespace", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["paymets"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Unknown namespace "paymets"\. Did you mean "payments"\?/);
  });

  it("suggests a method", async () => {
    const errOut: string[] = [];
    await run(["payments", "lst"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(errOut.join("\n")).toMatch(/Did you mean "list"\?/);
  });
});

describe("cli integration - search", () => {
  beforeEach(() => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
  });

  it("finds namespaces by partial name without auth", async () => {
    const output: string[] = [];
    const exitCode = await run(["search", "paym"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(output).toContain("payments");
  });

  it("finds methods across namespaces", async () => {
    const output: string[] = [];
    await run(["search", "list"], { deps, stdout: (msg) => output.push(msg) });
    expect(output).toContain("payments list");
    expect(output).toContain("terminal actions list");
  });

  it("matches a multi-word path", async () => {
    const output: string[] = [];
    await run(["search", "terminal actions"], { deps, stdout: (msg) => output.push(msg) });
    expect(output[0]).toBe("terminal actions");
  });

  it("reports when nothing matches", async () => {
    const output: string[] = [];
    const exitCode = await run(["search", "zzzzz"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(output.join("\n")).toMatch(/No matches for "zzzzz"/);
  });

  it("requires a term", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["search"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Usage: square search/);
  });

  it("--help explains the command", async () => {
    const output: string[] = [];
    const exitCode = await run(["search", "--help"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(output.join("\n")).toMatch(/square search "terminal actions"/);
  });
});

describe("cli integration - production write confirmation", () => {
  beforeEach(() => {
    process.env["SQUARE_ENVIRONMENT"] = "production";
  });

  it("refuses a write in production when not interactive and no --yes", async () => {
    const { prompter } = fakePrompter({ interactive: false });
    const { deps: d, captured } = capturingCreateDeps(prompter);
    const errOut: string[] = [];
    const exitCode = await run(["payments", "create"], {
      deps: d,
      stdout: () => {},
      stderr: (m) => errOut.push(m),
    });
    expect(exitCode).toBe(1);
    expect(captured.request).toBeUndefined();
    expect(errOut.join("\n")).toMatch(/PRODUCTION.*--yes/);
  });

  it("asks for confirmation interactively and aborts on no", async () => {
    const { prompter, calls } = fakePrompter({ interactive: true, confirm: false });
    const { deps: d, captured } = capturingCreateDeps(prompter);
    const exitCode = await run(["payments", "create"], {
      deps: d,
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(1);
    expect(calls.confirm[0]).toMatch(/payments create.*PRODUCTION/);
    expect(captured.request).toBeUndefined();
  });

  it("runs after an interactive yes", async () => {
    const { prompter } = fakePrompter({ interactive: true, confirm: true });
    const { deps: d, captured } = capturingCreateDeps(prompter);
    const exitCode = await run(["payments", "create"], {
      deps: d,
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(0);
    expect(captured.request).toBeDefined();
  });

  it("--yes skips the prompt", async () => {
    const { prompter, calls } = fakePrompter({ interactive: false });
    const { deps: d, captured } = capturingCreateDeps(prompter);
    const exitCode = await run(["payments", "create", "--yes"], {
      deps: d,
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(0);
    expect(calls.confirm).toEqual([]);
    expect(captured.request).toBeDefined();
  });

  it("read calls in production do not prompt", async () => {
    const { prompter, calls } = fakePrompter({ interactive: false });
    const exitCode = await run(["payments", "list"], {
      deps: { ...deps, prompter },
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(0);
    expect(calls.confirm).toEqual([]);
  });

  it("--dry-run in production does not prompt", async () => {
    const { prompter, calls } = fakePrompter({ interactive: false });
    const exitCode = await run(["payments", "create", "--dry-run"], {
      deps: { ...deps, prompter },
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(0);
    expect(calls.confirm).toEqual([]);
  });
});

describe("cli integration - config set token sources", () => {
  async function savedToken(name: string): Promise<string> {
    return JSON.parse(fs.readFileSync(tmpConfigPath, "utf8")).profiles[name].token;
  }

  it("--token - reads the token from stdin", async () => {
    const { prompter } = fakePrompter({ interactive: false, stdin: "stdin-token\n" });
    const exitCode = await run(["config", "set", "p", "--token", "-"], {
      deps: { ...deps, prompter },
      stdout: () => {},
    });
    expect(exitCode).toBe(0);
    expect(await savedToken("p")).toBe("stdin-token");
  });

  it("prompts for a hidden token when --token is omitted in a terminal", async () => {
    const { prompter, calls } = fakePrompter({ interactive: true, secret: "typed-token" });
    const exitCode = await run(["config", "set", "p"], {
      deps: { ...deps, prompter },
      stdout: () => {},
    });
    expect(exitCode).toBe(0);
    expect(calls.secret.length).toBe(1);
    expect(await savedToken("p")).toBe("typed-token");
  });

  it("errors when --token is omitted and not in a terminal", async () => {
    const { prompter } = fakePrompter({ interactive: false });
    const errOut: string[] = [];
    const exitCode = await run(["config", "set", "p"], {
      deps: { ...deps, prompter },
      stdout: () => {},
      stderr: (m) => errOut.push(m),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/--token -/);
  });

  it("rejects an empty token", async () => {
    const { prompter } = fakePrompter({ interactive: false, stdin: "   \n" });
    const errOut: string[] = [];
    const exitCode = await run(["config", "set", "p", "--token", "-"], {
      deps: { ...deps, prompter },
      stdout: () => {},
      stderr: (m) => errOut.push(m),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/token is empty/);
  });
});

describe("cli integration - config list and remove", () => {
  it("list marks the default and shows each environment", async () => {
    await run(["config", "set", "sandbox", "--token", "t1", "--env", "sandbox"], {
      deps,
      stdout: () => {},
    });
    await run(["config", "set", "prod", "--token", "t2", "--env", "production"], {
      deps,
      stdout: () => {},
    });
    await run(["config", "use", "prod"], { deps, stdout: () => {} });
    const output: string[] = [];
    const exitCode = await run(["config", "list"], { deps, stdout: (m) => output.push(m) });
    expect(exitCode).toBe(0);
    expect(output).toContain("  sandbox  sandbox");
    expect(output).toContain("* prod     production");
    expect(output.join("\n")).toMatch(/\* = default/);
  });

  it("remove deletes the profile and notes when it was the default", async () => {
    await run(["config", "set", "p", "--token", "t"], { deps, stdout: () => {} });
    await run(["config", "use", "p"], { deps, stdout: () => {} });
    const output: string[] = [];
    const exitCode = await run(["config", "remove", "p"], {
      deps,
      stdout: (m) => output.push(m),
    });
    expect(exitCode).toBe(0);
    expect(output.join("\n")).toMatch(/removed.*was the default/);
    const listOut: string[] = [];
    await run(["config", "list"], { deps, stdout: (m) => listOut.push(m) });
    expect(listOut).toEqual(["No profiles configured."]);
  });

  it("remove of an unknown profile exits 1", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["config", "remove", "ghost"], {
      deps,
      stdout: () => {},
      stderr: (m) => errOut.push(m),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/does not exist/);
  });

  it("remove without a name prints usage", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["config", "remove"], {
      deps,
      stdout: () => {},
      stderr: (m) => errOut.push(m),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Usage: square config remove/);
  });
});

describe("cli integration - whoami", () => {
  it("shows merchant, environment, and token source", async () => {
    const output: string[] = [];
    const exitCode = await run(["whoami"], { deps, stdout: (m) => output.push(m) });
    expect(exitCode).toBe(0);
    expect(JSON.parse(output.join("\n"))).toEqual({
      environment: "sandbox",
      tokenSource: "SQUARE_ACCESS_TOKEN",
      merchant: {
        id: "M1",
        businessName: "Test Cafe",
        country: "US",
        currency: "USD",
        status: "ACTIVE",
        mainLocationId: "L1",
      },
    });
  });

  it('asks the SDK for merchant "me"', async () => {
    let requested: unknown;
    const spyDeps = {
      createClient: (_auth: any) => {
        const m = createMockClient() as any;
        const merchants = m.merchants;
        const orig = merchants.get.bind(merchants);
        merchants.get = (req: unknown) => {
          requested = req;
          return orig(req);
        };
        Object.defineProperty(m, "merchants", { get: () => merchants });
        return m;
      },
    };
    await run(["whoami"], { deps: spyDeps, stdout: () => {} });
    expect(requested).toEqual({ merchantId: "me" });
  });

  it("reports the profile as token source", async () => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
    await run(["config", "set", "prod", "--token", "t", "--env", "production"], {
      deps,
      stdout: () => {},
    });
    await run(["config", "use", "prod"], { deps, stdout: () => {} });
    const output: string[] = [];
    await run(["whoami", "--json-output"], { deps, stdout: (m) => output.push(m) });
    expect(output.length).toBe(1);
    const parsed = JSON.parse(output[0]!);
    expect(parsed.environment).toBe("production");
    expect(parsed.tokenSource).toBe('default profile "prod"');
  });

  it("without auth exits 1", async () => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
    const errOut: string[] = [];
    const exitCode = await run(["whoami"], {
      deps,
      stdout: () => {},
      stderr: (m) => errOut.push(m),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/No authentication found/);
  });

  it("--help shows usage without auth", async () => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
    const output: string[] = [];
    const exitCode = await run(["whoami", "--help"], { deps, stdout: (m) => output.push(m) });
    expect(exitCode).toBe(0);
    expect(output.join("\n")).toMatch(/Usage: square whoami/);
  });
});

describe("cli integration - output selection and tables", () => {
  it("--select keeps only the requested fields", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "list", "--select", "id", "--json-output"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(output[0]!)).toEqual([{ id: "pay1" }, { id: "pay2" }, { id: "pay3" }]);
  });

  it("--select applies per line in stream mode", async () => {
    const output: string[] = [];
    await run(["payments", "list", "--select", "id", "--stream"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(output.map((line) => JSON.parse(line))).toEqual([
      { id: "pay1" },
      { id: "pay2" },
      { id: "pay3" },
    ]);
  });

  it("--table renders an aligned table", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "list", "--select", "id", "--table"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(output[0]!.split("\n")).toEqual(["id", "pay1", "pay2", "pay3"]);
  });

  it("--table rejects a non-list result", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["locations", "list", "--table"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/--table requires a list result/);
  });

  it("--table conflicts with --json-output", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list", "--table", "--json-output"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/--table cannot be combined with --json-output/);
  });

  it("rejects an empty --select", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list", "--select", ","], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/at least one field path/);
  });
});

describe("cli integration - output file", () => {
  it("writes the result to a file instead of stdout", async () => {
    const file = path.join(path.dirname(tmpConfigPath), "out.json");
    const exitCode = await run(["payments", "list", "--json-output", "--output", file], {
      deps,
      stdout: () => {
        throw new Error("stdout should not be used");
      },
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toHaveLength(3);
  });

  it("writes NDJSON when streaming", async () => {
    const file = path.join(path.dirname(tmpConfigPath), "out.ndjson");
    const exitCode = await run(["payments", "list", "--stream", "--output", file], {
      deps,
      stdout: () => {},
    });
    expect(exitCode).toBe(0);
    const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!).id).toBe("pay1");
  });
});

describe("cli integration - JSON errors", () => {
  it("emits a JSON error for a bad request body", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "create", "--json", "[]", "--json-output"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    const payload = JSON.parse(errOut[0]!);
    expect(payload.error).toBe("cli");
    expect(payload.message).toMatch(/must be a JSON object/);
  });

  it("emits a JSON error for missing authentication", async () => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list", "--json-output"], {
      deps,
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(JSON.parse(errOut[0]!).message).toMatch(/No authentication found/);
  });
});

describe("cli integration - doctor", () => {
  it("passes all checks against a working setup", async () => {
    const output: string[] = [];
    const exitCode = await run(["doctor"], { deps, stdout: (msg) => output.push(msg) });
    expect(exitCode).toBe(0);
    const text = output.join("\n");
    expect(text).toContain("✓ Runtime");
    expect(text).toContain("✓ Config");
    expect(text).toContain("✓ Auth");
    expect(text).toContain("Test Cafe");
    expect(text).toContain("All checks passed.");
  });

  it("--offline skips the API round-trip", async () => {
    let apiCalled = false;
    const probeDeps = {
      createClient: (auth: any) => {
        if (auth.token !== "dummy") apiCalled = true;
        return createMockClient() as any;
      },
    };
    const output: string[] = [];
    const exitCode = await run(["doctor", "--offline"], {
      deps: probeDeps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    expect(apiCalled).toBe(false);
    expect(output.join("\n")).toContain("skipped (--offline)");
  });

  it("fails when credentials are missing", async () => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
    const output: string[] = [];
    const exitCode = await run(["doctor"], { deps, stdout: (msg) => output.push(msg) });
    expect(exitCode).toBe(1);
    const text = output.join("\n");
    expect(text).toContain("✗ Auth");
    expect(text).toContain("Some checks failed.");
  });

  it("--json-output returns a machine-readable report", async () => {
    const output: string[] = [];
    const exitCode = await run(["doctor", "--json-output"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(0);
    const report = JSON.parse(output[0]!);
    expect(report.ok).toBe(true);
    expect(report.checks.map((check: any) => check.name)).toContain("API");
  });

  it("flags a config file with loose permissions", async () => {
    if (process.platform === "win32") return;
    await run(["config", "set", "p", "--token", "t"], { deps, stdout: () => {} });
    fs.chmodSync(tmpConfigPath, 0o644);
    const output: string[] = [];
    const exitCode = await run(["doctor", "--offline"], {
      deps,
      stdout: (msg) => output.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(output.join("\n")).toContain("should be 0600");
  });
});

describe("cli integration - keychain profiles", () => {
  function fakeKeychain(available = true) {
    const store = new Map<string, string>();
    const deleted: string[] = [];
    return {
      store,
      deleted,
      keychain: {
        available: () => available,
        set: (name: string, token: string) => void store.set(name, token),
        get: (name: string) => store.get(name),
        delete: (name: string) => {
          deleted.push(name);
          store.delete(name);
        },
      },
    };
  }

  async function setKeychainProfile(fake: ReturnType<typeof fakeKeychain>) {
    return run(
      ["config", "set", "prod", "--token", "secret", "--env", "production", "--keychain"],
      { deps: { ...deps, keychain: fake.keychain }, stdout: () => {} },
    );
  }

  it("stores the token in the keychain, not the config file", async () => {
    const fake = fakeKeychain();
    const exitCode = await setKeychainProfile(fake);
    expect(exitCode).toBe(0);
    expect(JSON.parse(fs.readFileSync(tmpConfigPath, "utf8")).profiles.prod).toEqual({
      environment: "production",
      keychain: true,
    });
    expect(fake.store.get("prod")).toBe("secret");
  });

  it("shows the keychain placeholder in config get and list", async () => {
    const fake = fakeKeychain();
    await setKeychainProfile(fake);

    const getOut: string[] = [];
    await run(["config", "get", "prod"], {
      deps: { ...deps, keychain: fake.keychain },
      stdout: (msg) => getOut.push(msg),
    });
    expect(getOut.join("\n")).toContain("(stored in keychain)");
    expect(getOut.join("\n")).not.toContain("secret");

    const listOut: string[] = [];
    await run(["config", "list"], {
      deps: { ...deps, keychain: fake.keychain },
      stdout: (msg) => listOut.push(msg),
    });
    expect(listOut.join("\n")).toContain("(keychain)");
  });

  it("resolves auth from the keychain", async () => {
    const fake = fakeKeychain();
    await setKeychainProfile(fake);
    const seen: any[] = [];
    const exitCode = await run(["locations", "list", "--profile", "prod"], {
      deps: {
        keychain: fake.keychain,
        createClient: (auth: any) => {
          seen.push(auth);
          return createMockClient() as any;
        },
      },
      stdout: () => {},
    });
    expect(exitCode).toBe(0);
    expect(seen.at(-1)).toMatchObject({ token: "secret", environment: "production" });
  });

  it("reports a missing keychain entry", async () => {
    fs.writeFileSync(
      tmpConfigPath,
      JSON.stringify({ profiles: { p: { environment: "sandbox", keychain: true } } }),
    );
    const fake = fakeKeychain();
    const errOut: string[] = [];
    const exitCode = await run(["locations", "list", "--profile", "p"], {
      deps: { ...deps, keychain: fake.keychain },
      stdout: () => {},
      stderr: (msg) => errOut.push(msg),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/no token was found/);
  });

  it("deletes the keychain entry when the profile is removed", async () => {
    const fake = fakeKeychain();
    await setKeychainProfile(fake);
    await run(["config", "remove", "prod"], {
      deps: { ...deps, keychain: fake.keychain },
      stdout: () => {},
    });
    expect(fake.deleted).toContain("prod");
  });

  it("moves back to file storage when re-set without --keychain", async () => {
    const fake = fakeKeychain();
    await setKeychainProfile(fake);
    await run(["config", "set", "prod", "--token", "new"], {
      deps: { ...deps, keychain: fake.keychain },
      stdout: () => {},
    });
    expect(fake.deleted).toContain("prod");
    expect(JSON.parse(fs.readFileSync(tmpConfigPath, "utf8")).profiles.prod).toEqual({
      token: "new",
      environment: "production",
    });
  });

  it("errors when no keychain is available", async () => {
    const fake = fakeKeychain(false);
    const errOut: string[] = [];
    const exitCode = await setKeychainProfileWith(fake, errOut);
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/no supported keychain/);

    async function setKeychainProfileWith(f: ReturnType<typeof fakeKeychain>, errors: string[]) {
      return run(["config", "set", "prod", "--token", "secret", "--keychain"], {
        deps: { ...deps, keychain: f.keychain },
        stdout: () => {},
        stderr: (msg) => errors.push(msg),
      });
    }
  });
});

describe("cli integration - completion", () => {
  beforeEach(() => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
  });

  it("prints a bash completion script without auth", async () => {
    const output: string[] = [];
    const exitCode = await run(["completion", "bash"], { deps, stdout: (m) => output.push(m) });
    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain("complete -F _square square");
  });

  it("supports zsh and fish", async () => {
    for (const shell of ["zsh", "fish"]) {
      const output: string[] = [];
      const exitCode = await run(["completion", shell], { deps, stdout: (m) => output.push(m) });
      expect(exitCode).toBe(0);
      expect(output.join("\n")).toContain("payments");
    }
  });

  it("rejects an unknown shell", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["completion", "powershell"], {
      deps,
      stdout: () => {},
      stderr: (m) => errOut.push(m),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Unknown shell "powershell"/);
  });

  it("requires a shell argument", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["completion"], {
      deps,
      stdout: () => {},
      stderr: (m) => errOut.push(m),
    });
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Usage: square completion/);
  });
});

describe("cli integration - doctor keychain check", () => {
  it("flags an unavailable keychain needed by a profile", async () => {
    fs.writeFileSync(
      tmpConfigPath,
      JSON.stringify({ profiles: { p: { environment: "sandbox", keychain: true } } }),
    );
    const output: string[] = [];
    const exitCode = await run(["doctor", "--offline"], {
      deps: {
        ...deps,
        keychain: {
          available: () => false,
          set: () => {},
          get: () => undefined,
          delete: () => {},
        },
      },
      stdout: (m) => output.push(m),
    });
    expect(exitCode).toBe(1);
    expect(output.join("\n")).toMatch(/✗ Keychain/);
  });
});

describe("cli integration - keychain lookups are scoped", () => {
  it("only reads the profile in use", async () => {
    fs.writeFileSync(
      tmpConfigPath,
      JSON.stringify({
        profiles: {
          a: { environment: "sandbox", keychain: true },
          b: { environment: "sandbox", keychain: true },
        },
      }),
    );
    const asked: string[] = [];
    const keychain = {
      available: () => true,
      set: () => {},
      get: (name: string) => {
        asked.push(name);
        return "tok";
      },
      delete: () => {},
    };
    await run(["locations", "list", "--profile", "b"], {
      deps: { ...deps, keychain },
      stdout: () => {},
    });
    expect(asked).toEqual(["b"]);
  });
});

describe("cli integration - search includes built-in commands", () => {
  it("finds doctor and completion", async () => {
    const output: string[] = [];
    await run(["search", "doctor"], { deps, stdout: (m) => output.push(m) });
    expect(output).toContain("doctor");

    const out2: string[] = [];
    await run(["search", "comp"], { deps, stdout: (m) => out2.push(m) });
    expect(out2).toContain("completion");
  });
});
