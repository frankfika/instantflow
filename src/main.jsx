import React, { Fragment, useEffect, useRef, useState } from "react";
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
  Star,
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
import { LangProvider, useLang } from "./i18n.jsx";

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

const REPO_URL = "https://github.com/frankfika/instantflow";

function App() {
  return (
    <LangProvider>
      <UnifiedHome />
    </LangProvider>
  );
}

function GithubIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function useStarCount() {
  const [stars, setStars] = useState(null);
  useEffect(() => {
    const cacheKey = "instantflow:stars";
    const cacheTtl = 10 * 60 * 1000;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.t < cacheTtl && typeof cached.s === "number") {
          setStars(cached.s);
          return;
        }
      }
    } catch {}
    let cancelled = false;
    fetch("https://api.github.com/repos/frankfika/instantflow")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const s = typeof d.stargazers_count === "number" ? d.stargazers_count : null;
        setStars(s);
        if (s != null) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify({ s, t: Date.now() }));
          } catch {}
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return stars;
}

function GitHubStarButton() {
  const { t } = useLang();
  const stars = useStarCount();
  const hasStars = stars != null && stars > 0;
  const starLabel = stars != null ? stars.toLocaleString() : "";
  return (
    <a
      className="gh-star-btn"
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={
        hasStars
          ? t("star.aria.hasStars", { count: starLabel })
          : t("star.aria.firstStar")
      }
      title={hasStars ? t("star.title.hasStars", { count: starLabel }) : t("star.title.firstStar")}
    >
      <Star size={14} className="gh-star-pulse" />
      <span>{hasStars ? t("star.btn.hasStars") : t("star.btn.firstStar")}</span>
      {hasStars && (
        <span className="gh-star-count" data-stars={starLabel}>
          <Star size={11} /> {starLabel}
        </span>
      )}
    </a>
  );
}

function HeroStarCta() {
  const { t } = useLang();
  const stars = useStarCount();
  const hasStars = stars != null && stars > 0;
  return (
    <a
      className="hero-star-cta"
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("star.aria.firstStar")}
    >
      <span className="hero-star-ic">
        <Star size={14} className="hero-star-pulse" />
      </span>
      <span className="hero-star-body">
        <b>{hasStars ? t("star.hero.title.hasStars") : t("star.hero.title.firstStar")}</b>
        <small>
          {hasStars
            ? t("star.hero.sub.hasStars", { count: stars.toLocaleString() })
            : t("star.hero.sub.firstStar")}
        </small>
      </span>
      <span className="hero-star-go">
        <GithubIcon size={13} /> {t("star.hero.cta")}
      </span>
    </a>
  );
}

function LangSwitch() {
  const { lang, setLang, t } = useLang();
  const other = lang === "zh" ? "en" : "zh";
  return (
    <button
      type="button"
      className="lang-switch"
      onClick={() => setLang(other)}
      aria-label={t("lang.switchTo")}
      title={t("lang.switchTo")}
    >
      <span className={lang === "zh" ? "lang-active" : ""}>中</span>
      <span className="lang-sep">/</span>
      <span className={lang === "en" ? "lang-active" : ""}>EN</span>
    </button>
  );
}

function Shell({ children }) {
  const { t } = useLang();
  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <img src="/brand/instantflow-mark.svg" alt="" />
          </span>
          <span>{t("brand.eyebrow")}</span>
        </a>
        <div className="top-right">
          <div className="top-trust">
            <span className="status-dot" />
            {t("top.trust")}
          </div>
          <LangSwitch />
          <GitHubStarButton />
        </div>
      </header>
      {children}
      <footer className="footer">
        <span>{t("footer.left")}</span>
        <div className="footer-links">
          <span className="footer-link">
            <ShieldCheck size={13} /> {t("footer.privacy")}
          </span>
          <a
            className="footer-link footer-gh"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Star size={13} className="footer-star" /> {t("star.footer")}
          </a>
        </div>
      </footer>
    </div>
  );
}

