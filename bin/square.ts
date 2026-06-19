#!/usr/bin/env bun

import { run } from "../src/cli";

const exitCode = await run(process.argv.slice(2));
process.exit(exitCode);
