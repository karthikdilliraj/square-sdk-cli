#!/usr/bin/env bun

import { run } from "../src/cli";
import { guardBrokenPipe } from "../src/epipe";

// `square ... | head` closes stdout early; exit quietly instead of a stack trace.
guardBrokenPipe([process.stdout, process.stderr]);

const exitCode = await run(process.argv.slice(2));
process.exit(exitCode);
