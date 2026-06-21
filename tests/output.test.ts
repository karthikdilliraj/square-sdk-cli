/**
 * output.test.ts - Readable error rendering (renderError).
 */

import { test, expect, describe } from "bun:test";
import { SquareError } from "square";
import { renderError } from "../src/output.ts";

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
        { category: "INVALID_REQUEST_ERROR", code: "INVALID_ENUM_VALUE", field: "sort_field", detail: "`` is not a valid enum value for `sort_field`." },
      ])
    );
    const out = lines.join("\n");
    expect(out).toContain("HTTP 400 Bad Request");
    expect(out).toContain("field: sort_field");
    expect(out).toContain("INVALID_REQUEST_ERROR / INVALID_ENUM_VALUE");
  });

  test("leads with human detail when present", () => {
    const { lines } = capture(
      squareError(400, [
        { category: "INVALID_REQUEST_ERROR", code: "INVALID_ENUM_VALUE", field: "sort_field", detail: "human detail here" },
      ])
    );
    expect(lines.join("\n")).toContain("• human detail here");
  });

  test("gives sort_field hint for empty enum on list endpoints", () => {
    const { lines } = capture(
      squareError(400, [
        { category: "INVALID_REQUEST_ERROR", code: "INVALID_ENUM_VALUE", field: "sort_field" },
      ])
    );
    expect(lines.join("\n")).toContain("--sortField");
  });

  test("gives auth hint for UNAUTHORIZED", () => {
    const { lines } = capture(
      squareError(401, [
        { category: "AUTHENTICATION_ERROR", code: "UNAUTHORIZED", detail: "This request could not be authorized." },
      ])
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
      ])
    );
    const out = lines.join("\n");
    expect(out).toContain("VALUE_EMPTY");
    expect(out).toContain("INVALID_ENUM_VALUE");
  });
});
