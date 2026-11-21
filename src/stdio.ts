/**
 * stdio.ts - Flush buffered stream writes before exiting.
 *
 * `process.exit()` does not wait for pending writes. For a pipe or socket,
 * stdout is asynchronous, so exiting right after printing a large response can
 * truncate the tail. Writing an empty chunk and waiting for its callback
 * guarantees everything queued before it has been handed off.
 */

export interface FlushableStream {
  writableLength?: number;
  write(chunk: string, callback: () => void): unknown;
}

export function flushStream(stream: FlushableStream): Promise<void> {
  return new Promise((resolve) => {
    // Nothing queued: avoid an unnecessary tick.
    if (stream.writableLength === 0) {
      resolve();
      return;
    }
    try {
      stream.write("", () => resolve());
    } catch {
      // Closed or non-writable (EPIPE is handled separately); nothing to flush.
      resolve();
    }
  });
}

export async function flushStreams(streams: readonly FlushableStream[]): Promise<void> {
  await Promise.all(streams.map(flushStream));
}