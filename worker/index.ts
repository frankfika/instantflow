import { DurableObject } from "cloudflare:workers";

type PublicKeyJwk = {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
};

type RoomRecord = {
  id: string;
  code: string;
  uploadTokenHash: string;
  receiverTokenHash?: string;
  senderPublicKey: PublicKeyJwk;
  receiverPublicKey?: PublicKeyJwk;
  createdAt: number;
  expiresAt: number;
  status: "waiting" | "paired" | "uploading" | "ready" | "deleting";
  size: number;
  payloadChunks?: number;
  sameNetworkOnly: boolean;
  networkKeyHash?: string;
  passphraseSalt?: string;
  passphraseVerifierHash?: string;
};

type RoomView = {
  roomId: string;
  createdAt: number;
  expiresAt: number;
  status: RoomRecord["status"];
  size: number;
  senderPublicKey: PublicKeyJwk;
  receiverPublicKey: PublicKeyJwk | null;
  sameNetworkOnly: boolean;
  requiresPassphrase: boolean;
  passphraseSalt?: string;
};

type CodeRecord = { roomId: string; expiresAt: number };
type RateResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

interface Env {
  ROOMS: DurableObjectNamespace<RoomObject>;
  CODES: DurableObjectNamespace<CodeObject>;
  LIMITERS: DurableObjectNamespace<RateLimiterObject>;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
}

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024;
const PAYLOAD_CHUNK_BYTES = 1024 * 1024;

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};

const randomToken = (bytes = 24) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
};

const randomCode = () => {
  const value = new Uint32Array(1);
  const range = 90_000_000;
  const ceiling = Math.floor(0x1_0000_0000 / range) * range;
  do crypto.getRandomValues(value);
  while (value[0] >= ceiling);
  return String(10_000_000 + (value[0] % range));
};

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const constantEqual = (left: string, right?: string) => {
  if (!right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
};

const ipv4Subnet24 = (ip: string) => {
  const parts = ip.split(".");
  return `v4:${parts[0]}.${parts[1]}.${parts[2]}`;
};

const ipv6Prefix64 = (address: string) => {
  const value = address.toLowerCase().split("%")[0];
  if (value.startsWith("::ffff:") && /^\d+\.\d+\.\d+\.\d+$/.test(value.slice(7)))
    return ipv4Subnet24(value.slice(7));
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (
    groups.length !== 8 ||
    groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
  )
    return null;
  return `v6:${groups
    .slice(0, 4)
    .map((part) => part.padStart(4, "0"))
    .join(":")}`;
};

const networkIdentity = (address: string) => {
  const value = String(address || "local").replace(/^\[|\]$/g, "");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return ipv4Subnet24(value);
  return ipv6Prefix64(value) || `other:${value}`;
};

const requestAddress = (request: Request) =>
  request.headers.get("cf-connecting-ip") ||
  request.headers.get("x-real-ip") ||
  "local";

const tokenMatches = async (raw: string, digest?: string) =>
  Boolean(raw && digest && constantEqual(await sha256(raw), digest));

const parsePublicKey = async (key: unknown): Promise<PublicKeyJwk | null> => {
  if (!key || typeof key !== "object") return null;
  const value = key as Record<string, unknown>;
  if (!(
    value.kty === "EC" &&
    value.crv === "P-256" &&
    typeof value.x === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value.x) &&
    typeof value.y === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value.y)
  )) return null;
  const canonical: PublicKeyJwk = {
    kty: "EC",
    crv: "P-256",
    x: value.x,
    y: value.y,
  };
  try {
    await crypto.subtle.importKey(
      "jwk",
      canonical,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    return canonical;
  } catch {
    return null;
  }
};

const roomView = (room: RoomRecord): RoomView => ({
  roomId: room.id,
  createdAt: room.createdAt,
  expiresAt: room.expiresAt,
  status: room.status,
  size: room.size,
  senderPublicKey: room.senderPublicKey,
  receiverPublicKey: room.receiverPublicKey || null,
  sameNetworkOnly: room.sameNetworkOnly,
  requiresPassphrase: Boolean(room.passphraseVerifierHash),
  passphraseSalt: room.passphraseVerifierHash ? room.passphraseSalt : undefined,
});

