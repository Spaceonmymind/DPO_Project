export type PaneWidths = { questions: number; settings: number };
export const PANE_STORAGE_KEY = "dpo-template-pane-widths";
export const DEFAULT_PANES: PaneWidths = { questions: 240, settings: 340 };
const DIVIDERS = 24;
const CENTER_MIN = 280;

export function fitPaneWidths(value: PaneWidths, available: number): PaneWidths {
  if (!Number.isFinite(available) || available < 760) return DEFAULT_PANES;
  const room = available - DIVIDERS - CENTER_MIN;
  let questions = Math.max(180, Math.min(420, Math.round(value.questions)));
  let settings = Math.max(260, Math.min(520, Math.round(value.settings)));
  if (questions + settings > room) {
    questions = Math.max(180, Math.min(questions, room - 260));
    settings = Math.max(260, Math.min(settings, room - questions));
  }
  return { questions, settings };
}

export function readPaneWidths(): PaneWidths {
  try {
    const value = JSON.parse(window.localStorage.getItem(PANE_STORAGE_KEY) || "null");
    if (value && Number.isFinite(value.questions) && Number.isFinite(value.settings) && value.questions >= 180 && value.questions <= 420 && value.settings >= 260 && value.settings <= 520) {
      return fitPaneWidths(value, 2000);
    }
  } catch { /* Invalid local preference: use the standard layout. */ }
  return DEFAULT_PANES;
}
