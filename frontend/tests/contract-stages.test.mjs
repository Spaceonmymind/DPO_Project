import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("manager authorization adds the next stage without using unlock", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html?published=1&stages=1&manager-flow=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.getByRole("navigation", { name: "Этапы настройки шаблона" }).getByRole("button", { name: /Проверка и публикация/ }).click();
    await page.getByRole("button", { name: "Разрешить следующий этап" }).click();
    await page.getByText(/Этап «Проведение» подключён/).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__managerActions), ["allow-next"]);
    assert.equal(await page.getByRole("button", { name: "Разблокировать для исправления" }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Разрешить следующий этап" }).count(), 0);
  } finally { await browser.close(); await server.close(); }
});

test("resumed employee draft opens the newly allowed stage and keeps the first read only", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/contract-stages-employee.html?resumed=1&draft=draft-1`);
    await page.getByLabel("Вопрос проведения").waitFor();
    assert.equal(await page.getByLabel("Вопрос проведения").isDisabled(), false);
    await page.getByRole("navigation", { name: "Этапы договора" }).getByRole("button", { name: /Подготовка/ }).click();
    assert.equal(await page.getByLabel("Вопрос подготовки").isDisabled(), true);
    assert.equal(await page.getByLabel("Вопрос подготовки").inputValue(), "Подготовлено");
    await page.getByRole("button", { name: "Изменить этапы договора" }).click();
    assert.equal(await page.getByRole("checkbox", { name: /Подписание/ }).count(), 0);
    assert.equal(await page.getByRole("checkbox", { name: /Проведение/ }).isDisabled(), true);
    await page.getByRole("button", { name: "Вернуться к вопросам" }).click();
    await page.getByRole("navigation", { name: "Этапы договора" }).getByRole("button", { name: /Проведение/ }).click();
    assert.equal(await page.getByLabel("Вопрос проведения").isDisabled(), false);
  } finally { await browser.close(); await server.close(); }
});

test("stage draft with an earlier DOCX remains in the continue list", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/contract-stages-employee.html?resumed=1`);
    assert.match(await page.locator(".saved-drafts .draft-continue").innerText(), /Доступен следующий этап/);
    await page.locator(".saved-drafts .draft-continue").click();
    await page.getByLabel("Вопрос проведения").waitFor();
    assert.equal(await page.getByLabel("Вопрос проведения").isDisabled(), false);
  } finally { await browser.close(); await server.close(); }
});

test("builder stages filter step 6 and test generation uses selected IDs", { skip: !existsSync(chromePath), timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html?stages=1`, { waitUntil: "load" });
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    const nav = page.getByRole("navigation", { name: "Этапы настройки шаблона" });
    await nav.getByRole("button", { name: /Привязки к Word/ }).click();
    await page.getByRole("tab", { name: "Этапы" }).click();
    assert.match(await page.locator(".contract-stage-panel").innerText(), /Подготовка.*Проведение/s);
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
    await page.getByRole("checkbox", { name: /Проведение/ }).check();
    assert.equal(await page.getByRole("checkbox", { name: /Подготовка/ }).isChecked(), true);
    await page.getByRole("button", { name: "Продолжить к вопросам" }).click();
    assert.equal(await page.getByLabel("Вопрос подготовки").count(), 1);
    assert.equal(await page.getByRole("navigation", { name: "Этапы договора" }).getByRole("button", { name: /Проведение/ }).isDisabled(), true);
    await page.getByRole("button", { name: "Изменить этапы договора" }).click();
    await page.getByRole("checkbox", { name: /Проведение/ }).uncheck();
    await page.getByRole("button", { name: "Продолжить к вопросам" }).click();
    assert.equal(await page.getByLabel("Вопрос подготовки").inputValue(), "Подготовлено");
    assert.equal(await page.getByLabel("Общий для этапов").count(), 1);
  } finally { await browser.close(); await server.close(); }
});

test("employee keeps the specialist's saved order after selecting one or two stages", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/contract-stages-employee.html?ordered=1`);
    await page.getByRole("button", { name: /Заполнить договор/ }).click();
    await page.getByRole("checkbox", { name: /Подготовка/ }).check();
    await page.getByRole("button", { name: "Продолжить к вопросам" }).click();
    assert.deepEqual((await page.locator(".dynamic-form fieldset > label").allTextContents()).map(text => text.trim()), ["Пятый вопрос", "Первый вопрос", "Второй вопрос", "Четвёртый вопрос"]);
    await page.getByRole("button", { name: "Изменить этапы договора" }).click();
    await page.getByRole("checkbox", { name: /Проведение/ }).check();
    await page.getByRole("button", { name: "Продолжить к вопросам" }).click();
    assert.deepEqual((await page.locator(".dynamic-form fieldset > label").allTextContents()).map(text => text.trim()), ["Пятый вопрос", "Первый вопрос", "Второй вопрос", "Четвёртый вопрос"]);
    assert.equal(await page.getByRole("navigation", { name: "Этапы договора" }).getByRole("button", { name: /Проведение/ }).isDisabled(), true);
  } finally { await browser.close(); await server.close(); }
});

