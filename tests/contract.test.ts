/**
 * contract.test.ts - Guards the SDK conventions the CLI relies on.
 *
 * The CLI is version-agnostic: it introspects the real `square` package at
 * runtime instead of hardcoding namespaces/methods. That only holds while the
 * SDK keeps the structural conventions asserted below. If a future
 * `bun update square` changes any of them, these tests go RED and point at
 * exactly what introspect.ts / client.ts / output.ts must be updated for.
 *
 * Verified against square@40–44.
 */

import { test, expect, describe } from "bun:test";
import * as squarePkg from "square";
import { SquareClient, SquareEnvironment, SquareError } from "square";
import { buildTree, resolvePath } from "../src/introspect.ts";

describe("Square SDK contract (relied on by introspection)", () => {
  test("exports SquareClient, SquareEnvironment, SquareError", () => {
    expect(typeof SquareClient).toBe("function");
    expect(squarePkg.SquareEnvironment).toBeDefined();
    expect(typeof SquareError).toBe("function");
  });

  test("SquareEnvironment has Sandbox + Production", () => {
    expect(SquareEnvironment.Sandbox).toBeDefined();
    expect(SquareEnvironment.Production).toBeDefined();
  });

  test("constructs with { token, environment } option keys", () => {
    const c = new SquareClient({
      token: "dummy",
      environment: SquareEnvironment.Sandbox,
    });
    expect(c).toBeInstanceOf(SquareClient);
  });

  test("namespaces are lazy getters on the prototype (no network on access)", () => {
    const c = new SquareClient({ token: "dummy", environment: SquareEnvironment.Sandbox });
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c), "payments");
    expect(desc).toBeDefined();
    expect(typeof desc!.get).toBe("function"); // getter, not a data field
    expect((c as any).payments).toBeDefined();
  });

  test("introspection discovers known top-level namespaces", () => {
    const c = new SquareClient({ token: "dummy", environment: SquareEnvironment.Sandbox });
    const tree = buildTree(c);
    for (const ns of ["payments", "customers", "catalog", "orders", "terminal"]) {
      expect(tree.children.has(ns)).toBe(true);
    }
  });

  test("__-prefixed internal duplicates are filtered out", () => {
    const c = new SquareClient({ token: "dummy", environment: SquareEnvironment.Sandbox });
    const tree = buildTree(c);
    const payments = tree.children.get("payments")!;
    expect(payments.methods.has("create")).toBe(true);
    expect(payments.methods.has("__create")).toBe(false);
    for (const name of payments.methods.keys()) {
      expect(name.startsWith("_")).toBe(false);
    }
  });

  test("nested namespaces resolve (e.g. terminal actions create)", () => {
    const c = new SquareClient({ token: "dummy", environment: SquareEnvironment.Sandbox });
    const tree = buildTree(c);
    const result = resolvePath(tree, ["terminal", "actions", "create"]);
    expect("error" in result).toBe(false);
  });

  test("methods are functions taking (request, requestOptions?)", () => {
    const c = new SquareClient({ token: "dummy", environment: SquareEnvironment.Sandbox });
    const tree = buildTree(c);
    const create = tree.children.get("payments")!.methods.get("create")!;
    expect(typeof create.fn).toBe("function");
    expect(create.arity).toBeLessThanOrEqual(2);
  });
});
