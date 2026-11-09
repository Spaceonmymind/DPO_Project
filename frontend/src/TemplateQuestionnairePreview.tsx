import React, { useEffect, useMemo, useState } from "react";
import { Download, FileText, Send } from "lucide-react";
import { Question, RepeatingGroupForm } from "./ContractCatalog";
import { calculateAnswers } from "./calculations";
import { evaluateCondition, fieldState } from "./conditions";
import { questionnaireSteps, validateStep } from "./questionnaireSteps";

const newRowId = () => globalThis.crypto?.randomUUID?.() || `row-${Date.now()}-${Math.random()}`;

export function TemplateQuestionnairePreview({ schema, answers, change, busy, published, document, error, notice, generate, publish }: any) {
  const [sectionIndex, setSectionIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fields = schema?.fields || [];
  const groups = schema?.repeating_groups || [];
  const steps = useMemo(() => questionnaireSteps(fields, groups), [fields, groups]);
  const calculated = useMemo(() => calculateAnswers(schema, answers), [schema, answers]);
  const current = steps[Math.min(sectionIndex, Math.max(steps.length - 1, 0))];
  const activeAnswers = Object.fromEntries(fields.filter((field: any) => fieldState(field, answers).visible).map((field: any) => [field.field_key, answers[field.field_key]]));

  useEffect(() => { if (sectionIndex >= steps.length && steps.length) setSectionIndex(steps.length - 1); }, [sectionIndex, steps.length]);

  const setValue = (key: string, value: any) => {
    change({ ...answers, [key]: value });
    setErrors(previous => ({ ...previous, [key]: "" }));
  };
  const setItems = (group: any, items: any[]) => setValue(group.group_key, items);
  const checkAll = () => {
    const next = Object.assign({}, ...steps.map(step => validateStep(step, answers, fields)));
    setErrors(next);
    const first = steps.findIndex(step => [...step.fields.map(field => field.field_key), ...step.groups.map(group => group.group_key)].some(key => next[key]));
    if (first >= 0) setSectionIndex(first);
    return !Object.values(next).some(Boolean);
  };
  const displayError = (() => {
    if (!error) return "";
    try {
      const detail = JSON.parse(error);
      return typeof detail === "string" ? detail : detail.message || error;
    } catch { return error; }
  })();

  return <section className="contract-questionnaire template-questionnaire-preview" aria-label="Предпросмотр анкеты">
    <div className="template-questionnaire-content">
      <header className="template-questionnaire-heading"><span>Проверка перед публикацией</span><h2>Предпросмотр анкеты</h2><p>Заполните вопросы так, как это сделает сотрудник, и сформируйте тестовый документ.</p></header>
      {steps.length > 1 && <nav className="questionnaire-steps" aria-label="Разделы анкеты">{steps.map((step, index) => <button key={step.name} type="button" className={index === sectionIndex ? "active" : ""} aria-current={index === sectionIndex ? "step" : undefined} onClick={() => setSectionIndex(index)}>{index + 1}. {step.name}</button>)}</nav>}
      {displayError && <div className="platform-error" role="alert">{displayError}</div>}
      {notice && <div className="platform-success" role="status">{notice}</div>}
      {Object.entries(errors).some(([, message]) => !!message) && <div className="platform-error" role="alert"><b>Проверьте ответы:</b><ul>{Object.entries(errors).filter(([, message]) => !!message).map(([key, message]) => <li key={key}><b>{fields.find((field: any) => field.field_key === key)?.label || groups.find((group: any) => group.group_key === key)?.name || key}</b>: {message}</li>)}</ul></div>}
      <div className="dynamic-form" data-tour="tpl-preview-questionnaire">
        {current ? <fieldset key={current.name}><legend>{current.name}</legend>
          {current.fields.filter(field => fieldState(field, answers).visible).map((field: any) => <Question key={field.id} field={field} value={field.config?.calculated ? calculated.values[field.field_key] : answers[field.field_key]} required={fieldState(field, answers).required} error={errors[field.field_key]} change={(value: any) => setValue(field.field_key, value)}/>)}
        </fieldset> : <div className="template-questionnaire-empty">В этой версии пока нет вопросов. Добавьте их на шаге «Вопросы анкеты».</div>}
        {(current?.groups || []).filter((group: any) => evaluateCondition(group.config?.visible_when, activeAnswers)).map((group: any, index: number) => {
          const items = answers[group.group_key] || [];
          return <RepeatingGroupForm key={group.id} group={group} tourTarget={index === 0} items={items} calculatedItems={calculated.groups[group.group_key] || []} calculationErrors={calculated.errors} error={errors[group.group_key]}
            add={() => { if (items.length < group.max_items) setItems(group, [...items, { _id: newRowId() }]); }}
            remove={(position: number) => setItems(group, items.filter((_: any, index: number) => index !== position))}
            move={(position: number, offset: number) => { const next = [...items], target = position + offset; if (target < 0 || target >= next.length) return; [next[position], next[target]] = [next[target], next[position]]; setItems(group, next); }}
            change={(position: number, key: string, value: any) => setItems(group, items.map((item: any, index: number) => index === position ? { ...item, [key]: value } : item))}/>;
        })}
      </div>
      {document && <a className="document-ready" href={document.download_url}><FileText size={20}/><span><b>Тестовый DOCX готов</b><small>Скачайте документ и проверьте результат</small></span><Download size={20}/></a>}
      <footer className="template-questionnaire-actions">
        <button type="button" className="secondary" disabled={busy || published} onClick={() => { if (checkAll()) generate(); }}><FileText size={16}/>Сформировать тестовый DOCX</button>
        <button type="button" className="primary" disabled={busy || published} onClick={publish}><Send size={16}/>Опубликовать шаблон</button>
        {published && !notice && <p>Версия опубликована и доступна сотрудникам.</p>}
      </footer>
    </div>
  </section>;
}