export class CodeObject extends DurableObject<Env> {
  async reserve(roomId: string, expiresAt: number): Promise<boolean> {
    const current = await this.ctx.storage.get<CodeRecord>("entry");
    if (current && current.expiresAt > Date.now()) return false;
    if (current) await this.ctx.storage.deleteAll();
    await this.ctx.storage.put("entry", { roomId, expiresAt });
    await this.ctx.storage.setAlarm(expiresAt);
    return true;
  }

  async lookup(): Promise<CodeRecord | null> {
    const entry = await this.ctx.storage.get<CodeRecord>("entry");
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      await this.ctx.storage.deleteAll();
      return null;
    }
    return entry;
  }

  async release(roomId: string): Promise<void> {
    const entry = await this.ctx.storage.get<CodeRecord>("entry");
    if (entry?.roomId === roomId) await this.ctx.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

export class RateLimiterObject extends DurableObject<Env> {
  async check(limit: number, windowMs: number): Promise<RateResult> {
    const now = Date.now();
    let bucket = await this.ctx.storage.get<{
      count: number;
      resetAt: number;
    }>("bucket");
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
    }
    bucket.count += 1;
    await this.ctx.storage.put("bucket", bucket);
    await this.ctx.storage.setAlarm(bucket.resetAt);
    return {
      allowed: bucket.count <= limit,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

export class RoomObject extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "PUT") return this.storePayload(request);
    if (request.method === "GET") return this.readPayload(request);
    return json(405, { error: "method_not_allowed" });
  }

  async create(room: RoomRecord): Promise<boolean> {
    const current = await this.ctx.storage.get<RoomRecord>("room");
    if (current && current.expiresAt > Date.now()) return false;
    if (current) await this.ctx.storage.deleteAll();
    await this.ctx.storage.put("room", room);
    await this.ctx.storage.setAlarm(room.expiresAt);
    return true;
  }

  async getState(): Promise<RoomView | null> {
    const room = await this.ctx.storage.get<RoomRecord>("room");
    if (!room) return null;
    if (room.expiresAt <= Date.now()) {
      await this.destroy(room);
      return null;
    }
    return roomView(room);
  }

  async join(
    receiverPublicKey: PublicKeyJwk,
    networkKeyHash: string,
    passphraseVerifier?: string,
  ): Promise<{ view: RoomView; receiverToken: string } | { error: string }> {
    const room = await this.ctx.storage.get<RoomRecord>("room");
    if (!room || room.expiresAt <= Date.now()) return { error: "expired" };
    if (
      room.sameNetworkOnly &&
      !constantEqual(networkKeyHash, room.networkKeyHash)
    )
      return { error: "restricted_network" };
    if (
      room.passphraseVerifierHash &&
      !(await tokenMatches(passphraseVerifier || "", room.passphraseVerifierHash))
    )
      return { error: "invalid_passphrase" };
    if (room.receiverPublicKey) {
      return { error: "already_paired" };
    }
    const receiverToken = randomToken(32);
    room.receiverPublicKey = receiverPublicKey;
    room.receiverTokenHash = await sha256(receiverToken);
    room.status = "paired";
    await this.ctx.storage.put("room", room);
    return { view: roomView(room), receiverToken };
  }

  async beginUpload(
    uploadToken: string,
    size: number,
  ): Promise<{ ok: boolean; expiresAt?: number; error?: string }> {
    const room = await this.ctx.storage.get<RoomRecord>("room");
    if (!room || room.expiresAt <= Date.now()) return { ok: false, error: "expired" };
    if (!(await tokenMatches(uploadToken, room.uploadTokenHash)))
      return { ok: false, error: "unauthorized" };
    if (!room.receiverPublicKey) return { ok: false, error: "not_paired" };
    if (room.status === "ready" || room.status === "uploading")
      return { ok: false, error: "already_uploaded" };
    room.status = "uploading";
    room.size = size;
    await this.ctx.storage.put("room", room);
    return { ok: true, expiresAt: room.expiresAt };
  }

  async finishUpload(payloadChunks: number): Promise<RoomView | null> {
    const room = await this.ctx.storage.get<RoomRecord>("room");
    if (!room || room.status !== "uploading") return null;
    room.status = "ready";
    room.payloadChunks = payloadChunks;
    await this.ctx.storage.put("room", room);
    return roomView(room);
  }

  async abortUpload(): Promise<void> {
    const room = await this.ctx.storage.get<RoomRecord>("room");
    if (!room || room.status !== "uploading") return;
    room.status = "paired";
    room.size = 0;
    room.payloadChunks = 0;
    await this.ctx.storage.put("room", room);
  }

  async authorizePayload(receiverToken: string): Promise<boolean> {
    const room = await this.ctx.storage.get<RoomRecord>("room");
    return Boolean(
      room &&
        room.status === "ready" &&
        (await tokenMatches(receiverToken, room.receiverTokenHash)),
    );
  }

  async complete(receiverToken: string): Promise<{ ok: boolean; error?: string }> {
    const room = await this.ctx.storage.get<RoomRecord>("room");
    if (!room) return { ok: false, error: "expired" };
    if (!(await tokenMatches(receiverToken, room.receiverTokenHash)))
      return { ok: false, error: "unauthorized" };
    if (room.status !== "ready") return { ok: false, error: "not_ready" };
    await this.destroy(room);
    return { ok: true };
  }

  async revoke(uploadToken: string): Promise<{ ok: boolean; error?: string }> {
    const room = await this.ctx.storage.get<RoomRecord>("room");
    if (!room) return { ok: false, error: "expired" };
    if (!(await tokenMatches(uploadToken, room.uploadTokenHash)))
      return { ok: false, error: "unauthorized" };
    await this.destroy(room);
    return { ok: true };
  }

  async alarm(): Promise<void> {
    const room = await this.ctx.storage.get<RoomRecord>("room");
    if (!room) return;
    try {
      await this.destroy(room);
    } catch {
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
    }
  }

  private async destroy(room: RoomRecord): Promise<void> {
    room.status = "deleting";
    await this.ctx.storage.put("room", room);
    try {
      const codeId = this.env.CODES.idFromName(room.code);
      await this.env.CODES.get(codeId).release(room.id);
      await this.ctx.storage.deleteAll();
    } catch (error) {
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
      throw error;
    }
  }

  private async storePayload(request: Request): Promise<Response> {
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_UPLOAD_BYTES)
      return json(413, { error: "too_large" });
    const payload = new Uint8Array(await request.arrayBuffer());
    if (!payload.byteLength) return json(400, { error: "empty_upload" });
    if (payload.byteLength > MAX_UPLOAD_BYTES)
      return json(413, { error: "too_large" });

    const begin = await this.beginUpload(bearer(request), payload.byteLength);
    if (!begin.ok)
      return json(errorStatus(begin.error), { error: begin.error });

    let chunkCount = 0;
    try {
      for (let offset = 0; offset < payload.byteLength; offset += PAYLOAD_CHUNK_BYTES) {
        const chunk = payload.slice(offset, offset + PAYLOAD_CHUNK_BYTES);
        await this.ctx.storage.put(`payload:${chunkCount}`, chunk.buffer);
        chunkCount += 1;
      }
      const view = await this.finishUpload(chunkCount);
      return view ? json(200, view) : json(410, { error: "expired" });
    } catch (error) {
      for (let index = 0; index < chunkCount; index += 1)
        await this.ctx.storage.delete(`payload:${index}`);
      await this.abortUpload();
      throw error;
    }
  }

  private async readPayload(request: Request): Promise<Response> {
    if (!(await this.authorizePayload(bearer(request))))
      return json(401, { error: "unauthorized" });
    const room = await this.ctx.storage.get<RoomRecord>("room");
    if (!room?.payloadChunks) return json(410, { error: "expired" });

    const payload = new Uint8Array(room.size);
    let offset = 0;
    for (let index = 0; index < room.payloadChunks; index += 1) {
      const chunk = await this.ctx.storage.get<ArrayBuffer>(`payload:${index}`);
      if (!chunk) return json(410, { error: "expired" });
      payload.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    return new Response(payload, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(payload.byteLength),
        "cache-control": "no-store",
      },
    });
  }
}

