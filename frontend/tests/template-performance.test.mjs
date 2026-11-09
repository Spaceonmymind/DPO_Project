import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("large Word preview mounts distant blocks on demand and preserves visible interactions", { skip: !existsSync(chromePath), timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-workspace.html?large=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.locator(".preview-node").first().waitFor();
    assert.equal(await page.locator(".workspace-question-list button").count(), 160);
    assert.ok(await page.locator(".preview-node").count() < 150);
    assert.equal(await page.locator(".docx-table").count(), 0);
    await page.getByRole("tab", { name: "Word" }).click();
    await page.getByLabel("Найти фрагмент").fill("Фрагмент договора 3500");
    await page.locator(".workspace-structure-list button").first().click();
    await page.locator('.docx-page [data-locator="word/document.xml#/p[3500]"]').waitFor();
    assert.ok(await page.locator(".document-canvas").evaluate(panel => panel.scrollTop) > 0);
    await page.getByLabel("Найти фрагмент").fill("Объединённая ячейка");
    await page.locator(".workspace-structure-list button").first().click();
    await page.locator(".docx-table").waitFor();
    assert.equal(await page.locator(".docx-table tr").count(), 2);
    assert.equal(await page.locator(".docx-table td[colspan='2'][rowspan='2']").count(), 1);
    await page.getByLabel("Масштаб документа").selectOption("125");
    await page.locator(".docx-table td[colspan='2'][rowspan='2']").waitFor();
    await page.getByLabel("Масштаб документа").selectOption("100");
    await page.getByLabel("Найти фрагмент").fill("Фрагмент договора 1");
    await page.locator(".workspace-structure-list button").first().click();
    await page.locator('.docx-page [data-locator="word/document.xml#/p[1]"]').waitFor();
    await page.getByRole("tab", { name: "Вопросы" }).click();
    await page.evaluate(() => { window.__wordNode = document.querySelector('.docx-page [data-locator="word/document.xml#/p[1]"]'); });
    await page.locator(".workspace-question-list button").first().click();
    assert.equal(await page.evaluate(() => window.__wordNode === document.querySelector('.docx-page [data-locator="word/document.xml#/p[1]"]')), true);
    await page.getByLabel("Найти вопрос").fill("Вопрос номер 160");
    assert.equal(await page.locator(".workspace-question-list button").count(), 1);
    await page.locator(".workspace-question-list button").click();
    assert.equal(await page.evaluate(() => window.__wordNode === document.querySelector('.docx-page [data-locator="word/document.xml#/p[1]"]')), true);
    await page.locator('.docx-page [data-locator="word/document.xml#/p[1]"]').evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node.firstChild); getSelection().removeAllRanges(); getSelection().addRange(range);
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.locator("#workspace-context-inspector .selection-card").waitFor();
    assert.equal(await page.evaluate(() => window.__previewRequests), 1);
    await page.getByRole("tab", { name: "Word" }).click();
    await page.getByLabel("Найти фрагмент").fill("Объединённая ячейка");
    await page.locator(".workspace-structure-list button").first().click();
    assert.equal(await page.locator('.docx-table [data-locator="word/document.xml#/tbl[1]/tr[2]/tc[1]/p[1]"]').count(), 1);
    const mergedCell = page.locator('.docx-table .preview-node').first();
    await mergedCell.hover();
    await mergedCell.getByRole("button", { name: "Сделать строку повторяемой" }).click();
    await page.locator("#workspace-context-inspector .repeating-editor").waitFor();
  } finally {
    await browser.close();
    await server.close();
  }
});
