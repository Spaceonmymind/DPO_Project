import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("failed binding keeps the Word selection; confirmed response paints and lists it", { skip: !existsSync(chromePath), timeout: 45000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/docx-interactions.html`);
    await page.getByRole("button", { name: /Черновик договора с ИП/ }).first().click();
    await page.getByRole("button", { name: /Версия 3/ }).first().click();
    const paragraph = page.locator('.preview-node [data-locator="word/document.xml#/p[1]"]');
    await paragraph.evaluate(node => {
      const range = document.createRange();
      range.setStart(node.firstChild, 0);
      range.setEnd(node.firstChild, 7);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    const card = page.locator("#workspace-context-inspector .selection-card");
    await card.waitFor();
    await page.getByRole("combobox", { name: "Вопрос анкеты" }).fill("Порядок оплаты");
    await page.getByRole("option", { name: /Порядок оплаты/ }).click();
    const text = await card.locator("blockquote").textContent();
    await page.evaluate(() => { window.fixtureState.failBinding = true; });
    await card.getByRole("button", { name: "Создать привязку" }).click();
    await page.getByRole("alert").filter({ hasText: "Выделение не соответствует исходному DOCX." }).waitFor();
    assert.equal(await card.locator("blockquote").textContent(), text);
    assert.equal(await page.locator('.preview-node [data-locator="word/document.xml#/p[1]"] mark').count(), 0);
    await page.evaluate(() => { window.fixtureState.failBinding = false; });
    await card.getByRole("button", { name: "Создать привязку" }).click();
    await page.getByText("Привязка создана.").waitFor();
    assert.equal(await card.count(), 0);
    assert.equal(await page.locator('.preview-node [data-locator="word/document.xml#/p[1]"] mark').count(), 1);
    assert.match(await page.locator(".binding-list.panel-bindings").textContent(), /Порядок оплаты/);
    assert.equal(await page.evaluate(() => window.fixtureState.bindings.length), 1);
  } finally {
    await browser.close();
    await server.close();
  }
});
