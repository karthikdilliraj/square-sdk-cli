# Contributing

Thanks for taking a look. This CLI is intentionally small: most behavior comes
from introspecting the `square` SDK at runtime, so most changes touch one
focused module plus its test file.

## Setup

```bash
bun install
bun test              # full suite
bun run test:coverage # suite + coverage thresholds (lines 85%, functions 80%)
bun run typecheck
bun run lint          # Biome; `bun run lint:fix` applies safe fixes
bun bin/square.ts --help
```

CI runs lint, typecheck, coverage, build, and node 18/20/22 smoke tests on
Ubuntu and macOS. A weekly job repeats the suite against the newest `square`
release.

## Layout

| File | Responsibility |
| ---- | -------------- |
| `src/args.ts` | argv parsing: positionals, global flags, `--field.path` |
| `src/introspect.ts` | build the namespace/method tree, resolve paths, suggestions, search, `bindMethod` |
| `src/execute.ts` | call a method; paging, streaming, raw pages |
| `src/merge.ts` | build request bodies from `--json` and fields |
| `src/auth.ts` | resolve credentials from flags/env/config profiles |
| `src/config.ts` | profile storage (atomic writes, `0600`) |
| `src/keychain.ts` | OS keychain backend (macOS `security`, Linux `secret-tool`) |
| `src/cli.ts` | wiring, built-ins (`config`, `whoami`, `search`, `completion`, `doctor`) |
| `src/output.ts` | JSON/table rendering, `--select`, error rendering |
| `src/completion.ts` | shell completion generation |
| `src/doctor.ts` | environment checks |
| `bin/square.ts` | entry point: broken-pipe guard, exit handling |

## Conventions

- **Bun everywhere**: `bun test`, `bun <file>`, `bun install`.
- **No hardcoded SDK names.** Namespaces, methods and fields come from the
  installed SDK. If something needs a new SDK convention, update
  `tests/contract.test.ts` so the assumption is guarded.
- **Tests live next to the behavior**: unit tests per module, plus
  `tests/cli.integration.test.ts` for command flows and
  `tests/stdio.e2e.test.ts` for real-process pipe behavior.
- **Effects are injectable.** Add new side effects (clients, keychain, streams)
  to `RunDeps` so tests don't touch the network or a real keychain.
- **Errors**: user-facing failures go through `renderError` so prose and
  `--json-output` stay consistent.
- **Formatting/lint are enforced** (`bun run lint`); don't hand-format around
  Biome.

## Changing behavior

- New flag: add it to `ParsedFlags` and `STRING_FLAGS`/`BOOL_FLAGS` in
  `src/args.ts`, document it in `src/help.ts` and the README flag table, and
  add parsing + integration tests.
- New SDK method/namespace: no code change expected. Run the contract tests.
- Config format change: update `validateConfig`, handle old files, and add a
  config test.

## Pull requests

- Keep commits focused; explain user-visible behavior changes.
- Run `bun run lint && bun run typecheck && bun run test:coverage` before
  opening a PR.
- Note behavior changes in `CHANGELOG.md` under `Unreleased`.

Releases are tag-driven; see the README "Releasing" section.