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
square config set sandbox --env sandbox      # prompts for the token (hidden)
square config set prod --env production      # same
pbpaste | square config set prod --token - --env production   # token from stdin
square config use sandbox          # set default profile
square config list
square config get sandbox          # token shown masked
```

Omitting `--token` (or passing `--token -`) keeps the token out of your shell
history. `--token <ACCESS_TOKEN>` inline still works.

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

- `--json '<json>'` — full request body as a JSON object; `--json @body.json`
  reads it from a file, `--json -` reads it from stdin
- `--field.path value` — set a field by dotted path (merged over `--json`;
  numeric path segments create arrays; values are JSON-coerced, falling back to string)
- `--field.path:str value` — same, but the value is always kept as a string
  (e.g. `--address.postalCode:str 94103`, which would otherwise become a number)

```bash
square payments create --json @payment.json --dry-run   # preview, nothing sent
cat payment.json | square payments create --json -
```

### Flags

| Flag            | Description                                 |
| --------------- | ------------------------------------------- |
| `--profile <n>` | use a named profile from config             |
| `--token <t>`   | Square API access token                     |
| `--env <e>`     | `sandbox` or `production` (default sandbox; anything else is an error) |
| `--json '<j>'`  | JSON request body (`@file` or `-` for stdin) |
| `--json-output` | compact JSON output (no pretty print)       |
| `--stream`      | stream pageable results as NDJSON           |
| `--dry-run`     | print the request without sending it        |
| `--max-items <n>` | stop paging after n items                 |
| `--max-pages <n>` | stop paging after n pages                 |
| `--yes`         | skip the production write confirmation      |
| `--help`        | show help                                   |

### Safety defaults

- **Production writes ask first.** Any call against `production` whose method
  isn't a read (`get*`, `list*`, `search*`, `retrieve*`, `batchGet*`, …) asks
  `Continue? [y/N]`. In scripts or CI (no terminal), it refuses unless you pass
  `--yes`. `--dry-run` never prompts.
- **Automatic idempotency keys.** Write calls without an `idempotencyKey` get a
  random one, printed to stderr. To retry safely, pass it back with
  `--idempotencyKey <key>`. Endpoints that don't use a key ignore it.
- **Paging limits.** `list` calls fetch every page by default. Cap them with
  `--max-items` or `--max-pages`. (`--limit` is still the API's own page-size
  field.)

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
