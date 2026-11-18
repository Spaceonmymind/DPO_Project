import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function openBuilder(page, url) {
  await page.goto(url);
  await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
  await page.getByRole("button", { name: /Версия 1/ }).first().click();
  await page.getByRole("navigation", { name: "Этапы настройки шаблона" }).getByRole("button", { name: /Вопросы анкеты/ }).click();
  await page.locator(".workspace-question-card").first().waitFor();
}

const questionOrder = page => page.locator(".workspace-question-open b").allTextContents();

test("150+ questions reorder by buttons and drag, persist after reload, and match preview", { skip: !existsSync(chromePath), timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const url = `${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html`;
    await openBuilder(page, url);
    assert.ok(await page.locator(".workspace-question-card").count() > 150);
    await page.getByRole("button", { name: "Переместить «Дополнительный вопрос 1» вниз" }).click();
    await page.waitForFunction(() => window.__orderCalls === 1);
    let order = await questionOrder(page);
    assert.ok(order.indexOf("Дополнительный вопрос 2") < order.indexOf("Дополнительный вопрос 1"));
    const source = page.locator(".workspace-question-card").filter({ has: page.getByText("Дополнительный вопрос 3", { exact: true }) });
    const target = page.locator(".workspace-question-card").filter({ has: page.getByText("Дополнительный вопрос 2", { exact: true }) });
    await source.dragTo(target);
    await page.waitForFunction(() => window.__orderCalls === 2);
    order = await questionOrder(page);
    assert.ok(order.indexOf("Дополнительный вопрос 3") < order.indexOf("Дополнительный вопрос 2"));
    await openBuilder(page, url);
    order = await questionOrder(page);
    assert.ok(order.indexOf("Дополнительный вопрос 3") < order.indexOf("Дополнительный вопрос 2"));
    const stages = page.getByRole("navigation", { name: "Этапы настройки шаблона" });
    await stages.getByRole("button", { name: /Проверка и публикация/ }).click();
    await page.getByRole("navigation", { name: "Разделы анкеты" }).getByRole("button", { name: /Дополнительно/ }).click();
    const text = await page.locator(".dynamic-form").innerText();
    assert.ok(text.indexOf("Дополнительный вопрос 3") < text.indexOf("Дополнительный вопрос 2"));
  } finally { await browser.close(); await server.close(); }
});

test("sections move and a question crosses sections without losing saved order", { skip: !existsSync(chromePath), timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const url = `${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html?order-groups=1&order-small=1&stages=1`;
    await openBuilder(page, url);
    await page.getByRole("button", { name: "Поднять раздел «Дополнительно»" }).click();
    await page.waitForFunction(() => window.__orderCalls === 1);
    assert.deepEqual(await page.locator(".workspace-question-section b").allTextContents(), ["Дополнительно", "Оплата"]);
    const source = page.locator(".workspace-question-card").filter({ has: page.getByText("Дополнительный вопрос 1", { exact: true }) });
    const target = page.locator(".workspace-question-card").filter({ has: page.getByText("Порядок оплаты", { exact: true }) });
    assert.equal(await source.count(), 1);
    assert.equal(await source.locator(".workspace-question-open b").textContent(), "Дополнительный вопрос 1");
    await source.evaluate(node => { window.__questionDrag = new DataTransfer(); node.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: window.__questionDrag })); });
    await target.evaluate(node => { node.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: window.__questionDrag, clientY: node.getBoundingClientRect().top + 5 })); node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: window.__questionDrag, clientY: node.getBoundingClientRect().top + 5 })); });
    await page.waitForFunction(() => window.__orderCalls === 2);
    assert.match(await source.locator(".workspace-question-open span").textContent(), /Оплата/, JSON.stringify(await page.evaluate(() => window.__orderPayloads)));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("question-order-fixture")));
    assert.ok(saved.indexOf("extra-0") < saved.indexOf("payment"));
    await openBuilder(page, url);
    assert.match(await page.locator(".workspace-question-card").filter({ has: page.getByText("Дополнительный вопрос 1", { exact: true }) }).locator(".workspace-question-open span").textContent(), /Оплата/);
    assert.deepEqual(await page.locator(".workspace-question-section b").allTextContents(), ["Дополнительно", "Оплата"]);
    await page.getByRole("navigation", { name: "Этапы настройки шаблона" }).getByRole("button", { name: /Проверка и публикация/ }).click();
    await page.getByRole("navigation", { name: "Разделы анкеты" }).getByRole("button", { name: /Оплата/ }).click();
    const preview = await page.locator(".dynamic-form").innerText();
    assert.ok(preview.indexOf("Дополнительный вопрос 1") < preview.indexOf("Порядок оплаты"));
  } finally { await browser.close(); await server.close(); }
});

test("help is above inputs and stays visible for text, date, number and choices", { skip: !existsSync(chromePath), timeout: 30000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await openBuilder(page, `${server.resolvedUrls.local[0]}tests/fixtures/template-stage6.html`);
    await page.getByRole("navigation", { name: "Этапы настройки шаблона" }).getByRole("button", { name: /Проверка и публикация/ }).click();
    assert.equal(await page.getByText("Выберите порядок расчётов").count(), 1);
    await page.getByRole("button", { name: "PARTIAL" }).click();
    const percent = page.getByLabel("Процент предоплаты");
    assert.equal(await percent.getAttribute("placeholder"), null);
    assert.match(await percent.getAttribute("aria-describedby"), /-help/);
    await percent.fill("40");
    assert.equal(await page.getByText("Укажите процент от общей суммы").count(), 1);
    assert.equal(await page.getByText("Укажите общую сумму в рублях").count(), 1);
    assert.equal(await page.getByLabel("Дата мероприятия").getAttribute("placeholder"), "ДД.ММ.ГГГГ");
    assert.equal(await page.locator(".question-help-text").filter({ hasText: "ДД.ММ.ГГГГ" }).count(), 0);
    await page.getByRole("navigation", { name: "Разделы анкеты" }).getByRole("button", { name: /Дополнительно/ }).click();
    assert.equal(await page.getByText("Отметьте все подходящие услуги").count(), 1);
    const extra = page.getByLabel("Дополнительный вопрос 1", { exact: true });
    assert.equal(await extra.getAttribute("placeholder"), null);
    await extra.fill("Описание");
    assert.equal(await page.getByText("Укажите краткое описание").count(), 1);
  } finally { await browser.close(); await server.close(); }
});
