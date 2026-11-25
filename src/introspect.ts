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
  depth: number,
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
          const childNode = buildNode(propName, childInstance as object, seen, depth + 1);
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
          (
            (capturedInstance as Record<string, unknown>)[capturedName] as (
              ...a: unknown[]
            ) => unknown
          )(...args),
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

/**
 * Walk the tree following `segments`, treating every segment as a namespace.
 * Returns the final namespace node, or undefined if any segment is not one.
 */
export function findNamespace(tree: NamespaceNode, segments: string[]): NamespaceNode | undefined {
  let current = tree;
  for (const seg of segments) {
    const child = current.children.get(seg);
    if (!child) return undefined;
    current = child;
  }
  return current;
}

export type ResolveResult =
  | { node: NamespaceNode; method: MethodEntry }
  | { error: string; validTokens: string[] };

/** Levenshtein distance between two strings. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j]!;
      row[j] = Math.min(
        previous + 1, // deletion
        row[j - 1]! + 1, // insertion
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1), // substitution
      );
      diagonal = previous;
    }
  }
  return row[b.length]!;
}

/**
 * Best "did you mean" candidate for a mistyped token: a prefix of it, or a
 * close edit distance. Ties resolve alphabetically so output is stable.
 */
export function suggestToken(token: string, candidates: Iterable<string>): string | undefined {
  const needle = token.toLowerCase();
  if (!needle) return undefined;
  const maxDistance = needle.length <= 4 ? 1 : 2;
  let best: { name: string; score: number } | undefined;

  for (const candidate of candidates) {
    const name = candidate.toLowerCase();
    let score: number | undefined;
    if (name === needle) score = 0;
    else if (needle.length >= 3 && name.startsWith(needle)) score = 1;
    else {
      const distance = editDistance(needle, name);
      if (distance <= maxDistance) score = 10 + distance;
    }
    if (score === undefined) continue;
    if (!best || score < best.score || (score === best.score && candidate < best.name)) {
      best = { name: candidate, score };
    }
  }
  return best?.name;
}

/**
 * Walk the tree following `segments`.
 * All segments except the last navigate into children (namespaces).
 * The last segment resolves a method on the final namespace node.
 */
export function resolvePath(tree: NamespaceNode, segments: string[]): ResolveResult {
  if (segments.length === 0) {
    const validTokens = [...tree.children.keys(), ...tree.methods.keys()];
    return { error: "No path provided. Expected: <namespace> <method>", validTokens };
  }

  let current = tree;

  // Navigate namespace segments (all but last)
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const child = current.children.get(seg);
    if (!child) {
      const validTokens = [...current.children.keys()];
      const hint = suggestToken(seg, validTokens);
      return {
        error: hint
          ? `Unknown namespace "${seg}". Did you mean "${hint}"?`
          : `Unknown namespace "${seg}". Valid options: ${validTokens.join(", ")}`,
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
    const validTokens = [...current.methods.keys(), ...current.children.keys()];
    const hint = suggestToken(methodName, validTokens);
    if (current === tree) {
      return {
        error: hint
          ? `Unknown namespace "${methodName}". Did you mean "${hint}"?`
          : `Unknown namespace "${methodName}". Valid options: ${validTokens.join(", ")}`,
        validTokens,
      };
    }
    return {
      error: hint
        ? `Unknown method "${methodName}" on namespace "${current.name}". Did you mean "${hint}"?`
        : `Unknown method "${methodName}" on namespace "${current.name}". Valid: ${validTokens.join(", ")}`,
      validTokens,
    };
  }

  return { node: current, method };
}

/**
 * Name-based guess at whether a method only reads data. Used to decide which
 * calls need confirmation in production and an auto idempotency key. Unknown
 * names count as writes, which errs on the side of asking.
 */
const READ_ONLY_PREFIX =
  /^(get|list|search|retrieve|batchGet|bulkRetrieve|calculate|info|changes|deprecatedGet|deprecatedBatchGet|v1List|v1Retrieve)/;

export function isReadOnlyMethod(name: string): boolean {
  return READ_ONLY_PREFIX.test(name);
}

/**
 * Bind a method on a client instance by walking namespace segments.
 *
 * `buildTree` captures the instance it was built from, so its methods are bound
 * to that client. Execution needs the authenticated client, so walk straight to
 * the namespace on it and take the method there — no need to rebuild the tree.
 */
export function bindMethod(
  client: object,
  namespaceSegments: string[],
  methodName: string,
): MethodEntry | undefined {
  let target = client as Record<string, unknown> | undefined;

  for (const segment of namespaceSegments) {
    const next = target?.[segment];
    if (next === null || typeof next !== "object") return undefined;
    target = next as Record<string, unknown>;
  }

  const owner = target as Record<string, unknown>;
  const fn = owner[methodName];
  if (typeof fn !== "function") return undefined;

  return {
    name: methodName,
    arity: (fn as (...args: unknown[]) => unknown).length,
    fn: (...args: unknown[]) =>
      (owner[methodName] as (...a: unknown[]) => unknown).apply(owner, args),
  };
}

export interface SearchMatch {
  /** Runnable command path: a method (`payments create`) or namespace (`terminal actions`). */
  path: string;
  kind: "namespace" | "method";
}

/**
 * Find namespaces and methods whose name contains `term`. A multi-word term is
 * matched against the full path (`search "terminal actions"`); a single word is
 * matched against each name segment, so `search create` finds `payments create`
 * without listing every command under `payments`.
 */
export function searchTree(tree: NamespaceNode, term: string, limit = 100): SearchMatch[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];
  const matchPath = needle.includes(" ");
  const matches: SearchMatch[] = [];

  const walk = (node: NamespaceNode, prefix: string[]) => {
    for (const [name, child] of node.children) {
      const path = [...prefix, name];
      const pathText = path.join(" ").toLowerCase();
      if (matchPath ? pathText.includes(needle) : name.toLowerCase().includes(needle)) {
        matches.push({ path: path.join(" "), kind: "namespace" });
      }
      walk(child, path);
    }
    for (const name of node.methods.keys()) {
      const pathText = [...prefix, name].join(" ").toLowerCase();
      if (matchPath ? pathText.includes(needle) : name.toLowerCase().includes(needle)) {
        matches.push({ path: [...prefix, name].join(" "), kind: "method" });
      }
    }
  };

  walk(tree, []);

  const rank = (match: SearchMatch): number => {
    const path = match.path.toLowerCase();
    if (path === needle) return 0;
    const last = path.split(" ").pop()!;
    if (last === needle) return 1;
    if (last.startsWith(needle)) return 2;
    if (path.startsWith(needle)) return 3;
    return 4;
  };

  return matches.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path)).slice(0, limit);
}
