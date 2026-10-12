# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

## [0.2.0] - 2026-10-12

### ⚠️ Behavior changes (check scripts that use the CLI)

- **Write calls against production now need confirmation.** In a terminal you
  are asked `Continue? [y/N]`; without a terminal (scripts, CI) the call is
  refused unless you pass `--yes`. Reads (`get*`, `list*`, `search*`, …),
  `--dry-run` and sandbox calls are unaffected.
- **`--stream` prints NDJSON**: one compact JSON object per line, instead of
  pretty-printed multi-line objects.
- **Invalid environments are errors.** `--env`, `SQUARE_ENVIRONMENT` and
  `config set --env` accept only `sandbox` or `production`; a typo like `prod`
  used to fall back to sandbox silently.
- **Write calls get an automatic `idempotencyKey`** when none is given. The key
  is printed to stderr; pass it back with `--idempotencyKey` to retry safely.
- **Unknown namespaces and methods exit 1** (e.g. `square bogus` used to print
  help and exit 0).
- **`--json` must be a JSON object**; arrays and scalars are rejected.
- **The config file is validated on load**; a malformed profile now fails with
  a message naming the file and the problem.
- **Field paths containing `__proto__`, `constructor` or `prototype` are rejected.**

### Added

- `--dry-run`: print the environment, method and request without sending it.
- `--json @file.json` and `--json -` read the request body from a file or stdin.
- `--field:str value` keeps a value as a string instead of JSON-coercing it
  (e.g. `--address.postalCode:str 94103`).
- `--max-items <n>` and `--max-pages <n>` cap paging.
- `--yes` skips the production write confirmation.
- `config set` without `--token` prompts for the token with hidden input, and
  `--token -` reads it from stdin, keeping tokens out of shell history.
- `config remove <profile>`.
- `config list` marks the default profile and shows each profile's environment.
- `square whoami`: shows the merchant, environment and token source in use.
- Help for namespaces (including nested ones like `square terminal actions`)
  works without credentials.
- CI on GitHub Actions (typecheck, tests, build, node 18/20/22 smoke tests) and
  a weekly run against the latest `square` SDK release.
- `bun run typecheck` script; `prepublishOnly` now runs it.

### Fixed

- `--json-output` had no effect; it now prints compact JSON.
- `square <namespace>` without credentials failed with "No authentication found"
  instead of showing help.

### Changed

- `typescript` moved from `peerDependencies` to `devDependencies`, so installing
  the CLI no longer warns about a missing peer.
- `@types/bun` pinned to `^1.4.3` instead of `latest`.

## [0.1.2] - 2026-06-21

### Changed

- Square API errors are shown in readable form (HTTP status, detail, field and
  code) with actionable hints for common problems.

### Fixed

- README `list` examples now include the sort flags those endpoints require.

## [0.1.1] - 2026-06-19

### Added

- MIT `LICENSE` file.
- npm keywords for discoverability.

## [0.1.0] - 2026-06-19

### Added

- Initial release: every Square SDK namespace and method exposed by runtime
  introspection, profile-based config, `--json` and `--field.path` request
  building, automatic paging and `--stream`.

[0.2.0]: https://github.com/karthikdilliraj/square-sdk-cli/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/karthikdilliraj/square-sdk-cli/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/karthikdilliraj/square-sdk-cli/compare/45f2670...v0.1.1
[0.1.0]: https://github.com/karthikdilliraj/square-sdk-cli/tree/45f2670
