#!/usr/bin/env node

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const outputDir = path.join(projectDir, "docs", "assets");
const baseUrl = process.env.INSTANTFLOW_URL || "http://localhost:5173";

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  locale: "zh-CN",
});
const page = await context.newPage();

async function capture(name) {
  await page.screenshot({
    path: path.join(outputDir, `${name}.png`),
    type: "png",
    animations: "disabled",
  });
  console.log(`Captured docs/assets/${name}.png`);
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await capture("home");

  await page.getByRole("button", { name: "文字" }).click();
  await page.getByPlaceholder("粘贴一段文字、地址或临时信息……").fill(
    "这是一段只在两台设备之间短暂存在的示例文字。",
  );
  await page.getByText("仅限同一网络出口", { exact: true }).click();
  await page.getByText("增加接收口令", { exact: true }).click();
  await page.getByPlaceholder("设置至少 8 个字符的接收口令").fill("instant-flow-demo");
  await capture("settings");

  await page.getByRole("button", { name: "我要接收" }).click();
  await page.getByPlaceholder("0000 0000").fill("48273165");
  await capture("features");
} finally {
  await browser.close();
}
