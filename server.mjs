import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const rooms = new Map();
const roomsByCode = new Map();
const rateBuckets = new Map();
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024;
const distDir = path.join(process.cwd(), "dist");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const token = (bytes = 24) => crypto.randomBytes(bytes).toString("base64url");
const hashToken = (value) => crypto.createHash("sha256").update(value).digest();
const tokenMatches = (value, digest) => {
  if (!value || !digest) return false;
  const candidate = hashToken(value);
  return (
    candidate.length === digest.length &&
    crypto.timingSafeEqual(candidate, digest)
  );
};
const ipv4Subnet24 = (ip) => {
  const parts = ip.split(".");
  return `v4:${parts[0]}.${parts[1]}.${parts[2]}`;
};
const ipv6Prefix64 = (address) => {
  let value = address.toLowerCase().split("%")[0];
  if (value.startsWith("::ffff:") && /^\d+\.\d+\.\d+\.\d+$/.test(value.slice(7)))
    return ipv4Subnet24(value.slice(7));
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part)))
    return null;
  return `v6:${groups
    .slice(0, 4)
    .map((part) => part.padStart(4, "0"))
    .join(":")}`;
};
const networkIdentity = (address) => {
  const value = String(address || "unknown").replace(/^\[|\]$/g, "");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return ipv4Subnet24(value);
  return ipv6Prefix64(value) || `other:${value}`;
};
const parsePublicKey = (key) => {
  if (
    !key ||
    typeof key !== "object" ||
    key.kty !== "EC" ||
    key.crv !== "P-256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(key.x || "") ||
    !/^[A-Za-z0-9_-]{43}$/.test(key.y || "")
  )
    return null;
  const canonical = { kty: "EC", crv: "P-256", x: key.x, y: key.y };
  try {
    crypto.createPublicKey({ key: canonical, format: "jwk" });
    return canonical;
  } catch {
    return null;
  }
};
const deleteRoom = (room) => {
  rooms.delete(room.id);
  roomsByCode.delete(room.code);
};
const safeRoom = (room) => ({
  roomId: room.id,
  expiresAt: room.expiresAt,
  createdAt: room.createdAt,
  status: room.envelope
    ? "ready"
    : room.receiverPublicKey
      ? "paired"
      : "waiting",
  size: room.size || 0,
  receiverPublicKey: room.receiverPublicKey || null,
  senderPublicKey: room.senderPublicKey,
  sameNetworkOnly: Boolean(room.sameNetworkOnly),
  requiresPassphrase: Boolean(room.passphraseVerifierDigest),
  passphraseSalt: room.passphraseVerifierDigest ? room.passphraseSalt : undefined,
});
const cleanup = () => {
  const now = Date.now();
  for (const room of rooms.values())
    if (room.expiresAt <= now) deleteRoom(room);
  for (const [key, bucket] of rateBuckets)
    if (bucket.resetAt <= now) rateBuckets.delete(key);
};
setInterval(cleanup, 30_000).unref();

const securityHeaders = (res) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  res.setHeader("cross-origin-opener-policy", "same-origin");
  res.setHeader("cross-origin-resource-policy", "same-origin");
  const connectSrc =
    process.env.NODE_ENV === "production"
      ? "'self'"
      : "'self' http://localhost:8787 http://127.0.0.1:8787";
  res.setHeader(
    "content-security-policy",
    `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src ${connectSrc}; worker-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'`,
  );
  res.setHeader("x-xss-protection", "0");
  if (process.env.NODE_ENV === "production")
    res.setHeader(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
};
const allowCors = (req, res) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const protocol =
    process.env.TRUST_PROXY === "true" && forwardedProto
      ? forwardedProto
      : req.socket.encrypted
        ? "https"
        : "http";
  const sameOrigin = origin === `${protocol}://${req.headers.host}`;
  const isLocalDev =
    process.env.NODE_ENV !== "production" &&
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  if (!sameOrigin && !isLocalDev) return false;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader(
    "access-control-allow-methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  res.setHeader("access-control-max-age", "600");
  return true;
};
const clientIp = (req) =>
  process.env.TRUST_PROXY === "true"
    ? String(req.headers["x-forwarded-for"] || "")
        .split(",")[0]
        .trim() ||
      req.socket.remoteAddress ||
      "unknown"
    : req.socket.remoteAddress || "unknown";
