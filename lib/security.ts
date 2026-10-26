import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDirectory } from "./db";

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [algorithm, salt64, hash64] = stored.split("$");
  if (algorithm !== "scrypt" || !salt64 || !hash64) return false;
  const expected = Buffer.from(hash64, "base64");
  const actual = scryptSync(password, Buffer.from(salt64, "base64"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function secretKey() {
  let secret = process.env.APP_SECRET?.trim();
  if (!secret) {
    const file = path.join(dataDirectory(), ".app-secret");
    if (!existsSync(file)) writeFileSync(file, randomBytes(48).toString("base64url"), { encoding: "utf8", mode: 0o600 });
    secret = readFileSync(file, "utf8").trim();
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string) {
  if (!value) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(value: string) {
  if (!value) return "";
  const [version, iv64, tag64, encrypted64] = value.split(".");
  if (version !== "v1") throw new Error("无法读取已保存的 API 密钥。请重新录入。");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv64, "base64"));
  decipher.setAuthTag(Buffer.from(tag64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted64, "base64")), decipher.final()]).toString("utf8");
}

// Protect the first-admin bootstrap without exposing the deployment token or comparison length.
export function validSetupToken(value: string, expected = process.env.SETUP_TOKEN || "") {
  if (!expected) return true;
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return value.length <= 1024 && timingSafeEqual(digest(value), digest(expected));
}

export function validatePassword(password: string) {
  if (password.length < 10) return "密码至少需要10位";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "密码需同时包含字母和数字";
  return "";
}
