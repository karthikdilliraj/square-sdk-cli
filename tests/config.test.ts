import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getProfile,
  listProfiles,
  load,
  putProfile,
  removeProfile,
  save,
  setProfile,
  useProfile,
} from "../src/config";

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

describe("config - load validation", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["top-level array", [], /expected a JSON object/],
    ["profiles not an object", { profiles: "x" }, /"profiles" must be an object/],
    [
      "profile missing token",
      { profiles: { p: { environment: "sandbox" } } },
      /profile "p" is missing a "token"/,
    ],
    [
      "bad environment",
      { profiles: { p: { token: "t", environment: "prod" } } },
      /environment "prod"/,
    ],
    [
      "defaultProfile not a string",
      { profiles: {}, defaultProfile: 1 },
      /"defaultProfile" must be a string/,
    ],
  ];

  for (const [label, data, pattern] of cases) {
    it(`rejects ${label}`, async () => {
      fs.writeFileSync(tmpPath, JSON.stringify(data));
      await expect(load()).rejects.toThrow(pattern);
    });
  }

  it("treats a missing profiles key as empty", async () => {
    fs.writeFileSync(tmpPath, "{}");
    const cfg = await load();
    expect(cfg.profiles).toEqual({});
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

describe("config - atomic saves and permissions", () => {
  const onWindows = process.platform === "win32";

  it("leaves no temp files behind after saving", async () => {
    await save({ profiles: { p: { token: "t", environment: "sandbox" } } });
    expect(fs.readdirSync(path.dirname(tmpPath))).toEqual(["config.json"]);
  });

  it("creates the profile directory with mode 0700", async () => {
    if (onWindows) return;
    const deepPath = path.join(path.dirname(tmpPath), "nested", "config.json");
    process.env["SQUARE_CLI_CONFIG"] = deepPath;
    await save({ profiles: {} });
    expect(fs.statSync(path.dirname(deepPath)).mode & 0o777).toBe(0o700);
  });

  it("re-tightens a loosely-permissioned config file on load", async () => {
    if (onWindows) return;
    fs.writeFileSync(tmpPath, JSON.stringify({ profiles: {} }));
    fs.chmodSync(tmpPath, 0o644);
    await load();
    expect(fs.statSync(tmpPath).mode & 0o777).toBe(0o600);
  });

  it("leaves an owner-only file alone", async () => {
    if (onWindows) return;
    fs.writeFileSync(tmpPath, JSON.stringify({ profiles: {} }));
    fs.chmodSync(tmpPath, 0o400);
    await load();
    expect(fs.statSync(tmpPath).mode & 0o777).toBe(0o400);
  });

  it("replaces the file rather than rewriting it in place", async () => {
    await setProfile("p", { token: "one", environment: "sandbox" });
    const before = fs.statSync(tmpPath).ino;
    await setProfile("p", { token: "two" });
    const after = fs.statSync(tmpPath).ino;
    // A rename installs a new inode; an in-place write keeps the old one.
    if (!onWindows) expect(after).not.toBe(before);
    expect((await getProfile("p"))?.token).toBe("two");
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

describe("config - removeProfile", () => {
  it("deletes a non-default profile and keeps the default", async () => {
    await setProfile("a", { token: "ta", environment: "sandbox" });
    await setProfile("b", { token: "tb", environment: "sandbox" });
    await useProfile("a");
    expect(await removeProfile("b")).toBe(false);
    const cfg = await load();
    expect(Object.keys(cfg.profiles)).toEqual(["a"]);
    expect(cfg.defaultProfile).toBe("a");
  });

  it("clears the default when the default is removed", async () => {
    await setProfile("a", { token: "ta", environment: "sandbox" });
    await useProfile("a");
    expect(await removeProfile("a")).toBe(true);
    const cfg = await load();
    expect(cfg.profiles).toEqual({});
    expect(cfg.defaultProfile).toBeUndefined();
  });

  it("throws for an unknown profile", async () => {
    await expect(removeProfile("nope")).rejects.toThrow(/does not exist/);
  });
});

describe("config - keychain profiles", () => {
  it("accepts a keychain profile without a token", async () => {
    fs.writeFileSync(
      tmpPath,
      JSON.stringify({ profiles: { p: { environment: "sandbox", keychain: true } } }),
    );
    const cfg = await load();
    expect(cfg.profiles["p"]).toEqual({ environment: "sandbox", keychain: true });
  });

  it("still rejects a profile with neither token nor keychain", async () => {
    fs.writeFileSync(tmpPath, JSON.stringify({ profiles: { p: { environment: "sandbox" } } }));
    await expect(load()).rejects.toThrow(/missing a "token"/);
  });

  it("rejects a non-boolean keychain flag", async () => {
    fs.writeFileSync(
      tmpPath,
      JSON.stringify({ profiles: { p: { environment: "sandbox", keychain: "yes" } } }),
    );
    await expect(load()).rejects.toThrow(/non-boolean "keychain"/);
  });

  it("putProfile replaces the profile wholesale", async () => {
    await setProfile("p", { token: "old", environment: "sandbox" });
    await putProfile("p", { environment: "production", keychain: true });
    const cfg = await load();
    expect(cfg.profiles["p"]).toEqual({ environment: "production", keychain: true });
  });
});
