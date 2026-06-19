import { describe, it, expect } from "bun:test";
import { execute } from "../src/execute";
import { buildTree, resolvePath } from "../src/introspect";
import { createMockClient, MockSquareError } from "./fixtures/mockClient";

function getMethod(namespace: string, methodName: string) {
  const client = createMockClient();
  const tree = buildTree(client);
  const resolved = resolvePath(tree, [namespace, methodName]);
  if ("error" in resolved) throw new Error(`Could not resolve ${namespace}.${methodName}: ${resolved.error}`);
  return resolved.method;
}

function getNestedMethod(segments: string[]) {
  const client = createMockClient();
  const tree = buildTree(client);
  const resolved = resolvePath(tree, segments);
  if ("error" in resolved) throw new Error(`Could not resolve ${segments.join(".")}: ${resolved.error}`);
  return resolved.method;
}

describe("execute - non-pageable", () => {
  it("returns response body for non-pageable method", async () => {
    const method = getMethod("payments", "create");
    const result = await execute(method, { amountMoney: { amount: 100, currency: "USD" } }, {});
    expect(result).toBeDefined();
    expect((result as any).payment).toBeDefined();
  });

  it("returns response body for locations.list (non-pageable non-page return)", async () => {
    const method = getMethod("locations", "list");
    const result = await execute(method, {}, {});
    // locations.list in mock returns plain object, not a Page
    expect(result).toBeDefined();
  });
});

describe("execute - pageable (collect mode)", () => {
  it("collects all pages into flat array by default", async () => {
    const method = getMethod("payments", "list");
    const result = await execute(method, {}, {});
    // mock has 3 items in pages of 2 => 2 pages
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(3);
  });

  it("collects nested pageable (terminal.actions.list)", async () => {
    const method = getNestedMethod(["terminal", "actions", "list"]);
    const result = await execute(method, {}, {});
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(3);
  });
});

describe("execute - stream mode", () => {
  it("in stream mode, yields items as async iterable (collect still works via array)", async () => {
    const method = getMethod("payments", "list");
    const items: unknown[] = [];
    // stream mode returns an async iterable; collect manually
    const gen = execute(method, {}, { stream: true });
    // stream mode: execute returns an AsyncIterable
    for await (const item of gen as any) {
      items.push(item);
    }
    expect(items.length).toBe(3);
  });
});

describe("execute - error propagation", () => {
  it("SquareError thrown by method surfaces from execute", async () => {
    const method = getMethod("payments", "throwingMethod");
    await expect(execute(method, {}, {})).rejects.toBeInstanceOf(MockSquareError);
  });
});

describe("execute - BigInt result from output", () => {
  it("BigInt fields in result can be serialized with replacer", async () => {
    const method = getMethod("payments", "list");
    const result = await execute(method, {}, {}) as any[];
    // result contains BigInt amounts
    const bigIntItem = result.find((r: any) => typeof r.amount_money?.amount === "bigint");
    expect(bigIntItem).toBeDefined();
    // Serialize without throwing
    const json = JSON.stringify(result, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v
    );
    expect(typeof json).toBe("string");
    expect(json).toContain("100");
  });
});
