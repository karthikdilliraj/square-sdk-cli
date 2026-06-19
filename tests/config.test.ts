import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { load, save, setProfile, getProfile, listProfiles, useProfile } from "../src/config";

function makeTempConfigPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sq-cli-test-"));
  return path.join(dir, "config.json");
}

let originalEnv: string | undefined;
let tmpPath: string;

beforeEach(() => {
  originalEnv = process.env["SQUARE_CLI_CONFIG"];
  tmpPath = makeTempConfigPath();
  process.env["SQUARE_CLI_CONFIG"] = tmpPath;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env["SQUARE_CLI_CONFIG"];
  } else {
    process.env["SQUARE_CLI_CONFIG"] = originalEnv;
  }
  // cleanup tmp
  try {
    fs.rmSync(path.dirname(tmpPath), { recursive: true });
  } catch {}
});

describe("config - load", () => {
  it("returns empty config when file missing", async () => {
    const cfg = await load();
    expect(cfg.profiles).toEqual({});
    expect(cfg.defaultProfile).toBeUndefined();
  });

  it("loads valid config file", async () => {
    const data = {
      profiles: { default: { token: "tok123", environment: "sandbox" } },
      defaultProfile: "default",
    };
    fs.writeFileSync(tmpPath, JSON.stringify(data));
    const cfg = await load();
    expect(cfg.profiles["default"]?.token).toBe("tok123");
    expect(cfg.defaultProfile).toBe("default");
  });

  it("throws on malformed JSON", async () => {
    fs.writeFileSync(tmpPath, "{bad json}");
    await expect(load()).rejects.toThrow();
  });
});

describe("config - save", () => {
  it("writes config to file with mode 0600", async () => {
    const cfg = { profiles: { myprofile: { token: "tok", environment: "sandbox" as const } } };
    await save(cfg);
    expect(fs.existsSync(tmpPath)).toBe(true);
    const mode = fs.statSync(tmpPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("writes pretty JSON (2-space indent)", async () => {
    const cfg = { profiles: { p: { token: "t", environment: "sandbox" as const } } };
    await save(cfg);
    const content = fs.readFileSync(tmpPath, "utf8");
    expect(content).toContain("  ");
  });

  it("creates parent directory if missing", async () => {
    const deepPath = path.join(path.dirname(tmpPath), "subdir", "config.json");
    process.env["SQUARE_CLI_CONFIG"] = deepPath;
    const cfg = { profiles: {} };
    await save(cfg);
    expect(fs.existsSync(deepPath)).toBe(true);
    fs.rmSync(path.dirname(deepPath), { recursive: true });
  });
});

describe("config - setProfile / getProfile", () => {
  it("set and get round-trip", async () => {
    await setProfile("prod", { token: "prodtok", environment: "production" });
    const profile = await getProfile("prod");
    expect(profile?.token).toBe("prodtok");
    expect(profile?.environment).toBe("production");
  });

  it("partial update merges with existing", async () => {
    await setProfile("dev", { token: "tok1", environment: "sandbox" });
    await setProfile("dev", { token: "tok2" });
    const profile = await getProfile("dev");
    expect(profile?.token).toBe("tok2");
    expect(profile?.environment).toBe("sandbox");
  });

  it("getProfile returns undefined for missing profile", async () => {
    const profile = await getProfile("nonexistent");
    expect(profile).toBeUndefined();
  });
});

describe("config - listProfiles", () => {
  it("returns empty array when no profiles", async () => {
    const list = await listProfiles();
    expect(list).toEqual([]);
  });

  it("returns profile names", async () => {
    await setProfile("a", { token: "ta", environment: "sandbox" });
    await setProfile("b", { token: "tb", environment: "production" });
    const list = await listProfiles();
    expect(list).toContain("a");
    expect(list).toContain("b");
  });
});

describe("config - useProfile", () => {
  it("sets defaultProfile to known profile", async () => {
    await setProfile("myprofile", { token: "tok", environment: "sandbox" });
    await useProfile("myprofile");
    const cfg = await load();
    expect(cfg.defaultProfile).toBe("myprofile");
  });

  it("throws error for unknown profile", async () => {
    await expect(useProfile("unknown")).rejects.toThrow();
  });
});
