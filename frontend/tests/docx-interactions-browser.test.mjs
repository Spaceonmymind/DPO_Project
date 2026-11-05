import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("Word binding uses search and structural block highlights every visible paragraph", { skip: !existsSync(chromePath) }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/docx-interactions.html`);
    await page.getByRole("button", { name: /Черновик договора с ИП/ }).first().click();
    await page.getByRole("button", { name: /Версия 3/ }).first().click();

    const paragraph = page.locator('.preview-node [data-locator="word/document.xml#/p[1]"]');
    await paragraph.scrollIntoViewIfNeeded();
    const box = await paragraph.evaluate(element => { const range = document.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 18); const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
    assert.ok(box);
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(box.width - 2, 90), box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    const search = page.locator('#workspace-context-inspector [role="combobox"][aria-autocomplete="list"]');
    await search.waitFor({ timeout: 3000 });
    assert.equal(await page.locator('#workspace-context-inspector select').filter({ has: page.locator('option:text("Выберите вопрос")') }).count(), 0);
    await search.fill("график");
    await page.getByRole("option", { name: /График тренировок/ }).click();
    await page.getByRole("button", { name: "Создать привязку" }).click();
    await page.waitForFunction(() => window.fixtureState.writes.some(write => write.kind === "binding"));
    const binding = await page.evaluate(() => window.fixtureState.writes.find(write => write.kind === "binding").payload);
    assert.equal(binding.field_id, "field-schedule");
    assert.match(binding.selected_text, /Договор/);
    await page.locator('.preview-node [data-locator="word/document.xml#/p[1]"] mark[role="button"]').click();
    assert.match(await page.locator(".workspace-inspector-header").textContent(), /Настроенная привязка/);
    assert.equal(await page.locator("#workspace-context-inspector .selection-card").count(), 0, "existing binding opens its settings instead of a second editor");
    await page.locator(".workspace-active-binding").getByRole("button", { name: "Закрыть" }).click();

    const structural = page.locator('.preview-node:has([data-locator="word/document.xml#/p[3]"])');
    await structural.hover();
    await structural.getByRole("button", { name: "Привязать абзац" }).click();
    await search.waitFor();
    await page.getByLabel("Формат в документе").selectOption("NUMBER");
    await search.fill("Продолжительность тренировок");
    await page.getByRole("option", { name: /Создать новый вопрос: Продолжительность тренировок/ }).click();
    await page.locator(".field-editor").waitFor();
    assert.equal(await page.locator(".field-editor").getByLabel("Вопрос", { exact: true }).inputValue(), "Продолжительность тренировок");
    await page.locator(".field-editor").getByRole("button", { name: "Добавить вопрос" }).click();
    await search.waitFor();
    assert.equal(await search.inputValue(), "Продолжительность тренировок");
    assert.equal(await page.getByLabel("Формат в документе").inputValue(), "NUMBER");
    assert.match(await page.locator(".selection-card-floating blockquote").textContent(), /Исполнитель проводит занятия/);
    await page.getByRole("button", { name: "Закрыть панель" }).click();

    const first = page.locator('.preview-node:has([data-locator="word/document.xml#/p[1]"])');
    const middle = page.locator('.preview-node:has([data-locator="word/document.xml#/p[3]"])');
    const last = page.locator('.preview-node:has([data-locator="word/document.xml#/p[7]"])');
    await first.hover();
    await first.getByRole("button", { name: "Начало блока" }).click();
    assert.equal(await first.locator(".block-boundary-label").first().textContent(), "Начало блока");
    await last.hover();
    assert.equal(await page.locator(".preview-node.block-range-active").count(), 3);
    assert.ok(await middle.evaluate(node => getComputedStyle(node).backgroundColor !== "rgba(0, 0, 0, 0)"));
    await last.getByRole("button", { name: "Конец блока" }).click();
    assert.equal(await page.locator(".preview-node.block-range-active").count(), 3);
    assert.equal(await page.getByText("Выделение должно находиться внутри одного абзаца или одной ячейки").count(), 0);
    await page.getByLabel("Отображение в готовом документе").selectOption("NEVER");
    await page.locator(".region-editor input[required]").fill("ip_training_block");
    await page.getByRole("button", { name: "Сохранить область" }).click();
    await page.waitForFunction(() => window.fixtureState.writes.some(write => write.kind === "region"));
    assert.equal(await page.locator(".preview-node.block-range-active").count(), 0);
    await page.getByRole("button", { name: /Условия и таблицы/ }).first().click();
    await page.locator('.region-list button[aria-label="Изменить условную область"]').click();
    assert.equal(await page.locator(".preview-node.block-range-active").count(), 3);
    assert.equal(await middle.locator(".block-boundary-label").count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await page.close(); await browser.close(); await server.close();
  }
});

test("existing IP draft preview preserves sparse paragraph block selection", { skip: !existsSync(chromePath) || !process.env.DPO_IP_PREVIEW_JSON }, async () => {
  const nodes = JSON.parse(readFileSync(process.env.DPO_IP_PREVIEW_JSON, "utf8"));
  const paragraphs = nodes.filter(node => /^word\/document\.xml#\/p\[\d+\]$/.test(node.locator));
  const gap = paragraphs.findIndex((node, index) => index > 0 && index + 1 < paragraphs.length && Number(node.locator.match(/\[(\d+)\]$/)[1]) - Number(paragraphs[index - 1].locator.match(/\[(\d+)\]$/)[1]) > 1);
  assert.ok(gap > 0, "real preview includes a numbering gap");
  const expected = paragraphs.slice(gap - 1, gap + 2).map(node => node.locator);
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.addInitScript(value => { window.__ipNodes = value; }, nodes);
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/docx-interactions.html`);
    await page.getByRole("button", { name: /Черновик договора с ИП/ }).first().click();
    await page.getByRole("button", { name: /Версия 3/ }).first().click();
    const start = page.locator(`.preview-node:has([data-locator="${expected[0]}"])`);
    const end = page.locator(`.preview-node:has([data-locator="${expected[2]}"])`);
    await start.hover(); await start.getByRole("button", { name: "Начало блока" }).click();
    await end.hover();
    assert.deepEqual(await page.locator(".preview-node.block-range-active [data-locator]").evaluateAll(elements => elements.map(element => element.dataset.locator)), expected);
    await end.getByRole("button", { name: "Конец блока" }).click();
    assert.deepEqual(await page.locator(".preview-node.block-range-active [data-locator]").evaluateAll(elements => elements.map(element => element.dataset.locator)), expected);
    assert.equal(await page.getByText("Выделение должно находиться внутри одного абзаца или одной ячейки").count(), 0);
    assert.equal((await page.evaluate(() => window.fixtureState.writes)).length, 0, "real draft preview check is read only");
  } finally { await page.close(); await browser.close(); await server.close(); }
});

