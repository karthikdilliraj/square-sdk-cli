/**
 * output.ts - Print results and render errors.
 */

import { SquareError } from "square";

/** BigInt-safe JSON replacer */
export function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export interface PrintOptions {
  raw?: boolean;
  writeFn?: (msg: string) => void;
}

/** Serialize a result the way `--json-output` (raw) or the default (pretty) wants. */
export function formatJson(value: unknown, raw = false): string {
  return raw ? JSON.stringify(value, bigIntReplacer) : JSON.stringify(value, bigIntReplacer, 2);
}

export function print(value: unknown, options: PrintOptions = {}): void {
  const write = options.writeFn ?? ((msg: string) => process.stdout.write(msg + "\n"));
  write(formatJson(value, options.raw === true));
}

export interface RenderErrorOptions {
  writeFn?: (msg: string) => void;
  /** Also print the raw error body, cause, or stack. */
  verbose?: boolean;
  /** Emit a machine-readable JSON error instead of prose. */
  json?: boolean;
}

/** Headers Square has used for the request id, in order of preference. */
const REQUEST_ID_HEADERS = [
  "request-id",
  "x-request-id",
  "square-request-id",
  "x-square-request-id",
];

/**
 * Extract Square's request id from an error, which support uses to trace a
 * call. It usually arrives as a response header; some APIs also echo it in the
 * body as `request_id` / `requestId`.
 */
export function getRequestId(err: SquareError): string | undefined {
  const body = err.body as { request_id?: unknown; requestId?: unknown } | null | undefined;
  for (const key of ["request_id", "requestId"] as const) {
    const value = body?.[key];
    if (typeof value === "string" && value) return value;
  }

  const headers = err.rawResponse as
    | { headers?: { get?: (name: string) => string | null } }
    | undefined;
  if (headers?.headers?.get) {
    for (const name of REQUEST_ID_HEADERS) {
      const value = headers.headers.get(name);
      if (value) return value;
    }
  }
  return undefined;
}

/**
 * Cloudflare trace id from the response headers. Square's v2 APIs do not send a
 * `request-id` header or a `request_id` body field, but `cf-ray` is present and
 * is what support can use to trace a call.
 */
export function getTraceId(err: SquareError): string | undefined {
  const headers = err.rawResponse as
    | { headers?: { get?: (name: string) => string | null } }
    | undefined;
  const value = headers?.headers?.get?.("cf-ray");
  return value || undefined;
}

/** Human-readable reason phrases for the HTTP status codes Square returns. */
const STATUS_REASON: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

interface SquareBodyError {
  category: string;
  code: string;
  detail?: string;
  field?: string;
}

/**
 * Return an actionable hint for known error situations, or undefined.
 */
function hintFor(e: SquareBodyError): string | undefined {
  const field = e.field ?? "";
  if (e.code === "INVALID_ENUM_VALUE" && /^sort_/.test(field)) {
    if (field === "sort_field")
      return "This list endpoint needs an explicit sort field, e.g. `--sortField CREATED_AT`.";
    if (field === "sort_order")
      return "This list endpoint needs an explicit sort order, e.g. `--sortOrder ASC`.";
  }
  switch (e.code) {
    case "UNAUTHORIZED":
    case "ACCESS_TOKEN_EXPIRED":
    case "ACCESS_TOKEN_REVOKED":
    case "AUTHENTICATION_ERROR":
      return "Check your access token (`square config set <profile> --token ...` or $SQUARE_ACCESS_TOKEN).";
    case "FORBIDDEN":
    case "INSUFFICIENT_SCOPES":
      return "Your token lacks the OAuth scope/permission for this endpoint.";
    case "NOT_FOUND":
      return "The referenced resource does not exist in this environment (sandbox vs production?).";
    case "RATE_LIMITED":
      return "You hit the API rate limit — retry after a short delay.";
    case "VALUE_EMPTY":
    case "MISSING_REQUIRED_PARAMETER":
      return e.field
        ? `Provide the required field: \`--${camelize(e.field)} <value>\` or via \`--json\`.`
        : "A required field is missing — pass it with `--<field> <value>` or `--json`.";
    default:
      return undefined;
  }
}

/** snake_case / dotted field path -> camelCase flag name (best effort). */
function camelize(field: string): string {
  return field
    .split(".")
    .map((seg) => seg.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()))
    .join(".");
}

/**
 * Render an error to stderr (or custom write fn). Returns exit code 1.
 */
