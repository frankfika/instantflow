import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileLock2,
  FileText,
  Info,
  KeyRound,
  LockKeyhole,
  QrCode,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wifi,
} from "lucide-react";
import "./styles.css";
import {
  createPassphraseSalt,
  createPair,
  decryptPayload,
  derivePassphraseMaterial,
  deriveSession,
  encryptPayload,
  normalizePassphrase,
} from "./crypto.js";

// In local development Vite may move to another port; the API remains on 8787.
// VITE_API_URL can override this for a hosted deployment or reverse proxy.
const isViteDevelopment = /^517\d$/.test(window.location.port);
const API =
  import.meta.env.VITE_API_URL ||
  (isViteDevelopment
    ? `${window.location.protocol}//${window.location.hostname}:8787/api`
    : "/api");
const fmt = (bytes) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const api = async (path, options = {}) => {
  const r = await fetch(`${API}${path}`, options);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "network_error");
  return data;
};
const apiBinary = async (path, options = {}) => {
  const response = await fetch(`${API}${path}`, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "network_error");
  }
  return new Uint8Array(await response.arrayBuffer());
};

function App() {
  return <UnifiedHome />;
}

function Shell({ children, eyebrow = "瞬传 / INSTANTFLOW" }) {
  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <LockKeyhole size={16} />
          </span>
          <span>{eyebrow}</span>
        </a>
        <div className="top-trust">
          <span className="status-dot" />
          端到端临时传输
        </div>
      </header>
      {children}
      <footer className="footer">
        <span>不需要账号，不保留传输历史</span>
        <span className="footer-link">
          <ShieldCheck size={13} /> 设计上默认最少保存
        </span>
      </footer>
    </div>
  );
}

function TrustStrip() {
  return (
    <div className="trust-strip">
      <div>
        <LockKeyhole size={15} />
        <span>
          <b>本机先加密</b>
          <small>文件离开设备前已密封</small>
        </span>
      </div>
      <div>
        <Clock3 size={15} />
        <span>
          <b>短时存在</b>
          <small>最长 10 分钟后自动删除</small>
        </span>
      </div>
      <div>
        <ShieldCheck size={15} />
        <span>
          <b>无需账号</b>
          <small>配对码只连接这次传输</small>
        </span>
      </div>
    </div>
  );
}

