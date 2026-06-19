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
}

/**
 * Render an error to stderr (or custom write fn). Returns exit code 1.
 */
export function renderError(err: unknown, options: RenderErrorOptions = {}): number {
  const write =
    options.writeFn ?? ((msg: string) => process.stderr.write(msg + "\n"));

  if (err instanceof SquareError) {
    write(`Square API Error: HTTP ${err.statusCode}`);
    for (const e of err.errors) {
      const detail = (e as { detail?: string }).detail;
      write(`  [${e.category}] ${e.code}${detail ? ": " + detail : ""}`);
    }
  } else if (err instanceof Error) {
    write(`Error: ${err.message}`);
  } else {
    write(`Error: ${String(err)}`);
  }

  return 1;
}
