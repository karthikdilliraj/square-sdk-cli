/**
 * help.ts - Render help text from the namespace tree.
 */

import type { NamespaceNode } from "./introspect.ts";

const GLOBAL_FLAGS = `
Global flags:
  --profile <name>      Use a named profile from config
  --token <token>       Square API access token
  --env <environment>   "sandbox" or "production" (default: sandbox)
  --json <json>         JSON body for the request
  --json-output         Output as compact JSON (no pretty print)
  --stream              Stream pageable results item by item
  --help                Show this help message
`.trim();

/**
 * Render root help: lists all namespaces and the "config" built-in.
 */
export function renderRootHelp(tree: NamespaceNode): string {
  const lines: string[] = [];
  lines.push("Square SDK CLI");
  lines.push("");
  lines.push("Usage:");
  lines.push("  square <namespace> <method> [--json <body>] [--field value] [flags]");
  lines.push("  square config <subcommand> [args]");
  lines.push("");
  lines.push("Namespaces:");

  const namespaces = [...tree.children.keys()].sort();
  for (const ns of namespaces) {
    lines.push(`  ${ns}`);
  }

  lines.push("");
  lines.push("Built-in commands:");
  lines.push("  config set <profile> --token <tok> --env <env>   Create/update a profile");
  lines.push("  config get <profile>                              Show profile (token masked)");
  lines.push("  config list                                       List all profiles");
  lines.push("  config use <profile>                              Set default profile");
  lines.push("");
  lines.push(GLOBAL_FLAGS);

  return lines.join("\n");
}

/**
 * Render namespace help: lists sub-namespaces and methods.
 */
export function renderNamespaceHelp(node: NamespaceNode): string {
  const lines: string[] = [];
  lines.push(`Namespace: ${node.name}`);
  lines.push("");

  if (node.children.size > 0) {
    lines.push("Sub-namespaces:");
    for (const [name] of node.children) {
      lines.push(`  ${node.name} ${name}`);
    }
    lines.push("");
  }

  if (node.methods.size > 0) {
    lines.push("Methods:");
    for (const [name, method] of node.methods) {
      lines.push(`  ${node.name} ${name}  (arity: ${method.arity})`);
    }
    lines.push("");
  }

  lines.push(GLOBAL_FLAGS);

  return lines.join("\n");
}

/**
 * Render method help: structural usage with --json and --field hints.
 */
export function renderMethodHelp(namespaceName: string, methodName: string, arity: number): string {
  const lines: string[] = [];
  lines.push(`Method: ${namespaceName} ${methodName}`);
  lines.push("");
  lines.push("Usage:");
  lines.push(`  square ${namespaceName} ${methodName} [options]`);
  lines.push("");
  lines.push("Request options:");
  lines.push("  --json '<json>'              Full request body as JSON");
  lines.push("  --<field.path> <value>       Set a field in the request by dotted path");
  lines.push(`                               e.g. --amountMoney.amount 100`);
  lines.push("");
  lines.push(`Note: arity hint = ${arity} (optional params may not be counted)`);
  lines.push("      Always pass a request object (even if empty).");
  lines.push("");
  lines.push(GLOBAL_FLAGS);

  return lines.join("\n");
}
