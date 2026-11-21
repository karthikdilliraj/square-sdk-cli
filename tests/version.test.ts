import { describe, expect, it } from "bun:test";
import { formatVersionLine, getVersions } from "../src/version";

describe("version", () => {
  it("resolves the CLI version from its package.json", () => {
    expect(getVersions().cli).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("resolves the installed Square SDK version", () => {
    expect(getVersions().sdk).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("formats with and without an SDK version", () => {
    expect(formatVersionLine({ cli: "1.2.3", sdk: "9.9.9" })).toBe(
      "square-sdk-cli 1.2.3 (Square SDK 9.9.9)",
    );
    expect(formatVersionLine({ cli: "1.2.3" })).toBe("square-sdk-cli 1.2.3");
  });
});
