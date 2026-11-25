import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { createPrompter, type PromptInput, type PromptOutput } from "../src/prompt";

interface FakeIO {
  stdin: PassThrough & { isTTY?: boolean };
  stderr: PassThrough & { isTTY?: boolean };
  prompter: ReturnType<typeof createPrompter>;
  written: () => string;
}

function fakeIO(options: { interactive?: boolean } = {}): FakeIO {
  const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
  const stderr = new PassThrough() as PassThrough & { isTTY?: boolean };
  stdin.isTTY = options.interactive ?? false;
  stderr.isTTY = options.interactive ?? false;

  let written = "";
  stderr.on("data", (chunk: Buffer) => {
    written += chunk.toString();
  });

  const prompter = createPrompter({
    stdin: stdin as unknown as PromptInput,
    stderr: stderr as unknown as PromptOutput,
  });
  return { stdin, stderr, prompter, written: () => written };
}

describe("prompter - isInteractive", () => {
  it("is false when stdin is not a terminal", () => {
    expect(fakeIO({ interactive: false }).prompter.isInteractive()).toBe(false);
  });

  it("is true when stdin and stderr are terminals", () => {
    expect(fakeIO({ interactive: true }).prompter.isInteractive()).toBe(true);
  });

  it("is false when only stdin is a terminal", () => {
    const io = fakeIO({ interactive: true });
    io.stderr.isTTY = false;
    expect(io.prompter.isInteractive()).toBe(false);
  });
});

describe("prompter - confirm", () => {
  for (const [answer, expected] of [
    ["y\n", true],
    ["yes\n", true],
    ["Y\n", true],
    ["n\n", false],
    ["\n", false],
  ] as const) {
    it(`treats ${JSON.stringify(answer)} as ${expected}`, async () => {
      const io = fakeIO({ interactive: true });
      const result = io.prompter.confirm("Continue? ");
      io.stdin.write(answer);
      expect(await result).toBe(expected);
    });
  }
});

describe("prompter - secret", () => {
  it("collects input and handles backspace", async () => {
    const io = fakeIO({ interactive: true });
    const result = io.prompter.secret("Token: ");
    io.stdin.write("abc\u007f");
    io.stdin.write("d\r");
    expect(await result).toBe("abd");
  });

  it("writes the prompt but never the secret itself", async () => {
    const io = fakeIO({ interactive: true });
    const result = io.prompter.secret("Token: ");
    io.stdin.write("hunter2\n");
    await result;
    expect(io.written()).toContain("Token: ");
    expect(io.written()).not.toContain("hunter2");
  });

  it("rejects on ctrl-c", async () => {
    const io = fakeIO({ interactive: true });
    const result = io.prompter.secret("Token: ");
    io.stdin.write("\u0003");
    await expect(result).rejects.toThrow("Cancelled");
  });
});

describe("prompter - readStdin", () => {
  it("reads everything until EOF", async () => {
    const io = fakeIO();
    const result = io.prompter.readStdin();
    io.stdin.write("line one\n");
    io.stdin.write("line two");
    io.stdin.end();
    expect(await result).toBe("line one\nline two");
  });

  it("returns an empty string for empty stdin", async () => {
    const io = fakeIO();
    const result = io.prompter.readStdin();
    io.stdin.end();
    expect(await result).toBe("");
  });
});
