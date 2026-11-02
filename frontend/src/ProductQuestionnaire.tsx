import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Download, Plus, Save, Trash2 } from "lucide-react";
import { evaluateCondition, fieldState } from "./conditions";
import { calculateAnswers } from "./calculations";
import { QuestionHint } from "./QuestionHint";
import { questionnaireSteps, validateStep } from "./questionnaireSteps";

const rowId = () => globalThis.crypto?.randomUUID?.() || `row-${Date.now()}-${Math.random()}`;

export function ProductQuestionnaire({ api, initial, close, reload }: any) {
  const [draft, setDraft] = useState(initial);
  const [common, setCommon] = useState<any>(initial.common_answers || {});
  const [variant, setVariant] = useState<any>(initial.variant_answers || {});
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [document, setDocument] = useState<any>();
  const ready = useRef(false);
  useEffect(() => { ready.current = true; }, []);
  useEffect(() => {
    if (!ready.current) return;
    const timer = setTimeout(() => save(true).catch(() => {}), 650);
    return () => clearTimeout(timer);
  }, [common, variant]);

  async function save(silent = false) {
    try {
      const next = await api(`/contract-product-drafts/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ common_answers: common, variant_answers: variant }) });
      setDraft(next);
      setVariant((current: any) => JSON.stringify(current) === JSON.stringify(next.variant_answers || {}) ? current : next.variant_answers || {});
      if (!silent) setNotice("Черновик сохранён");
      await reload();
      return next;
    } catch (e: any) {
      setError(e.message);
      throw e;
    }
  }

  const decision = draft.decision || {};
  const schema = draft.schema;
  const effectiveVariant = { ...variant };
  for (const mapping of draft.selected_variant?.mappings || []) effectiveVariant[mapping.target_field_key] = common[mapping.product_field_key];
  const calculated = schema ? calculateAnswers(schema, effectiveVariant) : { values: {}, groups: {}, errors: {} };
  const commonStep = { name: "Общие сведения и применимость", fields: draft.common_fields || [], groups: [] };
  const variantSteps = decision.state === "SELECTED" && schema ? questionnaireSteps(schema.fields.filter((field: any) => !draft.mapped_field_keys?.includes(field.field_key)), schema.repeating_groups || []) : [];
  const steps = [commonStep, ...variantSteps];
  const activeIndex = Math.min(stepIndex, steps.length - 1);
  const currentStep = steps[activeIndex];
  const answers = activeIndex === 0 ? common : effectiveVariant;
  const allFields = activeIndex === 0 ? draft.common_fields : schema?.fields || [];

  function validateAt(index: number) {
    const step = steps[index];
    if (!step) return {};
    return validateStep(step, index === 0 ? common : effectiveVariant, index === 0 ? draft.common_fields : schema.fields);
  }
  function goTo(index: number) {
    if (index < activeIndex) { setStepIndex(index); setErrors({}); setError(""); return; }
    for (let current = activeIndex; current < index; current++) {
      const found = validateAt(current);
      if (Object.keys(found).length) { setStepIndex(current); setErrors(found); setError("Исправьте поля текущего раздела."); return; }
    }
    setStepIndex(index); setErrors({}); setError("");
  }
  async function next() {
    const found = validateAt(activeIndex);
    setErrors(found);
    if (Object.keys(found).length) { setError("Исправьте поля текущего раздела."); return; }
    setError("");
    if (activeIndex === 0) {
      try {
        const refreshed = await save(true);
        if (refreshed.decision?.state !== "SELECTED") { setError("Сначала заполните сведения для выбора варианта договора."); return; }
        if (questionnaireSteps((refreshed.schema?.fields || []).filter((field: any) => !refreshed.mapped_field_keys?.includes(field.field_key)), refreshed.schema?.repeating_groups || []).length === 0) {
          const result = await api(`/contract-product-drafts/${draft.id}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          setDocument(result); setNotice("Договор сформирован из подходящего утверждённого варианта"); return;
        }
        setStepIndex(1); return;
      } catch { return; }
    }
    if (activeIndex < steps.length - 1) { setStepIndex(activeIndex + 1); return; }
    if (decision.state !== "SELECTED") { setError("Сначала заполните сведения для выбора варианта договора."); return; }
    for (let index = 0; index < steps.length; index++) {
      const prior = validateAt(index);
      if (Object.keys(prior).length) { setStepIndex(index); setErrors(prior); setError("Исправьте поля анкеты."); return; }
    }
    try {
      await save(true);
      const result = await api(`/contract-product-drafts/${draft.id}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setDocument(result); setNotice("Договор сформирован из подходящего утверждённого варианта");
    } catch (e: any) { setError(e.message); }
  }
  function change(field: any, value: any) {
    if (activeIndex === 0) setCommon({ ...common, [field.field_key]: value });
    else setVariant({ ...variant, [field.field_key]: value });
    setErrors({ ...errors, [field.field_key]: "" });
  }
  function setItems(group: any, items: any[]) { setVariant({ ...variant, [group.group_key]: items }); setErrors({ ...errors, [group.group_key]: "" }); }

  return <div className="page contract-questionnaire">
    <button className="back-link" onClick={close}><ArrowLeft size={16}/>К каталогу</button>
    <header className="pagehead"><div><p>{draft.product.category}</p><h1>{draft.title || draft.product.name}</h1><span>Система выберет утверждённый вариант DOCX по вашим ответам.</span></div></header>
    <section className="questionnaire-progress" aria-label="Прогресс заполнения"><div><b>Раздел {activeIndex + 1} из {steps.length}: {currentStep.name}</b></div><progress max={steps.length} value={activeIndex + 1}/><nav className="questionnaire-steps" aria-label="Разделы анкеты">{steps.map((step, index) => <button type="button" key={step.name} className={index === activeIndex ? "active" : ""} aria-current={index === activeIndex ? "step" : undefined} onClick={() => goTo(index)}>{index + 1}. {step.name}</button>)}</nav></section>
    {error && <div className="platform-error" role="alert">{error}</div>}
    {notice && <div className="platform-success" role="status">{notice}</div>}
    <form className="dynamic-form" noValidate onSubmit={(event) => { event.preventDefault(); next(); }}>
      <fieldset><legend>{currentStep.name}</legend>{currentStep.fields.filter((field: any) => fieldState(field, answers).visible).map((field: any) => <Input key={field.id} field={field} required={fieldState(field, answers).required} value={field.config?.calculated ? calculated.values[field.field_key] : answers[field.field_key]} error={errors[field.field_key]} change={(value: any) => change(field, value)}/>)}</fieldset>
      {activeIndex === 0 && <Decision decision={decision}/>}
      {activeIndex > 0 && currentStep.groups.filter((group: any) => evaluateCondition(group.config?.visible_when, Object.fromEntries((schema?.fields || []).filter((field: any) => fieldState(field, effectiveVariant).visible).map((field: any) => [field.field_key, effectiveVariant[field.field_key]])))).map((group: any) => <fieldset key={group.id} className="repeating-group"><legend>{group.name}</legend>{(variant[group.group_key] || []).map((row: any, index: number) => <article className="repeat-item" key={row._id}><header><b>Запись {index + 1}</b><button type="button" onClick={() => setItems(group, (variant[group.group_key] || []).filter((_: any, n: number) => n !== index))} aria-label="Удалить запись"><Trash2 size={15}/></button></header><div className="repeat-fields">{group.fields.map((field: any) => <Input key={field.id} field={field} required={field.required} value={field.config?.calculated ? calculated.groups[group.group_key]?.[index]?.[field.field_key] : row[field.field_key]} change={(value: any) => { const rows = [...(variant[group.group_key] || [])]; rows[index] = { ...rows[index], [field.field_key]: value }; setItems(group, rows); }}/>)}</div></article>)}{errors[group.group_key] && <b className="repeat-error" role="alert">{errors[group.group_key]}</b>}<button type="button" className="condition-add" onClick={() => setItems(group, [...(variant[group.group_key] || []), { _id: rowId() }])} disabled={(variant[group.group_key] || []).length >= group.max_items}><Plus size={15}/>Добавить запись</button></fieldset>)}
      <div className="form-actions">{activeIndex > 0 && <button type="button" className="secondary" onClick={() => goTo(activeIndex - 1)}><ArrowLeft size={16}/>Назад</button>}<button type="button" className="secondary" onClick={() => save().catch(() => {})}><Save size={16}/>Сохранить</button><button className="primary">{activeIndex === steps.length - 1 ? "Сформировать DOCX" : "Далее"}</button></div>
      {document && <a className="document-ready" href={document.download_url}><CheckCircle2/><span><b>Договор готов</b><small>{document.variant_name}</small></span><Download/></a>}
    </form>
  </div>;
}

function Decision({ decision }: any) {
  const names: any = { SELECTED: "Подходящий вариант определён", NEED_MORE_INFORMATION: "Нужны дополнительные сведения", NOT_APPLICABLE: "Автоматическое формирование недоступно", MANUAL_REVIEW_REQUIRED: "Требуется проверка специалиста ДПО", AMBIGUOUS: "Обнаружен конфликт правил", CONFIGURATION_ERROR: "Ошибка конфигурации продукта" };
  return <section className={`decision-preview ${(decision.state || "").toLowerCase()}`} aria-live="polite"><b>{names[decision.state] || "Уточняем подходящий вариант"}</b><span>{decision.reason}</span></section>;
}

function Input({ field, value, change, required, error }: any) {
  const id = `product-field-${field.id}`;
  if (field.config?.calculated) return null;
  const props: any = { value: value ?? "", onChange: (event: any) => change(event.target.value), "aria-invalid": !!error, "aria-describedby": error ? `${id}-error` : undefined, disabled: field.config?.calculated };
  const caption = <>{field.label}<QuestionHint text={field.config?.description} id={id}/></>;
  if (field.field_type === "LIST") {
    const items = Array.isArray(value) ? value : [];
    return <fieldset><legend>{caption}</legend>{items.map((item: string, index: number) => <div key={index}><input value={item} onChange={(event) => change(items.map((old: string, n: number) => n === index ? event.target.value : old))}/><button type="button" onClick={() => change(items.filter((_: string, n: number) => n !== index))}>Удалить</button></div>)}<button type="button" onClick={() => change([...items, ""])} disabled={items.length >= (field.config?.item_config?.max_items ?? 20)}>Добавить</button>{error && <b id={`${id}-error`}>{error}</b>}</fieldset>;
  }
  if (field.field_type === "COMPOSITE") {
    const object = value && typeof value === "object" ? value : {};
    return <fieldset><legend>{caption}</legend>{(field.config?.components || []).map((component: any) => <label key={component.key}><span>{component.label}</span><input value={object[component.key] ?? ""} onChange={(event) => change({ ...object, [component.key]: event.target.value })}/></label>)}{error && <b id={`${id}-error`}>{error}</b>}</fieldset>;
  }
  return <label className={error ? "invalid" : ""}><span>{caption}</span>{field.field_type === "BOOLEAN" ? <select value={value === true ? "true" : value === false ? "false" : ""} onChange={(event) => change(event.target.value === "" ? null : event.target.value === "true")}><option value="">Выберите</option><option value="true">Да</option><option value="false">Нет</option></select> : field.field_type === "SINGLE_SELECT" ? <select {...props}><option value="">Выберите</option>{(field.config?.options || []).map((option: string) => <option key={option} value={option}>{option}</option>)}</select> : field.field_type === "MULTILINE_TEXT" ? <textarea {...props}/> : <input {...props} type={field.field_type === "DATE" ? "date" : ["INTEGER", "DECIMAL", "MONEY"].includes(field.field_type) ? "number" : "text"} step={field.field_type === "INTEGER" ? "1" : "any"}/>}{error && <b id={`${id}-error`}>{error}</b>}</label>;
}
