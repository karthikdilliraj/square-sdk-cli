import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { run } from "../src/cli";
import { createMockClient } from "./fixtures/mockClient";
import type { Prompter } from "../src/prompt";

function fakePrompter(opts: { interactive: boolean; confirm?: boolean; secret?: string; stdin?: string }) {
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
    readStdin: () => opts.stdin ?? "",
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

describe("cli integration - output modes", () => {
  it("--json-output prints compact JSON", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "list", "--json-output"], deps, (msg) => output.push(msg));
    expect(exitCode).toBe(0);
    expect(output.length).toBe(1);
    expect(output[0]).not.toContain("\n");
    expect(JSON.parse(output[0]!)).toHaveLength(3);
  });

  it("--stream prints one compact JSON object per line", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "list", "--stream"], deps, (msg) => output.push(msg));
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
    const exitCode = await run(
      ["payments", "create", "--amountMoney.amount", "100", "--dry-run"],
      spyDeps,
      (msg) => output.push(msg)
    );
    expect(exitCode).toBe(0);
    expect(called).toBe(false);
    const printed = JSON.parse(output.join("\n"));
    expect(printed).toEqual({
      dryRun: true,
      environment: "sandbox",
      method: "payments create",
      request: { amountMoney: { amount: 100 }, idempotencyKey: expect.any(String) },
    });
  });
});

describe("cli integration - --json sources", () => {
  it("reads the request body from @file", async () => {
    const bodyPath = path.join(path.dirname(tmpConfigPath), "body.json");
    fs.writeFileSync(bodyPath, '{"sourceId":"cnon:card"}');
    const output: string[] = [];
    const exitCode = await run(
      ["payments", "create", "--json", `@${bodyPath}`, "--dry-run"],
      deps,
      (msg) => output.push(msg)
    );
    expect(exitCode).toBe(0);
    expect(JSON.parse(output.join("\n")).request).toMatchObject({ sourceId: "cnon:card" });
  });

  it("missing @file exits 1 with a clear error", async () => {
    const errOut: string[] = [];
    const exitCode = await run(
      ["payments", "create", "--json", "@/nonexistent/body.json"],
      deps,
      () => {},
      (msg) => errOut.push(msg)
    );
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Cannot read --json file/);
  });
});

describe("cli integration - environment validation", () => {
  it("rejects a mistyped --env on API calls", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list", "--env", "prod"], deps, () => {}, (msg) => errOut.push(msg));
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Invalid --env "prod"/);
  });

  it("config set rejects a mistyped --env", async () => {
    const errOut: string[] = [];
    const exitCode = await run(
      ["config", "set", "p", "--token", "tok", "--env", "prod"],
      deps,
      () => {},
      (msg) => errOut.push(msg)
    );
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Invalid --env/);
  });
});

describe("cli integration - help and unknown commands without auth", () => {
  beforeEach(() => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
  });

  it("no args shows root help, exit 0", async () => {
    const output: string[] = [];
    const exitCode = await run([], deps, (msg) => output.push(msg));
    expect(exitCode).toBe(0);
    expect(output.join("\n")).toMatch(/Namespaces:/);
  });

  it("namespace with no method shows namespace help without a token", async () => {
    const output: string[] = [];
    const errOut: string[] = [];
    const exitCode = await run(["payments"], deps, (msg) => output.push(msg), (msg) => errOut.push(msg));
    expect(exitCode).toBe(0);
    expect(errOut).toEqual([]);
    expect(output.join("\n")).toMatch(/Namespace: payments/);
  });

  it("nested namespace shows its help with the full path", async () => {
    const output: string[] = [];
    const exitCode = await run(["terminal", "actions"], deps, (msg) => output.push(msg));
    expect(exitCode).toBe(0);
    const combined = output.join("\n");
    expect(combined).toMatch(/Namespace: terminal actions/);
    expect(combined).toMatch(/terminal actions create/);
  });

  it("nested namespace --help shows namespace help, not root help", async () => {
    const output: string[] = [];
    const exitCode = await run(["terminal", "actions", "--help"], deps, (msg) => output.push(msg));
    expect(exitCode).toBe(0);
    expect(output.join("\n")).toMatch(/Namespace: terminal actions/);
  });

  it("unknown namespace exits 1 with an error instead of auth failure", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["bogus"], deps, () => {}, (msg) => errOut.push(msg));
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Unknown namespace "bogus"/);
  });

  it("unknown method exits 1 before checking auth", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "nope"], deps, () => {}, (msg) => errOut.push(msg));
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Unknown method "nope"/);
  });

  it("a valid method still requires auth", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list"], deps, () => {}, (msg) => errOut.push(msg));
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/No authentication found/);
  });
});

