import { describe, it, expect } from "bun:test";
import { buildRequest, readJsonArg } from "../src/merge";

describe("buildRequest - json only", () => {
  it("parses json string into object", () => {
    const result = buildRequest('{"key":"value"}', []);
    expect(result).toEqual({ key: "value" });
  });

  it("returns empty object when no json and no fields", () => {
    const result = buildRequest(undefined, []);
    expect(result).toEqual({});
  });

  it("throws on bad JSON", () => {
    expect(() => buildRequest("{bad json}", [])).toThrow();
  });

  it("throws with descriptive error on bad JSON", () => {
    try {
      buildRequest("{invalid}", []);
      expect(true).toBe(false); // should not reach
    } catch (e: any) {
      expect(e.message).toMatch(/JSON/i);
    }
  });
});

describe("buildRequest - fields only", () => {
  it("sets simple key from field", () => {
    const result = buildRequest(undefined, [{ path: "key", value: "hello" }]);
    expect(result).toEqual({ key: "hello" });
  });

  it("creates nested path from dotted field", () => {
    const result = buildRequest(undefined, [{ path: "amountMoney.amount", value: "100" }]);
    expect(result).toEqual({ amountMoney: { amount: 100 } });
  });

  it("numeric segment creates array index", () => {
    const result = buildRequest(undefined, [{ path: "ids.0", value: "abc" }]);
    expect(Array.isArray((result as any).ids)).toBe(true);
    expect((result as any).ids[0]).toBe("abc");
  });

  it("coerces true value to boolean", () => {
    const result = buildRequest(undefined, [{ path: "flag", value: "true" }]);
    expect((result as any).flag).toBe(true);
  });

  it("coerces numeric string to number", () => {
    const result = buildRequest(undefined, [{ path: "amount", value: "42" }]);
    expect((result as any).amount).toBe(42);
  });

  it("coerces JSON object string to object", () => {
    const result = buildRequest(undefined, [{ path: "meta", value: '{"a":1}' }]);
    expect((result as any).meta).toEqual({ a: 1 });
  });

  it("falls back to raw string when not valid JSON", () => {
    const result = buildRequest(undefined, [{ path: "name", value: "John Doe" }]);
    expect((result as any).name).toBe("John Doe");
  });
});

describe("buildRequest - deep merge (fields override json)", () => {
  it("fields override json values at same path", () => {
    const result = buildRequest('{"amount":50}', [{ path: "amount", value: "100" }]);
    expect((result as any).amount).toBe(100);
  });

  it("fields deep-merge with json (non-conflicting keys preserved)", () => {
    const result = buildRequest('{"amountMoney":{"currency":"USD"}}', [
      { path: "amountMoney.amount", value: "100" },
    ]);
    expect((result as any).amountMoney.currency).toBe("USD");
    expect((result as any).amountMoney.amount).toBe(100);
  });

  it("creates nested structures not in json", () => {
    const result = buildRequest('{"existing":"value"}', [
      { path: "new.nested.key", value: "deep" },
    ]);
    expect((result as any).existing).toBe("value");
    expect((result as any).new.nested.key).toBe("deep");
  });
});

describe("buildRequest - validation and string escape", () => {
  it("rejects a JSON array body", () => {
    expect(() => buildRequest("[1,2]", [])).toThrow(/must be a JSON object/);
  });

  it("rejects a JSON string body", () => {
    expect(() => buildRequest('"x"', [])).toThrow(/must be a JSON object/);
  });

  it(":str suffix keeps numeric-looking value as string", () => {
    const result = buildRequest(undefined, [{ path: "address.postalCode:str", value: "94103" }]);
    expect(result).toEqual({ address: { postalCode: "94103" } });
  });
});

describe("readJsonArg", () => {
  const fake = (source: string | 0) => (source === 0 ? "STDIN" : `FILE:${source}`);

  it("returns inline JSON unchanged", () => {
    expect(readJsonArg('{"a":1}', fake)).toBe('{"a":1}');
  });

  it("reads stdin for -", () => {
    expect(readJsonArg("-", fake)).toBe("STDIN");
  });

  it("reads a file for @path", () => {
    expect(readJsonArg("@body.json", fake)).toBe("FILE:body.json");
  });

  it("wraps file read errors with the path", () => {
    const failing = () => {
      throw new Error("ENOENT");
    };
    expect(() => readJsonArg("@missing.json", failing)).toThrow(/missing\.json.*ENOENT/);
  });
});
