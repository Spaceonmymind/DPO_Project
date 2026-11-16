import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("builder stages filter step 6 and test generation uses selected IDs", { skip: !existsSync(chromePath), timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html?stages=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    const nav = page.getByRole("navigation", { name: "Этапы настройки шаблона" });
    await nav.getByRole("button", { name: /Вопросы анкеты/ }).click();
    await page.locator(".contract-stage-manager summary").click();
    assert.match(await page.locator(".contract-stage-manager").innerText(), /Подготовка.*Проведение/s);
    await nav.getByRole("button", { name: /Проверка и публикация/ }).click();
    const generate = page.getByRole("button", { name: "Сформировать тестовый DOCX" });
    assert.equal(await generate.isDisabled(), true);
    await page.getByRole("checkbox", { name: /Подготовка/ }).check();
    assert.equal(await generate.isDisabled(), false);
    await page.getByRole("button", { name: "PARTIAL" }).click();
    assert.equal(await page.getByLabel("Процент предоплаты").count(), 1);
    await page.getByRole("navigation", { name: "Разделы анкеты" }).getByRole("button", { name: /Дополнительно/ }).click();
    assert.equal(await page.getByText("Услуги", { exact: true }).count(), 0);
    await page.getByRole("checkbox", { name: /Проведение/ }).check();
    assert.equal(await page.getByText("Услуги", { exact: true }).count(), 1);
    await page.getByRole("checkbox", { name: /Подготовка/ }).uncheck();
    await page.getByRole("navigation", { name: "Разделы анкеты" }).getByRole("button", { name: /Оплата/ }).click();
    assert.equal(await page.getByLabel("Процент предоплаты").count(), 0);
    await generate.click();
    await page.waitForFunction(() => window.__testCalls === 1);
    assert.deepEqual(await page.evaluate(() => window.__testStageIds), ["stage-b"]);
  } finally { await browser.close(); await server.close(); }
});

test("employee selects stages and keeps answers while switching", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/contract-stages-employee.html`);
    await page.getByRole("button", { name: /Заполнить договор/ }).click();
    await page.getByRole("heading", { name: "Этапы договора" }).waitFor();
    await page.getByRole("checkbox", { name: /Подготовка/ }).check();
    await page.getByRole("button", { name: "Продолжить к вопросам" }).click();
    assert.deepEqual(await page.evaluate(() => window.__selectedStages), ["stage-a"]);
    assert.equal(await page.getByLabel("Вопрос подготовки").count(), 1);
    assert.equal(await page.getByLabel("Вопрос проведения").count(), 0);
    await page.getByLabel("Вопрос подготовки").fill("Подготовлено");
    await page.getByRole("button", { name: "Изменить этапы договора" }).click();
    await page.getByRole("checkbox", { name: /Подготовка/ }).uncheck();
    await page.getByRole("checkbox", { name: /Проведение/ }).check();
    await page.getByRole("button", { name: "Продолжить к вопросам" }).click();
    assert.equal(await page.getByLabel("Вопрос подготовки").count(), 0);
    assert.equal(await page.getByLabel("Вопрос проведения").count(), 1);
    await page.getByRole("button", { name: "Изменить этапы договора" }).click();
    await page.getByRole("checkbox", { name: /Подготовка/ }).check();
    await page.getByRole("button", { name: "Продолжить к вопросам" }).click();
    assert.equal(await page.getByLabel("Вопрос подготовки").inputValue(), "Подготовлено");
    assert.equal(await page.getByLabel("Общий для этапов").count(), 1);
  } finally { await browser.close(); await server.close(); }
});

test("specialist creates, renames, reorders and removes a draft stage", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html?stages=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.getByRole("navigation", { name: "Этапы настройки шаблона" }).getByRole("button", { name: /Вопросы анкеты/ }).click();
    const manager = page.locator(".contract-stage-manager");
    await manager.locator("summary").click();
    await manager.getByRole("button", { name: /Добавить этап/ }).click();
    await manager.getByLabel("Название этапа").fill("Подписание");
    await manager.getByRole("button", { name: "Сохранить этап" }).click();
    await manager.getByText("3. Подписание").waitFor();
    await manager.getByRole("button", { name: "Поднять этап «Подписание»" }).click();
    await manager.getByText("2. Подписание").waitFor();
    const row = manager.locator(".contract-stage-row").filter({ hasText: "Подписание" });
    await row.getByRole("button", { name: "Изменить" }).click();
    await manager.getByLabel("Название этапа").fill("Согласование");
    await manager.getByRole("button", { name: "Сохранить этап" }).click();
    await manager.getByText("2. Согласование").waitFor();
    await manager.locator(".contract-stage-row").filter({ hasText: "Согласование" }).getByRole("button", { name: "Удалить" }).click();
    assert.equal(await manager.getByText("Согласование").count(), 0);
  } finally { await browser.close(); await server.close(); }
});
