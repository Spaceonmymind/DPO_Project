import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("DOCX pane widths drag, persist, clamp and reset without changing zoom", { skip: !existsSync(chromePath) }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
    const url = `${server.resolvedUrls.local[0]}tests/fixtures/template-workspace.html`;
    await page.goto(url);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    const left = page.getByRole("separator", { name: "Изменить ширину панели вопросов" });
    const right = page.getByRole("separator", { name: "Изменить ширину панели настроек" });
    const widths = () => page.locator(".builder-grid").evaluate(grid => ({
      left: grid.querySelector(".document-outline").getBoundingClientRect().width,
      center: grid.querySelector(".document-canvas").getBoundingClientRect().width,
      right: grid.querySelector(".questionnaire-builder").getBoundingClientRect().width,
      zoom: grid.querySelector('[aria-label="Масштаб документа"]').value,
    }));
    const initial = await widths();
    const leftBox = await left.boundingBox();
    await page.mouse.move(leftBox.x + 6, leftBox.y + 40);
    await page.mouse.down();
    await page.mouse.move(leftBox.x + 86, leftBox.y + 40, { steps: 5 });
    await page.mouse.up();
    const afterLeft = await widths();
    assert.ok(afterLeft.left > initial.left + 60);
    assert.ok(afterLeft.center < initial.center - 60);
    const rightBox = await right.boundingBox();
    await page.mouse.move(rightBox.x + 6, rightBox.y + 40);
    await page.mouse.down();
    await page.mouse.move(rightBox.x - 74, rightBox.y + 40, { steps: 5 });
    await page.mouse.up();
    const afterRight = await widths();
    assert.ok(afterRight.right > afterLeft.right + 55);
    assert.ok(afterRight.center < afterLeft.center - 55);
    assert.equal(afterRight.zoom, initial.zoom);
    await page.reload();
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    const restored = await widths();
    assert.ok(Math.abs(restored.left - afterRight.left) < 3);
    assert.ok(Math.abs(restored.right - afterRight.right) < 3);
    await page.getByRole("button", { name: "Сбросить расположение" }).click();
    const reset = await widths();
    assert.ok(Math.abs(reset.left - initial.left) < 3);
    assert.ok(Math.abs(reset.right - initial.right) < 3);
    assert.equal(await page.evaluate(() => localStorage.getItem("dpo-template-pane-widths")), null);
    await left.focus();
    await left.press("ArrowRight");
    assert.ok((await widths()).left > reset.left);
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(await page.locator("body").evaluate(body => body.scrollWidth <= innerWidth + 2), true);
  } finally {
    await browser.close();
    await server.close();
  }
});

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
      const search = page.getByRole("combobox", { name: "Вопрос анкеты" });
      await search.click();
      const list = page.getByRole("listbox", { name: "Вопросы анкеты" });
      await list.waitFor();
      assert.equal(await list.getByRole("option").count(), 12, `${width}px: show at most 12 questions at once`);
      const position = await list.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const panel = element.closest(".questionnaire-builder").getBoundingClientRect();
        return { left: rect.left, right: rect.right, panelLeft: panel.left, panelRight: panel.right, width: rect.width, scrollWidth: element.scrollWidth, height: rect.height, scrollHeight: element.scrollHeight };
      });
      assert.ok(position.left >= position.panelLeft - 2 && position.right <= position.panelRight + 2, `${width}px: question list stays inside the right panel`);
      assert.ok(position.scrollWidth <= position.width + 2, `${width}px: no horizontal list overflow`);
      assert.ok(position.height <= 300 && position.scrollHeight > position.height, `${width}px: long result list scrolls inside its own bounds`);
      await search.fill("вопрос номер 120");
      assert.match(await list.textContent(), /Вопрос номер 120/, `${width}px: last question remains searchable`);
      await search.press("Escape");

      await page.locator(".preview-node").first().hover();
      await page.locator(".preview-node").first().getByRole("button", { name: "Абзац", exact: true }).click();
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

