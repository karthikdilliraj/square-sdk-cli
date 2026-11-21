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

export function print(value: unknown, options: PrintOptions = {}): void {
  const write = options.writeFn ?? ((msg: string) => process.stdout.write(msg + "\n"));
  if (options.raw) {
    write(JSON.stringify(value, bigIntReplacer));
  } else {
    write(JSON.stringify(value, bigIntReplacer, 2));
  }
}

export interface RenderErrorOptions {
  writeFn?: (msg: string) => void;
  /** Also print the raw error body, cause, or stack. */
  verbose?: boolean;
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
  const body = err.body as
    | { request_id?: unknown; requestId?: unknown }
    | null
    | undefined;
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
      return 'This list endpoint needs an explicit sort field, e.g. `--sortField CREATED_AT`.';
    if (field === "sort_order")
      return 'This list endpoint needs an explicit sort order, e.g. `--sortOrder ASC`.';
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
  const write =
    options.writeFn ?? ((msg: string) => process.stderr.write(msg + "\n"));

  if (err instanceof SquareError) {
    const status = err.statusCode;
    const reason = status ? STATUS_REASON[status] : undefined;
    const statusText = status
      ? `HTTP ${status}${reason ? " " + reason : ""}`
      : "request failed";
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