function UnifiedHome() {
  const [mode, setMode] = useState("send");
  const [kind, setKind] = useState("file");
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [minutes, setMinutes] = useState(5);
  const [sameNetworkOnly, setSameNetworkOnly] = useState(false);
  const [usePassphrase, setUsePassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const verificationResolverRef = useRef(null);
  const hasContent = kind === "file" ? file : text.trim();
  const canSend =
    hasContent && (!usePassphrase || normalizePassphrase(passphrase).length >= 8);
  const choose = (f) => {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024)
      return setError("单个文件暂时不能超过 20 MB");
    setFile(f);
    setError("");
  };
  const createTransfer = async () => {
    if (!canSend || busy) return;
    setBusy(true);
    setError("");
    try {
      setStage("room");
      const pair = await createPair();
      const passphraseSalt = usePassphrase ? createPassphraseSalt() : undefined;
      const passphraseMaterial = usePassphrase
        ? await derivePassphraseMaterial(passphrase, passphraseSalt)
        : null;
      const passphraseVerifier = passphraseMaterial?.verifier;
      const room = await api("/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          minutes,
          senderPublicKey: pair.publicKey,
          sameNetworkOnly,
          passphraseSalt,
          passphraseVerifier,
        }),
      });
      setResult({
        ...room,
        size:
          kind === "file"
            ? file.size
            : new TextEncoder().encode(text).byteLength,
        name: kind === "file" ? file.name : "临时文字.txt",
      });
      setStage("waiting");
      for (;;) {
        const status = await api(`/rooms/${room.roomId}`);
        if (status.receiverPublicKey) {
          const session = await deriveSession(
            pair.privateKey,
            pair.publicKey,
            status.receiverPublicKey,
            passphraseMaterial?.encryptionSecret,
          );
          setResult((current) => ({
            ...current,
            verificationCode: session.verificationCode,
          }));
          setStage("verify");
          const verified = await new Promise((resolve) => {
            verificationResolverRef.current = resolve;
          });
          verificationResolverRef.current = null;
          if (!verified) throw new Error("verification_cancelled");
          setStage("encrypt");
          const envelope = await encryptPayload(
            kind === "file" ? { kind, file } : { kind, text },
            session.encryptionKey,
          );
          setStage("upload");
          await api(`/rooms/${room.roomId}/upload`, {
            method: "PUT",
            headers: { authorization: `Bearer ${room.uploadToken}` },
            body: envelope,
          });
          setStage("ready");
          break;
        }
        await new Promise((r) => setTimeout(r, 700));
      }
    } catch {
      setError("传输没有完成，请重新开始。");
      setResult(null);
      setStage("idle");
    } finally {
      setBusy(false);
    }
  };
  if (result)
    return (
      <ReadyPage
        result={result}
        stage={stage}
        onVerify={() => verificationResolverRef.current?.(true)}
        onReset={() => {
          verificationResolverRef.current?.(false);
          setResult(null);
          setFile(null);
          setText("");
          setStage("idle");
        }}
      />
    );
  return (
    <Shell>
      <main className="main home-main">
        <section className="hero">
          <div className="eyebrow">
            <Sparkles size={14} /> SHORT-LIVED / PRIVATE BY DEFAULT
          </div>
          <h1>
            {mode === "send" ? (
              <>
                把信息送到
                <br />
                <em>另一台设备。</em>
              </>
            ) : (
              <>
                接收一份
                <br />
                <em>临时信息。</em>
              </>
            )}
          </h1>
          <p>
            {mode === "send"
              ? "不登录，不复制链接。选择内容后，用一次性配对码连接另一台设备。"
              : "输入发送设备上显示的配对码，内容只会在这台设备本地解密。"}
          </p>
        </section>
        <div className="mode-switch home-mode">
          <button
            className={mode === "send" ? "active" : ""}
            onClick={() => setMode("send")}
          >
            我要发送
          </button>
          <button
            className={mode === "receive" ? "active" : ""}
            onClick={() => setMode("receive")}
          >
            我要接收
          </button>
        </div>
        {mode === "send" ? (
          <section className="send-card">
            <div className="segmented">
              <button
                className={kind === "file" ? "active" : ""}
                onClick={() => setKind("file")}
              >
                <Upload size={16} /> 文件
              </button>
              <button
                className={kind === "text" ? "active" : ""}
                onClick={() => setKind("text")}
              >
                <FileText size={16} /> 文字
              </button>
            </div>
            {kind === "file" ? (
              <button
                className={`dropzone ${file ? "has-file" : ""}`}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  choose(e.dataTransfer.files[0]);
                }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  hidden
                  onChange={(e) => choose(e.target.files[0])}
                />
                {file ? (
                  <>
                    <span className="file-icon">
                      <FileLock2 size={22} />
                    </span>
                    <span className="drop-title">{file.name}</span>
                    <span className="drop-meta">
                      {fmt(file.size)} · 已准备在本机加密
                    </span>
                    <span className="change-file">点击更换</span>
                  </>
                ) : (
                  <>
                    <span className="drop-icon">
                      <Upload size={23} />
                    </span>
                    <span className="drop-title">拖入文件，或点击选择</span>
                    <span className="drop-meta">单个文件最大 20 MB</span>
                  </>
                )}
              </button>
            ) : (
              <div className="text-wrap">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="粘贴一段文字、地址或临时信息……"
                  maxLength={12000}
                />
                <span className="char-count">
                  {text.length.toLocaleString()} / 12,000
                </span>
              </div>
            )}
            <div className="send-options">
              <label>
                <span>自动删除</span>
                <select
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                >
                  <option value={1}>1 分钟后</option>
                  <option value={5}>5 分钟后</option>
                  <option value={10}>10 分钟后</option>
                </select>
              </label>
              <span className="option-note">
                <ShieldCheck size={14} /> 两台设备临时协商密钥
              </span>
            </div>
            <div className="security-options">
              <div className="security-options-heading">
                <span>额外限制</span>
                <small>可选</small>
              </div>
              <label className="security-toggle">
                <input
                  type="checkbox"
                  checked={sameNetworkOnly}
                  onChange={(event) => setSameNetworkOnly(event.target.checked)}
                />
                <span className="toggle-box"><Check size={12} /></span>
                <Wifi size={16} />
                <span>
                  <b>仅限同一网络出口</b>
                  <small>由服务端校验网络指纹，不读取或比较 Wi-Fi 名称</small>
                </span>
              </label>
              <label className="security-toggle">
                <input
                  type="checkbox"
                  checked={usePassphrase}
                  onChange={(event) => {
                    setUsePassphrase(event.target.checked);
                    if (!event.target.checked) setPassphrase("");
                  }}
                />
                <span className="toggle-box"><Check size={12} /></span>
                <KeyRound size={16} />
                <span>
                  <b>增加接收口令</b>
                  <small>只有同时知道配对码和口令的设备才能加入</small>
                </span>
              </label>
              {usePassphrase && (
                <input
                  className="passphrase-input"
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value.slice(0, 64))}
                  placeholder="设置至少 8 个字符的接收口令"
                  autoComplete="new-password"
                />
              )}
              {sameNetworkOnly && (
                <p className="network-caveat">
                  开启 VPN、代理、蜂窝网络或隐私中继时，即使连接同一 Wi-Fi 也可能被拒绝。
                </p>
              )}
            </div>
            <button
              className="primary-btn"
              disabled={!canSend || busy}
              onClick={createTransfer}
            >
              {busy ? (
                <>
                  <span className="spinner" />{" "}
                  {stage === "room"
                    ? "建立配对房间…"
                    : stage === "waiting"
                      ? "等待另一台设备…"
                      : stage === "verify"
                        ? "请核对安全校验码…"
                      : stage === "encrypt"
                        ? "正在本机加密…"
                        : "正在上传密文…"}
                </>
              ) : (
                <>
                  生成一次性配对码 <ArrowUpRight size={17} />
                </>
              )}
            </button>
            {error && (
              <div className="error-note">
                <Info size={15} />
                {error}
              </div>
            )}
            <TrustStrip />
          </section>
        ) : (
          <ReceiveEntry />
        )}
        <button
          className="how-link"
          onClick={() =>
            document
              .getElementById("how")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          它是怎么保护你的？ <ChevronDown size={15} />
        </button>
        <section id="how" className="how-section">
          <div>
            <span className="section-kicker">A SMALL PROMISE</span>
            <h2>
              让安全变成
              <br />
              看得见的过程。
            </h2>
          </div>
          <div className="how-steps">
            <HowStep
              n="01"
              icon={<LockKeyhole />}
              title="两台设备临时配对"
              body="发送和接收都从这一个首页开始。"
            />
            <HowStep
              n="02"
              icon={<ShieldCheck />}
              title="设备之间协商密钥"
              body="配对码只负责找到房间，真正的加密钥匙由两台设备临时生成。"
            />
            <HowStep
              n="03"
              icon={<Trash2 />}
              title="到点自动清空"
              body="倒计时结束后，临时房间和密文一起失效。"
            />
          </div>
        </section>
      </main>
    </Shell>
  );
}

