<div align="center">

# USend

> No account. No copied link. Let information exist briefly between two devices.  
> 不登录、不复制链接，让信息只在两台设备之间短暂存在。

[![Version](https://img.shields.io/badge/version-0.1.0-315fbd?style=flat-square)](https://github.com/frankfika/usend/releases/tag/v0.1.0)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
![E2EE](https://img.shields.io/badge/security-E2EE-2d9d78?style=flat-square)

[Live Demo](https://usend.xyz/) · [Features](#-features) · [Quick Start](#-quick-start) · [Security](#-security)

[简体中文](./README.md) | __English__

</div>

![USend home screen](./docs/assets/home_en.png)

> Screenshots show the English UI. 中文界面截图见 [README.md](./README.md).

## ✨ Introduction

USend is a web app for temporary device-to-device transfers. The sender selects a file or text and creates an eight-digit pairing code. The receiver enters it on another device to connect. By default, the sender checks that both devices show the same security code before sending. Content is encrypted by the sender, briefly relayed by the server, and decrypted only by the receiver.

| Typical temporary transfer | USend |
| --- | --- |
| Account registration or app installation | Open it in a browser |
| Long-lived shared links | Eight-digit one-time pairing code |
| Server-readable file contents | Browser-based end-to-end encryption |
| Manual cleanup | Automatic deletion after receipt, revocation, or expiry |

## 🚀 Features

### 1. Fast file and text transfer

- **Two content types**: Send one file up to 20 MB or up to 12,000 characters of text.
- **No account required**: Sending and receiving start on the same homepage.
- **No shared link**: Tell the other person only the one-time eight-digit pairing code.

### 2. A visible, verifiable security flow

- **End-to-end encryption**: The devices negotiate a shared secret with ECDH P-256, then derive an AES-256-GCM content key with HKDF-SHA-256.
- **Security code**: By default, the sender confirms that both codes match before sending; confirmation can be disabled for trusted transfers that should start automatically after pairing.
- **Optional restrictions**: “Same network only” is off by default. Enable it explicitly when needed, and optionally add a receive password of at least eight characters.
- **Domain-separated derivation**: A receive password is processed with a random salt and PBKDF2-SHA-256 (210,000 iterations) to derive separate verification and encryption material.

![Transfer security options](./docs/assets/settings_en.png)

### 3. Ephemeral by default

- **Automatic expiry**: Delete after 1, 5, or 10 minutes.
- **Delete after receipt**: Remove the room and ciphertext immediately after a successful transfer.
- **Sender revocation**: End a transfer at any time and invalidate its pairing code.

## 🖼️ Screenshots

| Send a file | Configure restrictions | Enter a pairing code |
| --- | --- | --- |
| ![Send a file](./docs/assets/home_en.png) | ![Security options](./docs/assets/settings_en.png) | ![Receive screen](./docs/assets/features_en.png) |

## ⚡ Quick Start

### Use the hosted app

Open [usend.xyz](https://usend.xyz/):

1. Select a file or text on the sending device, then adjust the security-code check and optional restrictions as needed.
2. Create a pairing code and enter it on the receiving device.
3. Check both security codes by default, or let the transfer start automatically if the sender disabled the check.
4. Temporary server-side data is destroyed after successful receipt.

### Run locally

Node.js 20 or later is required.

```bash
git clone https://github.com/frankfika/usend.git
cd usend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173` by default and the local reference API at `http://localhost:8787`. To use the full local Cloudflare runtime:

```bash
npm run dev:edge
```

## 🏗️ Architecture

```mermaid
flowchart LR
    S["Sending device<br/>Local encryption"] -->|"Chunked ciphertext"| W["Cloudflare Worker"]
    W --> R["Room Durable Object"]
    W --> C["Pairing codes and rate limits<br/>Durable Object"]
    R -->|"Authenticated ciphertext download"| D["Receiving device<br/>Local decryption"]
    S <-.->|"ECDH + verification code"| D
    A["Durable Object Alarm"] -->|"Expiry cleanup"| R
```

- A Cloudflare Worker serves the static app and API on the same origin.
- Each transfer room uses a dedicated Durable Object for metadata and chunked ciphertext.
- A separate Durable Object manages pairing-code mappings and cross-node rate limits.
- Durable Object Alarms handle expiry; successful receipt or revocation deletes data immediately.

## 🔐 Security

The server never receives a private key or content key. Ciphertext downloads require a receiver-specific token, and only a hash of that token is stored. CSP, HSTS, frame protection, MIME sniffing protection, same-origin restrictions, and no-cache responses are enabled by default.

Learn more: [Security model](./SECURITY.md) · [Privacy notice](./PRIVACY.md) · [Security audit](./SECURITY_AUDIT.md)

> USend reduces the risk of server-side access to temporary content. It does not replace trust in the devices, browser environment, or the identity of the other participant.

## 🧪 Validation and deployment

```bash
npm test
npm run typecheck:worker
npm run deploy:dry-run
```

For the edge smoke test, run `npm run dev:edge`, then execute `npm run test:edge` in another terminal. With the local app running, regenerate README images using `npm run screenshots`.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment and secret configuration.

## 📦 Releases

The current version is [v0.1.0](https://github.com/frankfika/usend/releases/tag/v0.1.0). See [GitHub Releases](https://github.com/frankfika/usend/releases) for release notes and future updates.

## ☕ Support the project

If USend has been useful to you, consider buying the author a coffee. Thank you for your support!

<div align="center">
  <img src="./docs/assets/wechat-pay.jpg" alt="WeChat Pay donation QR code" width="320" />
</div>
