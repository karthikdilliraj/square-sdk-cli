#!/usr/bin/env bun

import { run } from "../src/cli";
import { guardBrokenPipe } from "../src/epipe";
import { flushStreams } from "../src/stdio";

// `square ... | head` closes stdout early; exit quietly instead of a stack trace.
guardBrokenPipe([process.stdout, process.stderr]);

const exitCode = await run(process.argv.slice(2));

// process.exit() would truncate writes still buffered for a pipe.
process.exitCode = exitCode;
await flushStreams([process.stdout, process.stderr]);
process.exit(exitCode);
