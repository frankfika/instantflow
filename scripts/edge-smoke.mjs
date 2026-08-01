import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

const base = process.env.EDGE_URL || "http://127.0.0.1:8793";

const key = async () => {
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return webcrypto.subtle.exportKey("jwk", pair.publicKey);
};

const json = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  return { response, body };
};

const health = await json("/api/health");
assert.equal(health.response.status, 200);
assert.equal(health.body.storage, "durable-objects");
assert.equal(health.response.headers.get("x-frame-options"), "DENY");
assert.equal(
  health.response.headers.get("cross-origin-resource-policy"),
  "same-origin",
);
assert.match(
  health.response.headers.get("content-security-policy") || "",
  /frame-ancestors 'none'/,
);
assert.match(
  health.response.headers.get("strict-transport-security") || "",
  /max-age=31536000/,
);
assert.equal(
  (
    await fetch(`${base}/api/health`, {
      headers: { origin: "https://attacker.example" },
    })
  ).status,
  403,
);
assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);

const created = await json("/api/rooms", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ minutes: 1, senderPublicKey: await key() }),
});
assert.equal(created.response.status, 201);
assert.match(created.body.code, /^\d{8}$/);

const found = await json(`/api/rooms/code/${created.body.code}`);
assert.equal(found.response.status, 200);
assert.equal(found.body.roomId, created.body.roomId);

const joined = await json(`/api/rooms/${created.body.roomId}/join`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ receiverPublicKey: await key() }),
});
assert.equal(joined.response.status, 200);

const ciphertext = new Uint8Array(2_500_000);
for (let offset = 0; offset < ciphertext.length; offset += 65_536)
  webcrypto.getRandomValues(
    ciphertext.subarray(offset, Math.min(offset + 65_536, ciphertext.length)),
  );
const uploaded = await json(`/api/rooms/${created.body.roomId}/upload`, {
  method: "PUT",
  headers: { authorization: `Bearer ${created.body.uploadToken}` },
  body: ciphertext,
});
assert.equal(uploaded.response.status, 200);
assert.equal(uploaded.body.status, "ready");

const denied = await fetch(
  `${base}/api/rooms/${created.body.roomId}/payload`,
);
assert.equal(denied.status, 401);

const downloaded = await fetch(
  `${base}/api/rooms/${created.body.roomId}/payload`,
  { headers: { authorization: `Bearer ${joined.body.receiverToken}` } },
);
assert.equal(downloaded.status, 200);
assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), ciphertext);

const completed = await json(`/api/rooms/${created.body.roomId}/complete`, {
  method: "DELETE",
  headers: { authorization: `Bearer ${joined.body.receiverToken}` },
});
assert.equal(completed.response.status, 200);
assert.equal(completed.body.deleted, true);
assert.equal(
  (await json(`/api/rooms/code/${created.body.code}`)).response.status,
  404,
);
assert.equal(
  (await json(`/api/rooms/${created.body.roomId}`)).response.status,
  410,
);

console.log("Edge smoke test passed: isolated DO storage + one-time deletion");
