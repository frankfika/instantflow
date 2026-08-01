const targets = await fetch("http://127.0.0.1:9223/json/list").then((r) =>
  r.json(),
);
const checkUrl = process.env.CHECK_URL || "http://127.0.0.1:4173/";
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("mobile preview tab not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let requestId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 5_000);
  });

await cdp("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
});
await cdp("Page.navigate", { url: checkUrl });
await new Promise((resolve) => setTimeout(resolve, 1_000));

const evaluated = await cdp("Runtime.evaluate", {
  returnByValue: true,
  expression: `(() => {
    const switcher = document.querySelector('.home-mode');
    const card = document.querySelector('.send-card, .receive-entry');
    const buttons = [...switcher.querySelectorAll('button')];
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width };
    };
    return { innerWidth, innerHeight, switcher: rect(switcher), card: rect(card), buttons: buttons.map(rect) };
  })()`,
});
const result = evaluated.result.value;
const allRects = [result.switcher, ...result.buttons];
if (allRects.some((rect) => rect.left < 0 || rect.right > result.innerWidth))
  throw new Error(`mobile switch overflows: ${JSON.stringify(result)}`);
if (result.switcher.top >= result.card.top)
  throw new Error(`mobile switch is below the content card: ${JSON.stringify(result)}`);
if (result.buttons.some((rect) => rect.bottom - rect.top < 44))
  throw new Error(`mobile touch target is too small: ${JSON.stringify(result)}`);

const receiveButton = result.buttons[1];
const clickX = (receiveButton.left + receiveButton.right) / 2;
const clickY = (receiveButton.top + receiveButton.bottom) / 2;
await cdp("Input.dispatchMouseEvent", {
  type: "mousePressed",
  x: clickX,
  y: clickY,
  button: "left",
  clickCount: 1,
});
await cdp("Input.dispatchMouseEvent", {
  type: "mouseReleased",
  x: clickX,
  y: clickY,
  button: "left",
  clickCount: 1,
});
const receiveState = await cdp("Runtime.evaluate", {
  returnByValue: true,
  expression: `({
    heading: document.querySelector('.hero h1')?.innerText,
    receiveCardVisible: Boolean(document.querySelector('.receive-entry')),
    codeInputVisible: Boolean(document.querySelector('.code-input'))
  })`,
});
socket.close();
if (
  !receiveState.result.value.receiveCardVisible ||
  !receiveState.result.value.codeInputVisible
)
  throw new Error(`receive mode did not open: ${JSON.stringify(receiveState)}`);
console.log(
  JSON.stringify({ ...result, receiveMode: receiveState.result.value }, null, 2),
);
