/**
 * epipe.ts - Exit quietly when stdout/stderr is closed early.
 *
 * `square payments list --stream | head -5` makes the downstream process go
 * away while we are still writing. Node surfaces that as an EPIPE error event
 * on the stream; unhandled, it prints a stack trace after the useful output.
 * That is a normal end for a piped command, so exit 0 instead.
 */

interface ErrorEmittingStream {
  on(event: "error", listener: (err: unknown) => void): unknown;
}

export interface BrokenPipeGuardOptions {
  /** Called with the exit code instead of process.exit (for tests). */
  exit?: (code: number) => void;
  /** Report a non-EPIPE stream error. Defaults to writing to stderr. */
  report?: (err: unknown) => void;
}

export function guardBrokenPipe(
  streams: readonly ErrorEmittingStream[],
  options: BrokenPipeGuardOptions = {}
): void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const report =
    options.report ??
    ((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        process.stderr.write(`✗ Error: ${msg}\n`);
      } catch {
        // stderr is gone too; there is nothing left to report to.
      }
    });

  for (const stream of streams) {
    stream.on("error", (err: unknown) => {
      const code = (err as { code?: unknown } | null | undefined)?.code;
      if (code === "EPIPE") {
        exit(0);
        return;
      }
      report(err);
      exit(1);
    });
  }
}