describe("cli integration - paging limits", () => {
  it("--max-items caps collected results", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "list", "--max-items", "2", "--json-output"], deps, (m) => output.push(m));
    expect(exitCode).toBe(0);
    expect(JSON.parse(output[0]!).map((p: any) => p.id)).toEqual(["pay1", "pay2"]);
  });

  it("--max-pages caps streamed results", async () => {
    const output: string[] = [];
    const exitCode = await run(["payments", "list", "--max-pages", "1", "--stream"], deps, (m) => output.push(m));
    expect(exitCode).toBe(0);
    expect(output.length).toBe(2); // mock pages hold 2 items
  });

  it("rejects a non-positive --max-items", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["payments", "list", "--max-items", "0"], deps, () => {}, (m) => errOut.push(m));
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/--max-items must be a positive integer/);
  });
});

describe("cli integration - auto idempotency key", () => {
  it("adds a key to write calls and reports it on stderr", async () => {
    const { deps: d, captured } = capturingCreateDeps();
    const errOut: string[] = [];
    const exitCode = await run(["payments", "create"], d, () => {}, (m) => errOut.push(m));
    expect(exitCode).toBe(0);
    expect(captured.request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(errOut.join("\n")).toContain(captured.request.idempotencyKey);
  });

  it("keeps a key the user passed", async () => {
    const { deps: d, captured } = capturingCreateDeps();
    const errOut: string[] = [];
    await run(["payments", "create", "--idempotencyKey", "mine"], d, () => {}, (m) => errOut.push(m));
    expect(captured.request.idempotencyKey).toBe("mine");
    expect(errOut).toEqual([]);
  });

  it("does not add a key to read calls", async () => {
    const output: string[] = [];
    await run(["locations", "get", "--locationId", "L1", "--dry-run"], deps, (m) => output.push(m));
    expect(JSON.parse(output.join("\n")).request).toEqual({ locationId: "L1" });
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
    const exitCode = await run(["payments", "create"], d, () => {}, (m) => errOut.push(m));
    expect(exitCode).toBe(1);
    expect(captured.request).toBeUndefined();
    expect(errOut.join("\n")).toMatch(/PRODUCTION.*--yes/);
  });

  it("asks for confirmation interactively and aborts on no", async () => {
    const { prompter, calls } = fakePrompter({ interactive: true, confirm: false });
    const { deps: d, captured } = capturingCreateDeps(prompter);
    const exitCode = await run(["payments", "create"], d, () => {}, () => {});
    expect(exitCode).toBe(1);
    expect(calls.confirm[0]).toMatch(/payments create.*PRODUCTION/);
    expect(captured.request).toBeUndefined();
  });

  it("runs after an interactive yes", async () => {
    const { prompter } = fakePrompter({ interactive: true, confirm: true });
    const { deps: d, captured } = capturingCreateDeps(prompter);
    const exitCode = await run(["payments", "create"], d, () => {}, () => {});
    expect(exitCode).toBe(0);
    expect(captured.request).toBeDefined();
  });

  it("--yes skips the prompt", async () => {
    const { prompter, calls } = fakePrompter({ interactive: false });
    const { deps: d, captured } = capturingCreateDeps(prompter);
    const exitCode = await run(["payments", "create", "--yes"], d, () => {}, () => {});
    expect(exitCode).toBe(0);
    expect(calls.confirm).toEqual([]);
    expect(captured.request).toBeDefined();
  });

  it("read calls in production do not prompt", async () => {
    const { prompter, calls } = fakePrompter({ interactive: false });
    const exitCode = await run(["payments", "list"], { ...deps, prompter }, () => {}, () => {});
    expect(exitCode).toBe(0);
    expect(calls.confirm).toEqual([]);
  });

  it("--dry-run in production does not prompt", async () => {
    const { prompter, calls } = fakePrompter({ interactive: false });
    const exitCode = await run(["payments", "create", "--dry-run"], { ...deps, prompter }, () => {}, () => {});
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
    const exitCode = await run(["config", "set", "p", "--token", "-"], { ...deps, prompter }, () => {});
    expect(exitCode).toBe(0);
    expect(await savedToken("p")).toBe("stdin-token");
  });

  it("prompts for a hidden token when --token is omitted in a terminal", async () => {
    const { prompter, calls } = fakePrompter({ interactive: true, secret: "typed-token" });
    const exitCode = await run(["config", "set", "p"], { ...deps, prompter }, () => {});
    expect(exitCode).toBe(0);
    expect(calls.secret.length).toBe(1);
    expect(await savedToken("p")).toBe("typed-token");
  });

  it("errors when --token is omitted and not in a terminal", async () => {
    const { prompter } = fakePrompter({ interactive: false });
    const errOut: string[] = [];
    const exitCode = await run(["config", "set", "p"], { ...deps, prompter }, () => {}, (m) => errOut.push(m));
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/--token -/);
  });

  it("rejects an empty token", async () => {
    const { prompter } = fakePrompter({ interactive: false, stdin: "   \n" });
    const errOut: string[] = [];
    const exitCode = await run(["config", "set", "p", "--token", "-"], { ...deps, prompter }, () => {}, (m) => errOut.push(m));
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/token is empty/);
  });
});