function TrustStrip() {
  const { t } = useLang();
  return (
    <div className="trust-strip">
      <div>
        <LockKeyhole size={15} />
        <span>
          <b>{t("trust.encrypt.title")}</b>
          <small>{t("trust.encrypt.sub")}</small>
        </span>
      </div>
      <div>
        <Clock3 size={15} />
        <span>
          <b>{t("trust.ttl.title")}</b>
          <small>{t("trust.ttl.sub")}</small>
        </span>
      </div>
      <div>
        <ShieldCheck size={15} />
        <span>
          <b>{t("trust.account.title")}</b>
          <small>{t("trust.account.sub")}</small>
        </span>
      </div>
    </div>
  );
}

// 把含 \n 的翻译切成多行（用于 h1/h2 的换行排版）
function Multiline({ text, as: Tag = "span" }) {
  const parts = text.split("\n");
  return (
    <Tag>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {p}
        </Fragment>
      ))}
    </Tag>
  );
}

function UnifiedHome() {
  const { t } = useLang();
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
  const [howOpen, setHowOpen] = useState(false);
  const inputRef = useRef(null);
  const verificationResolverRef = useRef(null);
  const hasContent = kind === "file" ? file : text.trim();
  const normalizedPassphraseLength = normalizePassphrase(passphrase).length;
  const passphraseMissingCharacters = Math.max(
    0,
    8 - normalizedPassphraseLength,
  );
  const canSend =
    hasContent && (!usePassphrase || normalizedPassphraseLength >= 8);
  const choose = (f) => {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024)
      return setError(t("drop.tooLarge"));
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
        name: kind === "file" ? file.name : t("text.defaultName"),
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
      setError(t("err.transfer"));
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
          <h1>
            {mode === "send" ? t("hero.h1.send") : t("hero.h1.receive")}
          </h1>
          <p>
            {mode === "send" ? t("hero.p.send") : t("hero.p.receive")}
          </p>
          <HeroStarCta />
        </section>
        <div className="mode-switch home-mode">
          <button
            className={mode === "send" ? "active" : ""}
            onClick={() => setMode("send")}
          >
            {t("mode.send")}
          </button>
          <button
            className={mode === "receive" ? "active" : ""}
            onClick={() => setMode("receive")}
          >
            {t("mode.receive")}
          </button>
        </div>
        {mode === "send" ? (
          <section className="send-card">
            <div className="segmented">
              <button
                className={kind === "file" ? "active" : ""}
                onClick={() => setKind("file")}
              >
                <Upload size={16} /> {t("seg.file")}
              </button>
              <button
                className={kind === "text" ? "active" : ""}
                onClick={() => setKind("text")}
              >
                <FileText size={16} /> {t("seg.text")}
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
                      {t("drop.filled.meta", { size: fmt(file.size) })}
                    </span>
                    <span className="change-file">{t("drop.change")}</span>
                  </>
                ) : (
                  <>
                    <span className="drop-icon">
                      <Upload size={23} />
                    </span>
                    <span className="drop-title">{t("drop.empty.title")}</span>
                    <span className="drop-meta">{t("drop.empty.meta")}</span>
                  </>
                )}
              </button>
            ) : (
              <div className="text-wrap">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t("text.placeholder")}
                  maxLength={12000}
                />
                <span className="char-count">
                  {t("text.count", { n: text.length.toLocaleString() })}
                </span>
              </div>
            )}
            <div className="send-options">
              <label>
                <span>{t("opt.autoDelete")}</span>
                <select
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                >
                  <option value={1}>{t("opt.after1")}</option>
                  <option value={5}>{t("opt.after5")}</option>
                  <option value={10}>{t("opt.after10")}</option>
                </select>
              </label>
              <span className="option-note">
                <ShieldCheck size={14} /> {t("opt.note")}
              </span>
            </div>
            <div className="security-options">
              <div className="security-options-heading">
                <span>{t("sec.heading")}</span>
                <small>{t("sec.optional")}</small>
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
                  <b>{t("sec.network.title")}</b>
                  <small>{t("sec.network.sub")}</small>
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
                  <b>{t("sec.passphrase.title")}</b>
                  <small>{t("sec.passphrase.sub")}</small>
                </span>
              </label>
              {usePassphrase && (
                <div className="passphrase-field">
                  <input
                    className="passphrase-input"
                    type="password"
                    value={passphrase}
                    onChange={(event) => {
                      setPassphrase(event.target.value.slice(0, 64));
                      setError("");
                    }}
                    placeholder={t("sec.passphrase.placeholder")}
                    autoComplete="new-password"
                    aria-invalid={
                      passphrase.length > 0 && passphraseMissingCharacters > 0
                    }
                    aria-describedby="passphrase-requirement"
                  />
                  <small
                    id="passphrase-requirement"
                    className={
                      passphrase.length > 0 && passphraseMissingCharacters > 0
                        ? "field-hint invalid"
                        : "field-hint"
                    }
                  >
                    {passphrase.length === 0
                      ? t("sec.passphrase.hint.empty")
                      : passphraseMissingCharacters > 0
                        ? t("sec.passphrase.hint.short", { n: passphraseMissingCharacters })
                        : t("sec.passphrase.hint.ok")}
                  </small>
                </div>
              )}
              {sameNetworkOnly && (
                <p className="network-caveat">
                  {t("sec.network.caveat")}
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
                    ? t("stage.room")
                    : stage === "waiting"
                      ? t("stage.waiting")
                      : stage === "verify"
                        ? t("stage.verify")
                      : stage === "encrypt"
                        ? t("stage.encrypt")
                        : t("stage.upload")}
                </>
              ) : (
                <>
                  {usePassphrase && passphraseMissingCharacters > 0
                    ? t("btn.passphraseShort", { n: passphraseMissingCharacters })
                    : t("btn.generate")}
                  <ArrowUpRight size={17} />
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
          className="how-toggle"
          aria-expanded={howOpen}
          onClick={() => setHowOpen((v) => !v)}
        >
          <span className="how-toggle-left">
            <span className="how-toggle-ic">
              <ShieldCheck size={16} />
            </span>
            <span>
              {t("how.link")}
              <small className="how-toggle-sub">{t("how.kicker")}</small>
            </span>
          </span>
          <ChevronDown
            size={18}
            className="how-toggle-chev"
            style={{ transform: howOpen ? "rotate(180deg)" : "none" }}
          />
        </button>
        <section
          id="how"
          className={`how-section ${howOpen ? "" : "is-collapsed"}`}
        >
          <div>
            <span className="section-kicker">{t("how.kicker")}</span>
            <h2>
              <Multiline text={t("how.title")} />
            </h2>
          </div>
          <div className="how-steps">
            <HowStep
              n="01"
              icon={<LockKeyhole />}
              title={t("how.1.title")}
              body={t("how.1.body")}
            />
            <HowStep
              n="02"
              icon={<ShieldCheck />}
              title={t("how.2.title")}
              body={t("how.2.body")}
            />
            <HowStep
              n="03"
              icon={<Trash2 />}
              title={t("how.3.title")}
              body={t("how.3.body")}
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
  const { t } = useLang();
  const [code, setCode] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);
  const [deletionConfirmed, setDeletionConfirmed] = useState(false);
  const join = async () => {
    if (!/^\d{8}$/.test(code)) return setError(t("recv.err.code"));
    setState("joining");
    setError("");
    try {
      const found = await api(`/rooms/code/${code}`);
      if (found.requiresPassphrase && !normalizePassphrase(passphrase)) {
        setState("idle");
        return setError(t("recv.err.needPassphrase"));
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
          ? t("recv.err.rate")
          : e.message === "expired" || e.message === "not_found"
            ? t("recv.err.notfound")
            : e.message === "already_paired"
              ? t("recv.err.paired")
              : e.message === "restricted_network"
                ? t("recv.err.network")
                : e.message === "invalid_passphrase"
                  ? t("recv.err.passphrase")
              : t("recv.err.fallback"),
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
          <span className="live-dot" /> {t("done.eyebrow")}
        </span>
        <h2>{payload.kind === "text" ? t("done.h2.text") : t("done.h2.file")}</h2>
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
              <Download size={15} /> {t("done.save")}
            </button>
          </div>
        )}
        <p className="delete-confirm">
          {deletionConfirmed ? (
            <>
              <Check size={14} /> {t("done.delete.ok")}
            </>
          ) : (
            <>
              <Info size={14} />{" "}
              {t("done.delete.fail")}
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
      <span className="ready-eyebrow">{t("recv.eyebrow")}</span>
      <h2>
        <Multiline text={t("recv.h2")} />
      </h2>
      <p>{t("recv.p")}</p>
      <input
        className="code-input"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
        placeholder={t("recv.code.placeholder")}
        inputMode="numeric"
        maxLength={8}
      />
      <div className="receive-passphrase">
        <KeyRound size={15} />
        <input
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value.slice(0, 64))}
          placeholder={t("recv.passphrase.placeholder")}
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
            <span className="spinner" /> {t("recv.btn.joining")}
          </>
        ) : state === "waiting" ? (
          <>
            <span className="spinner" /> {t("recv.btn.waiting")}
          </>
        ) : (
          <>
            {t("recv.btn.start")} <ArrowUpRight size={17} />
          </>
        )}
      </button>
      {state === "waiting" && verificationCode && (
        <div className="verification-box" role="status">
          <span>{t("recv.verify.label")}</span>
          <strong>{verificationCode}</strong>
          <small>{t("recv.verify.hint")}</small>
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
        {t("recv.warn")}
      </small>
    </div>
  );
}

