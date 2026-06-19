/**
 * client.ts - Create a SquareClient from resolved auth.
 */

import { SquareClient, SquareEnvironment } from "square";
import type { ResolvedAuth } from "./auth.ts";

export function createClient(auth: ResolvedAuth): SquareClient {
  const environment =
    auth.environment === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox;

  return new SquareClient({
    token: auth.token,
    environment,
  });
}
