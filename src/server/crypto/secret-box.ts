import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets stored in the database, such as the
 * SimpleFIN Access URL (Phase 3). The key comes from APP_ENCRYPTION_KEY.
 *
 * Stored format: "v1:<iv base64>:<auth tag base64>:<ciphertext base64>".
 * The version prefix lets us rotate algorithms or keys later.
 */

const VERSION = "v1";
const IV_BYTES = 12;

function keyFromBase64(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes");
  return key;
}

export function encryptSecret(plaintext: string, keyBase64: string): string {
  const key = keyFromBase64(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(stored: string, keyBase64: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Unrecognized encrypted value format");
  }
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFromBase64(keyBase64),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
