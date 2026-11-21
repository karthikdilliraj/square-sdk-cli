import { describe, it, expect } from "bun:test";
import { SquareEnvironment } from "square";
import { createClient } from "../src/client";

describe("createClient", () => {
  it("forwards timeout and retry options to the SDK", () => {
    const client = createClient(
      { token: "dummy", environment: "sandbox" },
      { timeoutInSeconds: 5, maxRetries: 0 }
    );
    const options = (client as any)._options;
    expect(options.timeoutInSeconds).toBe(5);
    expect(options.maxRetries).toBe(0);
  });

  it("leaves transport options unset by default", () => {
    const options = (createClient({ token: "dummy", environment: "sandbox" }) as any)._options;
    expect(options.timeoutInSeconds).toBeUndefined();
    expect(options.maxRetries).toBeUndefined();
  });

  it("maps the environment", () => {
    const sandbox = (createClient({ token: "t", environment: "sandbox" }) as any)._options;
    const production = (createClient({ token: "t", environment: "production" }) as any)._options;
    expect(sandbox.environment).toBe(SquareEnvironment.Sandbox);
    expect(production.environment).toBe(SquareEnvironment.Production);
  });
});