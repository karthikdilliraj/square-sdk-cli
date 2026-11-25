/**
 * output.test.ts - Readable error rendering (renderError).
 */

import { describe, expect, test } from "bun:test";
import { SquareError } from "square";
import { renderError, renderTable, selectFields } from "../src/output.ts";

function capture(err: unknown): { lines: string[]; code: number } {
  const lines: string[] = [];
  const code = renderError(err, { writeFn: (m) => lines.push(m) });
  return { lines, code };
}

/** Build a SquareError with the given status + body errors. */
function squareError(statusCode: number, errors: unknown[]): SquareError {
  const e = new SquareError({ statusCode, body: { errors } });
  // SquareError reads `errors` from body; ensure it's populated for the test.
  (e as unknown as { errors: unknown[] }).errors = errors;
  return e;
}

describe("renderError", () => {
  test("returns exit code 1", () => {
    expect(capture(new Error("boom")).code).toBe(1);
  });

  test("renders status with human reason phrase", () => {
    const { lines } = capture(
      squareError(400, [
        {
          category: "INVALID_REQUEST_ERROR",
          code: "INVALID_ENUM_VALUE",
          field: "sort_field",
          detail: "`` is not a valid enum value for `sort_field`.",
        },
      ]),
    );
    const out = lines.join("\n");
    expect(out).toContain("HTTP 400 Bad Request");
    expect(out).toContain("field: sort_field");
    expect(out).toContain("INVALID_REQUEST_ERROR / INVALID_ENUM_VALUE");
  });

  test("leads with human detail when present", () => {
    const { lines } = capture(
      squareError(400, [
        {
          category: "INVALID_REQUEST_ERROR",
          code: "INVALID_ENUM_VALUE",
          field: "sort_field",
          detail: "human detail here",
        },
      ]),
    );
    expect(lines.join("\n")).toContain("• human detail here");
  });

  test("gives sort_field hint for empty enum on list endpoints", () => {
    const { lines } = capture(
      squareError(400, [
        { category: "INVALID_REQUEST_ERROR", code: "INVALID_ENUM_VALUE", field: "sort_field" },
      ]),
    );
    expect(lines.join("\n")).toContain("--sortField");
  });

  test("gives auth hint for UNAUTHORIZED", () => {
    const { lines } = capture(
      squareError(401, [
        {
          category: "AUTHENTICATION_ERROR",
          code: "UNAUTHORIZED",
          detail: "This request could not be authorized.",
        },
      ]),
    );
    const out = lines.join("\n");
    expect(out).toContain("HTTP 401 Unauthorized");
    expect(out).toContain("access token");
  });

  test("renders plain Error message", () => {
    const { lines } = capture(new Error("something broke"));
    expect(lines.join("\n")).toContain("something broke");
  });

  test("handles multiple body errors", () => {
    const { lines } = capture(
      squareError(400, [
        { category: "INVALID_REQUEST_ERROR", code: "VALUE_EMPTY", field: "name" },
        { category: "INVALID_REQUEST_ERROR", code: "INVALID_ENUM_VALUE", field: "sort_order" },
      ]),
    );
    const out = lines.join("\n");
    expect(out).toContain("VALUE_EMPTY");
    expect(out).toContain("INVALID_ENUM_VALUE");
  });
});

describe("renderError - request id", () => {
  test("prints the request id from response headers", () => {
    const err = new SquareError({
      statusCode: 400,
      body: {
        errors: [{ category: "INVALID_REQUEST_ERROR", code: "BAD_REQUEST", detail: "nope" }],
      },
      rawResponse: { headers: new Headers({ "request-id": "req-header" }) } as any,
    });
    expect(capture(err).lines.join("\n")).toContain("request id: req-header");
  });

  test("falls back to request_id echoed in the body", () => {
    const err = new SquareError({
      statusCode: 400,
      body: {
        errors: [{ category: "INVALID_REQUEST_ERROR", code: "BAD_REQUEST" }],
        request_id: "req-body",
      },
    });
    expect(capture(err).lines.join("\n")).toContain("request id: req-body");
  });

  test("omits the line when no request id is available", () => {
    const err = new SquareError({ statusCode: 500, body: {} });
    expect(capture(err).lines.join("\n")).not.toContain("request id");
  });
});

describe("renderError - verbose", () => {
  function verboseCapture(err: unknown): string {
    const lines: string[] = [];
    renderError(err, { writeFn: (m) => lines.push(m), verbose: true });
    return lines.join("\n");
  }

  test("prints the raw error body", () => {
    const err = new SquareError({
      statusCode: 400,
      body: { errors: [{ category: "INVALID_REQUEST_ERROR", code: "BAD_REQUEST" }] },
    });
    const out = verboseCapture(err);
    expect(out).toContain("body:");
    expect(out).toContain('"errors"');
  });

  test("keeps the raw body out of non-verbose output", () => {
    const err = new SquareError({
      statusCode: 400,
      body: { errors: [{ category: "INVALID_REQUEST_ERROR", code: "BAD_REQUEST" }] },
    });
    expect(capture(err).lines.join("\n")).not.toContain("body:");
  });

  test("prints the underlying cause", () => {
    const err = new SquareError({
      statusCode: 500,
      body: {},
      cause: new Error("socket hang up"),
    });
    expect(verboseCapture(err)).toContain("cause: socket hang up");
  });

  test("prints a stack trace for plain errors", () => {
    const out = verboseCapture(new Error("boom"));
    expect(out).toContain("boom");
    expect(out).toMatch(/\n {2}at /);
  });
});

