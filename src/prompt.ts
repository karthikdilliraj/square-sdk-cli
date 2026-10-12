/**
 * prompt.ts - Interactive terminal input (confirmations, hidden secrets) and stdin.
 * Prompts are written to stderr so stdout stays clean for JSON output.
 */

import * as fs from "fs";
import * as readline from "readline";

export interface Prompter {
  /** True when both stdin and stderr are attached to a terminal. */
  isInteractive(): boolean;
  /** Ask a yes/no question; resolves true only for "y" or "yes". */
  confirm(question: string): Promise<boolean>;
  /** Read a line without echoing it (for tokens). */
  secret(question: string): Promise<string>;
  /** Read all of stdin. */
  readStdin(): string;
}

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function secret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";

    const finish = (err?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
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

    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

function readStdin(): string {
  return fs.readFileSync(0, "utf8");
}

export const terminalPrompter: Prompter = { isInteractive, confirm, secret, readStdin };
