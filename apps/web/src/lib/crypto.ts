import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getSecretKey(): Buffer {
  const secret = process.env.SENTRY_TOKEN_ENCRYPTION_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error(
      "Missing or invalid SENTRY_TOKEN_ENCRYPTION_SECRET (min 32 chars)",
    );
  }

  return createHash("sha256").update(secret).digest();
}

export function encryptText(plainText: string): string {
  const iv = randomBytes(IV_LENGTH);
  const key = getSecretKey();
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptText(cipherText: string): string {
  const [ivB64, tagB64, encryptedB64] = cipherText.split(":");
  if (!ivB64 || !tagB64 || !encryptedB64) {
    throw new Error("Invalid encrypted payload format");
  }

  const key = getSecretKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
