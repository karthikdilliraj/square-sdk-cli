/**
 * introspect.ts - Enumerate SDK namespace tree via prototype inspection.
 * No hardcoded namespace or method names.
 */

export interface MethodEntry {
  name: string;
  arity: number;
  fn: (...args: unknown[]) => unknown;
}

export interface NamespaceNode {
  name: string;
  instance: object;
  methods: Map<string, MethodEntry>;
  children: Map<string, NamespaceNode>;
}

const MAX_DEPTH = 6;

/**
 * Walk the prototype chain of `instance` and collect all own property descriptors
 * from the immediate prototype (i.e., Object.getPrototypeOf(instance)).
 * - getter-only (no setter, no value) => sub-namespace
 * - value function => method
 * Skip: constructor, any name starting with "_"
 */
function collectDescriptors(instance: object): PropertyDescriptorMap {
  const proto = Object.getPrototypeOf(instance);
  if (!proto || proto === Object.prototype) return {};
  return Object.getOwnPropertyDescriptors(proto);
}

function shouldSkip(name: string): boolean {
  return name === "constructor" || name.startsWith("_");
}

function buildNode(
  name: string,
  instance: object,
  seen: WeakSet<object>,
  depth: number
): NamespaceNode {
  const node: NamespaceNode = {
    name,
    instance,
    methods: new Map(),
    children: new Map(),
  };

  if (depth >= MAX_DEPTH) return node;
  if (seen.has(instance)) return node;
  seen.add(instance);

  const descriptors = collectDescriptors(instance);

  for (const [propName, descriptor] of Object.entries(descriptors)) {
    if (shouldSkip(propName)) continue;

    const isGetterOnly =
      typeof descriptor.get === "function" &&
      typeof descriptor.set === "undefined" &&
      descriptor.value === undefined;

    if (isGetterOnly) {
      // Invoke getter to get sub-namespace instance (no network call)
      try {
        const childInstance = (instance as Record<string, unknown>)[propName];
        if (childInstance && typeof childInstance === "object") {
          const childNode = buildNode(
            propName,
            childInstance as object,
            seen,
            depth + 1
          );
          node.children.set(propName, childNode);
        }
      } catch {
        // Ignore errors from getter invocation
      }
    } else if (typeof descriptor.value === "function") {
      const rawFn = descriptor.value as (...args: unknown[]) => unknown;
      const capturedInstance = instance;
      const capturedName = propName;
      node.methods.set(propName, {
        name: propName,
        arity: rawFn.length,
        // Dispatch via instance property lookup at call time so own-property
        // overrides (e.g. injected in tests) are respected.
        fn: (...args: unknown[]) =>
          ((capturedInstance as Record<string, unknown>)[capturedName] as (...a: unknown[]) => unknown)(
            ...args
          ),
      });
    }
  }

  return node;
}

/**
 * Build a full tree of namespaces and methods from a SquareClient instance.
 */
export function buildTree(client: object): NamespaceNode {
  const seen = new WeakSet<object>();
  return buildNode("root", client, seen, 0);
}

export type ResolveResult =
  | { node: NamespaceNode; method: MethodEntry }
  | { error: string; validTokens: string[] };

/**
 * Walk the tree following `segments`.
 * All segments except the last navigate into children (namespaces).
 * The last segment resolves a method on the final namespace node.
 */
export function resolvePath(
  tree: NamespaceNode,
  segments: string[]
): ResolveResult {
  if (segments.length === 0) {
    const validTokens = [
      ...tree.children.keys(),
      ...tree.methods.keys(),
    ];
    return { error: "No path provided. Expected: <namespace> <method>", validTokens };
  }

  let current = tree;

  // Navigate namespace segments (all but last)
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const child = current.children.get(seg);
    if (!child) {
      const validTokens = [...current.children.keys()];
      return {
        error: `Unknown namespace "${seg}". Valid options: ${validTokens.join(", ")}`,
        validTokens,
      };
    }
    current = child;
  }

  // Last segment: method name
  const methodName = segments[segments.length - 1]!;
  const method = current.methods.get(methodName);

  if (!method) {
    // Could also be a namespace without method - collect valid tokens
    const validTokens = [
      ...current.methods.keys(),
      ...current.children.keys(),
    ];
    return {
      error: `Unknown method "${methodName}" on namespace "${current.name}". Valid: ${validTokens.join(", ")}`,
      validTokens,
    };
  }

  return { node: current, method };
}
