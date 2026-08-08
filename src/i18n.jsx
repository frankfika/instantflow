import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// ============================================================
// InstantFlow — minimal i18n (zh / en)
// ============================================================

export const LANGS = ["zh", "en"];
const STORAGE_KEY = "instantflow:lang";

// 推断初始语言：localStorage > 浏览器 navigator.language > 默认 zh
export function detectLang() {
  if (typeof window === "undefined") return "zh";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {}
  const nav = (navigator.language || "zh").toLowerCase();
  return nav.startsWith("en") ? "en" : "zh";
}

// 翻译字典。带 {name} {count} {n} 的字符串支持插值。
const DICT = {
  zh: {
    // ---- document / meta ----
    "doc.title": "瞬传 · 让信息短暂存在",
    "doc.lang": "zh-CN",

    // ---- topbar ----
    "brand.eyebrow": "INSTANTFLOW",
    "top.trust": "端到端临时传输",
    "lang.label": "语言",
    "lang.switchTo": "切换到 English",

    // ---- github star ----
    "star.btn.hasStars": "Star",
    "star.btn.firstStar": "成为首个 Star",
    "star.aria.hasStars": "在 GitHub 上给项目点 Star，当前 {count} 颗星",
    "star.aria.firstStar": "在 GitHub 上成为首个给项目点 Star 的人",
    "star.title.hasStars": "当前 {count} 颗星",
    "star.title.firstStar": "成为第一个 Star",
    "star.hero.title.hasStars": "觉得好用？给个 Star 支持一下",
    "star.hero.title.firstStar": "成为第一个 Star 支持者",
    "star.hero.sub.hasStars": "已有 {count} 颗星 · 完全开源，无追踪",
    "star.hero.sub.firstStar": "完全开源，无追踪，无账号 · 等你点亮第一颗星",
    "star.hero.cta": "去点 Star",
    "star.ended.cta": "顺手给个 Star，让瞬传被更多人看到",
    "star.footer": "开源无追踪 · Star 支持一下",

    // ---- footer ----
    "footer.left": "无账号 · 无历史 · 端到端加密",
    "footer.privacy": "临时传输，阅后即焚",

    // ---- trust strip ----
    "trust.encrypt.title": "本机先加密",
    "trust.encrypt.sub": "文件离开设备前已密封",
    "trust.ttl.title": "短时存在",
    "trust.ttl.sub": "最长 10 分钟后自动删除",
    "trust.account.title": "无需账号",
    "trust.account.sub": "配对码只连接这次传输",

    // ---- hero ----
    "hero.h1.send": "把信息送到另一台设备",
    "hero.h1.receive": "接收一份临时信息",
    "hero.p.send": "不登录，不复制链接。选择内容后，用一次性配对码连接另一台设备。",
    "hero.p.receive": "输入发送设备上显示的配对码，内容只在这台设备本地解密。",

    // ---- mode switch ----
    "mode.send": "我要发送",
    "mode.receive": "我要接收",

    // ---- send card / segmented ----
    "seg.file": "文件",
    "seg.text": "文字",

    // ---- dropzone ----
    "drop.empty.title": "拖入文件，或点击选择",
    "drop.empty.meta": "单个文件最大 20 MB",
    "drop.filled.meta": "{size} · 已准备在本机加密",
    "drop.change": "点击更换",
    "drop.tooLarge": "单个文件暂时不能超过 20 MB",

    // ---- text ----
    "text.placeholder": "粘贴一段文字、地址或临时信息……",
    "text.count": "{n} / 12,000",
    "text.defaultName": "临时文字.txt",

    // ---- send options ----
    "opt.autoDelete": "自动删除",
    "opt.after1": "1 分钟后",
    "opt.after5": "5 分钟后",
    "opt.after10": "10 分钟后",
    "opt.note": "两台设备临时协商密钥",

    // ---- security options ----
    "sec.heading": "额外限制",
    "sec.optional": "可选",
    "sec.network.title": "仅限同一网络出口",
    "sec.network.sub": "由服务端校验网络指纹，不读取或比较 Wi-Fi 名称",
    "sec.network.caveat": "开启 VPN、代理、蜂窝网络或隐私中继时，即使连接同一 Wi-Fi 也可能被拒绝。",
    "sec.passphrase.title": "增加接收口令",
    "sec.passphrase.sub": "只有同时知道配对码和口令的设备才能加入",
    "sec.passphrase.placeholder": "设置至少 8 个字符的接收口令",
    "sec.passphrase.hint.empty": "至少 8 个字符",
    "sec.passphrase.hint.short": "还差 {n} 个字符，暂时不能生成配对码",
    "sec.passphrase.hint.ok": "口令长度符合要求",

    // ---- primary button / send stages ----
    "btn.generate": "生成一次性配对码",
    "btn.passphraseShort": "接收口令还差 {n} 个字符",
    "stage.room": "建立配对房间…",
    "stage.waiting": "等待另一台设备…",
    "stage.verify": "请核对安全校验码…",
    "stage.encrypt": "正在本机加密…",
    "stage.upload": "正在上传密文…",
    "err.transfer": "传输没有完成，请重新开始。",

    // ---- how section ----
    "how.link": "它是怎么保护你的？",
    "how.kicker": "HOW IT WORKS",
    "how.title": "让安全变成\n看得见的过程。",
    "how.1.title": "两台设备临时配对",
    "how.1.body": "发送和接收都从这一个首页开始。",
    "how.2.title": "设备之间协商密钥",
    "how.2.body": "配对码只负责找到房间，真正的加密钥匙由两台设备临时生成。",
    "how.3.title": "到点自动清空",
    "how.3.body": "倒计时结束后，临时房间和密文一起失效。",

    // ---- receive entry ----
    "recv.eyebrow": "输入一次性配对码",
    "recv.h2": "让两台设备\n认出彼此。",
    "recv.p": "配对码只在这次传输中有效，不需要链接或账号。",
    "recv.code.placeholder": "0000 0000",
    "recv.passphrase.placeholder": "接收口令（如果发送方设置了）",
    "recv.btn.joining": "正在配对…",
    "recv.btn.waiting": "等待发送设备…",
    "recv.btn.start": "开始接收",
    "recv.verify.label": "安全校验码",
    "recv.verify.hint": "请与发送设备核对；不一致时立即取消。",
    "recv.warn": "配对成功后，真正的加密钥匙只在两台设备之间生成。",
    "recv.err.code": "请输入 8 位配对码",
    "recv.err.needPassphrase": "发送方为这次传输设置了接收口令",
    "recv.err.rate": "尝试次数过多，请稍后再试。",
    "recv.err.notfound": "这个配对码不存在或已经过期。",
    "recv.err.paired": "这次传输已经与另一台设备配对。",
    "recv.err.network": "发送方只允许同一网络下的设备接收。请连接同一 Wi-Fi，并关闭 VPN、代理或蜂窝网络后重试。",
    "recv.err.passphrase": "接收口令不正确。",
    "recv.err.fallback": "接收失败，请检查配对码后重试。",

    // ---- receive done ----
    "done.eyebrow": "已在此设备解密",
    "done.h2.text": "文字已经到达。",
    "done.h2.file": "文件已经到达。",
    "done.save": "保存",
    "done.delete.ok": "服务器已确认删除临时密文",
    "done.delete.fail": "内容已解密，但删除确认失败；密文仍会在到期时清除",

    // ---- ready page ----
    "ready.eyebrow.waiting": "等待另一台设备配对",
    "ready.h1.waiting": "告诉对方这组\n一次性配对码。",
    "ready.h1.ended": "这次传输\n已经安全结束。",
    "ready.pair.hint": "在接收设备首页输入这 8 位数字",
    "ready.badge.network": "仅限同一网络出口",
    "ready.badge.passphrase": "需要接收口令",
    "ready.verify.label": "双方安全校验码",
    "ready.verify.hint": "与接收设备一致后，才会开始加密和上传。",
    "ready.verify.btn": "两边一致，继续发送",
    "ready.countdown": "自动删除倒计时",
    "ready.privacy.title": "没有链接，也没有账号",
    "ready.privacy.sub": "配对码只负责找到房间，加密钥匙由两台设备临时协商。",
    "ready.btn.again": "再传一个",
    "ready.btn.destroy": "立即销毁",
    "ready.btn.ended": "已结束",
    "ready.note.ended": "本次配对码已经失效，不能再次接收",
    "ready.note.waiting": "只需告诉对方配对码，不需要复制任何链接",

    // ---- end reasons ----
    "end.received.eyebrow": "对方已安全接收",
    "end.received.message": "对方已接收，服务器上的临时密文已删除",
    "end.expired.eyebrow": "传输已到期",
    "end.expired.message": "保存时间已结束，房间和临时密文已删除",
    "end.revoked.eyebrow": "已主动销毁",
    "end.revoked.message": "房间和临时密文已立即删除",
  },

  en: {
    // ---- document / meta ----
    "doc.title": "InstantFlow · Short-lived, private transfers",
    "doc.lang": "en",

    // ---- topbar ----
    "brand.eyebrow": "INSTANTFLOW",
    "top.trust": "End-to-end temporary transfer",
    "lang.label": "Language",
    "lang.switchTo": "Switch to 中文",

    // ---- github star ----
    "star.btn.hasStars": "Star",
    "star.btn.firstStar": "Be the first Star",
    "star.aria.hasStars": "Star this project on GitHub — currently {count} stars",
    "star.aria.firstStar": "Be the first to star this project on GitHub",
    "star.title.hasStars": "{count} stars so far",
    "star.title.firstStar": "Be the first Star",
    "star.hero.title.hasStars": "Finding it useful? Leave a Star",
    "star.hero.title.firstStar": "Be the first to star this project",
    "star.hero.sub.hasStars": "{count} stars · fully open-source, no tracking",
    "star.hero.sub.firstStar": "Fully open-source, no tracking, no accounts · waiting for its first star",
    "star.hero.cta": "Star it",
    "star.ended.cta": "Drop a Star so more people can find InstantFlow",
    "star.footer": "Open-source, no tracking · Star to support",

    // ---- footer ----
    "footer.left": "No accounts · No history · End-to-end encrypted",
    "footer.privacy": "Temporary transfer, gone after read",

    // ---- trust strip ----
    "trust.encrypt.title": "Encrypted on device first",
    "trust.encrypt.sub": "Sealed before it ever leaves",
    "trust.ttl.title": "Short-lived",
    "trust.ttl.sub": "Auto-deleted after at most 10 minutes",
    "trust.account.title": "No account needed",
    "trust.account.sub": "Pairing code links only this transfer",

    // ---- hero ----
    "hero.h1.send": "Send something to another device",
    "hero.h1.receive": "Receive a temporary transfer",
    "hero.p.send": "No sign-in, no copied links. Pick your content, connect with a one-time pairing code.",
    "hero.p.receive": "Enter the pairing code shown on the sending device. Content is decrypted only on this device.",

    // ---- mode switch ----
    "mode.send": "Send",
    "mode.receive": "Receive",

    // ---- send card / segmented ----
    "seg.file": "File",
    "seg.text": "Text",

    // ---- dropzone ----
    "drop.empty.title": "Drop a file, or click to choose",
    "drop.empty.meta": "Max 20 MB per file",
    "drop.filled.meta": "{size} · ready to encrypt on this device",
    "drop.change": "Click to change",
    "drop.tooLarge": "A single file can't exceed 20 MB yet",

    // ---- text ----
    "text.placeholder": "Paste some text, an address, or any temporary note…",
    "text.count": "{n} / 12,000",
    "text.defaultName": "temporary-text.txt",

    // ---- send options ----
    "opt.autoDelete": "Auto-delete",
    "opt.after1": "after 1 min",
    "opt.after5": "after 5 min",
    "opt.after10": "after 10 min",
    "opt.note": "Keys are negotiated by the two devices",

    // ---- security options ----
    "sec.heading": "Extra restrictions",
    "sec.optional": "optional",
    "sec.network.title": "Same network only",
    "sec.network.sub": "Server checks the network fingerprint — it never reads or compares Wi-Fi names",
    "sec.network.caveat": "With VPN, proxies, cellular, or privacy relay enabled, pairing may be rejected even on the same Wi-Fi.",
    "sec.passphrase.title": "Add a receive passphrase",
    "sec.passphrase.sub": "Only a device that knows both the code and the passphrase can join",
    "sec.passphrase.placeholder": "Set a receive passphrase (min 8 characters)",
    "sec.passphrase.hint.empty": "At least 8 characters",
    "sec.passphrase.hint.short": "{n} more characters before we can generate a pairing code",
    "sec.passphrase.hint.ok": "Passphrase length looks good",

    // ---- primary button / send stages ----
    "btn.generate": "Generate one-time code",
    "btn.passphraseShort": "Passphrase needs {n} more characters",
    "stage.room": "Setting up the room…",
    "stage.waiting": "Waiting for the other device…",
    "stage.verify": "Check the verification code…",
    "stage.encrypt": "Encrypting on this device…",
    "stage.upload": "Uploading ciphertext…",
    "err.transfer": "Transfer didn't complete. Please start over.",

    // ---- how section ----
    "how.link": "How does it protect you?",
    "how.kicker": "HOW IT WORKS",
    "how.title": "Security you can\nactually see.",
    "how.1.title": "Two devices, temporarily paired",
    "how.1.body": "Sending and receiving both start from this single page.",
    "how.2.title": "Keys negotiated between devices",
    "how.2.body": "The pairing code only finds the room. The real encryption key is generated on the fly by the two devices.",
    "how.3.title": "Auto-cleared on schedule",
    "how.3.body": "When the countdown ends, the temporary room and ciphertext expire together.",

    // ---- receive entry ----
    "recv.eyebrow": "Enter the one-time code",
    "recv.h2": "Let the two devices\nrecognize each other.",
    "recv.p": "The code is valid only for this transfer — no links, no accounts.",
    "recv.code.placeholder": "0000 0000",
    "recv.passphrase.placeholder": "Receive passphrase (if the sender set one)",
    "recv.btn.joining": "Pairing…",
    "recv.btn.waiting": "Waiting for sender…",
    "recv.btn.start": "Start receiving",
    "recv.verify.label": "Verification code",
    "recv.verify.hint": "Compare with the sender. Cancel immediately if it doesn't match.",
    "recv.warn": "After pairing, the real encryption key is generated only between the two devices.",
    "recv.err.code": "Please enter the 8-digit code",
    "recv.err.needPassphrase": "The sender set a passphrase for this transfer",
    "recv.err.rate": "Too many attempts. Please try again later.",
    "recv.err.notfound": "This code doesn't exist or has expired.",
    "recv.err.paired": "This transfer has already paired with another device.",
    "recv.err.network": "The sender only allows devices on the same network. Join the same Wi-Fi and turn off VPN, proxy, or cellular, then try again.",
    "recv.err.passphrase": "Incorrect passphrase.",
    "recv.err.fallback": "Receive failed. Please check the code and try again.",

    // ---- receive done ----
    "done.eyebrow": "Decrypted on this device",
    "done.h2.text": "Your text has arrived.",
    "done.h2.file": "Your file has arrived.",
    "done.save": "Save",
    "done.delete.ok": "Server confirmed the temporary ciphertext was deleted",
    "done.delete.fail": "Content was decrypted, but the deletion confirmation failed; the ciphertext will still be purged at expiry",

    // ---- ready page ----
    "ready.eyebrow.waiting": "Waiting for the other device to pair",
    "ready.h1.waiting": "Tell the other device\nthis one-time code.",
    "ready.h1.ended": "This transfer\nhas safely ended.",
    "ready.pair.hint": "Enter these 8 digits on the receiving device",
    "ready.badge.network": "Same network only",
    "ready.badge.passphrase": "Passphrase required",
    "ready.verify.label": "Shared verification code",
    "ready.verify.hint": "Encryption and upload start only after it matches the receiver.",
    "ready.verify.btn": "They match, continue",
    "ready.countdown": "Auto-delete countdown",
    "ready.privacy.title": "No links, no accounts",
    "ready.privacy.sub": "The code only finds the room. The encryption key is negotiated by the two devices.",
    "ready.btn.again": "Send another",
    "ready.btn.destroy": "Destroy now",
    "ready.btn.ended": "Ended",
    "ready.note.ended": "This pairing code is now invalid and can't be used again",
    "ready.note.waiting": "Just tell the other person the code — no links to copy",

    // ---- end reasons ----
    "end.received.eyebrow": "Received securely",
    "end.received.message": "Recipient received it; the temporary ciphertext on the server was deleted",
    "end.expired.eyebrow": "Transfer expired",
    "end.expired.message": "Time's up — the room and temporary ciphertext were deleted",
    "end.revoked.eyebrow": "Destroyed",
    "end.revoked.message": "The room and temporary ciphertext were deleted immediately",
  },
};

const LangContext = createContext({
  lang: "zh",
  setLang: () => {},
  t: (k) => k,
});

function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] != null ? String(params[key]) : `{${key}}`,
  );
}

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(detectLang);

  const setLang = useCallback((next) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
      const dictTitle = DICT[lang]?.["doc.title"];
      if (dictTitle) document.title = dictTitle;
    }
  }, [lang]);

  const value = useMemo(() => {
    const table = DICT[lang] || DICT.zh;
    const t = (key, params) => {
      const raw = table[key];
      if (raw == null) {
        // 退回到另一语言，再退回到 key 本身，避免出现裸 key
        const fallback = DICT.zh[key] ?? DICT.en[key] ?? key;
        return interpolate(fallback, params);
      }
      return interpolate(raw, params);
    };
    return { lang, setLang, t };
  }, [lang, setLang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}
