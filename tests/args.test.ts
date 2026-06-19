import { describe, it, expect } from "bun:test";
import { parseArgs } from "../src/args";

describe("parseArgs - positionals", () => {
  it("captures bare positional tokens", () => {
    const result = parseArgs(["payments", "list"]);
    expect(result.positionals).toEqual(["payments", "list"]);
  });

  it("empty argv gives empty positionals and no flags", () => {
    const result = parseArgs([]);
    expect(result.positionals).toEqual([]);
    expect(result.fields).toEqual([]);
  });
});

describe("parseArgs - reserved global flags", () => {
  it("--profile is isolated as flag", () => {
    const result = parseArgs(["payments", "list", "--profile", "prod"]);
    expect(result.flags.profile).toBe("prod");
    expect(result.positionals).toEqual(["payments", "list"]);
  });

  it("--token is isolated as flag", () => {
    const result = parseArgs(["payments", "list", "--token", "mytoken"]);
    expect(result.flags.token).toBe("mytoken");
  });

  it("--env is isolated as flag", () => {
    const result = parseArgs(["payments", "list", "--env", "production"]);
    expect(result.flags.env).toBe("production");
  });

  it("--json is isolated as flag (bare bool)", () => {
    const result = parseArgs(["payments", "create", "--json", "{}"]);
    expect(result.flags.json).toBe("{}");
  });

  it("--help bare flag becomes true", () => {
    const result = parseArgs(["--help"]);
    expect(result.flags.help).toBe(true);
    expect(result.positionals).toEqual([]);
  });

  it("--json-output bare flag becomes true", () => {
    const result = parseArgs(["payments", "list", "--json-output"]);
    expect(result.flags.jsonOutput).toBe(true);
  });

  it("--stream bare flag becomes true", () => {
    const result = parseArgs(["payments", "list", "--stream"]);
    expect(result.flags.stream).toBe(true);
  });
});

describe("parseArgs - field flags", () => {
  it("--field.path value form", () => {
    const result = parseArgs(["payments", "create", "--amountMoney.amount", "100"]);
    expect(result.fields).toContainEqual({ path: "amountMoney.amount", value: "100" });
  });

  it("--field.path=value form", () => {
    const result = parseArgs(["payments", "create", "--amountMoney.amount=100"]);
    expect(result.fields).toContainEqual({ path: "amountMoney.amount", value: "100" });
  });

  it("repeated path creates array of values", () => {
    const result = parseArgs(["--ids", "a", "--ids", "b"]);
    // repeated key => array entries
    const idFields = result.fields.filter((f) => f.path === "ids");
    expect(idFields.length).toBe(2);
    expect(idFields.map((f) => f.value)).toEqual(["a", "b"]);
  });

  it("bare flag (no value following) becomes string 'true'... but reserved booleans are true", () => {
    // Non-reserved dotted flag with no value: treat next non-flag token as value
    const result = parseArgs(["payments", "list", "--cursor=abc"]);
    expect(result.fields).toContainEqual({ path: "cursor", value: "abc" });
  });

  it("fields and positionals coexist", () => {
    const result = parseArgs(["payments", "create", "--amountMoney.amount", "500", "--currency", "USD"]);
    expect(result.positionals).toEqual(["payments", "create"]);
    expect(result.fields).toContainEqual({ path: "amountMoney.amount", value: "500" });
    expect(result.fields).toContainEqual({ path: "currency", value: "USD" });
  });
});

describe("parseArgs - mixed", () => {
  it("all together: positionals + reserved flags + fields", () => {
    const result = parseArgs([
      "payments",
      "create",
      "--profile",
      "sandbox",
      "--amountMoney.amount",
      "100",
      "--json-output",
    ]);
    expect(result.positionals).toEqual(["payments", "create"]);
    expect(result.flags.profile).toBe("sandbox");
    expect(result.flags.jsonOutput).toBe(true);
    expect(result.fields).toContainEqual({ path: "amountMoney.amount", value: "100" });
  });
});
