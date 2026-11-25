/**
 * completion.ts - Generate shell completions from the introspected SDK tree.
 *
 * Completions are static: `square completion zsh` prints a script to source.
 * That keeps tab completion fast (no CLI startup per press) while still
 * covering every namespace and method the installed SDK exposes.
 */

import type { NamespaceNode } from "./introspect.ts";

const GLOBAL_FLAGS = [
  "--profile",
  "--token",
  "--env",
  "--json",
  "--json-output",
  "--stream",
  "--raw-page",
  "--dry-run",
  "--max-items",
  "--max-pages",
  "--timeout",
  "--retry",
  "--select",
  "--table",
  "--output",
  "--yes",
  "--verbose",
  "--keychain",
  "--offline",
  "--help",
  "--version",
];

export const ROOT_COMMANDS = ["search", "completion", "config", "whoami", "doctor"];

export type Shell = "bash" | "zsh" | "fish";

export const SUPPORTED_SHELLS: readonly Shell[] = ["bash", "zsh", "fish"];

interface Level {
  /** Namespace path, e.g. ["terminal", "actions"]; [] is the root. */
  path: string[];
  /** Completions offered at this level. */
  words: string[];
}

function levels(tree: NamespaceNode): Level[] {
  const out: Level[] = [];
  const walk = (node: NamespaceNode, prefix: string[]) => {
    const words = [...node.children.keys(), ...node.methods.keys()];
    out.push({
      path: prefix,
      words:
        prefix.length === 0
          ? [...ROOT_COMMANDS, ...words, ...GLOBAL_FLAGS]
          : [...words, ...GLOBAL_FLAGS],
    });
    for (const [name, child] of node.children) walk(child, [...prefix, name]);
  };
  walk(tree, []);
  return out;
}

function bash(tree: NamespaceNode): string {
  const cases = levels(tree)
    .map(({ path, words }) => {
      const key = path.join(" ");
      return `    ${JSON.stringify(key)})\n      COMPREPLY=( $(compgen -W ${JSON.stringify(words.join(" "))} -- "$cur") )\n      ;;`;
    })
    .join("\n");

  return `# bash completion for square
_square() {
  local cur path="" i
  cur="\${COMP_WORDS[COMP_CWORD]}"
  for ((i=1; i<COMP_CWORD; i++)); do path+="\${path:+ }\${COMP_WORDS[i]}"; done
  COMPREPLY=()
  case "$path" in
${cases}
  esac
}
complete -F _square square
`;
}

function zsh(tree: NamespaceNode): string {
  const cases = levels(tree)
    .map(({ path, words }) => {
      const key = path.join(" ");
      return `    ${JSON.stringify(key)})\n      candidates=(${words.join(" ")})\n      ;;`;
    })
    .join("\n");

  return `#compdef square
_square() {
  local key="\${(j: :)words[2,CURRENT-1]}"
  local -a candidates
  case "$key" in
${cases}
  esac
  (( \${#candidates} )) && compadd -- "\${candidates[@]}"
}
_square "$@"
`;
}

function fish(tree: NamespaceNode): string {
  const cases = levels(tree)
    .map(({ path, words }) => {
      const key = path.join(" ");
      return `        case ${JSON.stringify(key)}\n            printf '%s\\n' ${words.join(" ")}`;
    })
    .join("\n");

  return `# fish completion for square
function __square_complete
    set -l key (string join ' ' (commandline -opc)[2..-1])
    switch "$key"
${cases}
        case '*'
            return
    end
end
complete -c square -f -a '(__square_complete)'
`;
}

export function renderCompletion(shell: Shell, tree: NamespaceNode): string {
  switch (shell) {
    case "bash":
      return bash(tree);
    case "zsh":
      return zsh(tree);
    case "fish":
      return fish(tree);
  }
}
