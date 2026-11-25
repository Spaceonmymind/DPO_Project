import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import "./contract-choice-options.css";
import "./contract-questionnaire-steps.css";
import {
  FileText,
  Search,
  ArrowLeft,
  Save,
  Download,
  CheckCircle2,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  LockKeyhole,
} from "lucide-react";
import { evaluateCondition, fieldState } from "./conditions";
import { calculateAnswers } from "./calculations";
import { ProductQuestionnaire } from "./ProductQuestionnaire";
import { QuestionHint } from "./QuestionHint";
import { questionHelp } from "./questionHelp";
import { lockedStageSteps, owningStage, selectedQuestionnaire } from "./contractStages";
import { questionnaireSteps, validateStep } from "./questionnaireSteps";
import { OTHER, choiceAnswer, choiceComplete, choiceOtherValues, choiceText, isStructuredChoice } from "./choices";
import { textRuleHint } from "./textRules";
import { ConfirmAction } from "./ConfirmAction";
type Api = (path: string, options?: any) => Promise<any>;
const itemId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;


function readableApiError(error: any): { message: string; fields: Record<string, string> } {
  const raw = String(error?.message || error || "Неизвестная ошибка");
  try {
    const parsed = JSON.parse(raw);
    const detail = parsed.detail || parsed;
    const fields = detail.fields || {};
    const messages = Object.entries(fields)
      .map(([key, value]) => `${key}: ${String(value)}`);
    return {
      message: messages.length
        ? `Проверьте поля анкеты: ${messages.join("; ")}`
        : String(detail.message || (typeof detail === "string" ? detail : raw)),
      fields,
    };
  } catch {
    return { message: raw, fields: {} };
  }
}

