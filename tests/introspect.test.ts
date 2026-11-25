import { describe, expect, it } from "bun:test";
import {
  bindMethod,
  buildTree,
  isReadOnlyMethod,
  resolvePath,
  searchTree,
  suggestToken,
} from "../src/introspect";
import { createMockClient } from "./fixtures/mockClient";

describe("introspect - buildTree", () => {
  it("finds top-level getters as namespaces", () => {
    const client = createMockClient();
    const tree = buildTree(client);
    expect(tree.children.has("payments")).toBe(true);
    expect(tree.children.has("locations")).toBe(true);
    expect(tree.children.has("terminal")).toBe(true);
  });

  it("excludes constructor from tree", () => {
    const client = createMockClient();
    const tree = buildTree(client);
    expect(tree.children.has("constructor")).toBe(false);
    expect(tree.methods.has("constructor")).toBe(false);
  });

  it("excludes members starting with _ or __", () => {
    const client = createMockClient();
    const tree = buildTree(client);
    // top-level private members
    expect(tree.children.has("_privateMethod")).toBe(false);
    expect(tree.methods.has("_privateMethod")).toBe(false);
    expect(tree.children.has("__doThing")).toBe(false);
    expect(tree.methods.has("__doThing")).toBe(false);
    // nested private members in payments
    const paymentsNode = tree.children.get("payments")!;
    expect(paymentsNode.methods.has("__list")).toBe(false);
    expect(paymentsNode.methods.has("__create")).toBe(false);
  });

  it("recurses into nested namespaces (terminal.actions)", () => {
    const client = createMockClient();
    const tree = buildTree(client);
    const terminalNode = tree.children.get("terminal")!;
    expect(terminalNode).toBeDefined();
    expect(terminalNode.children.has("actions")).toBe(true);
    const actionsNode = terminalNode.children.get("actions")!;
    expect(actionsNode.methods.has("list")).toBe(true);
    expect(actionsNode.methods.has("create")).toBe(true);
  });

  it("excludes __ prefix methods in nested clients", () => {
    const client = createMockClient();
    const tree = buildTree(client);
    const actionsNode = tree.children.get("terminal")!.children.get("actions")!;
    expect(actionsNode.methods.has("__list")).toBe(false);
  });

  it("excludes _ prefix methods in nested clients", () => {
    const client = createMockClient();
    const tree = buildTree(client);
    const terminalNode = tree.children.get("terminal")!;
    expect(terminalNode.methods.has("_internalHelper")).toBe(false);
  });

  it("records arity for list (0) and create (1) in payments", () => {
    const client = createMockClient();
    const tree = buildTree(client);
    const paymentsNode = tree.children.get("payments")!;
    expect(paymentsNode.methods.has("list")).toBe(true);
    expect(paymentsNode.methods.has("create")).toBe(true);
    // arity recorded from fn.length
    const listArity = paymentsNode.methods.get("list")!.arity;
    const createArity = paymentsNode.methods.get("create")!.arity;
    expect(typeof listArity).toBe("number");
    expect(typeof createArity).toBe("number");
  });

  it("namespace nodes have an instance property", () => {
    const client = createMockClient();
    const tree = buildTree(client);
    const paymentsNode = tree.children.get("payments")!;
    expect(paymentsNode.instance).toBeDefined();
  });
});

describe("introspect - resolvePath", () => {
  it("resolves a valid top-level namespace + method", () => {
    const client = createMockClient();
    const tree = buildTree(client);
    const result = resolvePath(tree, ["payments", "list"]);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(typeof result.method.fn).toBe("function");
      expect(result.method.name).toBe("list");
    }
  });

  it("resolves a nested path (terminal actions list)", () => {
    const client = createMockClient();
    const tree = buildTree(client);
    const result = resolvePath(tree, ["terminal", "actions", "list"]);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.method.name).toBe("list");
    }
  });

  it("returns error + validTokens for invalid namespace", () => {
    const client = createMockClient();
    const tree = buildTree(client);
    const result = resolvePath(tree, ["nonexistent", "list"]);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(Array.isArray(result.validTokens)).toBe(true);
      expect(result.validTokens.length).toBeGreaterThan(0);
    }
  });

  it("returns error + validTokens for invalid method", () => {
    const client = createMockClient();
    const tree = buildTree(client);
    const result = resolvePath(tree, ["payments", "nonexistentMethod"]);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(Array.isArray(result.validTokens)).toBe(true);
    }
  });

  it("returns error for empty path", () => {
    const client = createMockClient();
    const tree = buildTree(client);
    const result = resolvePath(tree, []);
    expect("error" in result).toBe(true);
  });
});