const json = (status: number, body: unknown, extraHeaders?: HeadersInit) => {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
};

const addSecurityHeaders = (response: Response, production: boolean) => {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("x-xss-protection", "0");
  headers.set(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'",
  );
  if (production)
    headers.set(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const allowedOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
};

const readJson = async (request: Request) => {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_JSON_BYTES) throw new Error("too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES)
    throw new Error("too_large");
  try {
    return JSON.parse(text || "{}") as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json");
  }
};

const bearer = (request: Request) =>
  (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");

const rateLimit = async (
  request: Request,
  env: Env,
  scope: string,
  limit: number,
  windowMs: number,
) => {
  const address = requestAddress(request);
  const limiterKey = await sha256(`${scope}:${address}`);
  const limiterId = env.LIMITERS.idFromName(limiterKey);
  return env.LIMITERS.get(limiterId).check(limit, windowMs);
};

const rateHeaders = (rate: RateResult) => ({
  "ratelimit-limit": String(rate.limit),
  "ratelimit-remaining": String(rate.remaining),
  "ratelimit-reset": String(Math.ceil((rate.resetAt - Date.now()) / 1000)),
});

const errorStatus = (error?: string) => {
  if (error === "unauthorized") return 401;
  if (error === "restricted_network" || error === "invalid_passphrase")
    return 403;
  if (error === "already_paired" || error === "already_uploaded") return 409;
  if (error === "not_paired" || error === "not_ready") return 409;
  if (error === "expired") return 410;
  return 400;
};

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const startedAt = Date.now();
    let status = 500;
    try {
      if (!allowedOrigin(request)) {
        const response = json(403, { error: "origin_not_allowed" });
        status = response.status;
        return addSecurityHeaders(response, env.ENVIRONMENT === "production");
      }
      const url = new URL(request.url);
      if (request.method === "OPTIONS") {
        const response = new Response(null, { status: 204 });
        status = response.status;
        return addSecurityHeaders(response, env.ENVIRONMENT === "production");
      }
      if (!url.pathname.startsWith("/api/")) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          const response = json(405, { error: "method_not_allowed" });
          status = response.status;
          return addSecurityHeaders(response, env.ENVIRONMENT === "production");
        }
        const response = await env.ASSETS.fetch(request);
        status = response.status;
        return addSecurityHeaders(response, env.ENVIRONMENT === "production");
      }

      let response: Response;
      if (request.method === "GET" && url.pathname === "/api/health") {
        response = json(200, { ok: true, storage: "durable-objects" });
      } else if (request.method === "POST" && url.pathname === "/api/rooms") {
        const rate = await rateLimit(request, env, "create", 30, 60 * 60_000);
        if (!rate.allowed) {
          response = json(429, { error: "rate_limited" }, rateHeaders(rate));
        } else {
          const body = await readJson(request);
          const senderPublicKey = await parsePublicKey(body.senderPublicKey);
          if (!senderPublicKey) {
            response = json(400, { error: "invalid_public_key" });
          } else {
            const requestedMinutes = Number(body.minutes ?? 5);
            if (!Number.isFinite(requestedMinutes)) {
              response = json(400, { error: "invalid_expiry" });
            } else {
              const minutes = Math.min(
                10,
                Math.max(1, Math.round(requestedMinutes)),
              );
              const roomId = randomToken(16);
              const uploadToken = randomToken(32);
              const createdAt = Date.now();
              const expiresAt = createdAt + minutes * 60_000;
              const sameNetworkOnly = body.sameNetworkOnly === true;
              const hasPassphrase =
                typeof body.passphraseSalt === "string" ||
                typeof body.passphraseVerifier === "string";
              if (
                hasPassphrase &&
                (!/^[A-Za-z0-9_-]{20,24}$/.test(
                  String(body.passphraseSalt || ""),
                ) ||
                  !/^[A-Za-z0-9_-]{43}$/.test(
                    String(body.passphraseVerifier || ""),
                  ))
              ) {
                response = json(400, { error: "invalid_security_options" });
                status = response.status;
                return addSecurityHeaders(
                  response,
                  env.ENVIRONMENT === "production",
                );
              }
              let code = "";
              for (let attempt = 0; attempt < 20; attempt += 1) {
                const candidate = randomCode();
                const codeId = env.CODES.idFromName(candidate);
                if (await env.CODES.get(codeId).reserve(roomId, expiresAt)) {
                  code = candidate;
                  break;
                }
              }
              if (!code) throw new Error("code_space_busy");
              const record: RoomRecord = {
                id: roomId,
                code,
                uploadTokenHash: await sha256(uploadToken),
                senderPublicKey,
                createdAt,
                expiresAt,
                status: "waiting",
                size: 0,
                sameNetworkOnly,
                networkKeyHash: sameNetworkOnly
                  ? await sha256(networkIdentity(requestAddress(request)))
                  : undefined,
                passphraseSalt: hasPassphrase
                  ? String(body.passphraseSalt)
                  : undefined,
                passphraseVerifierHash: hasPassphrase
                  ? await sha256(String(body.passphraseVerifier))
                  : undefined,
              };
              const roomObjectId = env.ROOMS.idFromName(roomId);
              await env.ROOMS.get(roomObjectId).create(record);
              response = json(201, {
                ...roomView(record),
                code,
                uploadToken,
              });
            }
          }
        }
      } else {
        response = await routeRoomRequest(request, env, url);
      }
      status = response.status;
      return addSecurityHeaders(response, env.ENVIRONMENT === "production");
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal_error";
      const response =
        message === "too_large"
          ? json(413, { error: "too_large" })
          : message === "invalid_json"
            ? json(400, { error: "invalid_json" })
          : json(500, { error: "internal_error" });
      status = response.status;
      return addSecurityHeaders(response, env.ENVIRONMENT === "production");
    } finally {
      console.log(
        JSON.stringify({
          event: "request",
          method: request.method,
          path: sanitizedPath(new URL(request.url).pathname),
          status,
          durationMs: Date.now() - startedAt,
        }),
      );
    }
  },
};