test("formula editor saves a standard AST and reopens it visually", { skip: !existsSync(chromePath) }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/docx-interactions.html`);
    await page.getByRole("button", { name: /Черновик договора с ИП/ }).first().click();
    await page.getByRole("button", { name: /Версия 3/ }).first().click();
    const first = page.locator('.preview-node:has([data-locator="word/document.xml#/p[1]"])');
    const end = page.locator('.preview-node:has([data-locator="word/document.xml#/p[3]"])');
    await first.hover(); await first.getByRole("button", { name: "Начало блока" }).click();
    await end.hover(); await end.getByRole("button", { name: "Конец блока" }).click();
    await page.locator(".region-editor input[required]").fill("formula_region");
    await page.locator(".region-editor").getByRole("button", { name: "Логическое выражение" }).click();
    const addVariable = page.getByRole("button", { name: "+ Добавить условие" });
    await addVariable.click();
    const buttonStyle = await addVariable.evaluate(button => ({ width: button.getBoundingClientRect().width, panelWidth: button.closest(".questionnaire-builder").getBoundingClientRect().width, height: button.getBoundingClientRect().height, whiteSpace: getComputedStyle(button).whiteSpace, fontSize: getComputedStyle(button).fontSize }));
    assert.ok(buttonStyle.width < buttonStyle.panelWidth * .8 && buttonStyle.height < 40, "add action stays compact in the right panel");
    assert.equal(buttonStyle.whiteSpace, "nowrap");
    assert.ok(Number.parseFloat(buttonStyle.fontSize) <= 12);
    await page.locator(".region-editor").getByRole("button", { name: "Визуальный конструктор" }).click();
    assert.equal(await page.locator(".region-editor .condition-node").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Сохранить область" }).isDisabled(), true);
    assert.match(await page.locator(".condition-draft-note").textContent(), /неприменённая формула/);
    await page.locator(".region-editor").getByRole("button", { name: "Логическое выражение" }).click();
    assert.equal(await page.locator(".named-condition").count(), 1);
    assert.equal(await page.locator(".condition-formula-input textarea").inputValue(), "");
    await page.locator(".named-condition .condition-row input").fill("Подряд");
    await page.locator(".condition-formula-input textarea").fill("A AND Z");
    assert.equal(await page.getByRole("button", { name: "Сохранить область" }).isDisabled(), true);
    await page.locator(".region-editor").getByRole("button", { name: "Визуальный конструктор" }).click();
    await page.locator(".region-editor").getByRole("button", { name: "Логическое выражение" }).click();
    assert.equal(await page.locator(".condition-formula-input textarea").inputValue(), "A AND Z");
    await page.locator(".condition-formula-input textarea").fill("A");
    await page.getByRole("button", { name: "Применить выражение" }).click();
    await page.getByRole("button", { name: "Сохранить область" }).click();
    const write = await page.evaluate(() => window.fixtureState.writes.find(item => item.kind === "region"));
    assert.deepEqual(write.payload.include_when, { operator: "EQUALS", field_key: "payment", value: "Подряд" });
    await page.getByRole("button", { name: /Условия и таблицы/ }).first().click();
    await page.locator('.region-list article').filter({ hasText: "formula_region" }).getByRole("button", { name: "Изменить условную область" }).click();
    await page.locator(".region-editor .condition-node").waitFor({ timeout: 3000 });
    assert.equal(await page.locator(".region-editor .condition-formula-mode").count(), 0);
  } finally { await page.close(); await browser.close(); await server.close(); }
});
