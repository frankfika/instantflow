import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { webcrypto } from "node:crypto";

const port = 8791;
const base = `http://127.0.0.1:${port}`;
let server;

async function waitForHealth(url = base) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("test server did not start");
}

async function publicKey() {
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return webcrypto.subtle.exportKey("jwk", pair.publicKey);
}

async function verifier(salt, passphrase) {
  const digest = await webcrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt}:${passphrase}`),
  );
  return Buffer.from(digest).toString("base64url");
}

async function json(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function createRoom() {
  const key = await publicKey();
  const { response, body } = await json("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ minutes: 5, senderPublicKey: key }),
  });
  assert.equal(response.status, 201);
  return body;
}

before(async () => {
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth();
});

after(() => server?.kill("SIGTERM"));

test("static responses include restrictive security headers", async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "same-origin",
  );
  assert.match(
    response.headers.get("content-security-policy") || "",
    /frame-ancestors 'none'/,
  );
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    (
      await fetch(`${base}/`, {
        method: "POST",
      })
    ).status,
    405,
  );
});

test("CORS rejects untrusted browser origins", async () => {
  const rejected = await fetch(`${base}/api/health`, {
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(rejected.status, 403);
  const sameOrigin = await fetch(`${base}/api/health`, {
    headers: { origin: base },
  });
  assert.equal(sameOrigin.status, 200);
});

test("room creation validates key and generates the code server-side", async () => {
  const invalid = await json("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error, "invalid_public_key");
  const offCurve = await json("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      senderPublicKey: {
        kty: "EC",
        crv: "P-256",
        x: "A".repeat(43),
        y: "A".repeat(43),
      },
    }),
  });
  assert.equal(offCurve.response.status, 400);
  assert.equal(offCurve.body.error, "invalid_public_key");
  const room = await createRoom();
  assert.match(room.code, /^\d{8}$/);
  assert.match(room.roomId, /^[A-Za-z0-9_-]{20,30}$/);
  assert.ok(room.uploadToken.length >= 40);
  const visible = await json(`/api/rooms/${room.roomId}`);
  assert.equal(visible.body.code, undefined);
  assert.equal(visible.body.uploadToken, undefined);
  assert.equal(visible.body.envelope, undefined);
});

test("upload and pairing reject invalid credentials and keys", async () => {
  const room = await createRoom();
  const unauthorized = await json(`/api/rooms/${room.roomId}/upload`, {
    method: "PUT",
    body: "ciphertext",
  });
  assert.equal(unauthorized.response.status, 401);
  const earlyUpload = await json(`/api/rooms/${room.roomId}/upload`, {
    method: "PUT",
    headers: { authorization: `Bearer ${room.uploadToken}` },
    body: "ciphertext",
  });
  assert.equal(earlyUpload.response.status, 409);
  assert.equal(earlyUpload.body.error, "not_paired");
  const badJoin = await json(`/api/rooms/${room.roomId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ receiverPublicKey: { kty: "EC" } }),
  });
  assert.equal(badJoin.response.status, 400);
  const oversizedJson = await json("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(20_000) }),
  });
  assert.equal(oversizedJson.response.status, 413);
});

test("only paired receiver can complete and completion destroys room", async () => {
  const room = await createRoom();
  const receiverPublicKey = await publicKey();
  const joined = await json(`/api/rooms/${room.roomId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ receiverPublicKey }),
  });
  assert.equal(joined.response.status, 200);
  assert.ok(joined.body.receiverToken.length >= 40);
  const attackerKey = await publicKey();
  const secondJoin = await json(`/api/rooms/${room.roomId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ receiverPublicKey: attackerKey }),
  });
  assert.equal(secondJoin.response.status, 409);
  const repeatedJoin = await json(`/api/rooms/${room.roomId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ receiverPublicKey }),
  });
  assert.equal(repeatedJoin.response.status, 409);
  assert.equal(repeatedJoin.body.receiverToken, undefined);
  const uploaded = await json(`/api/rooms/${room.roomId}/upload`, {
    method: "PUT",
    headers: { authorization: `Bearer ${room.uploadToken}` },
    body: "opaque-encrypted-envelope",
  });
  assert.equal(uploaded.response.status, 200);
  const deniedPayload = await fetch(
    `${base}/api/rooms/${room.roomId}/payload`,
  );
  assert.equal(deniedPayload.status, 401);
  const payload = await fetch(`${base}/api/rooms/${room.roomId}/payload`, {
    headers: { authorization: `Bearer ${joined.body.receiverToken}` },
  });
  assert.equal(payload.status, 200);
  assert.equal(await payload.text(), "opaque-encrypted-envelope");
  const wrongToken = await json(`/api/rooms/${room.roomId}/complete`, {
    method: "DELETE",
    headers: { authorization: "Bearer wrong" },
  });
  assert.equal(wrongToken.response.status, 401);
  const completed = await json(`/api/rooms/${room.roomId}/complete`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${joined.body.receiverToken}` },
  });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.body.reason, "received");
  assert.equal((await json(`/api/rooms/${room.roomId}`)).response.status, 410);
  assert.equal(
    (await json(`/api/rooms/code/${room.code}`)).response.status,
    404,
  );
});

