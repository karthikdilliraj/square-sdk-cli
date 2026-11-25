/**
 * prompt.ts - Interactive terminal input (confirmations, hidden secrets) and stdin.
 * Prompts are written to stderr so stdout stays clean for JSON output.
 */

import * as readline from "node:readline";

export interface Prompter {
  /** True when both stdin and stderr are attached to a terminal. */
  isInteractive(): boolean;
  /** Ask a yes/no question; resolves true only for "y" or "yes". */
  confirm(question: string): Promise<boolean>;
  /** Read a line without echoing it (for tokens). */
  secret(question: string): Promise<string>;
  /** Read all of stdin. */
  readStdin(): Promise<string>;
}

/** The slice of a readable stream prompting needs (fakeable in tests). */
export interface PromptInput {
  isTTY?: boolean;
  setEncoding(encoding: "utf8"): unknown;
  setRawMode?(mode: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  off(event: "data", listener: (chunk: string) => void): unknown;
  [Symbol.asyncIterator](): AsyncIterator<string>;
}

/** The slice of a writable stream prompting needs (fakeable in tests). */
export interface PromptOutput {
  isTTY?: boolean;
  write(chunk: string): unknown;
}

export interface PromptIO {
  stdin: PromptInput;
  stderr: PromptOutput;
}

/**
 * Build a prompter over the given streams. The default (`terminalPrompter`)
 * uses the real terminal; tests pass fakes.
 */
export function createPrompter({ stdin, stderr }: PromptIO): Prompter {
  return {
    isInteractive: () => Boolean(stdin.isTTY && stderr.isTTY),

    confirm: async (question) => {
      const rl = readline.createInterface({
        input: stdin as unknown as NodeJS.ReadableStream,
        output: stderr as unknown as NodeJS.WritableStream,
        terminal: false,
      });
      const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
      rl.close();
      return /^y(es)?$/i.test(answer.trim());
    },

    secret: (question) =>
      new Promise((resolve, reject) => {
        let value = "";

        const finish = (err?: Error) => {
          stdin.off("data", onData);
          stdin.setRawMode?.(false);
          stdin.pause();
          stderr.write("\n");
          if (err) reject(err);
          else resolve(value);
        };

        const onData = (chunk: string) => {
          for (const ch of chunk) {
            if (ch === "\r" || ch === "\n") return finish();
            if (ch === "\u0003") return finish(new Error("Cancelled"));
            if (ch === "\u007f" || ch === "\b") {
              value = value.slice(0, -1);
              continue;
            }
            value += ch;
          }
        };

        stderr.write(question);
        stdin.setRawMode?.(true);
        stdin.setEncoding("utf8");
        stdin.resume();
        stdin.on("data", onData);
      }),

    readStdin: async () => {
      let data = "";
      stdin.setEncoding("utf8");
      for await (const chunk of stdin) data += chunk;
      return data;
    },
  };
}

export const terminalPrompter: Prompter = createPrompter({
  stdin: process.stdin,
  stderr: process.stderr,
});
