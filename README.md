# square-sdk-cli

[![CI](https://github.com/karthikdilliraj/square-sdk-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/karthikdilliraj/square-sdk-cli/actions/workflows/ci.yml)

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
Writes are atomic (temp file + rename), so a crash can't truncate your saved
profiles. Tokens are written with `0600` permissions — an existing file with
looser permissions is tightened on read — and masked when read back.

```bash
square config set sandbox --env sandbox      # prompts for the token (hidden)
square config set prod --env production      # same
pbpaste | square config set prod --token - --env production   # token from stdin
square config use sandbox          # set default profile
square config list                 # * marks the default; shows each environment
square config get sandbox          # token shown masked
square config remove sandbox       # delete a profile (clears the default if it was)
square whoami                      # check the token: merchant, environment, token source
```

Omitting `--token` (or passing `--token -`) keeps the token out of your shell
history. `--token <ACCESS_TOKEN>` inline still works.

Auth resolution order: `--profile <name>` → `--token` / `SQUARE_ACCESS_TOKEN`
env → default profile.

An explicit `--env` overrides the environment stored in the selected profile.
`SQUARE_ENVIRONMENT` is only consulted when the token comes from `--token` or
`SQUARE_ACCESS_TOKEN` — it never redirects a profile.

## Usage

```
square <namespace> [<sub-namespace>...] <method> [--json '<body>'] [--field.path value] [flags]
```

```bash
# Discover what's available (no auth needed)
square --help
square payments --help
square terminal actions create --help
square search payment            # find namespaces/methods by name
square search "terminal actions" # multi-word terms match a path

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
- `--field.path=value` — same as the space form, and the way to pass a value
  that starts with `--` (e.g. `--note=--hello`)
- `--` — ends flag parsing; every later token is treated as a namespace or
  method name

A field whose name matches a global flag (`token`, `env`, `json`, `profile`,
`stream`, `raw-page`, `dry-run`, `max-items`, `max-pages`, `timeout`, `retry`,
`yes`, `verbose`, `json-output`, `help`, `version`) can't be set with `--name`;
pass it through `--json` instead.

```bash
square payments create --json @payment.json --dry-run   # preview, nothing sent
cat payment.json | square payments create --json -
```

### Pagination and cursors

By default `list` calls fetch every page and print one flattened array (cap it
with `--max-items`/`--max-pages`), and `--stream` emits one item per line as
NDJSON. To work page by page, `--raw-page` returns a single page's API response
envelope — cursor included — without fetching any further pages:

```bash
square payments list --raw-page --limit 100
square payments list --raw-page --limit 100 --cursor <cursor-from-previous-page>
```

`--raw-page` cannot be combined with `--stream`, and `--max-items`/`--max-pages`
don't apply to it.

### Diagnosing calls

`--verbose` prints the call, environment, auth source and duration to stderr,
and on failure includes the raw error body, underlying cause, and stack trace.
Square API errors always print the API's `request id` when it is available —
include it when asking Square support about a call.

Unknown namespace and method names suggest the closest match
(`Did you mean "payments"?`) instead of dumping hundreds of valid names.

### Flags

| Flag            | Description                                 |
| --------------- | ------------------------------------------- |
| `--profile <n>` | use a named profile from config             |
| `--token <t>`   | Square API access token                     |
| `--env <e>`     | `sandbox` or `production` (default sandbox; anything else is an error) |
| `--json '<j>'`  | JSON request body (`@file` or `-` for stdin) |
| `--json-output` | compact JSON output (no pretty print)       |
| `--stream`      | stream pageable results as NDJSON           |
| `--raw-page`    | return one raw page (with its cursor) instead of auto-paging |
| `--dry-run`     | print the request without sending it (no idempotency key is generated) |
| `--max-items <n>` | stop paging after n items                 |
| `--max-pages <n>` | stop paging after n pages                 |
| `--timeout <seconds>` | HTTP timeout per request (SDK default if omitted) |
| `--retry <n>`   | retry failed requests n times (SDK default 2; 0 disables) |
| `--yes`         | skip the production write confirmation      |
| `--verbose`     | request diagnostics and full error details on stderr |
| `--version`     | print the CLI and Square SDK versions       |
| `--help`        | show help                                   |

### Safety defaults

- **Production writes ask first.** Any call against `production` whose method
  isn't a read (`get*`, `list*`, `search*`, `retrieve*`, `batchGet*`, …) asks
  `Continue? [y/N]`. In scripts or CI (no terminal), it refuses unless you pass
  `--yes`. `--dry-run` never prompts.
- **Automatic idempotency keys.** Write calls without an `idempotencyKey` get a
  random one, printed to stderr. To retry safely, pass it back with
  `--idempotencyKey <key>`. Endpoints that don't use a key ignore it.
  `--dry-run` and aborted confirmations never generate one.
- **Paging limits.** `list` calls fetch every page by default. Cap them with
  `--max-items` or `--max-pages`. (`--limit` is still the API's own page-size
  field.)

> Per-field help is structural only — the SDK's field schemas live in its
> `.d.ts` types and aren't available at runtime. Use `--json` for full bodies.

## Develop

```bash
bun install
bun test              # full suite (incl. SDK contract guard test)
bun run test:coverage # same, with enforced coverage thresholds
bun run typecheck     # tsc --noEmit
bun run lint          # Biome lint + format check (bun run lint:fix to apply)
bun bin/square.ts <namespace> <method>
```

CI runs lint, typecheck, tests with coverage thresholds, the build, and node
18/20/22 smoke tests on both Ubuntu and macOS. A weekly job repeats the suite
against the newest `square` release and smoke-tests the rebuild bundle.

## Releasing

Pushing a version tag publishes to npm with
[provenance](https://docs.npmjs.com/generating-provenance-statements):

```bash
npm version patch        # bumps package.json and creates the tag
git push --follow-tags
```

The tag must match `package.json` (`v0.2.1` ↔ `0.2.1`) or the workflow fails.
It needs an `NPM_TOKEN` repository secret.

## Supported Square SDK versions

Currently built and tested against **`square@44.2.1`** (`^44.2.1` in
`package.json`, so any 44.x release is accepted).

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
