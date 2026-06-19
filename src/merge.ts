/**
 * merge.ts - Build a request object from a JSON string and field overrides.
 */

export interface FieldEntry {
  path: string;
  value: string;
}

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

/**
 * Deep-set a value at a dot-separated path on an object.
 * Numeric path segments create array indices.
 */
function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const nextSeg = segments[i + 1]!;
    const isNextNumeric = /^\d+$/.test(nextSeg);

    if (current[seg] === undefined || current[seg] === null) {
      current[seg] = isNextNumeric ? [] : {};
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
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      } else {
        base = parsed as Record<string, unknown>;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid JSON: ${msg}`);
    }
  }

  for (const field of fields) {
    const coerced = coerce(field.value);
    deepSet(base, field.path, coerced);
  }

  return base;
}
