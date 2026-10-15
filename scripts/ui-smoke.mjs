import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3010";
const errors = [];
const pageErrors = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(String(err)));

let passed = 0;
let failed = 0;

async function r(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message}`);
    failed++;
  }
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

await r("no magic link button when Resend unset", async () => {
  if ((await page.getByRole("button", { name: /magic/i }).count()) !== 0) {
    throw new Error("magic button visible");
  }
});

await r("login with FormData fields", async () => {
  await page.fill('input[name="email"]', "deisy@local.test");
  await page.fill('input[name="password"]', "deisy-dev-pass");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login")),
    page.getByRole("button", { name: /log in/i }).click(),
  ]);
  await page.waitForSelector(".brand");
  await page.waitForTimeout(800);
});

await r("ES toggle updates labels", async () => {
  await page.getByRole("button", { name: "ES", exact: true }).click();
  await page.waitForFunction(() => {
    const h1 = [...document.querySelectorAll("h1")].map((el) => el.textContent || "");
    const user = document.querySelector(".user")?.textContent || "";
    const logout = [...document.querySelectorAll("button")].some(
      (b) => b.textContent?.trim() === "Salir"
    );
    return logout && user.includes("· ES") && h1.some((t) => t.includes("Para Deisy"));
  });
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Log out")
  );
});

await r("company filter Baires shows ~11", async () => {
  await page.locator('input[type="search"]').fill("Baires");
  await page.waitForFunction(() => {
    const h = [...document.querySelectorAll("h1")].map((el) => el.textContent || "");
    return h.some((t) => /Filters?\s*\(1[01]\)|Filtros\s*\(1[01]\)/.test(t));
  });
  const body = await page.textContent("body");
  if (!body.includes("BairesDev")) throw new Error("no BairesDev cards");
});

await r("Detail navigates to application page", async () => {
  await page.locator("a.btn.ghost").first().click();
  await page.waitForURL(/\/applications\/\d+/);
  await page.waitForSelector("h2");
});

await r("logout returns to login", async () => {
  await page.goto(BASE);
  await page.waitForSelector(".brand");
  await page.getByRole("button", { name: /log out|salir/i }).click();
  await page.waitForURL(/\/login/);
});

fs.mkdirSync("/opt/cursor/artifacts/screenshots", { recursive: true });
console.log("\nconsole errors:", errors);
console.log("page errors:", pageErrors);
console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);