test("sender revocation requires sender token and destroys room", async () => {
  const room = await createRoom();
  const denied = await json(`/api/rooms/${room.roomId}/revoke`, {
    method: "DELETE",
    headers: { authorization: "Bearer wrong" },
  });
  assert.equal(denied.response.status, 401);
  const revoked = await json(`/api/rooms/${room.roomId}/revoke`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${room.uploadToken}` },
  });
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.body.reason, "revoked");
  assert.equal((await json(`/api/rooms/${room.roomId}`)).response.status, 410);
});

test("optional network and passphrase restrictions are enforced before pairing", async () => {
  const restrictedPort = 8793;
  const restrictedBase = `http://127.0.0.1:${restrictedPort}`;
  const restrictedServer = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(restrictedPort),
      NODE_ENV: "test",
      TRUST_PROXY: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(restrictedBase);
    const salt = Buffer.alloc(16, 7).toString("base64url");
    const passphraseVerifier = await verifier(salt, "correct horse");
    const created = await fetch(`${restrictedBase}/api/rooms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "2001:db8:abcd:1::10",
      },
      body: JSON.stringify({
        minutes: 5,
        senderPublicKey: await publicKey(),
        sameNetworkOnly: true,
        passphraseSalt: salt,
        passphraseVerifier,
      }),
    });
    assert.equal(created.status, 201);
    const room = await created.json();
    assert.equal(room.sameNetworkOnly, true);
    assert.equal(room.requiresPassphrase, true);
    assert.equal(room.passphraseSalt, salt);
    assert.equal(room.passphraseVerifier, undefined);

    const receiverPublicKey = await publicKey();
    const join = (address, suppliedVerifier) =>
      fetch(`${restrictedBase}/api/rooms/${room.roomId}/join`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": address,
        },
        body: JSON.stringify({ receiverPublicKey, passphraseVerifier: suppliedVerifier }),
      });

    const otherNetwork = await join("2001:db8:abcd:2::20", passphraseVerifier);
    assert.equal(otherNetwork.status, 403);
    assert.equal((await otherNetwork.json()).error, "restricted_network");

    const wrongPassphrase = await join(
      "2001:db8:abcd:1::99",
      await verifier(salt, "wrong horse"),
    );
    assert.equal(wrongPassphrase.status, 403);
    assert.equal((await wrongPassphrase.json()).error, "invalid_passphrase");

    const accepted = await join("2001:db8:abcd:1::ff", passphraseVerifier);
    assert.equal(accepted.status, 200);
    assert.ok((await accepted.json()).receiverToken);
  } finally {
    restrictedServer.kill("SIGTERM");
  }
});

test("same-network restriction matches IPv4 /24 subnet for two devices on same LAN", async () => {
  const restrictedPort = 8794;
  const restrictedBase = `http://127.0.0.1:${restrictedPort}`;
  const restrictedServer = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(restrictedPort),
      NODE_ENV: "test",
      TRUST_PROXY: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(restrictedBase);

    // Room created from 192.168.1.10
    const created = await fetch(`${restrictedBase}/api/rooms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "192.168.1.10",
      },
      body: JSON.stringify({
        minutes: 5,
        senderPublicKey: await publicKey(),
        sameNetworkOnly: true,
      }),
    });
    assert.equal(created.status, 201);
    const room = await created.json();

    // Different device on same /24 subnet (192.168.1.20) → allowed
    const receiverPublicKey = await publicKey();
    const sameSubnet = await fetch(
      `${restrictedBase}/api/rooms/${room.roomId}/join`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.168.1.20",
        },
        body: JSON.stringify({ receiverPublicKey }),
      },
    );
    assert.equal(sameSubnet.status, 200);

    // Second room from 192.168.1.10, join from different /24 (192.168.2.50) → rejected
    const created2 = await fetch(`${restrictedBase}/api/rooms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "192.168.1.10",
      },
      body: JSON.stringify({
        minutes: 5,
        senderPublicKey: await publicKey(),
        sameNetworkOnly: true,
      }),
    });
    const room2 = await created2.json();
    const otherSubnet = await fetch(
      `${restrictedBase}/api/rooms/${room2.roomId}/join`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.168.2.50",
        },
        body: JSON.stringify({ receiverPublicKey: await publicKey() }),
      },
    );
    assert.equal(otherSubnet.status, 403);
    assert.equal((await otherSubnet.json()).error, "restricted_network");
  } finally {
    restrictedServer.kill("SIGTERM");
  }
});

test("pair-code guessing is rate limited", async () => {
  const statuses = [];
  for (let i = 0; i < 12; i += 1) {
    const response = await fetch(
      `${base}/api/rooms/code/${String(70000000 + i)}`,
    );
    statuses.push(response.status);
  }
  assert.ok(statuses.includes(429));
});

test("expired rooms disappear from id and code lookup", async () => {
  const expiryPort = 8792;
  const expiryBase = `http://127.0.0.1:${expiryPort}`;
  const expiryServer = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(expiryPort),
      NODE_ENV: "test",
      ROOM_TTL_OVERRIDE_MS: "80",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(expiryBase);
    const key = await publicKey();
    const createdResponse = await fetch(`${expiryBase}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ minutes: 1, senderPublicKey: key }),
    });
    const room = await createdResponse.json();
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(
      (await fetch(`${expiryBase}/api/rooms/${room.roomId}`)).status,
      410,
    );
    assert.equal(
      (await fetch(`${expiryBase}/api/rooms/code/${room.code}`)).status,
      404,
    );
  } finally {
    expiryServer.kill("SIGTERM");
  }
});