test("specialist creates, renames, reorders and removes a draft stage", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html?stages=1&persist-stages=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.getByRole("navigation", { name: "Этапы настройки шаблона" }).getByRole("button", { name: /Привязки к Word/ }).click();
    await page.getByRole("tab", { name: "Этапы" }).click();
    const manager = page.locator(".contract-stage-panel");
    await manager.getByRole("button", { name: /Добавить этап/ }).click();
    await manager.getByLabel("Название этапа").fill("Подписание");
    await manager.getByRole("button", { name: "Сохранить этап" }).click();
    await manager.getByText("3. Подписание").waitFor();
    await manager.getByRole("button", { name: "Поднять этап «Подписание»" }).click();
    await manager.getByText("2. Подписание").waitFor();
    await page.reload();
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.getByRole("navigation", { name: "Этапы настройки шаблона" }).getByRole("button", { name: /Привязки к Word/ }).click();
    await page.getByRole("tab", { name: "Этапы" }).click();
    await manager.getByText("2. Подписание").waitFor();
    const row = manager.locator(".contract-stage-row").filter({ hasText: "Подписание" });
    await row.getByRole("button", { name: "Изменить" }).click();
    await manager.getByLabel("Название этапа").fill("Согласование");
    await page.getByRole("tab", { name: "Вопросы" }).click();
    await page.getByRole("tab", { name: "Этапы" }).click();
    assert.equal(await manager.getByLabel("Название этапа").inputValue(), "Согласование");
    await manager.getByRole("button", { name: "Сохранить этап" }).click();
    await manager.getByText("2. Согласование").waitFor();
    await manager.locator(".contract-stage-row").filter({ hasText: "Согласование" }).getByRole("button", { name: "Удалить" }).click();
    assert.equal(await manager.getByText("Согласование").count(), 0);
  } finally { await browser.close(); await server.close(); }
});

test("step 4 keeps Word structure search and navigates to a distant fragment", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html?stages=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.getByRole("navigation", { name: "Этапы настройки шаблона" }).getByRole("button", { name: /Привязки к Word/ }).click();
    assert.deepEqual(await page.getByRole("tab").allTextContents(), ["Вопросы", "Этапы"]);
    await page.locator(".workspace-word-outline summary").click();
    await page.getByRole("textbox", { name: "Найти фрагмент" }).fill("Фрагмент 2400");
    await page.getByRole("navigation", { name: "Структура документа" }).getByRole("button", { name: /Фрагмент 2400/ }).click();
    await page.locator('[data-locator="word/document.xml#/p[2400]"]').waitFor();
    await page.getByRole("tab", { name: "Этапы" }).click();
    assert.equal(await page.locator(".contract-stage-panel").isVisible(), true);
    await page.getByRole("tab", { name: "Вопросы" }).click();
    assert.equal(await page.getByRole("textbox", { name: "Найти вопрос" }).isVisible(), true);
  } finally { await browser.close(); await server.close(); }
});

test("empty and published versions show stages without edit controls", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const openStages = async () => {
      await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
      await page.getByRole("button", { name: /Версия 1/ }).first().click();
      await page.getByRole("navigation", { name: "Этапы настройки шаблона" }).getByRole("button", { name: /Привязки к Word/ }).click();
      await page.getByRole("tab", { name: "Этапы" }).click();
    };
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html`);
    await openStages();
    await page.getByText("Этапы пока не созданы. Добавьте этап, чтобы настроить поэтапное формирование договора.").waitFor();
    await page.getByRole("button", { name: "Добавить этап" }).waitFor();
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html?stages=1&published=1`);
    await openStages();
    await page.getByText("Первый этап").waitFor();
    assert.equal(await page.locator(".contract-stage-panel").getByRole("button").count(), 0);
  } finally { await browser.close(); await server.close(); }
});

test("questions and stages tabs persist across steps 2 through 5 with an unfinished stage", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html?stages=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    const nav = page.getByRole("navigation", { name: "Этапы настройки шаблона" });
    const steps = ["Исходный документ", "Вопросы анкеты", "Привязки к Word", "Условия и таблицы"];
    for (const label of steps) {
      await nav.getByRole("button", { name: label }).click();
      assert.deepEqual(await page.getByRole("tab").allTextContents(), ["Вопросы", "Этапы"]);
      await page.getByRole("tab", { name: "Этапы" }).click();
      await page.getByText("Первый этап").waitFor();
      if (label === steps[0]) {
        await page.getByRole("button", { name: "Добавить этап" }).click();
        await page.getByLabel("Название этапа").fill("Незавершённый этап");
      } else {
        assert.equal(await page.getByLabel("Название этапа").inputValue(), "Незавершённый этап");
      }
      assert.equal(await page.locator(".document-outline").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
    }
    await page.locator(".workspace-word-outline summary").click();
    await page.getByRole("textbox", { name: "Найти фрагмент" }).fill("Фрагмент 2500");
    await page.getByRole("navigation", { name: "Структура документа" }).getByRole("button", { name: /Фрагмент 2500/ }).click();
    await page.locator('[data-locator="word/document.xml#/p[2500]"]').waitFor();
  } finally { await browser.close(); await server.close(); }
});

test("version without source or questionnaire keeps stage manager available", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html?no-source=1&no-questionnaire=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.getByRole("tab", { name: "Этапы" }).click();
    await page.getByText("Этапы пока не созданы. Добавьте этап, чтобы настроить поэтапное формирование договора.").waitFor();
    await page.getByText("Исходный DOCX ещё не загружен.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Добавить этап" }).click();
    await page.getByLabel("Название этапа").fill("Подготовка");
    await page.getByRole("button", { name: "Сохранить этап" }).click();
    await page.getByText("1. Подготовка").waitFor();
    await page.getByRole("navigation", { name: "Этапы настройки шаблона" }).getByRole("button", { name: /Условия и таблицы/ }).click();
    await page.getByText("1. Подготовка").waitFor();
  } finally { await browser.close(); await server.close(); }
});
