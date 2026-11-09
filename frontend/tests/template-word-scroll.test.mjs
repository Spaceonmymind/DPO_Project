import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("Word stays on the same fragment after editor writes and step changes", { skip: !existsSync(chromePath), timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-workspace.html?large=1&scrollRegression=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.locator(".docx-page").waitFor();
    const stages = page.getByRole("navigation", { name: "Этапы настройки шаблона" });
    await page.getByRole("tab", { name: "Word" }).click();
    await page.getByLabel("Найти фрагмент").fill("Фрагмент договора 2500");
    await page.locator(".workspace-structure-list button").first().click();
    const target = page.locator('.docx-page [data-locator="word/document.xml#/p[2500]"]');
    await target.waitFor();
    const snapshot = () => page.locator(".document-canvas").evaluate(canvas => ({
      top: canvas.scrollTop,
      center: (() => {
        const center = canvas.getBoundingClientRect().top + canvas.clientHeight / 2;
        const items = [...canvas.querySelectorAll(".docx-page [data-locator]")];
        return items.reduce((closest, item) => Math.abs(item.getBoundingClientRect().top - center) < Math.abs(closest.getBoundingClientRect().top - center) ? item : closest).dataset.locator;
      })(),
    }));
    const initial = await snapshot();
    assert.ok(initial.top > 10000);
    await page.evaluate(() => { window.__wordCanvas = document.querySelector(".document-canvas"); });
    const unchanged = async (action, sameContainer = true) => {
      await page.waitForTimeout(100);
      const current = await snapshot();
      assert.equal(current.center, initial.center, `${action}: visible fragment`);
      assert.ok(Math.abs(current.top - initial.top) < 45, `${action}: scroll position ${current.top} vs ${initial.top}`);
      if (sameContainer) assert.equal(await page.evaluate(() => window.__wordCanvas === document.querySelector(".document-canvas")), true, `${action}: same scroll container`);
      assert.equal(await page.evaluate(() => window.__previewRequests), 1, `${action}: no Word refetch`);
    };

    await stages.getByRole("button", { name: /Вопросы анкеты/ }).click();
    await page.getByRole("tab", { name: "Вопросы" }).click();
    await page.locator(".workspace-add").click();
    const form = page.locator(".field-editor");
    await form.getByLabel("Вопрос", { exact: true }).fill("Проверка прокрутки");
    await form.getByRole("button", { name: "Добавить вопрос" }).click();
    await page.getByText("Поле анкеты сохранено.").waitFor();
    await unchanged("question creation");
    await page.locator(".workspace-question-list").getByRole("button", { name: /Проверка прокрутки/ }).click();
    await form.getByLabel("Вопрос", { exact: true }).fill("Проверка прокрутки обновлена");
    await form.getByRole("button", { name: "Сохранить изменения" }).click();
    await unchanged("question edit");

    await stages.getByRole("button", { name: /Привязки к Word/ }).click();
    await target.evaluate(node => {
      const range = document.createRange();
      range.selectNodeContents(node.firstChild);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.locator("#workspace-context-inspector .selection-card").waitFor();
    const combo = page.getByRole("combobox", { name: "Вопрос анкеты" });
    await combo.fill("Проверка прокрутки обновлена");
    await page.getByRole("option", { name: /Проверка прокрутки обновлена/ }).click();
    await page.getByRole("button", { name: "Создать привязку" }).click();
    await page.getByText("Привязка создана.").waitFor();
    await unchanged("binding creation");

    await stages.getByRole("button", { name: /Условия и таблицы/ }).click();
    await page.getByRole("button", { name: "Изменить условную область" }).click();
    await page.getByLabel("Отображение в готовом документе").selectOption("NEVER");
    await page.getByRole("button", { name: "Сохранить область" }).click();
    await page.getByText("Условие области изменено.").waitFor();
    await unchanged("condition edit");
    await page.getByRole("button", { name: "Изменить повторяемую группу" }).click();
    await page.getByRole("region", { name: "Настройка повторяемой группы" }).getByLabel("Описание").fill("Настройка группы обновлена");
    await page.getByRole("button", { name: "Сохранить группу" }).click();
    await page.getByText("Повторяемая группа сохранена.").waitFor();
    await unchanged("repeating group edit");
    const divider = page.getByRole("separator", { name: "Изменить ширину панели настроек" });
    const bounds = await divider.boundingBox();
    await page.mouse.move(bounds.x + 6, bounds.y + 40);
    await page.mouse.down();
    await page.mouse.move(bounds.x - 60, bounds.y + 40, { steps: 4 });
    await page.mouse.up();
    await unchanged("pane resize");
    await stages.getByRole("button", { name: /Проверка и публикация/ }).click();
    assert.equal(await page.locator(".document-canvas").count(), 0);
    await stages.getByRole("button", { name: /Условия и таблицы/ }).click();
    await target.waitFor();
    await unchanged("return from questionnaire preview", false);
    assert.deepEqual((await page.evaluate(() => window.__writes)).map(item => item.kind), ["field", "field-edit", "binding", "region-edit", "group-edit"]);
  } finally {
    await browser.close();
    await server.close();
  }
});