const limited = (req, res, scope, limit, windowMs) => {
  const now = Date.now();
  const key = `${scope}:${clientIp(req)}`;
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now)
    bucket = { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  res.setHeader("ratelimit-limit", String(limit));
  res.setHeader(
    "ratelimit-remaining",
    String(Math.max(0, limit - bucket.count)),
  );
  res.setHeader(
    "ratelimit-reset",
    String(Math.ceil((bucket.resetAt - now) / 1000)),
  );
  if (bucket.count <= limit) return false;
  res.setHeader(
    "retry-after",
    String(Math.ceil((bucket.resetAt - now) / 1000)),
  );
  return true;
};
const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};
const readBody = (req, limit) =>
  new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > limit) {
      req.resume();
      reject(new Error("too_large"));
      return;
    }
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) overflow = true;
      else if (!overflow) chunks.push(chunk);
    });
    req.on("end", () =>
      overflow
        ? reject(new Error("too_large"))
        : resolve(Buffer.concat(chunks)),
    );
    req.on("error", reject);
  });
const readJson = async (req) =>
  JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString() || "{}");
const generateCode = () => {
  for (let i = 0; i < 20; i += 1) {
    const code = String(crypto.randomInt(10000000, 100000000));
    if (!roomsByCode.has(code)) return code;
  }
  throw new Error("code_space_busy");
};

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  if (!allowCors(req, res))
    return json(res, 403, { error: "origin_not_allowed" });
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (!url.pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD")
      return json(res, 405, { error: "method_not_allowed" });
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const resolved = path.resolve(distDir, `.${requested}`);
    const insideDist =
      resolved === distDir || resolved.startsWith(`${distDir}${path.sep}`);
    const hasExtension = path.extname(requested) !== "";
    const target =
      insideDist && fs.existsSync(resolved) && fs.statSync(resolved).isFile()
        ? resolved
        : !hasExtension
          ? path.join(distDir, "index.html")
          : null;
    if (!target || !fs.existsSync(target))
      return json(res, 404, { error: "not_found" });
    res.writeHead(200, {
      "content-type":
        contentTypes[path.extname(target)] || "application/octet-stream",
      "cache-control": target.endsWith("index.html")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(target).pipe(res);
  }

  cleanup();
  try {
    if (req.method === "GET" && url.pathname === "/api/health")
      return json(res, 200, { ok: true });

    if (req.method === "POST" && url.pathname === "/api/rooms") {
      if (limited(req, res, "create", 30, 60 * 60_000))
        return json(res, 429, { error: "rate_limited" });
      const body = await readJson(req);
      const senderPublicKey = parsePublicKey(body.senderPublicKey);
      if (!senderPublicKey)
        return json(res, 400, { error: "invalid_public_key" });
      const requestedMinutes = Number(body.minutes ?? 5);
      if (!Number.isFinite(requestedMinutes))
        return json(res, 400, { error: "invalid_expiry" });
      const minutes = Math.min(10, Math.max(1, Math.round(requestedMinutes)));
      const ttlOverride =
        process.env.NODE_ENV === "test"
          ? Number(process.env.ROOM_TTL_OVERRIDE_MS || 0)
          : 0;
      const ttlMs =
        ttlOverride > 0 ? Math.max(50, ttlOverride) : minutes * 60_000;
      const sameNetworkOnly = body.sameNetworkOnly === true;
      const hasPassphrase =
        typeof body.passphraseSalt === "string" ||
        typeof body.passphraseVerifier === "string";
      if (
        hasPassphrase &&
        (!/^[A-Za-z0-9_-]{20,24}$/.test(body.passphraseSalt || "") ||
          !/^[A-Za-z0-9_-]{43}$/.test(body.passphraseVerifier || ""))
      )
        return json(res, 400, { error: "invalid_security_options" });
      const room = {
        id: token(16),
        code: generateCode(),
        uploadTokenDigest: null,
        receiverTokenDigest: null,
        senderPublicKey,
        receiverPublicKey: null,
        createdAt: Date.now(),
        expiresAt: Date.now() + ttlMs,
        envelope: null,
        size: 0,
        sameNetworkOnly,
        networkKeyDigest: sameNetworkOnly
          ? hashToken(networkIdentity(clientIp(req)))
          : null,
        passphraseSalt: hasPassphrase ? body.passphraseSalt : null,
        passphraseVerifierDigest: hasPassphrase
          ? hashToken(body.passphraseVerifier)
          : null,
      };
      const uploadToken = token(32);
      room.uploadTokenDigest = hashToken(uploadToken);
      rooms.set(room.id, room);
      roomsByCode.set(room.code, room.id);
      return json(res, 201, {
        ...safeRoom(room),
        code: room.code,
        uploadToken,
      });
    }

    const codeMatch = url.pathname.match(/^\/api\/rooms\/code\/([0-9]{8})$/);
    if (req.method === "GET" && codeMatch) {
      if (limited(req, res, "code_lookup", 10, 5 * 60_000))
        return json(res, 429, { error: "rate_limited" });
      const room = rooms.get(roomsByCode.get(codeMatch[1]));
      if (!room || room.expiresAt <= Date.now())
        return json(res, 404, { error: "not_found" });
      return json(res, 200, safeRoom(room));
    }

    const match = url.pathname.match(
      /^\/api\/rooms\/([^/]+)(?:\/(upload|payload|join|complete|revoke))?$/,
    );
    if (!match) return json(res, 404, { error: "not_found" });
    const room = rooms.get(match[1]);
    if (!room || room.expiresAt <= Date.now()) {
      if (room) deleteRoom(room);
      return json(res, 410, { error: "expired" });
    }
    const action = match[2];
    const auth = String(req.headers.authorization || "").replace(
      /^Bearer\s+/i,
      "",
    );

    if (req.method === "GET" && !action) {
      if (limited(req, res, "room_read", 1000, 5 * 60_000))
        return json(res, 429, { error: "rate_limited" });
      return json(res, 200, safeRoom(room));
    }

    if (action === "join" && req.method === "POST") {
      if (limited(req, res, "join", 20, 5 * 60_000))
        return json(res, 429, { error: "rate_limited" });
      const body = await readJson(req);
      const receiverPublicKey = parsePublicKey(body.receiverPublicKey);
      if (!receiverPublicKey)
        return json(res, 400, { error: "invalid_public_key" });
      if (
        room.sameNetworkOnly &&
        !tokenMatches(networkIdentity(clientIp(req)), room.networkKeyDigest)
      )
        return json(res, 403, { error: "restricted_network" });
      if (
        room.passphraseVerifierDigest &&
        !tokenMatches(body.passphraseVerifier, room.passphraseVerifierDigest)
      )
        return json(res, 403, { error: "invalid_passphrase" });
      if (room.receiverPublicKey)
        return json(res, 409, { error: "already_paired" });
      room.receiverPublicKey = receiverPublicKey;
      const receiverToken = token(32);
      room.receiverTokenDigest = hashToken(receiverToken);
      return json(res, 200, {
        ...safeRoom(room),
        receiverToken,
      });
    }

    if (action === "upload" && req.method === "PUT") {
      if (!tokenMatches(auth, room.uploadTokenDigest))
        return json(res, 401, { error: "unauthorized" });
      if (!room.receiverPublicKey)
        return json(res, 409, { error: "not_paired" });
      if (room.envelope) return json(res, 409, { error: "already_uploaded" });
      const payload = await readBody(req, MAX_UPLOAD_BYTES);
      if (payload.length === 0)
        return json(res, 400, { error: "empty_upload" });
      room.envelope = payload;
      room.size = payload.length;
      return json(res, 200, safeRoom(room));
    }

    if (action === "payload" && req.method === "GET") {
      if (!tokenMatches(auth, room.receiverTokenDigest))
        return json(res, 401, { error: "unauthorized" });
      if (!room.envelope) return json(res, 409, { error: "not_ready" });
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(room.envelope.length),
        "cache-control": "no-store",
      });
      return res.end(room.envelope);
    }

    if (action === "complete" && req.method === "DELETE") {
      if (!tokenMatches(auth, room.receiverTokenDigest))
        return json(res, 401, { error: "unauthorized" });
      if (!room.envelope) return json(res, 409, { error: "not_ready" });
      deleteRoom(room);
      return json(res, 200, { deleted: true, reason: "received" });
    }

    if (action === "revoke" && req.method === "DELETE") {
      if (!tokenMatches(auth, room.uploadTokenDigest))
        return json(res, 401, { error: "unauthorized" });
      deleteRoom(room);
      return json(res, 200, { deleted: true, reason: "revoked" });
    }

    return json(res, 405, { error: "method_not_allowed" });
  } catch (error) {
    if (error.message === "too_large")
      return json(res, 413, { error: "too_large" });
    return json(res, 400, { error: "bad_request" });
  }
});

server.listen(PORT, HOST, () =>
  console.log(`InstantFlow API listening on http://${HOST}:${PORT}`),
);