const sanitizedPath = (path: string) =>
  path
    .replace(/\/api\/rooms\/code\/[0-9]{8}/, "/api/rooms/code/:code")
    .replace(
      /\/api\/rooms\/[A-Za-z0-9_-]{20,30}/,
      "/api/rooms/:roomId",
    );

async function routeRoomRequest(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const codeMatch = url.pathname.match(/^\/api\/rooms\/code\/([0-9]{8})$/);
  if (request.method === "GET" && codeMatch) {
    const rate = await rateLimit(request, env, "code_lookup", 10, 5 * 60_000);
    if (!rate.allowed)
      return json(429, { error: "rate_limited" }, rateHeaders(rate));
    const codeObject = env.CODES.get(env.CODES.idFromName(codeMatch[1]));
    const entry = await codeObject.lookup();
    if (!entry) return json(404, { error: "not_found" });
    const room = env.ROOMS.get(env.ROOMS.idFromName(entry.roomId));
    const view = await room.getState();
    if (!view) {
      await codeObject.release(entry.roomId);
      return json(404, { error: "not_found" });
    }
    return json(200, view);
  }

  const match = url.pathname.match(
    /^\/api\/rooms\/([A-Za-z0-9_-]{20,30})(?:\/(upload|payload|join|complete|revoke))?$/,
  );
  if (!match) return json(404, { error: "not_found" });
  const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
  const action = match[2];

  if (request.method === "GET" && !action) {
    const rate = await rateLimit(request, env, "room_read", 1000, 5 * 60_000);
    if (!rate.allowed)
      return json(429, { error: "rate_limited" }, rateHeaders(rate));
    const view = await room.getState();
    return view ? json(200, view) : json(410, { error: "expired" });
  }

  if (request.method === "POST" && action === "join") {
    const rate = await rateLimit(request, env, "join", 20, 5 * 60_000);
    if (!rate.allowed)
      return json(429, { error: "rate_limited" }, rateHeaders(rate));
    const body = await readJson(request);
    const receiverPublicKey = await parsePublicKey(body.receiverPublicKey);
    if (!receiverPublicKey)
      return json(400, { error: "invalid_public_key" });
    const joined = await room.join(
      receiverPublicKey,
      await sha256(networkIdentity(requestAddress(request))),
      typeof body.passphraseVerifier === "string"
        ? body.passphraseVerifier
        : undefined,
    );
    if ("error" in joined)
      return json(errorStatus(joined.error), { error: joined.error });
    return json(200, { ...joined.view, receiverToken: joined.receiverToken });
  }

  if (request.method === "PUT" && action === "upload") {
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_UPLOAD_BYTES)
      return json(413, { error: "too_large" });
    return room.fetch(request);
  }

  if (request.method === "GET" && action === "payload") {
    return room.fetch(request);
  }

  if (request.method === "DELETE" && action === "complete") {
    const result = await room.complete(bearer(request));
    return result.ok
      ? json(200, { deleted: true, reason: "received" })
      : json(errorStatus(result.error), { error: result.error });
  }

  if (request.method === "DELETE" && action === "revoke") {
    const result = await room.revoke(bearer(request));
    return result.ok
      ? json(200, { deleted: true, reason: "revoked" })
      : json(errorStatus(result.error), { error: result.error });
  }

  return json(405, { error: "method_not_allowed" });
}

export default worker;