export function ContractCatalog({ api, go, manager = false }: { api: Api; go?: (path: string) => void; manager?: boolean }) {
  const [catalog, setCatalog] = useState<any[]>([]),
    [productDraft, setProductDraft] = useState<any>(),
    [drafts, setDrafts] = useState<any[]>([]),
    [draft, setDraft] = useState<any>(),
    [answers, setAnswers] = useState<any>({}),
    [errors, setErrors] = useState<any>({}),
    [query, setQuery] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [document, setDocument] = useState<any>(),
    [review, setReview] = useState(false),
    [stageAction, setStageAction] = useState<"save" | "generate" | null>(null),
    [stepIndex, setStepIndex] = useState(0),
    [loading, setLoading] = useState(true);
  const autosaveReady = useRef(false);
  const savedSnapshot = useRef("{}");
  async function load() {
    let [c, d] = await Promise.all([
      api("/contract-catalog"),
      api("/contract-drafts"),
    ]);
    setCatalog(c);
    setDrafts(d);
  }
  useEffect(() => {
    load()
      .then(async () => {
        const id = new URLSearchParams(location.search).get("draft");
        const productId = new URLSearchParams(location.search).get("productDraft");
        if (id) await restore(id);
        else if (productId) await restoreProduct(productId);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(answers) === savedSnapshot.current) return;
      event.preventDefault();
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [draft, answers]);
  useEffect(() => {
    if (!draft || !autosaveReady.current) return;
    let timer = setTimeout(
      () =>
        api(`/contract-drafts/${draft.id}/autosave`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        })
          .then(() => { savedSnapshot.current = JSON.stringify(answers); })
          .catch((e: any) => {
            const parsed = readableApiError(e);
            setErrors(parsed.fields);
            setError(`Автосохранение не выполнено. ${parsed.message}`);
          }),
      650,
    );
    return () => clearTimeout(timer);
  }, [answers, draft]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e: any) {
      const parsed = readableApiError(e);
      setErrors(parsed.fields);
      setError(parsed.message);
    } finally {
      setBusy(false);
    }
  }
  async function begin(template_id: string) {
    await run(async () =>
      open(
        await api("/contract-drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template_id }),
        }),
      ),
    );
  }
  async function restoreProduct(id: string) {
    await run(async () => setProductDraft(await api("/contract-product-drafts/" + id)));
  }
  async function restore(id: string) {
    await run(async () => open(await api("/contract-drafts/" + id)));
  }
  function open(x: any) {
    autosaveReady.current = false;
    setDraft(x);
    setAnswers(x.answers || {});
    savedSnapshot.current = JSON.stringify(x.answers || {});
    setErrors({});
    setDocument(null);
    setReview(false);
    const stages = (x.schema?.stages || []).filter((stage: any) => stage.status === "ACTIVE").sort((a: any, b: any) => a.position - b.position);
    setStepIndex(Math.max(0, stages.findIndex((stage: any) => !(x.completed_stage_ids || []).includes(stage.id))));
    setTimeout(() => {
      autosaveReady.current = true;
    }, 0);
  }
  function groupActive(g: any) {
    const activeAnswers = Object.fromEntries(selectedSchema.fields.filter((f: any) => fieldState(f, currentAnswers).visible).map((f: any) => [f.field_key, currentAnswers[f.field_key]]));
    return evaluateCondition(g.config?.visible_when, activeAnswers);
  }
  const selectedStageIds: string[] = (draft?.schema?.stages || []).filter((stage: any) => stage.status === "ACTIVE").map((stage: any) => stage.id);
  const selectedSchema = draft ? selectedQuestionnaire(draft.schema, selectedStageIds) : { fields: [], groups: [] };
  const relevantAnswers = Object.fromEntries([...selectedSchema.fields.map((field: any) => field.field_key), ...selectedSchema.groups.map((group: any) => group.group_key)].filter(key => key in answers).map(key => [key, answers[key]]));
  const lockingStages = !!draft && selectedStageIds.length > 0;
  const steps: any[] = draft ? lockingStages ? lockedStageSteps(draft.schema, selectedStageIds, questionnaireSteps) : questionnaireSteps(selectedSchema.fields, selectedSchema.groups) : [];
  const currentStep = steps[Math.min(stepIndex, Math.max(steps.length - 1, 0))];
  const orderedStages = lockingStages ? (draft.schema.stages || []).filter((stage: any) => stage.status === "ACTIVE" && selectedStageIds.includes(stage.id)).sort((a: any, b: any) => a.position - b.position) : [];
  const completedStages = new Set<string>(draft?.completed_stage_ids || []);
  const activeStageId = orderedStages.find((stage: any) => !completedStages.has(stage.id))?.id;
  const stageState = (id: string) => completedStages.has(id) ? "COMPLETED" : id === activeStageId ? "IN_PROGRESS" : "NOT_STARTED";
  const currentStageState = lockingStages && currentStep?.stageId ? stageState(currentStep.stageId) : "IN_PROGRESS";
  const currentStageIndex = orderedStages.findIndex((stage: any) => stage.id === currentStep?.stageId);
  const availableKeys = lockingStages ? new Set([...selectedSchema.fields.filter((field: any) => { const owner = orderedStages.findIndex((stage: any) => stage.id === owningStage(field, orderedStages)); return owner >= 0 && owner <= currentStageIndex; }).map((field: any) => field.field_key), ...selectedSchema.groups.filter((group: any) => { const owner = orderedStages.findIndex((stage: any) => stage.id === owningStage(group, orderedStages)); return owner >= 0 && owner <= currentStageIndex; }).map((group: any) => group.group_key)]) : null;
  const currentAnswers = availableKeys ? Object.fromEntries(Object.entries(relevantAnswers).filter(([key]) => availableKeys.has(key))) : relevantAnswers;
  function checkCurrentStep() {
    if (!draft || !currentStep) return true;
    const nextErrors = validateStep(currentStep, currentAnswers, selectedSchema.fields);
    setErrors(nextErrors);
    setError(Object.keys(nextErrors).length ? "Исправьте поля текущего раздела." : "");
    return !Object.keys(nextErrors).length;
  }
  async function advance() {
    if (lockingStages && currentStep?.stageId) {
      if (currentStageState === "COMPLETED") {
        if (stepIndex < steps.length - 1) setStepIndex(stepIndex + 1);
        else setReview(true);
        return;
      }
      if (currentStageState === "NOT_STARTED") { setStepIndex(Math.max(0, steps.findIndex(step => stageState(step.stageId) === "IN_PROGRESS"))); return; }
      setStageAction("save");
      return;
    }
    if (!checkCurrentStep()) return;
    if (stepIndex < steps.length - 1) setStepIndex(stepIndex + 1);
    else if (validate()) setReview(true);
  }
  async function confirmStageAction() {
    const action = stageAction;
    setStageAction(null);
    if (!action || !draft || !currentStep?.stageId) return;
    if (currentStageState === "IN_PROGRESS" && !checkCurrentStep()) return;
    await run(async () => {
      if (currentStageState === "IN_PROGRESS") {
        const result = await api(`/contract-drafts/${draft.id}/stages/${currentStep.stageId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) });
        setDraft((current: any) => ({ ...current, completed_stage_ids: result.completed_stage_ids, stage_progress: result.stage_progress, status: "DRAFT" }));
        setAnswers(result.answers);
        savedSnapshot.current = JSON.stringify(result.answers);
      }
      if (action === "generate") {
        let generated;
        try { generated = await api(`/contract-drafts/${draft.id}/generate?stage_id=${encodeURIComponent(currentStep.stageId)}`, { method: "POST" }); }
        catch (e: any) { throw new Error(`Ответы этапа сохранены и заблокированы, но DOCX не сформирован: ${e.message || e}. Повторите формирование без разблокировки.`); }
        setDocument(generated);
        setDraft((current: any) => ({ ...current, status: generated.status }));
        setNotice("DOCX сформирован. Ответы этапа сохранены и заблокированы.");
        await load();
      } else setNotice("Ответы этапа сохранены и заблокированы.");
      if (stepIndex < steps.length - 1) setStepIndex(stepIndex + 1);
    });
  }
  function validate() {
    const e = Object.assign({}, ...steps.map((step) => validateStep(step, relevantAnswers, selectedSchema.fields)));
    setErrors(e);
    if (Object.keys(e).length) {
      setReview(false);
      setError("Исправьте указанные ниже поля анкеты.");
    } else {
      setError("");
    }
    return !Object.keys(e).length;
  }
  async function save() {
    if (lockingStages) { if (currentStageState === "IN_PROGRESS") setStageAction("save"); return; }
    if (!validate()) return;
    await run(async () => {
      await api(`/contract-drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      savedSnapshot.current = JSON.stringify(answers);
      setNotice("Ответы сохранены. Можно продолжить позже.");
      await load();
    });
  }
  async function generate(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    await run(async () => {
      await api(`/contract-drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      savedSnapshot.current = JSON.stringify(answers);
      let result = await api(`/contract-drafts/${draft.id}/generate`, {
        method: "POST",
      });
      setDocument(result);
      setNotice("Договор сформирован.");
      await load();
    });
  }
  function setItems(g: any, items: any[]) {
    setAnswers({ ...answers, [g.group_key]: items });
    setErrors({ ...errors, [g.group_key]: undefined });
  }
  function addItem(g: any) {
    let items = answers[g.group_key] || [];
    if (items.length >= g.max_items) return;
    setItems(g, [...items, { _id: itemId() }]);
  }
  function changeItem(g: any, index: number, key: string, value: any) {
    let items = [...(answers[g.group_key] || [])];
    items[index] = { ...items[index], [key]: value };
    setItems(g, items);
  }
  function moveItem(g: any, index: number, offset: number) {
    let items = [...(answers[g.group_key] || [])],
      next = index + offset;
    if (next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next], items[index]];
    setItems(g, items);
  }
  const filtered = useMemo(
    () =>
      catalog.filter((x) =>
        (x.name + " " + x.category + " " + x.description)
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [catalog, query],
  );
  const calculated: any = draft
    ? calculateAnswers({ ...draft.schema, fields: selectedSchema.fields, repeating_groups: selectedSchema.groups }, lockingStages && !review ? currentAnswers : relevantAnswers)
    : { values: {}, groups: {}, errors: {} };
  const activeFields = draft
    ? selectedSchema.fields.filter((f: any) => fieldState(f, relevantAnswers).visible && !f.config?.calculated)
    : [];
  const requiredFields = activeFields.filter(
    (f: any) => fieldState(f, relevantAnswers).required
  );
  const completedFields = requiredFields.filter((f: any) => {
    const value = answers[f.field_key];
    if (value === undefined || value === null || value === "") return false;
    if (isStructuredChoice(f)) return choiceComplete(f, value);
    if (f.field_type === "COMPOSITE") {
      return (f.config?.components || []).every(
        (c: any) => !c.required || String(value?.[c.key] ?? "").trim()
      );
    }
    return true;
  }).length;
  const progress = requiredFields.length
    ? Math.round((completedFields / requiredFields.length) * 100)
    : 100;
  if (productDraft)
    return <ProductQuestionnaire api={api} initial={productDraft} close={() => setProductDraft(undefined)} reload={load} />;
  if (draft)
    return (
      <div className="page contract-questionnaire">
        <button className="back-link" onClick={() => setDraft(null)}>
          <ArrowLeft size={16} />К каталогу
        </button>
        <header className="pagehead" data-tour="q-header">
          <div>
            <p>{draft.template.category}</p>
            <h1>{draft.title || draft.template.name}</h1>
            <span>Заполните вопросы. Изменения сохраняются автоматически.</span>
          </div>
        </header>
        <section className="questionnaire-progress" data-tour="q-progress" aria-label="Прогресс заполнения">
          <div><b>{review ? "Проверка ответов" : `Раздел ${stepIndex + 1} из ${steps.length}: ${currentStep?.name || "Анкета"}`}</b><span>{progress}% заполнено</span></div>
          <progress max="100" value={progress}>{progress}%</progress>
          <nav className="questionnaire-steps" data-tour="q-steps" aria-label={lockingStages ? "Этапы договора" : "Разделы анкеты"}>{steps.map((step, index) => <button key={step.name} type="button" aria-current={!review && index === stepIndex ? "step" : undefined} className={index === stepIndex && !review ? "active" : ""} disabled={lockingStages && stageState(step.stageId) === "NOT_STARTED"} onClick={() => { if (lockingStages) { setReview(false); setStepIndex(index); setErrors({}); setError(""); return; } if (index < stepIndex) { setReview(false); setStepIndex(index); setErrors({}); setError(""); } else if (index > stepIndex) { for (let n = stepIndex; n < index; n++) { const found = validateStep(steps[n], relevantAnswers, selectedSchema.fields); if (Object.keys(found).length) { setStepIndex(n); setErrors(found); setError("Исправьте поля текущего раздела."); return; } } setStepIndex(index); setErrors({}); setError(""); } else setReview(false); }}>{index + 1}. {step.name}{lockingStages && <small>{stageState(step.stageId) === "COMPLETED" ? <><LockKeyhole size={13}/> Завершён</> : stageState(step.stageId) === "IN_PROGRESS" ? "Заполняется" : "Не начат"}</small>}</button>)}</nav>
        </section>
        {error && (
          <div className="platform-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="platform-success" role="status">
            {notice}
          </div>
        )}
        {Object.keys(errors).filter((key) => errors[key]).length > 0 && (
          <div className="platform-error" role="alert">
            <strong>Проверьте следующие поля:</strong>
            <ul>
              {Object.entries(errors)
                .filter(([, message]) => Boolean(message))
                .map(([key, message]) => {
                  const field = draft.schema.fields.find(
                    (f: any) => f.field_key === key
                  );
                  const group = (draft.schema.repeating_groups || []).find(
                    (g: any) => g.group_key === key
                  );
                  return (
                    <li key={key}>
                      <b>{field?.label || group?.name || key}</b>
                      {": "}{String(message)}
                    </li>
                  );
                })}
            </ul>
          </div>
        )}
        {stageAction && <ConfirmAction title={stageAction === "generate" ? "Сформировать DOCX" : "Сохранить ответы"} body="После подтверждения ответы текущего этапа будут сохранены и заблокированы для редактирования. Продолжить?" action="Подтвердить" busy={busy} onConfirm={() => void confirmStageAction()} onCancel={() => setStageAction(null)}/>}
        <form className="dynamic-form" noValidate onSubmit={review ? generate : (event) => { event.preventDefault(); void advance(); }}>
          {review && <section className="answers-review"><h2>Проверьте ответы</h2><p>Платформа сформирует документ из закреплённой версии шаблона. При необходимости вернитесь к анкете.</p>{Object.entries(calculated.errors || {}).map(([key, message]) => <p className="platform-error" role="alert" key={key}>{selectedSchema.fields.find((field: any) => field.field_key === key)?.label || key}: {String(message)}</p>)}{activeFields.map((f:any)=><div key={f.id}><span>{f.label}</span><b>{choiceText(f, answers[f.field_key]) || "—"}</b></div>)}</section>}
          {!review && <>
          {lockingStages && currentStageState === "COMPLETED" && <p className="platform-success" role="status">Этап завершён. Редактирование ответов заблокировано.</p>}
          {lockingStages && currentStageState === "NOT_STARTED" && <p className="platform-error" role="status">Сначала завершите предыдущий этап.</p>}
          {currentStep && <fieldset key={currentStep.name} disabled={lockingStages && currentStageState !== "IN_PROGRESS"}>
              <legend>{currentStep.name}</legend>
              {currentStep.items.map((item: any, itemIndex: number) => item.kind === "field" ? (fieldState(item.value, currentAnswers).visible ? <Question key={item.value.id} field={item.value} required={fieldState(item.value, currentAnswers).required} value={answers[item.value.field_key]} error={errors[item.value.field_key]} change={(value: any) => { setAnswers({ ...answers, [item.value.field_key]: value }); setErrors({ ...errors, [item.value.field_key]: undefined }); }}/> : null) : (groupActive(item.value) ? <RepeatingGroupForm key={item.value.id} tourTarget={itemIndex === 0} group={item.value} items={answers[item.value.group_key] || []} calculatedItems={calculated.groups[item.value.group_key] || []} calculationErrors={calculated.errors || {}} error={errors[item.value.group_key]} add={() => addItem(item.value)} remove={(i: number) => setItems(item.value, (answers[item.value.group_key] || []).filter((_: any, n: number) => n !== i))} move={(i: number, o: number) => moveItem(item.value, i, o)} change={(i: number, k: string, v: any) => changeItem(item.value, i, k, v)}/> : null))}
            </fieldset>}
          </>}
          <div className="form-actions" data-tour="q-actions">
            {review && <button type="button" className="secondary" onClick={() => setReview(false)}><ArrowLeft size={16}/>Вернуться к анкете</button>}
            {!review && stepIndex > 0 && <button type="button" className="secondary" onClick={() => { setStepIndex(stepIndex - 1); setErrors({}); setError(""); }}><ArrowLeft size={16}/>Назад</button>}
            {!lockingStages && <button
              type="button"
              className="secondary"
              onClick={save}
              disabled={busy || (lockingStages && currentStageState !== "IN_PROGRESS")}
            >
              <Save size={16} />
              Сохранить ответы
            </button>}
            {lockingStages && currentStageState !== "NOT_STARTED" && <button type="button" className="secondary" disabled={busy} onClick={() => setStageAction("generate")}><FileText size={16}/>Сформировать DOCX</button>}
            <button className="primary" data-tour={review?"q-generate":undefined} disabled={busy}>
              {review ? "Сформировать DOCX" : lockingStages ? currentStageState === "IN_PROGRESS" ? "Сохранить ответы" : currentStageState === "COMPLETED" ? "Перейти далее" : "Вернуться к текущему этапу" : stepIndex === steps.length - 1 ? "Завершить заполнение" : "Далее"}
            </button>
          </div>
          {document && (
            <a className="document-ready" data-tour="q-download" href={document.download_url}>
              <CheckCircle2 />
              <span>
                <b>Договор готов</b>
                <small>Скачайте сформированный DOCX</small>
              </span>
              <Download />
            </a>
          )}
        </form>
      </div>
    );
  return (
    <div className="page contract-catalog">
      <header className="pagehead">
        <div>
          <p>КОРПОРАТИВНЫЕ ДОКУМЕНТЫ</p>
          <h1>Договоры</h1>
          <span>Выберите утверждённый шаблон и заполните анкету.</span>
        </div>
      </header>
      {error && (
        <div className="platform-error" role="alert">
          {error}
        </div>
      )}
      <label className="catalog-search" data-tour="catalog-search">
        <Search size={17} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти договор по названию или категории"
        />
      </label>
      <section className="contract-cards" data-tour="catalog-cards">
        {filtered.map((x,index) => (
          <article data-tour={index===0?"catalog-card":undefined} key={x.id}>
            <FileText />
            <small>{x.category}</small>
            <h2>{x.name}</h2>
            <p>
              {x.description || "Утверждённый корпоративный шаблон договора."}
            </p>
            {x.stages?.length > 0 && <ol aria-label="Этапы договора">{x.stages.map((stage: any) => <li key={stage.id}>{stage.name}</li>)}</ol>}
            <button className="primary" disabled={busy} onClick={() => begin(x.id)}>
              Начать заполнение
            </button>
          </article>
        ))}
      </section>
      {loading && <section className="catalog-loading" role="status">Загружаем доступные договоры…</section>}
      {!loading && filtered.length === 0 && (
        <section className="platform-empty catalog-empty">
          <FileText />
          <h2>{query ? "Ничего не найдено" : "Пока нет доступных договоров"}</h2>
          <p>{query ? "Измените поисковый запрос." : "Опубликованные шаблоны появятся здесь после их утверждения специалистами ДПО."}</p>
          {!query && manager && go && <button className="primary" onClick={() => go("/templates")}>Перейти в конструктор</button>}
        </section>
      )}
      {drafts.length > 0 && (
        <section className="saved-drafts" data-tour="catalog-drafts">
          <h2>Продолжить заполнение</h2>
          {drafts.filter((x) => !x.generated || (x.has_stages && x.status === "DRAFT")).map((x) => (
            <button className="draft-continue" key={x.id} onClick={() => restore(x.id)}>
              <span>
                <b>{x.title || x.template_name}</b>
                <small>
                  {x.has_stages && x.status === "DRAFT" && x.generated
                    ? "Доступен следующий этап"
                    : x.generated_stale
                    ? "Ответы изменены — продолжите заполнение"
                    : x.status === "GENERATED"
                      ? "Документ сформирован"
                      : x.has_stages ? "В работе" : "Черновик сохранён"}
                </small>
              </span>
              <span className="primary">Продолжить</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
export function RepeatingGroupForm({
  group,
  tourTarget,
  items,
  calculatedItems,
  calculationErrors,
  error,
  add,
  remove,
  move,
  change,
}: any) {
  return (
    <fieldset className={`repeating-group ${error ? "invalid" : ""}`}>
      <legend>{group.name}</legend>
      {group.description && (
        <p className="repeat-description">{group.description}</p>
      )}
      {items.map((item: any, index: number) => (
        <article className="repeat-item" key={item._id}>
          <header>
            <b>
              {group.name}: запись {index + 1}
            </b>
            <span>
              <button
                type="button"
                aria-label="Переместить запись выше"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                aria-label="Переместить запись ниже"
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                aria-label="Удалить запись"
                onClick={() => remove(index)}
              >
                <Trash2 size={15} />
              </button>
            </span>
          </header>
          <div className="repeat-fields">
            {group.fields.map((f: any) => (
              <Question
                key={f.id}
                inputId={`field-${f.id}-${item._id || index}`}
                field={f}
                required={f.required}
                value={
                  f.config?.calculated
                    ? calculatedItems[index]?.[f.field_key]
                    : item[f.field_key]
                }
                error={calculationErrors[`${group.group_key}.${f.field_key}`]}
                change={(v: any) => change(index, f.field_key, v)}
              />
            ))}
          </div>
        </article>
      ))}
      {error && (
        <b className="repeat-error" role="alert">
          {error}
        </b>
      )}
      <button
        type="button"
        className="condition-add" data-tour={tourTarget ? "q-repeat-add" : undefined}
        disabled={items.length >= group.max_items}
        onClick={add}
      >
        <Plus size={15} />
        Добавить запись
      </button>
      <small className="repeat-count">
        {items.length} из {group.max_items}
      </small>
    </fieldset>
  );
}
function groups(fields: any[]) {
  let map = new Map<string, any[]>();
  fields.filter((f) => !f.config?.calculated).forEach((f) => {
    let key = f.config?.group || "Основные сведения";
    map.set(key, [...(map.get(key) || []), f]);
  });
  return [...map.entries()];
}

const SELECT_LABELS: Record<string, string> = {
  TYPICAL_FORM: "Типовая форма договора",
  CUSTOM_FORM: "Иная форма договора",
  PREPAY: "Предоплата",
  POSTPAY: "Оплата после оказания услуг",
  MIXED: "Смешанная оплата",
  VAT_PAYER: "Исполнитель является плательщиком НДС",
  NO_VAT: "Исполнитель не является плательщиком НДС",
};

function selectLabel(value: string): string {
  return SELECT_LABELS[value] || value;
}

export function Question({ field, value, error, change, required, inputId }: any) {
  let id = inputId || `field-${field.id}`,
    help = questionHelp(field),
    helpId = help.help ? `${id}-help` : undefined,
    describedBy = [helpId, error ? `${id}-error` : undefined].filter(Boolean).join(" ") || undefined,
    caption = <>{field.label}{required && <span className="question-required" aria-label="Обязательное поле"> *</span>}<QuestionHint text={field.config?.description} id={id}/></>,
    helpText = help.help ? <small className="question-help-text" id={helpId}>{help.help}</small> : null,
    common = {
      id,
      value: value ?? "",
      onChange: (e: any) => change(e.target.value),
      placeholder: help.placeholder,
      required,
      "aria-label": field.label,
      "aria-invalid": !!error,
      "aria-describedby": describedBy,
    };
  if (field.config?.calculated)
    return null;

  /* Служебные вычисляемые поля скрыты из анкеты.
  return (
      <output className={`calculated-value ${error ? "invalid" : ""}`} aria-live="polite">
        <span>{field.label}</span>
        <b>{value !== undefined && value !== null && value !== ""
          ? String(value)
          : "—"}</b>
        <small>
          {value === undefined || value === null || value === ""
            ? "Заполните исходные данные для расчёта"
            : "Рассчитано автоматически"}
        </small>
      </output>
    );
  */
  if(field.field_type==="LIST"){let items=Array.isArray(value)?value:[];return <fieldset className={error?"invalid":""} aria-describedby={describedBy}><legend>{caption}</legend>{helpText}{items.map((x:string,i:number)=><div key={i} className="repeat-item"><input value={x} onChange={e=>change(items.map((v:string,n:number)=>n===i?e.target.value:v))}/><button type="button" onClick={()=>change(items.filter((_:string,n:number)=>n!==i))}>Удалить</button><button type="button" disabled={i===0} onClick={()=>{let a=[...items];[a[i-1],a[i]]=[a[i],a[i-1]];change(a)}}>Выше</button></div>)}<button type="button" onClick={()=>change([...items,""])} disabled={items.length>=(field.config?.item_config?.max_items??20)}>Добавить</button>{error&&<b>{error}</b>}</fieldset>}
  if(field.field_type==="COMPOSITE"){let object=value&&typeof value==="object"?value:{};return <fieldset className={error?"invalid":""} aria-describedby={describedBy}><legend>{caption}</legend>{helpText}<CompositeInputs components={field.config?.components||[]} value={object} change={change}/>{error&&<b>{error}</b>}</fieldset>}
  if (isStructuredChoice(field)) {
    const answer = choiceAnswer(value);
    const multiple = field.field_type === "MULTI_SELECT";
    const options = [...field.config.option_items, ...(field.config.allow_other ? [{ key: OTHER, label: "Иное" }] : [])];
    return <fieldset className={error ? "invalid" : ""} aria-describedby={describedBy}><legend>{caption}</legend>{helpText}<div className="contract-choice-options" role="group" aria-label={field.label}>{options.map((option: any) => <label className={`contract-choice ${answer.selected.includes(option.key) ? "contract-choice-selected" : ""}`} key={option.key}><input type={multiple ? "checkbox" : "radio"} name={id} checked={answer.selected.includes(option.key)} onChange={event => { const selected = multiple ? event.target.checked ? [...answer.selected, option.key] : answer.selected.filter(key => key !== option.key) : [option.key]; change({ ...answer, selected }); }}/><span>{option.label}</span></label>)}</div>{answer.selected.includes(OTHER) && (multiple ? <div className="contract-other-values">{choiceOtherValues(answer).map((text,index)=><div className="contract-other-row" key={index}><input aria-label={`Свой вариант ${index+1}`} placeholder={`Свой вариант ${index+1}`} value={text} onChange={event=>{const other_texts=[...choiceOtherValues(answer)];other_texts[index]=event.target.value;change({...answer,other_text:other_texts[0]||"",other_texts});}}/><button type="button" className="secondary" aria-label={`Удалить свой вариант ${index+1}`} onClick={()=>{const other_texts=choiceOtherValues(answer).filter((_,position)=>position!==index);change({...answer,other_text:other_texts[0]||"",other_texts});}}>Удалить</button></div>)}<button type="button" className="secondary" disabled={choiceOtherValues(answer).length>=20} onClick={()=>change({...answer,other_texts:[...choiceOtherValues(answer),""]})}>+ Добавить ещё вариант</button></div> : <input aria-label="Укажите свой вариант" placeholder="Укажите свой вариант" value={answer.other_text} onChange={event => change({ ...answer, other_text: event.target.value })}/>)}{error && <b role="alert">{error}</b>}</fieldset>;
  }
  return (
    <label className={error ? "invalid" : ""}>
      <span>{caption}</span>
      {helpText}
      {field.field_type === "MULTILINE_TEXT" ? (
        <textarea {...common} maxLength={field.config?.validation?.max_length} />
      ) : field.field_type === "BOOLEAN" ||
          field.field_type === "SINGLE_SELECT" ? (
        <div
          className="contract-choice-options"
          role="group"
          aria-label={field.label}
        >
          {(field.field_type === "BOOLEAN"
            ? [
                { value: "true", label: "Да" },
                { value: "false", label: "Нет" },
              ]
            : (field.config?.options || []).map((x: string) => ({
                value: x,
                label: selectLabel(x),
              }))
          ).map((option: any) => {
            const selected =
              value !== undefined &&
              value !== null &&
              value !== "" &&
              String(value) === option.value;

            return (
              <button
                key={option.value}
                type="button"
                className={`contract-choice ${
                  selected ? "contract-choice-selected" : ""
                }`}
                aria-pressed={selected}
                onClick={() =>
                  change(
                    field.field_type === "BOOLEAN"
                      ? option.value === "true"
                      : option.value
                  )
                }
              >
                <span>{option.label}</span>
                <span className="contract-choice-indicator">
                  {selected ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>      ) : (
        <input
          {...common}
          maxLength={field.field_type === "TEXT" ? field.config?.validation?.max_length : undefined}
          inputMode={field.field_type === "TEXT" && field.config?.validation?.character_set === "DIGITS" ? "numeric" : undefined}
          type={
            field.field_type === "DATE"
              ? "date"
              : field.field_type === "INTEGER" ||
                  field.field_type === "DECIMAL" ||
                  field.field_type === "MONEY"
                ? "number"
                : "text"
          }
          step={field.field_type === "INTEGER" ? "1" : "any"}
        />
      )}{["TEXT","MULTILINE_TEXT"].includes(field.field_type) && !!textRuleHint(field.config?.validation) && <small className="question-rule-hint">{textRuleHint(field.config?.validation)}</small>}{" "}
      {error && <b id={id + "-error"}>{error}</b>}
    </label>
  );
}
function CompositeInputs({ components, value, change }: any) {
  const hints: Record<string, string> = {
    passport_series: "4 цифры без пробелов, например 4500",
    passport_number: "6 цифр без пробелов, например 123456",
    passport_issue_date: "Дата выдачи паспорта",
    snils: "Формат: 123-456-789 00",
  };

  return (
    <>
      {components.map((component: any) => {
        const current = value?.[component.key] ?? "";

        if (component.type === "COMPOSITE") {
          return (
            <fieldset key={component.key}>
              <legend>{component.label}</legend>
              <CompositeInputs
                components={component.components || []}
                value={current || {}}
                change={(nested: any) =>
                  change({ ...value, [component.key]: nested })
                }
              />
            </fieldset>
          );
        }

        const pattern = component.validation?.regex;
        const invalid =
          Boolean(pattern) &&
          String(current).length > 0 &&
          !new RegExp(pattern).test(String(current));

        return (
          <label key={component.key} className={invalid ? "invalid" : ""}>
            <span>
              {component.label}
            </span>
            {hints[component.key] && <small>{hints[component.key]}</small>}
            <input
              type={
                component.type === "DATE"
                  ? "date"
                  : component.type === "INTEGER"
                    ? "number"
                    : "text"
              }
              value={current}
              aria-invalid={invalid}
              onChange={(e) =>
                change({ ...value, [component.key]: e.target.value })
              }
            />
            {invalid && (
              <b>Проверьте формат. {hints[component.key] || "Некорректное значение"}</b>
            )}
          </label>
        );
      })}
    </>
  );
}
