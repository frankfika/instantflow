#!/usr/bin/env node

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const outputDir = path.join(projectDir, "docs", "assets");
const baseUrl = process.env.USEND_URL || process.env.INSTANTFLOW_URL || "http://localhost:5173";

// Capture both languages so the README (zh + en) can show locale-matched screenshots.
// Pass USEND_LANGS=zh or USEND_LANGS=en to capture a single language.
const langs = (process.env.USEND_LANGS || "zh,en")
  .split(",")
  .map((l) => l.trim())
  .filter((l) => l === "zh" || l === "en");

if (langs.length === 0) {
  console.error("USEND_LANGS must contain at least one of: zh, en");
  process.exit(1);
}

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function captureLang(lang) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: lang === "en" ? "en-US" : "zh-CN",
  });
  // Force the app language regardless of navigator.language by seeding
  // localStorage before the page loads its scripts.
  await context.addInitScript((lang) => {
    try {
      window.localStorage.setItem("instantflow:lang", lang);
    } catch {}
  }, lang);

  const page = await context.newPage();
  const suffix = langs.length > 1 ? `_${lang}` : "";

  async function capture(name) {
    await page.screenshot({
      path: path.join(outputDir, `${name}${suffix}.png`),
      type: "png",
      animations: "disabled",
    });
    console.log(`Captured docs/assets/${name}${suffix}.png`);
  }

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await capture("home");

    if (lang === "zh") {
      await page.getByRole("button", { name: "文字" }).click();
      await page
        .getByPlaceholder("粘贴一段文字、地址或临时信息……")
        .fill("这是一段只在两台设备之间短暂存在的示例文字。");
      await page.getByRole("button", { name: /传输设置/ }).click();
      await page.getByText("仅限同一网络", { exact: true }).click();
      await page.getByText("设置接收密码", { exact: true }).click();
      await page.getByPlaceholder("至少 8 个字符").fill("instant-flow-demo");
      await capture("settings");

      await page.getByRole("button", { name: "接收", exact: true }).click();
      await page.getByPlaceholder("0000 0000").fill("48273165");
      await capture("features");
    } else {
      await page.getByRole("button", { name: "Text" }).click();
      await page
        .getByPlaceholder("Paste some text, an address, or any temporary note…")
        .fill("A short note that briefly exists only between two devices.");
      await page.getByRole("button", { name: /Transfer settings/ }).click();
      await page.getByText("Same network only", { exact: true }).click();
      await page.getByText("Set a receive password", { exact: true }).click();
      await page.getByPlaceholder("At least 8 characters").fill("instant-flow-demo");
      await capture("settings");

      await page.getByRole("button", { name: "Receive", exact: true }).click();
      await page.getByPlaceholder("0000 0000").fill("48273165");
      await capture("features");
    }
  } finally {
    await context.close();
  }
}

try {
  for (const lang of langs) {
    await captureLang(lang);
  }
} finally {
  await browser.close();
}
