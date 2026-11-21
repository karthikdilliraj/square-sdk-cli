/**
 * client.ts - Create a SquareClient from resolved auth.
 */

import { SquareClient, SquareEnvironment } from "square";
import type { ResolvedAuth } from "./auth.ts";

/** Transport-level options forwarded to the SDK client. */
export interface ClientOptions {
  /** Per-request HTTP timeout in seconds. */
  timeoutInSeconds?: number;
  /** How many times the SDK retries a failed request (0 disables retries). */
  maxRetries?: number;
}

export function createClient(
  auth: Pick<ResolvedAuth, "token" | "environment">,
  options: ClientOptions = {}
): SquareClient {
  const environment =
    auth.environment === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox;

  return new SquareClient({
    token: auth.token,
    environment,
    ...(options.timeoutInSeconds !== undefined
      ? { timeoutInSeconds: options.timeoutInSeconds }
      : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  });
}