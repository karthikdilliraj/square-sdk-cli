/**
 * args.ts - Parse CLI argv into structured form.
 */

export interface ParsedFlags {
  profile?: string;
  token?: string;
  env?: string;
  json?: string;
  jsonOutput?: true;
  stream?: true;
  help?: true;
}

export interface FieldEntry {
  path: string;
  value: string;
}

export interface ParsedArgs {
  positionals: string[];
  flags: ParsedFlags;
  fields: FieldEntry[];
}

// Reserved global flags that consume the next token as their value (string-valued)
const STRING_FLAGS: Record<string, keyof ParsedFlags> = {
  profile: "profile",
  token: "token",
  env: "env",
  json: "json",
};

// Reserved global flags that are bare booleans
const BOOL_FLAGS: Record<string, keyof ParsedFlags> = {
  "json-output": "jsonOutput",
  stream: "stream",
  help: "help",
};

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: ParsedFlags = {};
  const fields: FieldEntry[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;

    if (arg.startsWith("--")) {
      // Strip leading --
      const body = arg.slice(2);

      // Check for = sign
      const eqIdx = body.indexOf("=");
      if (eqIdx !== -1) {
        const key = body.slice(0, eqIdx);
        const val = body.slice(eqIdx + 1);
        if (handleFlag(key, val, flags)) {
          i++;
          continue;
        }
        // Non-reserved key=val => field
        fields.push({ path: key, value: val });
        i++;
        continue;
      }

      // No = sign
      const key = body;

      // Check bool flag
      if (key in BOOL_FLAGS) {
        const flagKey = BOOL_FLAGS[key]!;
        (flags as Record<string, unknown>)[flagKey] = true;
        i++;
        continue;
      }

      // Check string flag
      if (key in STRING_FLAGS) {
        const flagKey = STRING_FLAGS[key]!;
        const nextVal = argv[i + 1];
        if (nextVal !== undefined && !nextVal.startsWith("--")) {
          (flags as Record<string, unknown>)[flagKey] = nextVal;
          i += 2;
          continue;
        }
        // No value following; treat as bare true (shouldn't happen for these flags)
        (flags as Record<string, unknown>)[flagKey] = true;
        i++;
        continue;
      }

      // Non-reserved flag => field
      // Peek at next token for value
      const nextVal = argv[i + 1];
      if (nextVal !== undefined && !nextVal.startsWith("--")) {
        fields.push({ path: key, value: nextVal });
        i += 2;
        continue;
      }
      // No value => treat as boolean "true" field
      fields.push({ path: key, value: "true" });
      i++;
      continue;
    }

    // Bare positional
    positionals.push(arg);
    i++;
  }

  return { positionals, flags, fields };
}

function handleFlag(
  key: string,
  val: string,
  flags: ParsedFlags
): boolean {
  if (key in BOOL_FLAGS) {
    const flagKey = BOOL_FLAGS[key]!;
    (flags as Record<string, unknown>)[flagKey] = true;
    return true;
  }
  if (key in STRING_FLAGS) {
    const flagKey = STRING_FLAGS[key]!;
    (flags as Record<string, unknown>)[flagKey] = val;
    return true;
  }
  return false;
}
