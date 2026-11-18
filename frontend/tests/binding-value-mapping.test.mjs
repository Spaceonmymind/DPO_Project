import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("one Word binding edits and persists its own answer text map", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1450, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-workspace.html?valueMapping=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    const fragment = page.locator('.docx-page [data-locator="word/document.xml#/p[1]"]');
    await fragment.evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node.firstChild);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    const search = page.getByRole("combobox", { name: "Вопрос анкеты" });
    await search.fill("Порядок оплаты");
    await page.getByRole("option", { name: /Порядок оплаты и подтверждения/ }).click();
    await page.getByLabel("Формат в документе").selectOption("VALUE_MAPPING");
    const map = page.locator(".selection-card-floating .binding-value-mapping");
    assert.match(await map.innerText(), /Без соответствия/);
    await map.getByRole("checkbox").first().check();
    await map.getByRole("textbox", { name: "Текст для «100% постоплата»" }).fill("после оказания услуг");
    assert.match(await map.locator("output").innerText(), /после оказания услуг/);
    await page.getByRole("button", { name: "Создать привязку" }).click();
    const created = await page.evaluate(() => window.__writes.find(write => write.kind === "binding").payload);
    assert.equal(created.output_format, "VALUE_MAPPING");
    assert.equal(created.format_options.value_map["100% постоплата"], "после оказания услуг");
    await fragment.locator('mark[role="button"]').click();
    const saved = page.locator(".workspace-active-binding");
    assert.equal(await saved.getByRole("combobox", { name: "Формат вывода" }).inputValue(), "VALUE_MAPPING");
    await saved.getByRole("textbox", { name: "Текст для «100% постоплата»" }).fill("после завершения работ");
    await saved.getByRole("button", { name: "Сохранить соответствия" }).click();
    await page.waitForFunction(() => window.__writes.some(write => write.kind === "binding-format"));
    assert.equal(await page.evaluate(() => window.__writes.find(write => write.kind === "binding-format").payload.format_options.value_map["100% постоплата"]), "после завершения работ");
    await saved.getByRole("button", { name: "Закрыть" }).click();
    await page.reload();
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.locator('.docx-page [data-locator="word/document.xml#/p[1]"] mark[role="button"]').click();
    assert.equal(await saved.getByRole("textbox", { name: "Текст для «100% постоплата»" }).inputValue(), "после завершения работ");
  } finally { await browser.close(); await server.close(); }
});
