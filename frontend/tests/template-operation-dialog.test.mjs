import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("test DOCX loading waits for API and file, blocks duplicates, and closes on error", { skip: !existsSync(chromePath), timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html?slow=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.getByRole("navigation", { name: "Этапы настройки шаблона" }).getByRole("button", { name: /Проверка и публикация/ }).click();
    const generate = page.getByRole("button", { name: "Сформировать тестовый DOCX" });
    await generate.click();
    const dialog = page.getByRole("dialog", { name: "Формируем тестовый DOCX" });
    await dialog.waitFor();
    assert.equal(await generate.isDisabled(), true);
    await generate.evaluate(button => button.click());
    assert.equal(await page.evaluate(() => window.__testCalls), 1);
    await page.evaluate(() => window.__completeTest());
    await page.waitForFunction(() => window.__downloads === 1);
    assert.equal(await dialog.isVisible(), true, "dialog remains until file arrives");
    assert.equal(await page.getByRole("link", { name: /Тестовый DOCX готов/ }).count(), 0);
    await page.evaluate(() => window.__completeDownload());
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("link", { name: /Тестовый DOCX готов/ }).count(), 1);
    assert.equal(await page.evaluate(() => performance.getEntriesByName("template-test-docx-api-response").length), 1);
    assert.equal(await page.evaluate(() => performance.getEntriesByName("template-test-docx-file-transfer").length), 1);
    assert.equal(await page.evaluate(() => performance.getEntriesByName("template-test-docx-client-processing").length), 1);

    await generate.click();
    await dialog.waitFor();
    await page.evaluate(() => window.__failTest());
    await dialog.waitFor({ state: "hidden" });
    assert.match(await page.getByRole("alert").last().textContent(), /Ошибка тестовой генерации/);
    assert.equal(await page.evaluate(() => window.__testCalls), 2);
    const publish = page.getByRole("button", { name: "Опубликовать шаблон" });
    await publish.click();
    const publishDialog = page.getByRole("dialog", { name: "Публикуем шаблон" });
    await publishDialog.waitFor();
    await publish.evaluate(button => button.click());
    assert.equal(await page.evaluate(() => window.__publishes), 1);
    await page.evaluate(() => window.__completePublish());
    await publishDialog.waitFor({ state: "hidden" });
    await page.getByText("Версия опубликована и доступна сотрудникам.").waitFor();
  } finally {
    await browser.close();
    await server.close();
  }
});
