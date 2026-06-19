import { describe, it, expect } from "bun:test";
import { resolveAuth } from "../src/auth";
import type { Config } from "../src/config";

const baseConfig: Config = { profiles: {} };

const configWithDefault: Config = {
  defaultProfile: "myprofile",
  profiles: {
    myprofile: { token: "profile-token", environment: "production" },
  },
};

describe("resolveAuth - precedence", () => {
  it("--profile flag takes highest precedence", () => {
    const config: Config = {
      profiles: {
        sandbox: { token: "sandbox-token", environment: "sandbox" },
      },
    };
    const result = resolveAuth({ profile: "sandbox" }, {}, config);
    expect(result.token).toBe("sandbox-token");
    expect(result.environment).toBe("sandbox");
  });

  it("--profile flag errors if profile missing from config", () => {
    expect(() => resolveAuth({ profile: "nonexistent" }, {}, baseConfig)).toThrow();
  });

  it("--token flag overrides env var", () => {
    const result = resolveAuth(
      { token: "flag-token" },
      { SQUARE_ACCESS_TOKEN: "env-token" },
      baseConfig
    );
    expect(result.token).toBe("flag-token");
  });

  it("env SQUARE_ACCESS_TOKEN used when no --token flag", () => {
    const result = resolveAuth({}, { SQUARE_ACCESS_TOKEN: "env-token" }, baseConfig);
    expect(result.token).toBe("env-token");
  });

  it("default profile used as last resort", () => {
    const result = resolveAuth({}, {}, configWithDefault);
    expect(result.token).toBe("profile-token");
    expect(result.environment).toBe("production");
  });

  it("throws descriptive error when no auth available", () => {
    expect(() => resolveAuth({}, {}, baseConfig)).toThrow();
  });
});

describe("resolveAuth - environment resolution", () => {
  it("SQUARE_ENVIRONMENT env var sets environment", () => {
    const result = resolveAuth(
      { token: "tok" },
      { SQUARE_ENVIRONMENT: "production" },
      baseConfig
    );
    expect(result.environment).toBe("production");
  });

  it("--env flag sets environment", () => {
    const result = resolveAuth({ token: "tok", env: "production" }, {}, baseConfig);
    expect(result.environment).toBe("production");
  });

  it("defaults to sandbox when no environment specified", () => {
    const result = resolveAuth({ token: "tok" }, {}, baseConfig);
    expect(result.environment).toBe("sandbox");
  });

  it("--env flag overrides SQUARE_ENVIRONMENT env var", () => {
    const result = resolveAuth(
      { token: "tok", env: "production" },
      { SQUARE_ENVIRONMENT: "sandbox" },
      baseConfig
    );
    expect(result.environment).toBe("production");
  });
});
