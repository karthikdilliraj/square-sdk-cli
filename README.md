# square-sdk-cli

A command-line interface for the [Square API](https://developer.squareup.com/),
built with [Bun](https://bun.com). It exposes **every** Square SDK namespace and
method dynamically by introspecting the SDK at runtime — no hardcoded API list.

## Install

Global install (provides the `square` command on your PATH):

```bash
npm install -g square-sdk-cli     # works with node >= 18
# or
bun add -g square-sdk-cli
```

The published package ships a node-runnable bundle (`dist/square.js`), so a
runtime install via `npm i -g` does not require Bun.

### From source

```bash
bun install
bun run build         # produces dist/square.js
npm install -g .      # or: bun link
```

## Configure

Credentials are stored on your machine at
`~/.config/square-cli/config.json` (XDG-aware; override with `SQUARE_CLI_CONFIG`).
Tokens are written with `0600` permissions and masked when read back.

```bash
square config set sandbox --token <ACCESS_TOKEN> --env sandbox
square config set prod    --token <ACCESS_TOKEN> --env production
square config use sandbox          # set default profile
square config list
square config get sandbox          # token shown masked
```

Auth resolution order: `--profile <name>` → `--token` / `SQUARE_ACCESS_TOKEN`
env → default profile.

## Usage

```
square <namespace> [<sub-namespace>...] <method> [--json '<body>'] [--field.path value] [flags]
```

```bash
# Discover what's available (no auth needed)
square --help
square payments --help
square terminal actions create --help

# Call methods
square locations list
square catalog list
square payments list --sortField CREATED_AT
square customers list --sortField DEFAULT --sortOrder ASC
square payments create --json '{"sourceId":"...","idempotencyKey":"..."}' --amountMoney.amount 100 --amountMoney.currency USD
square customers list --sortField DEFAULT --sortOrder ASC --stream
```

> Note: some `list` endpoints (e.g. `payments`, `customers`) require explicit
> sort flags — the Square SDK serializes a missing sort field as an empty string
> and the API rejects it with `INVALID_ENUM_VALUE ... sort_field`. Pass
> `--sortField` (and `--sortOrder` for `customers`) as shown above. Endpoints
> like `locations` and `catalog` need no arguments.

### Request body

- `--json '<json>'` — full request body as JSON
- `--field.path value` — set a field by dotted path (merged over `--json`;
  numeric path segments create arrays; values are JSON-coerced, falling back to string)

### Flags

| Flag            | Description                                 |
| --------------- | ------------------------------------------- |
| `--profile <n>` | use a named profile from config             |
| `--token <t>`   | Square API access token                     |
| `--env <e>`     | `sandbox` or `production` (default sandbox) |
| `--json '<j>'`  | JSON request body                           |
| `--json-output` | compact JSON output (no pretty print)       |
| `--stream`      | stream pageable results item by item        |
| `--help`        | show help                                   |

> Per-field help is structural only — the SDK's field schemas live in its
> `.d.ts` types and aren't available at runtime. Use `--json` for full bodies.

## Develop

```bash
bun test          # full suite (incl. SDK contract guard test)
bun bin/square.ts <namespace> <method>
```

## Supported Square SDK versions

Currently built and tested against **`square@44.1.0`** (pinned `^44.1.0` in
`package.json`).

The CLI is **version-agnostic by design**: it reads the SDK's namespace/method
tree at runtime, so new Square APIs, methods, and fields are picked up
automatically with a simple `bun update square` — no CLI code change.

It relies on the SDK's structural _conventions_, not a specific version number.
Those conventions have been stable across the modern fluent SDK line
(**v40 → v44**):

- exports `SquareClient`, `SquareEnvironment`, `SquareError`
- constructs with `new SquareClient({ token, environment })`
- API namespaces are lazy getters on the client prototype (nested recursively)
- internal duplicate methods are `__`-prefixed (filtered out)
- list methods return async-iterable pageable results

A major SDK rewrite that changes any of the above is the _only_ case requiring a
CLI code change. `tests/contract.test.ts` guards these conventions against the
installed `square` package — if a future bump breaks the contract, those tests
go red and point at exactly what to fix.

| Square release type             | CLI action                      |
| ------------------------------- | ------------------------------- |
| New API / method / field (most) | `bun update square`             |
| Patch / minor                   | nothing                         |
| Major structural rewrite (rare) | update introspect/client/output |
