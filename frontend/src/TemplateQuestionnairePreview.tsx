import React, { useEffect, useMemo, useState } from "react";
import { Download, FileText, Send } from "lucide-react";
import { Question, RepeatingGroupForm } from "./ContractCatalog";
import { calculateAnswers } from "./calculations";
import { evaluateCondition, fieldState } from "./conditions";
import { questionnaireSteps, validateStep } from "./questionnaireSteps";
import { selectedQuestionnaire } from "./contractStages";

const newRowId = () => globalThis.crypto?.randomUUID?.() || `row-${Date.now()}-${Math.random()}`;

export function TemplateQuestionnairePreview({ schema, answers, change, selectedStageIds = [], changeStages, lockedDrafts = [], unlockStage, allowNextStage, busy, published, document, error, notice, publicationCheck, generate, publish }: any) {
  const [sectionIndex, setSectionIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const stages = (schema?.stages || []).filter((stage: any) => stage.status === "ACTIVE");
  const { fields, groups } = useMemo(() => selectedQuestionnaire(schema, selectedStageIds), [schema, selectedStageIds]);
  const relevantAnswers = Object.fromEntries([...fields.map((field: any) => field.field_key), ...groups.map((group: any) => group.group_key)].filter(key => key in answers).map(key => [key, answers[key]]));
  const steps = useMemo(() => questionnaireSteps(fields, groups), [fields, groups]);
  const calculated = useMemo(() => calculateAnswers({ ...schema, fields, repeating_groups: groups }, relevantAnswers), [schema, answers, fields, groups]);
  const current = steps[Math.min(sectionIndex, Math.max(steps.length - 1, 0))];
  const activeAnswers = Object.fromEntries(fields.filter((field: any) => fieldState(field, relevantAnswers).visible).map((field: any) => [field.field_key, relevantAnswers[field.field_key]]));

  useEffect(() => { if (sectionIndex >= steps.length && steps.length) setSectionIndex(steps.length - 1); }, [sectionIndex, steps.length]);

  const setValue = (key: string, value: any) => {
    change({ ...answers, [key]: value });
    setErrors(previous => ({ ...previous, [key]: "" }));
  };
  const setItems = (group: any, items: any[]) => setValue(group.group_key, items);
  const checkAll = () => {
    const next = Object.assign({}, ...steps.map(step => validateStep(step, relevantAnswers, fields)));
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
      {stages.length > 0 && <fieldset className="contract-stage-selection"><legend>Этапы договора</legend><p>Выберите один или несколько этапов для тестового документа.</p><button type="button" className="secondary" onClick={() => changeStages(stages.map((stage: any) => stage.id))}>Выбрать все этапы</button>{stages.map((stage: any) => <label key={stage.id}><input type="checkbox" checked={selectedStageIds.includes(stage.id)} onChange={event => changeStages(event.target.checked ? [...selectedStageIds, stage.id] : selectedStageIds.filter((id: string) => id !== stage.id))}/><span><b>{stage.name}</b>{stage.description && <small>{stage.description}</small>}</span></label>)}</fieldset>}
      {stages.length > 0 && <p className="contract-stage-lock-setting">После подтверждённого сохранения ответы этапа станут доступны только для просмотра. Предпросмотр не фиксирует реальные этапы.</p>}
      {published && stages.length > 0 && <section className="contract-stage-unlock-list"><h3>Этапы договоров сотрудников</h3>{lockedDrafts.length ? lockedDrafts.map((draft: any) => <article key={draft.id}><b>{draft.title} · {draft.owner}</b>{draft.next_stage && <div><span>Следующий: {draft.next_stage.name}</span><button type="button" className="secondary" disabled={busy} onClick={() => void allowNextStage(draft.id)}>Разрешить следующий этап</button></div>}{draft.stage_progress.filter((stage: any) => stage.state === "COMPLETED").map((stage: any) => <div key={stage.id}><span>{stage.name}</span><button type="button" className="secondary" disabled={busy} onClick={() => void unlockStage(draft.id, stage.id)}>Разблокировать для исправления</button></div>)}</article>) : <p>Завершённых этапов пока нет.</p>}</section>}
      {steps.length > 1 && <nav className="questionnaire-steps" aria-label="Разделы анкеты">{steps.map((step, index) => <button key={step.name} type="button" className={index === sectionIndex ? "active" : ""} aria-current={index === sectionIndex ? "step" : undefined} onClick={() => setSectionIndex(index)}>{index + 1}. {step.name}</button>)}</nav>}
      {displayError && <div className="platform-error" role="alert">{displayError}</div>}
      {publicationCheck?.errors?.length > 0 && !published && <div className="platform-error" role="alert"><b>Ошибки конфигурации</b><ul>{publicationCheck.errors.map((message: string, index: number) => <li key={index}>{message}</li>)}</ul></div>}
      {publicationCheck?.warnings?.length > 0 && <div className="template-publication-warnings" role="status"><b>Предупреждения</b><p>Они не мешают публикации шаблона.</p><ul>{publicationCheck.warnings.map((message: string, index: number) => <li key={index}>{message}</li>)}</ul></div>}
      {notice && <div className="platform-success" role="status">{notice}</div>}
      {Object.entries(errors).some(([, message]) => !!message) && <div className="platform-error" role="alert"><b>Проверьте ответы:</b><ul>{Object.entries(errors).filter(([, message]) => !!message).map(([key, message]) => <li key={key}><b>{fields.find((field: any) => field.field_key === key)?.label || groups.find((group: any) => group.group_key === key)?.name || key}</b>: {message}</li>)}</ul></div>}
      <div className="dynamic-form" data-tour="tpl-preview-questionnaire">
        {current ? <fieldset key={current.name}><legend>{current.name}</legend>
          {current.items.map((item, index) => item.kind === "field" ? (fieldState(item.value, relevantAnswers).visible ? <Question key={item.value.id} field={item.value} value={answers[item.value.field_key]} required={fieldState(item.value, relevantAnswers).required} error={errors[item.value.field_key]} change={(value: any) => setValue(item.value.field_key, value)}/> : null) : (evaluateCondition(item.value.config?.visible_when, activeAnswers) ? <RepeatingGroupForm key={item.value.id} group={item.value} tourTarget={index === 0} items={answers[item.value.group_key] || []} calculatedItems={calculated.groups[item.value.group_key] || []} calculationErrors={calculated.errors} error={errors[item.value.group_key]}
            add={() => { const items = answers[item.value.group_key] || []; if (items.length < item.value.max_items) setItems(item.value, [...items, { _id: newRowId() }]); }}
            remove={(position: number) => setItems(item.value, (answers[item.value.group_key] || []).filter((_: any, itemIndex: number) => itemIndex !== position))}
            move={(position: number, offset: number) => { const next = [...(answers[item.value.group_key] || [])], target = position + offset; if (target < 0 || target >= next.length) return; [next[position], next[target]] = [next[target], next[position]]; setItems(item.value, next); }}
            change={(position: number, key: string, value: any) => setItems(item.value, (answers[item.value.group_key] || []).map((row: any, itemIndex: number) => itemIndex === position ? { ...row, [key]: value } : row))}/> : null))}
        </fieldset> : <div className="template-questionnaire-empty">В этой версии пока нет вопросов. Добавьте их на шаге «Вопросы анкеты».</div>}
      </div>
      {document && <a className="document-ready" href={document.download_url}><FileText size={20}/><span><b>Тестовый DOCX готов</b><small>Скачайте документ и проверьте результат</small></span><Download size={20}/></a>}
      <footer className="template-questionnaire-actions">
        <button type="button" className="secondary" disabled={busy || published || (stages.length > 0 && selectedStageIds.length === 0)} onClick={() => { if (checkAll()) generate(); }}><FileText size={16}/>Сформировать тестовый DOCX</button>
        <button type="button" className="primary" disabled={busy || published || !publicationCheck || !!publicationCheck.errors?.length} onClick={publish}><Send size={16}/>{publicationCheck?.warnings?.length && !publicationCheck?.errors?.length ? "Опубликовать с предупреждениями" : "Опубликовать шаблон"}</button>
        {published && !notice && <p>Версия опубликована и доступна сотрудникам.</p>}
      </footer>
    </div>
  </section>;
}
