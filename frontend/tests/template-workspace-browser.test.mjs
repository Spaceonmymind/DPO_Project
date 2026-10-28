import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("DOCX workspace controls fit their panels at desktop and zoom-equivalent widths", { skip: !existsSync(chromePath) }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  const base = server.resolvedUrls.local[0];
  const failures = [];
  try {
    for (const width of [1280, 1440, 1920, 640]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on("pageerror", (error) => failures.push(`${width}: ${error.message}`));
      await page.goto(`${base}tests/fixtures/template-workspace.html`);
      await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
      await page.getByRole("button", { name: /Версия 1/ }).first().click();

      const checkPanel = async (state) => {
        const result = await page.locator(".questionnaire-builder").evaluate((panel) => {
          const bounds = panel.getBoundingClientRect();
          const controls = [...panel.querySelectorAll("input, select, textarea, button, fieldset")]
            .filter((element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden")
            .map((element) => ({ element, rect: element.getBoundingClientRect() }));
          return {
            clientWidth: panel.clientWidth,
            scrollWidth: panel.scrollWidth,
            outside: controls.filter(({ rect }) => rect.right > bounds.right + 2 || rect.left < bounds.left - 2).map(({ element }) => element.outerHTML.slice(0, 100)),
          };
        });
        assert.ok(result.scrollWidth <= result.clientWidth + 2, `${width}px ${state}: no horizontal panel scroll (${result.scrollWidth} > ${result.clientWidth})`);
        assert.deepEqual(result.outside, [], `${width}px ${state}: controls remain inside panel`);
      };

      await page.locator(".workspace-question-list button").first().click();
      await checkPanel("existing question");
      const question = await page.locator(".workspace-question-list button").first().evaluate((button) => ({ clientHeight: button.clientHeight, scrollHeight: button.scrollHeight }));
      assert.ok(question.scrollHeight <= question.clientHeight + 1, `${width}px: long question title is not clipped`);

      await page.locator(".docx-page [data-locator]").first().evaluate((paragraph) => {
        const range = document.createRange();
        range.setStart(paragraph.firstChild, 0);
        range.setEnd(paragraph.firstChild, 6);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      await page.locator("#workspace-context-inspector .selection-card").waitFor();
      await checkPanel("Word binding");

      await page.locator(".preview-node").first().hover();
      await page.locator(".preview-node").first().getByRole("button", { name: "Абзац" }).click();
      await page.locator("#workspace-context-inspector .region-editor").waitFor();
      await page.locator("#workspace-context-inspector .condition-add").first().click();
      await checkPanel("conditional region");

      await page.locator(".preview-node").nth(1).hover();
      await page.locator(".preview-node").nth(1).getByRole("button", { name: "Сделать строку повторяемой" }).click();
      await page.locator("#workspace-context-inspector .repeating-editor").waitFor();
      await checkPanel("repeating group");
      await page.locator("#workspace-context-inspector .repeating-editor").getByRole("button", { name: "Отмена" }).click();
      await page.getByRole("button", { name: /Условия и таблицы/ }).first().click();
      await page.getByRole("button", { name: "Добавить поле строки" }).click();
      await page.locator(".questionnaire-builder .repeat-field-form.panel-conditions").waitFor();
      await checkPanel("repeating row field");
      await page.locator(".repeat-field-form.panel-conditions").getByLabel("Тип").selectOption("SINGLE_SELECT");
      await page.locator(".repeat-field-form.panel-conditions").getByLabel("Варианты через запятую").fill("100% постоплата, 50% предоплата");
      assert.equal(await page.locator(".repeat-field-form.panel-conditions").getByLabel("Варианты через запятую").inputValue(), "100% постоплата, 50% предоплата");
      await checkPanel("repeating row select options");
      if (width === 1280) {
        await page.evaluate(() => { document.body.style.zoom = "150%"; });
        await checkPanel("150% CSS zoom");
      }
      await page.close();
    }
    assert.deepEqual(failures, [], "browser reports no uncaught UI errors");
  } finally {
    await browser.close();
    await server.close();
  }
});