describe("cli integration - config list and remove", () => {
  it("list marks the default and shows each environment", async () => {
    await run(["config", "set", "sandbox", "--token", "t1", "--env", "sandbox"], deps, () => {});
    await run(["config", "set", "prod", "--token", "t2", "--env", "production"], deps, () => {});
    await run(["config", "use", "prod"], deps, () => {});
    const output: string[] = [];
    const exitCode = await run(["config", "list"], deps, (m) => output.push(m));
    expect(exitCode).toBe(0);
    expect(output).toContain("  sandbox  sandbox");
    expect(output).toContain("* prod     production");
    expect(output.join("\n")).toMatch(/\* = default/);
  });

  it("remove deletes the profile and notes when it was the default", async () => {
    await run(["config", "set", "p", "--token", "t"], deps, () => {});
    await run(["config", "use", "p"], deps, () => {});
    const output: string[] = [];
    const exitCode = await run(["config", "remove", "p"], deps, (m) => output.push(m));
    expect(exitCode).toBe(0);
    expect(output.join("\n")).toMatch(/removed.*was the default/);
    const listOut: string[] = [];
    await run(["config", "list"], deps, (m) => listOut.push(m));
    expect(listOut).toEqual(["No profiles configured."]);
  });

  it("remove of an unknown profile exits 1", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["config", "remove", "ghost"], deps, () => {}, (m) => errOut.push(m));
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/does not exist/);
  });

  it("remove without a name prints usage", async () => {
    const errOut: string[] = [];
    const exitCode = await run(["config", "remove"], deps, () => {}, (m) => errOut.push(m));
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/Usage: square config remove/);
  });
});

describe("cli integration - whoami", () => {
  it("shows merchant, environment, and token source", async () => {
    const output: string[] = [];
    const exitCode = await run(["whoami"], deps, (m) => output.push(m));
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

  it("asks the SDK for merchant \"me\"", async () => {
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
    await run(["whoami"], spyDeps, () => {});
    expect(requested).toEqual({ merchantId: "me" });
  });

  it("reports the profile as token source", async () => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
    await run(["config", "set", "prod", "--token", "t", "--env", "production"], deps, () => {});
    await run(["config", "use", "prod"], deps, () => {});
    const output: string[] = [];
    await run(["whoami", "--json-output"], deps, (m) => output.push(m));
    expect(output.length).toBe(1);
    const parsed = JSON.parse(output[0]!);
    expect(parsed.environment).toBe("production");
    expect(parsed.tokenSource).toBe('default profile "prod"');
  });

  it("without auth exits 1", async () => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
    const errOut: string[] = [];
    const exitCode = await run(["whoami"], deps, () => {}, (m) => errOut.push(m));
    expect(exitCode).toBe(1);
    expect(errOut.join("\n")).toMatch(/No authentication found/);
  });

  it("--help shows usage without auth", async () => {
    delete process.env["SQUARE_ACCESS_TOKEN"];
    const output: string[] = [];
    const exitCode = await run(["whoami", "--help"], deps, (m) => output.push(m));
    expect(exitCode).toBe(0);
    expect(output.join("\n")).toMatch(/Usage: square whoami/);
  });
});