test("3500 Word fragments keep their layout during drag and apply each resize once", { skip: !existsSync(chromePath) }, async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  await server.listen();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-workspace.html?large=1`);
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    await page.locator(".preview-node").nth(3499).waitFor();
    await page.locator(".workspace-question-list button").first().click();
    await page.locator(".docx-page [data-locator]").first().evaluate((node) => {
      window.__firstPreviewNode = node;
      const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range);
    });
    const left = page.getByRole("separator", { name: "Изменить ширину панели вопросов" });
    const right = page.getByRole("separator", { name: "Изменить ширину панели настроек" });
    const snapshot = () => page.locator(".builder-grid").evaluate(grid => ({
      widths: [grid.querySelector(".document-outline").getBoundingClientRect().width, grid.querySelector(".questionnaire-builder").getBoundingClientRect().width],
      stored: localStorage.getItem("dpo-template-pane-widths"),
      requests: window.__previewRequests,
      sameNode: window.__firstPreviewNode === grid.querySelector(".docx-page [data-locator]"),
      selection: getSelection().toString(),
      selectedQuestion: !!grid.querySelector(".workspace-question-list button.active"),
    }));
    const before = await snapshot();
    assert.equal(before.requests, 1);
    assert.equal(before.selectedQuestion, true);
    const drag = async (divider, delta) => {
      const start = await snapshot();
      const box = await divider.boundingBox();
      const x = box.x + box.width / 2, y = box.y + 40;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + delta, y, { steps: 12 });
      await page.locator(".workspace-pane-drag-line:not([hidden])").waitFor();
      const during = await snapshot();
      const line = await page.locator(".workspace-pane-drag-line").evaluate(node => node.getBoundingClientRect().left);
      assert.deepEqual(during.widths, start.widths, "panel widths remain fixed during pointer movement");
      assert.equal(during.requests, before.requests);
      assert.equal(during.stored, start.stored);
      assert.ok(Math.abs(line - (x + delta)) < 8, "preview line follows the pointer");
      await page.mouse.up();
      assert.equal(await page.locator(".workspace-pane-drag-line").isVisible(), false);
    };
    await drag(left, 80);
    const afterLeft = await snapshot();
    assert.ok(afterLeft.widths[0] > before.widths[0] + 60);
    await drag(right, -70);
    const afterRight = await snapshot();
    assert.ok(afterRight.widths[1] > afterLeft.widths[1] + 50);
    assert.equal(afterRight.requests, 1);
    assert.equal(afterRight.sameNode, true);
    assert.equal(afterRight.selection, before.selection);
    assert.equal(afterRight.selectedQuestion, true);

    const cancel = async (divider, action) => {
      const old = await snapshot(); const box = await divider.boundingBox(); const x = box.x + box.width / 2, y = box.y + 40;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 35, y);
      if (action === "escape") await page.keyboard.press("Escape");
      else await divider.dispatchEvent("pointercancel", { bubbles: true, pointerId: 1 });
      await page.mouse.up();
      assert.deepEqual((await snapshot()).widths, old.widths, `${action} cancels resize`);
      assert.equal(await page.locator(".workspace-pane-drag-line").isVisible(), false);
    };
    await cancel(left, "escape");
    await cancel(right, "pointercancel");
    const maxDrag = async (divider, delta) => {
      const box = await divider.boundingBox(); const x = box.x + box.width / 2, y = box.y + 40;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + delta, y);
      await page.mouse.up();
    };
    await maxDrag(left, 1000);
    await maxDrag(right, -1000);
    const clamped = await snapshot();
    assert.ok(Math.abs(clamped.widths[0] - 420) < 2);
    assert.ok(Math.abs(clamped.widths[1] - 520) < 2);
    await maxDrag(left, -1000);
    await maxDrag(right, 1000);
    const minimum = await snapshot();
    assert.ok(Math.abs(minimum.widths[0] - 180) < 2);
    assert.ok(Math.abs(minimum.widths[1] - 260) < 2);
    await page.reload();
    await page.getByRole("button", { name: /Тестовый договор/ }).first().click();
    await page.getByRole("button", { name: /Версия 1/ }).first().click();
    assert.deepEqual((await snapshot()).widths, minimum.widths);
  } finally { await browser.close(); await server.close(); }
});