export function renderError(err: unknown, options: RenderErrorOptions = {}): number {
  const write = options.writeFn ?? ((msg: string) => process.stderr.write(msg + "\n"));

  if (options.json) {
    write(JSON.stringify(errorPayload(err, options.verbose === true), bigIntReplacer));
    return 1;
  }

  if (err instanceof SquareError) {
    const status = err.statusCode;
    const reason = status ? STATUS_REASON[status] : undefined;
    const statusText = status ? `HTTP ${status}${reason ? " " + reason : ""}` : "request failed";
    write(`✗ Square API request failed (${statusText})`);

    const requestId = getRequestId(err);
    if (requestId) write(`  request id: ${requestId}`);

    const errors = (err.errors ?? []) as SquareBodyError[];
    for (const e of errors) {
      write("");
      // Lead with the human-readable detail; fall back to the code.
      write(`  • ${e.detail ?? e.code}`);
      if (e.field) write(`    field: ${e.field}`);
      write(`    code:  ${e.category} / ${e.code}`);
      const hint = hintFor(e);
      if (hint) write(`    hint:  ${hint}`);
    }

    if (options.verbose) {
      const traceId = getTraceId(err);
      if (traceId) write(`  trace id: ${traceId}`);
      if (err.body !== undefined) {
        write("");
        write("  body:");
        for (const line of prettyJson(err.body)) write(`    ${line}`);
      }
      if (err.cause !== undefined) {
        write(`  cause: ${err.cause instanceof Error ? err.cause.message : String(err.cause)}`);
      }
    }
  } else if (err instanceof Error) {
    write(`✗ Error: ${err.message}`);
    if (options.verbose && err.stack) {
      for (const line of err.stack.split("\n").slice(1)) write(`  ${line.trim()}`);
    }
  } else {
    write(`✗ Error: ${String(err)}`);
  }

  return 1;
}

/** Pretty-print a value, falling back to a string if it can't be serialized. */
function prettyJson(value: unknown): string[] {
  try {
    return JSON.stringify(value, bigIntReplacer, 2).split("\n");
  } catch {
    return [String(value)];
  }
}

/** Read a dotted path out of an object. */
function getPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Set a dotted path on an object, creating intermediate objects. */
function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let current = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const next = current[segment];
    if (next === undefined || next === null || typeof next !== "object") {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]!] = value;
}

/**
 * Keep only the requested dotted fields. Arrays are mapped item by item, so
 * this works for list results and single objects alike.
 */
export function selectFields(value: unknown, paths: string[]): unknown {
  const pick = (item: unknown): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const path of paths) setPath(out, path, getPath(item, path));
    return out;
  };
  return Array.isArray(value) ? value.map(pick) : pick(value);
}

/**
 * Render rows as an aligned text table. Non-scalar cells are JSON-encoded.
 * Columns come from the given paths, or the first row's keys.
 */
export function renderTable(rows: unknown[], columns?: string[]): string {
  const keys = columns && columns.length > 0 ? columns : inferColumns(rows[0]);
  if (keys.length === 0) return "";

  const cell = (row: unknown, key: string): string => {
    const value = getPath(row, key);
    if (value === undefined || value === null) return "";
    return typeof value === "object" ? JSON.stringify(value, bigIntReplacer) : String(value);
  };

  const body = rows.map((row) => keys.map((key) => cell(row, key)));
  const widths = keys.map((key, i) =>
    Math.max(key.length, ...body.map((cells) => cells[i]!.length)),
  );
  const format = (cells: string[]) =>
    cells
      .map((value, i) => value.padEnd(widths[i]!))
      .join("  ")
      .trimEnd();

  return [format(keys), ...body.map(format)].join("\n");
}

function inferColumns(row: unknown): string[] {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return [];
  return Object.keys(row as Record<string, unknown>);
}

/** Build the JSON error payload used by `--json-output`. */
function errorPayload(err: unknown, verbose: boolean): unknown {
  if (err instanceof SquareError) {
    const payload: Record<string, unknown> = {
      error: "square_api",
      message: err.message,
      statusCode: err.statusCode,
      requestId: getRequestId(err),
      errors: (err.errors ?? []).map((e) => ({
        category: e.category,
        code: e.code,
        field: e.field,
        detail: e.detail,
      })),
    };
    if (verbose && err.body !== undefined) payload["body"] = err.body;
    if (verbose && err.cause !== undefined) payload["cause"] = String(err.cause);
    if (verbose) {
      const traceId = getTraceId(err);
      if (traceId) payload["traceId"] = traceId;
    }
    return payload;
  }
  const payload: Record<string, unknown> = {
    error: "cli",
    message: err instanceof Error ? err.message : String(err),
  };
  if (verbose && err instanceof Error && err.stack) payload["stack"] = err.stack;
  return payload;
}
