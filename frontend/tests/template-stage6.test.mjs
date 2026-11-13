import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("step 6 uses employee questionnaire without Word DOM and preserves answers", { skip: !existsSync(chromePath), timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.locator(".docx-page").waitFor();
    assert.equal(await page.evaluate(() => window.__previewRequests), 1);
    const stages = page.getByRole("navigation", { name: "Этапы настройки шаблона" });
    await stages.getByRole("button", { name: /Проверка и публикация/ }).click();
    await page.getByRole("region", { name: "Предпросмотр анкеты" }).waitFor();
    for (const selector of [".docx-page", ".version-list", ".document-outline", ".questionnaire-builder", ".builder-grid"]) assert.equal(await page.locator(selector).count(), 0, `${selector} absent on step 6`);
    assert.equal(await page.evaluate(() => window.__previewRequests), 1);
    assert.equal(await page.getByLabel("Процент предоплаты").count(), 0);
    await page.getByRole("button", { name: "PARTIAL" }).click();
    const percent = page.getByLabel("Процент предоплаты");
    assert.equal(await percent.inputValue(), "30");
    await percent.fill("");
    await page.getByRole("button", { name: "Сформировать тестовый DOCX" }).click();
    assert.match(await page.getByRole("alert").last().textContent(), /Процент предоплаты.*Обязательное поле/);
    assert.equal(await page.evaluate(() => window.__testAnswers), null);
    await percent.fill("40");
    await stages.getByRole("button", { name: /Условия и таблицы/ }).click();
    await page.locator(".docx-page").waitFor();
    await stages.getByRole("button", { name: /Проверка и публикация/ }).click();
    assert.equal(await page.getByLabel("Процент предоплаты").inputValue(), "40");
    const sections = page.getByRole("navigation", { name: "Разделы анкеты" });
    await sections.getByRole("button", { name: /Дополнительно/ }).click();
    await page.getByRole("checkbox", { name: "Кейтеринг" }).check();
    await page.getByRole("checkbox", { name: "Иное" }).check();
    await page.getByRole("button", { name: /Добавить ещё вариант/ }).click();
    await page.getByRole("textbox", { name: "Свой вариант 1" }).fill("Оформление");
    await page.getByRole("textbox", { name: "Свой вариант 2" }).fill("Трансфер");
    await page.getByRole("button", { name: "Добавить запись" }).click();
    await page.getByLabel("Описание услуги").fill("Прокат оборудования");
    await page.getByRole("button", { name: "Сформировать тестовый DOCX" }).click();
    await page.getByRole("link", { name: /Тестовый DOCX готов/ }).waitFor();
    const answers = await page.evaluate(() => window.__testAnswers);
    assert.equal(answers.percent, "40");
    assert.deepEqual(answers.services.selected, ["food", "__other__"]);
    assert.deepEqual(answers.services.other_texts, ["Оформление", "Трансфер"]);
    assert.equal(answers.extras[0].description, "Прокат оборудования");
    await page.getByRole("button", { name: "Опубликовать шаблон" }).click();
    await page.getByText("Версия опубликована и доступна сотрудникам.").waitFor();
    assert.equal(await page.evaluate(() => window.__publishes), 1);
    assert.equal(await page.evaluate(() => window.__previewRequests), 1, "publishing from step 6 skips Word preview fetch");
    assert.equal(await page.locator(".docx-page").count(), 0);
    await stages.getByRole("button", { name: /Условия и таблицы/ }).click();
    await page.locator(".docx-page").waitFor();
    assert.equal(await page.evaluate(() => window.__previewRequests), 1, "returning to the same Word reuses its preview");
  } finally {
    await browser.close();
    await server.close();
  }
});

test("publication warnings remain visible and do not block the action", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html?warnings=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.getByRole("navigation", { name: "Этапы настройки шаблона" }).getByRole("button", { name: /Проверка и публикация/ }).click();
    await page.getByText(/Служебный вопрос.*не используется/).waitFor();
    const button = page.getByRole("button", { name: "Опубликовать с предупреждениями" });
    assert.equal(await button.isEnabled(), true);
    await button.click();
    assert.equal(await page.evaluate(() => window.__publishes), 1);
  } finally { await browser.close(); await server.close(); }
});

test("critical publication error disables the action", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html?errors=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.getByRole("navigation", { name: "Этапы настройки шаблона" }).getByRole("button", { name: /Проверка и публикация/ }).click();
    await page.getByText(/Привязка «Имя» ссылается/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Опубликовать шаблон" }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__publishes), 0);
  } finally { await browser.close(); await server.close(); }
});