function ReadyPage({ result, onReset, onVerify, stage }) {
  const { t } = useLang();
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
      eyebrow: t("end.received.eyebrow"),
      message: t("end.received.message"),
    },
    expired: {
      eyebrow: t("end.expired.eyebrow"),
      message: t("end.expired.message"),
    },
    revoked: {
      eyebrow: t("end.revoked.eyebrow"),
      message: t("end.revoked.message"),
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
          {ended ? ` ${endCopy.eyebrow}` : ` ${t("ready.eyebrow.waiting")}`}
        </div>
        <h1>
          {ended ? (
            <Multiline text={t("ready.h1.ended")} />
          ) : (
            <Multiline text={t("ready.h1.waiting")} />
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
              <p className="pair-hint">{t("ready.pair.hint")}</p>
              {(result.sameNetworkOnly || result.requiresPassphrase) && (
                <div className="restriction-badges">
                  {result.sameNetworkOnly && (
                    <span><Wifi size={12} /> {t("ready.badge.network")}</span>
                  )}
                  {result.requiresPassphrase && (
                    <span><KeyRound size={12} /> {t("ready.badge.passphrase")}</span>
                  )}
                </div>
              )}
            </>
          )}
          {!ended && stage === "verify" && result.verificationCode && (
            <div className="verification-box" role="status">
              <span>{t("ready.verify.label")}</span>
              <strong>{result.verificationCode}</strong>
              <small>{t("ready.verify.hint")}</small>
              <button className="primary-btn small" onClick={onVerify}>
                <Check size={15} /> {t("ready.verify.btn")}
              </button>
            </div>
          )}
          {!ended && (
            <div className="countdown">
              <span>{t("ready.countdown")}</span>
              <strong>
                {String(Math.floor(left / 60)).padStart(2, "0")}:
                {String(left % 60).padStart(2, "0")}
              </strong>
            </div>
          )}
          <div className="privacy-callout">
            <ShieldCheck size={16} />
            <span>
              <b>{t("ready.privacy.title")}</b>
              <small>{t("ready.privacy.sub")}</small>
            </span>
          </div>
          <div className="ready-actions">
            <button className="secondary-btn" onClick={onReset}>
              <RotateCcw size={15} /> {t("ready.btn.again")}
            </button>
            <button
              className="danger-btn"
              onClick={revoke}
              disabled={ended || left === 0}
            >
              {ended ? (
                <>
                  <Check size={15} /> {t("ready.btn.ended")}
                </>
              ) : (
                <>
                  <Trash2 size={15} /> {t("ready.btn.destroy")}
                </>
              )}
            </button>
          </div>
        </div>
        <div className="ready-note">
          {ended ? (
            <>
              <CheckCircle2 size={15} /> {t("ready.note.ended")}
            </>
          ) : (
            <>
              <QrCode size={15} /> {t("ready.note.waiting")}
            </>
          )}
        </div>
        {ended && (
          <a
            className="ended-star-cta"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Star size={14} className="hero-star-pulse" />
            <span>{t("star.ended.cta")}</span>
            <ArrowUpRight size={13} />
          </a>
        )}
      </main>
    </Shell>
  );
}

createRoot(document.getElementById("root")).render(<App />);
