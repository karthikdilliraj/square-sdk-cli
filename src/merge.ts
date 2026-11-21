/**
 * merge.ts - Build a request object from a JSON string and field overrides.
 */

import * as fs from "fs";
import { randomUUID } from "crypto";
import type { FieldEntry } from "./args.ts";

/** Field path suffix that forces the value to stay a string (no JSON coercion). */
const STRING_SUFFIX = ":str";

/**
 * Coerce a string value: try JSON.parse, fallback to raw string.
 */
function coerce(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Path segments that would reach Object.prototype instead of the request. */
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/** Human-readable description of a value's shape, for conflict messages. */
function describeKind(value: unknown): string {
  if (Array.isArray(value)) return "an array";
  switch (typeof value) {
    case "string":
      return "a string";
    case "number":
      return "a number";
    case "boolean":
      return "a boolean";
    case "object":
      return "an object";
    default:
      return `a ${typeof value}`;
  }
}

/** Error for a field path that cannot be applied over the existing body. */
function pathConflict(path: string, prefix: string, existing: unknown, wantsArray: boolean): Error {
  const expected = wantsArray ? "an array" : "an object";
  return new Error(
    `Invalid field path "${path}": "${prefix}" is already ${describeKind(existing)}, ` +
      `but the path needs ${expected} there. Pass the whole value with --json instead.`
  );
}

/**
 * Deep-set a value at a dot-separated path on an object.
 * Numeric path segments create array indices.
 */
function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  for (const seg of segments) {
    if (FORBIDDEN_SEGMENTS.has(seg)) {
      throw new Error(`Invalid field path "${path}": "${seg}" is not allowed`);
    }
  }
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const nextSeg = segments[i + 1]!;
    const wantsArray = /^\d+$/.test(nextSeg);
    const existing = current[seg];

    if (existing === undefined || existing === null) {
      current[seg] = wantsArray ? [] : {};
    } else if (typeof existing !== "object") {
      // Setting a property on a primitive would throw a bare TypeError.
      throw pathConflict(path, segments.slice(0, i + 1).join("."), existing, wantsArray);
    } else if (wantsArray !== Array.isArray(existing)) {
      throw pathConflict(path, segments.slice(0, i + 1).join("."), existing, wantsArray);
    }
    current = current[seg] as Record<string, unknown>;
  }

  const lastSeg = segments[segments.length - 1]!;
  current[lastSeg] = value;
}

/**
 * Build request object from optional JSON string and field entries.
 * Fields deep-merge over (and override) JSON values.
 */
export function buildRequest(
  jsonStr: string | undefined,
  fields: FieldEntry[]
): object {
  let base: Record<string, unknown> = {};

  if (jsonStr !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid JSON: ${msg}`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid JSON: request body must be a JSON object");
    }
    base = parsed as Record<string, unknown>;
  }

  for (const field of fields) {
    if (field.path.endsWith(STRING_SUFFIX)) {
      deepSet(base, field.path.slice(0, -STRING_SUFFIX.length), field.value);
    } else {
      deepSet(base, field.path, coerce(field.value));
    }
  }

  return base;
}

/**
 * Resolve the raw --json argument to JSON text:
 *   "-"     => read stdin
 *   "@path" => read the file at path
 *   other   => used as-is
 */
export function readJsonArg(
  raw: string,
  readFile: (source: string | 0) => string = (source) => fs.readFileSync(source, "utf8")
): string {
  if (raw === "-") return readFile(0);
  if (raw.startsWith("@")) {
    const file = raw.slice(1);
    try {
      return readFile(file);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Cannot read --json file "${file}": ${msg}`);
    }
  }
  return raw;
}

/**
 * Add a random idempotencyKey to a write request that doesn't have one, and
 * return it (or undefined if nothing was added). Safe for endpoints that don't
 * take a key: the SDK strips unrecognized body keys before sending.
 * Skipped for methods like cancelByIdempotencyKey, where the key must name an
 * existing operation rather than be fresh.
 */
export function ensureIdempotencyKey(
  request: object,
  methodName: string,
  newKey: () => string = randomUUID
): string | undefined {
  if (/IdempotencyKey/.test(methodName)) return undefined;
  const body = request as Record<string, unknown>;
  if (body["idempotencyKey"] !== undefined) return undefined;
  const key = newKey();
  body["idempotencyKey"] = key;
  return key;
}
