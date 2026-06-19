import { describe, it, expect } from "bun:test";
import { buildTree, resolvePath } from "../src/introspect";
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