function HowStep({ n, icon, title, body }) {
  return (
    <div className="how-step">
      <span className="step-number">{n}</span>
      <span className="step-icon">{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </div>
  );
}

function ReceiveEntry() {
  const [code, setCode] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);
  const [deletionConfirmed, setDeletionConfirmed] = useState(false);
  const join = async () => {
    if (!/^\d{8}$/.test(code)) return setError("请输入 8 位配对码");
    setState("joining");
    setError("");
    try {
      const found = await api(`/rooms/code/${code}`);
      if (found.requiresPassphrase && !normalizePassphrase(passphrase)) {
        setState("idle");
        return setError("发送方为这次传输设置了接收口令");
      }
      const pair = await createPair();
      const passphraseMaterial = found.requiresPassphrase
        ? await derivePassphraseMaterial(passphrase, found.passphraseSalt)
        : null;
      const passphraseVerifier = passphraseMaterial?.verifier;
      const joined = await api(`/rooms/${found.roomId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          receiverPublicKey: pair.publicKey,
          passphraseVerifier,
        }),
      });
      const session = await deriveSession(
        pair.privateKey,
        pair.publicKey,
        found.senderPublicKey,
        passphraseMaterial?.encryptionSecret,
      );
      setVerificationCode(session.verificationCode);
      setState("waiting");
      for (;;) {
        const status = await api(`/rooms/${found.roomId}`);
        if (status.status === "ready") {
          const envelope = await apiBinary(`/rooms/${found.roomId}/payload`, {
            headers: { authorization: `Bearer ${joined.receiverToken}` },
          });
          const decoded = await decryptPayload(session.encryptionKey, envelope);
          setPayload(decoded);
          try {
            await api(`/rooms/${found.roomId}/complete`, {
              method: "DELETE",
              headers: {
                authorization: `Bearer ${joined.receiverToken}`,
              },
            });
            setDeletionConfirmed(true);
          } catch {
            setDeletionConfirmed(false);
          }
          setState("done");
          break;
        }
        await new Promise((r) => setTimeout(r, 700));
      }
    } catch (e) {
      setError(
        e.message === "rate_limited"
          ? "尝试次数过多，请稍后再试。"
          : e.message === "expired" || e.message === "not_found"
            ? "这个配对码不存在或已经过期。"
            : e.message === "already_paired"
              ? "这次传输已经与另一台设备配对。"
              : e.message === "restricted_network"
                ? "发送方只允许同一网络下的设备接收。请连接同一 Wi-Fi，并关闭 VPN、代理或蜂窝网络后重试。"
                : e.message === "invalid_passphrase"
                  ? "接收口令不正确。"
              : "接收失败，请检查配对码后重试。",
      );
      setState("idle");
      setVerificationCode("");
    }
  };
  const download = () => {
    const blob = new Blob([payload.data], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = payload.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  if (state === "done")
    return (
      <div className="receive-inline-done">
        <div className="done-icon">
          <CheckCircle2 size={26} />
        </div>
        <span className="ready-eyebrow">
          <span className="live-dot" /> 已在此设备解密
        </span>
        <h2>{payload.kind === "text" ? "文字已经到达。" : "文件已经到达。"}</h2>
        {payload.kind === "text" ? (
          <pre className="text-result">
            {new TextDecoder().decode(payload.data)}
          </pre>
        ) : (
          <div className="download-file">
            <FileLock2 size={20} />
            <span>
              {payload.name}
              <small>{fmt(payload.size)}</small>
            </span>
            <button className="primary-btn small" onClick={download}>
              <Download size={15} /> 保存
            </button>
          </div>
        )}
        <p className="delete-confirm">
          {deletionConfirmed ? (
            <>
              <Check size={14} /> 服务器已确认删除临时密文
            </>
          ) : (
            <>
              <Info size={14} />{" "}
              内容已解密，但删除确认失败；密文仍会在到期时清除
            </>
          )}
        </p>
      </div>
    );
  return (
    <div className="receive-entry">
      <div className="receive-lock">
        <QrCode size={24} />
      </div>
      <span className="ready-eyebrow">输入一次性配对码</span>
      <h2>
        让两台设备
        <br />
        <em>认出彼此。</em>
      </h2>
      <p>配对码只在这次传输中有效，不需要链接或账号。</p>
      <input
        className="code-input"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
        placeholder="0000 0000"
        inputMode="numeric"
        maxLength={8}
      />
      <div className="receive-passphrase">
        <KeyRound size={15} />
        <input
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value.slice(0, 64))}
          placeholder="接收口令（如果发送方设置了）"
          autoComplete="current-password"
        />
      </div>
      <button
        className="primary-btn"
        disabled={state !== "idle" || code.length !== 8}
        onClick={join}
      >
        {state === "joining" ? (
          <>
            <span className="spinner" /> 正在配对…
          </>
        ) : state === "waiting" ? (
          <>
            <span className="spinner" /> 等待发送设备…
          </>
        ) : (
          <>
            开始接收 <ArrowUpRight size={17} />
          </>
        )}
      </button>
      {state === "waiting" && verificationCode && (
        <div className="verification-box" role="status">
          <span>安全校验码</span>
          <strong>{verificationCode}</strong>
          <small>请与发送设备核对；不一致时立即取消。</small>
        </div>
      )}
      {error && (
        <div className="error-note">
          <Info size={15} />
          {error}
        </div>
      )}
      <small className="receive-warning">
        <ShieldCheck size={13} />{" "}
        配对成功后，真正的加密钥匙只在两台设备之间生成。
      </small>
    </div>
  );
}

function ReadyPage({ result, onReset, onVerify, stage }) {
  const [endReason, setEndReason] = useState(null);
  const ended = Boolean(endReason);
  const [left, setLeft] = useState(
    Math.max(0, Math.ceil((result.expiresAt - Date.now()) / 1000)),
  );
  useEffect(() => {
    if (ended) {
      setLeft(0);
      return;
    }
    const t = setInterval(
      () =>
        setLeft(Math.max(0, Math.ceil((result.expiresAt - Date.now()) / 1000))),
      1000,
    );
    return () => clearInterval(t);
  }, [ended, result.expiresAt]);
  useEffect(() => {
    if (stage !== "ready" || ended) return;
    let active = true;
    const check = async () => {
      try {
        await api(`/rooms/${result.roomId}`);
      } catch (error) {
        if (active && error.message === "expired") {
          setEndReason(
            Date.now() >= result.expiresAt ? "expired" : "received",
          );
        }
      }
    };
    check();
    const timer = setInterval(check, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [stage, ended, result.expiresAt, result.roomId]);
  const revoke = async () => {
    try {
      await api(`/rooms/${result.roomId}/revoke`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${result.uploadToken}` },
      });
      setEndReason("revoked");
    } catch {}
  };
  const endCopy = {
    received: {
      eyebrow: "对方已安全接收",
      message: "对方已接收，服务器上的临时密文已删除",
    },
    expired: {
      eyebrow: "传输已到期",
      message: "保存时间已结束，房间和临时密文已删除",
    },
    revoked: {
      eyebrow: "已主动销毁",
      message: "房间和临时密文已立即删除",
    },
  }[endReason];
  return (
    <Shell>
      <main className="main ready-main">
        <div className="ready-orbit">
          <span className="orbit-ring ring-one" />
          <span className="orbit-ring ring-two" />
          <div className="safe-box">
            <Check size={30} />
          </div>
        </div>
        <div className="ready-eyebrow">
          <span className="live-dot" />
          {ended ? ` ${endCopy.eyebrow}` : " 等待另一台设备配对"}
        </div>
        <h1>
          {ended ? (
            <>
              这次传输
              <br />
              <em>已经安全结束。</em>
            </>
          ) : (
            <>
              告诉对方这组
              <br />
              <em>一次性配对码。</em>
            </>
          )}
        </h1>
        <p className="ready-sub">
          {result.name} · {fmt(result.size)}
        </p>
        <div className="ready-panel">
          {ended ? (
            <div className="destroyed-state">
              <CheckCircle2 size={28} />
              <strong>{endCopy.message}</strong>
            </div>
          ) : (
            <>
              <div className="pair-code">
                {result.code.slice(0, 4)} <span>{result.code.slice(4)}</span>
              </div>
              <p className="pair-hint">在接收设备首页输入这 8 位数字</p>
              {(result.sameNetworkOnly || result.requiresPassphrase) && (
                <div className="restriction-badges">
                  {result.sameNetworkOnly && (
                    <span><Wifi size={12} /> 仅限同一网络出口</span>
                  )}
                  {result.requiresPassphrase && (
                    <span><KeyRound size={12} /> 需要接收口令</span>
                  )}
                </div>
              )}
            </>
          )}
          {!ended && stage === "verify" && result.verificationCode && (
            <div className="verification-box" role="status">
              <span>双方安全校验码</span>
              <strong>{result.verificationCode}</strong>
              <small>与接收设备一致后，才会开始加密和上传。</small>
              <button className="primary-btn small" onClick={onVerify}>
                <Check size={15} /> 两边一致，继续发送
              </button>
            </div>
          )}
          {!ended && (
            <div className="countdown">
              <span>自动删除倒计时</span>
              <strong>
                {String(Math.floor(left / 60)).padStart(2, "0")}:
                {String(left % 60).padStart(2, "0")}
              </strong>
            </div>
          )}
          <div className="privacy-callout">
            <ShieldCheck size={16} />
            <span>
              <b>没有链接，也没有账号</b>
              <small>配对码只负责找到房间，加密钥匙由两台设备临时协商。</small>
            </span>
          </div>
          <div className="ready-actions">
            <button className="secondary-btn" onClick={onReset}>
              <RotateCcw size={15} /> 再传一个
            </button>
            <button
              className="danger-btn"
              onClick={revoke}
              disabled={ended || left === 0}
            >
              {ended ? (
                <>
                  <Check size={15} /> 已结束
                </>
              ) : (
                <>
                  <Trash2 size={15} /> 立即销毁
                </>
              )}
            </button>
          </div>
        </div>
        <div className="ready-note">
          {ended ? (
            <>
              <CheckCircle2 size={15} /> 本次配对码已经失效，不能再次接收
            </>
          ) : (
            <>
              <QrCode size={15} /> 只需告诉对方配对码，不需要复制任何链接
            </>
          )}
        </div>
      </main>
    </Shell>
  );
}

createRoot(document.getElementById("root")).render(<App />);
