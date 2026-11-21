import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { guardBrokenPipe } from "../src/epipe";

function makeGuard() {
  const exits: number[] = [];
  const reported: unknown[] = [];
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  guardBrokenPipe([stdout, stderr], {
    exit: (code) => exits.push(code),
    report: (err) => reported.push(err),
  });
  return { stdout, stderr, exits, reported };
}

function epipe(): NodeJS.ErrnoException {
  const err = new Error("write EPIPE") as NodeJS.ErrnoException;
  err.code = "EPIPE";
  return err;
}

describe("guardBrokenPipe", () => {
  it("exits 0 when stdout is closed early", () => {
    const { stdout, exits, reported } = makeGuard();
    stdout.emit("error", epipe());
    expect(exits).toEqual([0]);
    expect(reported).toEqual([]);
  });

  it("guards stderr as well", () => {
    const { stderr, exits } = makeGuard();
    stderr.emit("error", epipe());
    expect(exits).toEqual([0]);
  });

  it("exits 1 and reports other stream errors", () => {
    const { stdout, exits, reported } = makeGuard();
    const err = new Error("EIO: i/o error");
    stdout.emit("error", err);
    expect(exits).toEqual([1]);
    expect(reported).toEqual([err]);
  });

  it("survives a null error payload", () => {
    const { stdout, exits, reported } = makeGuard();
    stdout.emit("error", null);
    expect(exits).toEqual([1]);
    expect(reported).toEqual([null]);
  });
});
