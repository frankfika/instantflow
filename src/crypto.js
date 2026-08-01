const MAX_CONTENT_BYTES = 20 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 40 * 1024 * 1024;
const MAX_NAME_LENGTH = 255;
const MAX_MIME_LENGTH = 127;
const AAD = new TextEncoder().encode("instantflow-envelope-v1");

export const normalizePassphrase = (value) =>
  String(value || "").trim().normalize("NFKC");

export const createPassphraseSalt = () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return encodeBase64Url(salt);
};

export async function derivePassphraseMaterial(passphrase, saltValue) {
  const normalized = normalizePassphrase(passphrase);
  if (normalized.length < 8 || normalized.length > 64)
    throw new Error("invalid_passphrase");
  const salt = decodeBase64Url(saltValue, 16);
  if (salt.byteLength !== 16) throw new Error("invalid_passphrase");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalized),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 },
      material,
      512,
    ),
  );
  return {
    verifier: encodeBase64Url(bits.slice(0, 32)),
    encryptionSecret: encodeBase64Url(bits.slice(32, 64)),
  };
}

export async function derivePassphraseVerifier(passphrase, saltValue) {
  return (await derivePassphraseMaterial(passphrase, saltValue)).verifier;
}

const encodeBase64Url = (bytes) => {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let offset = 0; offset < view.length; offset += 0x8000)
    binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};

const decodeBase64Url = (value, maxBytes = MAX_ENVELOPE_BYTES) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value))
    throw new Error("invalid_envelope");
  const expectedBytes = Math.floor((value.length * 3) / 4);
  if (expectedBytes > maxBytes) throw new Error("invalid_envelope");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  try {
    return Uint8Array.from(
      atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4)),
      (character) => character.charCodeAt(0),
    );
  } catch {
    throw new Error("invalid_envelope");
  }
};

const canonicalPublicKey = (key) => {
  if (
    !key ||
    typeof key !== "object" ||
    key.kty !== "EC" ||
    key.crv !== "P-256" ||
    typeof key.x !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(key.x) ||
    typeof key.y !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(key.y)
  )
    throw new Error("invalid_public_key");
  return { kty: "EC", crv: "P-256", x: key.x, y: key.y };
};

const transcript = (first, second) =>
  [canonicalPublicKey(first), canonicalPublicKey(second)]
    .map((key) => JSON.stringify(key))
    .sort()
    .join("\n");

export async function createPair() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return {
    privateKey: pair.privateKey,
    publicKey: canonicalPublicKey(
      await crypto.subtle.exportKey("jwk", pair.publicKey),
    ),
  };
}

export async function deriveSession(
  privateKey,
  ownPublicJwk,
  peerPublicJwk,
  passphraseEncryptionSecret,
) {
  const peer = canonicalPublicKey(peerPublicJwk);
  const peerPublicKey = await crypto.subtle.importKey(
    "jwk",
    peer,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    256,
  );
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveKey", "deriveBits"],
  );
  const context = transcript(ownPublicJwk, peer);
  const salt = passphraseEncryptionSecret
    ? decodeBase64Url(passphraseEncryptionSecret, 32)
    : new Uint8Array(32);
  if (salt.byteLength !== 32) throw new Error("invalid_passphrase");
  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: new TextEncoder().encode(`instantflow/aes-gcm/v1\n${context}`),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const verification = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: new TextEncoder().encode(
          `instantflow/verification/v1\n${context}`,
        ),
      },
      keyMaterial,
      48,
    ),
  );
  const hex = [...verification]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return {
    encryptionKey,
    verificationCode: `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8)}`,
  };
}

export async function encryptPayload(item, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const source =
    item.kind === "text"
      ? new TextEncoder().encode(item.text)
      : new Uint8Array(await item.file.arrayBuffer());
  if (source.byteLength > MAX_CONTENT_BYTES) throw new Error("too_large");
  const inner = {
    kind: item.kind,
    name: item.kind === "file" ? safeDownloadName(item.file.name) : "临时文字.txt",
    mime:
      item.kind === "file"
        ? String(item.file.type || "application/octet-stream").slice(0, MAX_MIME_LENGTH)
        : "text/plain;charset=utf-8",
    size: source.byteLength,
    data: encodeBase64Url(source),
  };
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: AAD },
    key,
    new TextEncoder().encode(JSON.stringify(inner)),
  );
  return new TextEncoder().encode(
    JSON.stringify({ version: 1, iv: encodeBase64Url(iv), data: encodeBase64Url(encrypted) }),
  );
}

export async function decryptPayload(key, envelope) {
  if (!(envelope instanceof Uint8Array) || envelope.byteLength > MAX_ENVELOPE_BYTES)
    throw new Error("invalid_envelope");
  let outer;
  try {
    outer = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(envelope));
  } catch {
    throw new Error("invalid_envelope");
  }
  if (!outer || outer.version !== 1)
    throw new Error("invalid_envelope");
  const iv = decodeBase64Url(outer.iv, 12);
  if (iv.byteLength !== 12) throw new Error("invalid_envelope");
  const ciphertext = decodeBase64Url(outer.data);
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: AAD },
      key,
      ciphertext,
    );
  } catch {
    throw new Error("invalid_envelope");
  }
  let inner;
  try {
    inner = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
  } catch {
    throw new Error("invalid_envelope");
  }
  if (
    !inner ||
    !["file", "text"].includes(inner.kind) ||
    typeof inner.name !== "string" ||
    inner.name.length > MAX_NAME_LENGTH ||
    typeof inner.mime !== "string" ||
    inner.mime.length > MAX_MIME_LENGTH ||
    !Number.isSafeInteger(inner.size) ||
    inner.size < 0 ||
    inner.size > MAX_CONTENT_BYTES
  )
    throw new Error("invalid_envelope");
  const data = decodeBase64Url(inner.data, MAX_CONTENT_BYTES);
  if (data.byteLength !== inner.size) throw new Error("invalid_envelope");
  return { ...inner, name: safeDownloadName(inner.name), data };
}

export function safeDownloadName(value) {
  const name = String(value || "download")
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .replace(/^\.+$/, "download")
    .slice(0, MAX_NAME_LENGTH);
  return name || "download";
}
