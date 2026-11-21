import { describe, it, expect } from "bun:test";
import { flushStream, flushStreams } from "../src/stdio";

function fakeStream(writableLength: number | undefined, opts: { throws?: boolean } = {}) {
  const writes: string[] = [];
  return {
    writes,
    writableLength,
    write(chunk: string, callback: () => void) {
      if (opts.throws) throw new Error("EPIPE");
      writes.push(chunk);
      callback();
      return true;
    },
  };
}

describe("flushStream", () => {
  it("waits for the write callback when data is buffered", async () => {
    const stream = fakeStream(42);
    await flushStream(stream);
    expect(stream.writes).toEqual([""]);
  });

  it("resolves without writing when nothing is buffered", async () => {
    const stream = fakeStream(0);
    await flushStream(stream);
    expect(stream.writes).toEqual([]);
  });

  it("resolves instead of throwing when the stream is unwritable", async () => {
    await expect(flushStream(fakeStream(undefined, { throws: true }))).resolves.toBeUndefined();
  });

  it("flushes every stream", async () => {
    const a = fakeStream(1);
    const b = fakeStream(1);
    await flushStreams([a, b]);
    expect(a.writes.length).toBe(1);
    expect(b.writes.length).toBe(1);
  });
});