describe("selectFields", () => {
  test("keeps only requested fields on a single object", () => {
    expect(selectFields({ id: "1", name: "x", extra: true }, ["id"])).toEqual({ id: "1" });
  });

  test("maps arrays item by item", () => {
    expect(
      selectFields(
        [
          { id: "1", name: "a" },
          { id: "2", name: "b" },
        ],
        ["id"],
      ),
    ).toEqual([{ id: "1" }, { id: "2" }]);
  });

  test("supports dotted paths", () => {
    expect(
      selectFields({ amountMoney: { amount: 100, currency: "USD" } }, ["amountMoney.amount"]),
    ).toEqual({ amountMoney: { amount: 100 } });
  });

  test("omits fields that are not present", () => {
    expect(selectFields({ id: "1" }, ["nope"])).toEqual({});
  });
});

describe("renderTable", () => {
  test("aligns columns using the first row's keys", () => {
    const text = renderTable([
      { id: "a", name: "x" },
      { id: "bb", name: "yy" },
    ]);
    expect(text.split("\n")).toEqual(["id  name", "a   x", "bb  yy"]);
  });

  test("uses explicit columns and dotted paths", () => {
    const text = renderTable(
      [{ id: "1", amountMoney: { amount: 100 } }],
      ["id", "amountMoney.amount"],
    );
    expect(text.split("\n")).toEqual(["id  amountMoney.amount", "1   100"]);
  });

  test("JSON-encodes object cells", () => {
    expect(renderTable([{ meta: { a: 1 } }])).toContain('{"a":1}');
  });

  test("renders blank cells for missing values", () => {
    expect(renderTable([{ id: "1", name: undefined }])).toBe("id  name\n1");
  });

  test("returns an empty string when there are no columns", () => {
    expect(renderTable([{}])).toBe("");
  });
});

describe("renderError - json output", () => {
  function jsonError(err: unknown, verbose = false): Record<string, unknown> {
    const lines: string[] = [];
    const code = renderError(err, { writeFn: (m) => lines.push(m), json: true, verbose });
    expect(code).toBe(1);
    return JSON.parse(lines[0]!);
  }

  test("emits a machine-readable CLI error", () => {
    expect(jsonError(new Error("boom"))).toEqual({ error: "cli", message: "boom" });
  });

  test("includes status, request id and field errors for API errors", () => {
    const err = new SquareError({
      statusCode: 422,
      body: {
        errors: [
          { category: "INVALID_REQUEST_ERROR", code: "BAD", field: "amount", detail: "nope" },
        ],
        request_id: "req-9",
      },
    });
    const payload = jsonError(err);
    expect(payload["error"]).toBe("square_api");
    expect(payload["statusCode"]).toBe(422);
    expect(payload["requestId"]).toBe("req-9");
    expect(payload["errors"]).toEqual([
      { category: "INVALID_REQUEST_ERROR", code: "BAD", field: "amount", detail: "nope" },
    ]);
  });

  test("adds the raw body only in verbose mode", () => {
    const err = new SquareError({ statusCode: 500, body: { errors: [] } });
    expect(jsonError(err)["body"]).toBeUndefined();
    expect(jsonError(err, true)["body"]).toBeDefined();
  });
});

describe("renderError - trace id", () => {
  function errorWithHeaders(headers: Headers): SquareError {
    return new SquareError({
      statusCode: 404,
      body: { errors: [{ category: "INVALID_REQUEST_ERROR", code: "NOT_FOUND" }] },
      rawResponse: { headers } as any,
    });
  }

  test("prints cf-ray as a trace id in verbose mode", () => {
    const lines: string[] = [];
    renderError(errorWithHeaders(new Headers({ "cf-ray": "a5fd83bf-YYZ" })), {
      writeFn: (m) => lines.push(m),
      verbose: true,
    });
    expect(lines.join("\n")).toContain("trace id: a5fd83bf-YYZ");
  });

  test("omits the trace id without --verbose", () => {
    const lines: string[] = [];
    renderError(errorWithHeaders(new Headers({ "cf-ray": "abc-YYZ" })), {
      writeFn: (m) => lines.push(m),
    });
    expect(lines.join("\n")).not.toContain("trace id");
  });

  test("includes traceId in verbose JSON errors", () => {
    const lines: string[] = [];
    renderError(errorWithHeaders(new Headers({ "cf-ray": "abc-YYZ" })), {
      writeFn: (m) => lines.push(m),
      verbose: true,
      json: true,
    });
    expect(JSON.parse(lines[0]!).traceId).toBe("abc-YYZ");
  });
});