describe("isReadOnlyMethod", () => {
  for (const name of [
    "get",
    "list",
    "listEntries",
    "search",
    "searchItems",
    "retrieveJob",
    "batchGet",
    "bulkRetrieveCustomers",
    "calculate",
    "v1ListOrders",
  ]) {
    it(`${name} is read-only`, () => expect(isReadOnlyMethod(name)).toBe(true));
  }
  for (const name of [
    "create",
    "update",
    "delete",
    "cancel",
    "refundPayment",
    "batchUpsert",
    "bulkDeleteCustomers",
    "complete",
    "fetch",
  ]) {
    it(`${name} is a write`, () => expect(isReadOnlyMethod(name)).toBe(false));
  }
});

describe("suggestToken", () => {
  const candidates = ["payments", "locations", "terminal", "list", "create"];

  it("suggests the closest namespace for a typo", () => {
    expect(suggestToken("paymets", candidates)).toBe("payments");
  });

  it("suggests a prefix match", () => {
    expect(suggestToken("paym", candidates)).toBe("payments");
  });

  it("suggests for a one-letter omission", () => {
    expect(suggestToken("lst", candidates)).toBe("list");
  });

  it("returns undefined when nothing is close", () => {
    expect(suggestToken("zzzzz", candidates)).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(suggestToken("PAYMETS", candidates)).toBe("payments");
  });
});

describe("did-you-mean in resolvePath", () => {
  it("suggests a namespace", () => {
    const result = resolvePath(buildTree(createMockClient()), ["paymets"]);
    expect("error" in result && result.error).toMatch(/Did you mean "payments"\?/);
  });

  it("suggests a method", () => {
    const result = resolvePath(buildTree(createMockClient()), ["payments", "lst"]);
    expect("error" in result && result.error).toMatch(/Did you mean "list"\?/);
  });

  it("keeps the full list when there is no close match", () => {
    const result = resolvePath(buildTree(createMockClient()), ["zzzzz"]);
    expect("error" in result && result.error).toMatch(/Valid options:/);
  });
});

describe("bindMethod", () => {
  it("binds a top-level namespace method", async () => {
    const method = bindMethod(createMockClient(), ["payments"], "list")!;
    const page = (await method.fn({})) as any;
    expect(page.data.map((p: any) => p.id)).toEqual(["pay1", "pay2"]);
  });

  it("binds a nested namespace method", async () => {
    const method = bindMethod(createMockClient(), ["terminal", "actions"], "create")!;
    const result = (await method.fn({})) as any;
    expect(result.action.id).toBe("new-action");
  });

  it("binds `this` so methods can use instance state", async () => {
    const method = bindMethod(createMockClient(), ["payments"], "list")!;
    const page = (await method.fn({})) as any;
    // `_items` is instance state; a lost `this` would throw or be empty.
    expect(page.data).toHaveLength(2);
    expect(page.hasNextPage()).toBe(true);
  });

  it("returns undefined for an unknown namespace", () => {
    expect(bindMethod(createMockClient(), ["nope"], "list")).toBeUndefined();
  });

  it("returns undefined for an unknown method", () => {
    expect(bindMethod(createMockClient(), ["payments"], "nope")).toBeUndefined();
  });
});

describe("searchTree", () => {
  const tree = buildTree(createMockClient());

  it("finds a namespace by partial name", () => {
    const matches = searchTree(tree, "paym");
    expect(matches).toContainEqual({ path: "payments", kind: "namespace" });
  });

  it("finds methods across namespaces", () => {
    const paths = searchTree(tree, "list").map((m) => m.path);
    expect(paths).toContain("payments list");
    expect(paths).toContain("locations list");
    expect(paths).toContain("terminal actions list");
  });

  it("matches multi-word terms against the path", () => {
    const matches = searchTree(tree, "terminal actions");
    expect(matches).toContainEqual({ path: "terminal actions", kind: "namespace" });
    expect(matches.every((m) => m.path.includes("terminal"))).toBe(true);
  });

  it("returns nothing for an unknown term", () => {
    expect(searchTree(tree, "zzzzz")).toEqual([]);
  });

  it("honors the limit", () => {
    expect(searchTree(tree, "list", 1).length).toBe(1);
  });

  it("ranks an exact name first", () => {
    expect(searchTree(tree, "list")[0]?.path.split(" ").pop()).toBe("list");
  });
});
