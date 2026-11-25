#!/usr/bin/env bun

import { run } from "../src/cli";
import { guardBrokenPipe } from "../src/epipe";

// `square ... | head` closes stdout early; exit quietly instead of a stack trace.
guardBrokenPipe([process.stdout, process.stderr]);

const exitCode = await run(process.argv.slice(2));

// Exit naturally so the runtime flushes buffered stdout/stderr: calling
// process.exit() here truncates output piped to another process. Some handles
// (e.g. SDK keep-alive sockets) can keep the loop alive, so an unref'd timer
// forces the exit if the process hasn't already finished by then.
process.exitCode = exitCode;
setTimeout(() => process.exit(exitCode), 2000).unref();
