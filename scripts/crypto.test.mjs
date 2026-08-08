import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ITERATIONS = 310_000;

async function deriveKey(password, salt) {
  const baseKey = await webcrypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

test("vault encryption round-trips and authenticates tampering", async () => {
  const password = "correct horse battery staple";
  const payload = JSON.stringify({ name: "OPENAI_API_KEY", value: "sk-test-value" });
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(payload)));

  const plaintext = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  assert.equal(decoder.decode(plaintext), payload);

  const tampered = new Uint8Array(ciphertext);
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(
    webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, tampered),
    /operation|authentication|decrypt/i
  );

  const wrongKey = await deriveKey("wrong password", salt);
  await assert.rejects(webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, wrongKey, ciphertext));
});
