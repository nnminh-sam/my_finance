import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword, validPassword, newToken, hashToken, validToken } from "../src/server/auth/crypto";

test("scrypt uses independent salts and verifies only the correct password", async () => {
  const password = "a long secure password";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("a different password", first), false);
  assert.equal(await verifyPassword(password, "scrypt$999999999$8$1$bad$bad"), false);
  assert.equal(await verifyPassword(password, first.slice(0, -2)), false);
});

test("password bounds reject oversized KDF input", async () => {
  assert.equal(validPassword("a".repeat(11)), false);
  assert.equal(validPassword("a".repeat(12)), true);
  assert.equal(validPassword("a".repeat(128)), true);
  assert.equal(validPassword("a".repeat(129)), false);
  assert.equal(validPassword({ length: 12 }), false);
  await assert.rejects(hashPassword("short"));
});

test("opaque tokens have 256 bits of randomness and stable SHA-256 hashes", () => {
  const token = newToken();
  assert.equal(validToken(token), true);
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.notEqual(token, newToken());
  assert.match(hashToken(token), /^[a-f0-9]{64}$/);
  assert.equal(hashToken(token), hashToken(token));
  assert.equal(validToken(`${token}extra`), false);
  assert.equal(validToken("../../cookie"), false);
});
