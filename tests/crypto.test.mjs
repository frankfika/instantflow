import test from "node:test";
import assert from "node:assert/strict";
import {
  createPair,
  createPassphraseSalt,
  decryptPayload,
  derivePassphraseMaterial,
  derivePassphraseVerifier,
  deriveSession,
  encryptPayload,
  safeDownloadName,
} from "../src/crypto.js";

test("both devices derive the same bound session and verification code", async () => {
  const sender = await createPair();
  const receiver = await createPair();
  const senderSession = await deriveSession(
    sender.privateKey,
    sender.publicKey,
    receiver.publicKey,
  );
  const receiverSession = await deriveSession(
    receiver.privateKey,
    receiver.publicKey,
    sender.publicKey,
  );
  assert.match(
    senderSession.verificationCode,
    /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/,
  );
  assert.equal(senderSession.verificationCode, receiverSession.verificationCode);

  const envelope = await encryptPayload(
    { kind: "text", text: "private message" },
    senderSession.encryptionKey,
  );
  const result = await decryptPayload(receiverSession.encryptionKey, envelope);
  assert.equal(new TextDecoder().decode(result.data), "private message");
});

test("authenticated envelope rejects tampering and malformed versions", async () => {
  const sender = await createPair();
  const receiver = await createPair();
  const senderSession = await deriveSession(
    sender.privateKey,
    sender.publicKey,
    receiver.publicKey,
  );
  const receiverSession = await deriveSession(
    receiver.privateKey,
    receiver.publicKey,
    sender.publicKey,
  );
  const envelope = await encryptPayload(
    { kind: "text", text: "do not alter" },
    senderSession.encryptionKey,
  );
  const parsed = JSON.parse(new TextDecoder().decode(envelope));
  const tamperAt = Math.floor(parsed.data.length / 2);
  parsed.data = `${parsed.data.slice(0, tamperAt)}${parsed.data[tamperAt] === "A" ? "B" : "A"}${parsed.data.slice(tamperAt + 1)}`;
  await assert.rejects(
    decryptPayload(
      receiverSession.encryptionKey,
      new TextEncoder().encode(JSON.stringify(parsed)),
    ),
    /invalid_envelope/,
  );
  parsed.version = 2;
  await assert.rejects(
    decryptPayload(
      receiverSession.encryptionKey,
      new TextEncoder().encode(JSON.stringify(parsed)),
    ),
    /invalid_envelope/,
  );
});

test("passphrase verifier is salted and filenames cannot contain paths", async () => {
  const salt = createPassphraseSalt();
  const first = await derivePassphraseVerifier("correct horse battery staple", salt);
  const second = await derivePassphraseVerifier("correct horse battery staple", salt);
  const other = await derivePassphraseVerifier(
    "correct horse battery staple",
    createPassphraseSalt(),
  );
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.equal(safeDownloadName("../../secret\u0000.txt"), ".._.._secret_.txt");
  assert.equal(safeDownloadName(".."), "download");
});

test("passphrase material is required to derive the same content key", async () => {
  const sender = await createPair();
  const receiver = await createPair();
  const salt = createPassphraseSalt();
  const senderPassword = await derivePassphraseMaterial("shared secret", salt);
  const receiverPassword = await derivePassphraseMaterial("shared secret", salt);
  const wrongPassword = await derivePassphraseMaterial("different secret", salt);
  assert.equal(senderPassword.verifier, receiverPassword.verifier);
  assert.equal(senderPassword.encryptionSecret, receiverPassword.encryptionSecret);
  assert.notEqual(senderPassword.verifier, senderPassword.encryptionSecret);

  const senderSession = await deriveSession(
    sender.privateKey,
    sender.publicKey,
    receiver.publicKey,
    senderPassword.encryptionSecret,
  );
  const receiverSession = await deriveSession(
    receiver.privateKey,
    receiver.publicKey,
    sender.publicKey,
    receiverPassword.encryptionSecret,
  );
  const wrongSession = await deriveSession(
    receiver.privateKey,
    receiver.publicKey,
    sender.publicKey,
    wrongPassword.encryptionSecret,
  );
  assert.equal(senderSession.verificationCode, receiverSession.verificationCode);
  assert.notEqual(senderSession.verificationCode, wrongSession.verificationCode);

  const envelope = await encryptPayload(
    { kind: "text", text: "password-bound" },
    senderSession.encryptionKey,
  );
  await assert.rejects(
    decryptPayload(wrongSession.encryptionKey, envelope),
    /invalid_envelope/,
  );
});
