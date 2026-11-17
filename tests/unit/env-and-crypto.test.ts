import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/server/crypto/secret-box";
import { EnvError, parseEnv } from "@/server/env";

const key = () => randomBytes(32).toString("base64");

describe("parseEnv", () => {
  const valid = {
    DATABASE_URL: "postgres://u:p@db:5432/app",
    APP_URL: "http://192.168.1.20:3000",
    BETTER_AUTH_SECRET: "x".repeat(32),
    APP_ENCRYPTION_KEY: key(),
  };

  it("accepts a minimal valid config and fills defaults", () => {
    const env = parseEnv(valid);
    expect(env.DB_POOL_MAX).toBe(5);
    expect(env.JOBS_ENABLED).toBe(true);
    expect(env.TRUSTED_ORIGINS).toEqual([]);
  });

  it("splits trusted origins", () => {
    const env = parseEnv({ ...valid, TRUSTED_ORIGINS: "https://a.example, http://b.example" });
    expect(env.TRUSTED_ORIGINS).toEqual(["https://a.example", "http://b.example"]);
  });

  it("lists every problem with a hint, without echoing secret values", () => {
    const secret = "short-secret";
    try {
      parseEnv({
        ...valid,
        BETTER_AUTH_SECRET: secret,
        APP_ENCRYPTION_KEY: "abc",
        APP_URL: "nope",
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      const message = (err as Error).message;
      expect(message).toMatch(/BETTER_AUTH_SECRET/);
      expect(message).toMatch(/APP_ENCRYPTION_KEY: must be 32 random bytes/);
      expect(message).toMatch(/APP_URL/);
      expect(message).not.toContain(secret);
    }
  });
});

describe("secret box (AES-256-GCM)", () => {
  it("round-trips and never stores the plaintext", () => {
    const k = key();
    const url = "https://user:pass@bridge.example/simplefin";
    const stored = encryptSecret(url, k);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("pass");
    expect(decryptSecret(stored, k)).toBe(url);
  });

  it("uses a fresh IV each time", () => {
    const k = key();
    expect(encryptSecret("same", k)).not.toBe(encryptSecret("same", k));
  });

  it("fails with the wrong key or tampered data", () => {
    const k = key();
    const stored = encryptSecret("secret", k);
    expect(() => decryptSecret(stored, key())).toThrow();
    const parts = stored.split(":");
    const data = Buffer.from(parts[3]!, "base64");
    data[0] = data[0]! ^ 0xff;
    parts[3] = data.toString("base64");
    expect(() => decryptSecret(parts.join(":"), k)).toThrow();
    expect(() => decryptSecret("garbage", k)).toThrow(/format/);
  });
});
