import { OTHER, choiceAnswer, choiceOtherValues } from "./choices";

function initialValue(field: any, optionText: string): unknown {
  if (field.field_type === "BOOLEAN") return false;
  if (["INTEGER", "DECIMAL", "MONEY"].includes(field.field_type)) return 0;
  if (field.field_type === "LIST") return [];
  if (field.field_type === "COMPOSITE") return {};
  if (field.field_type === "MULTI_SELECT") return { selected: [], other_text: "" };
  if (field.field_type === "SINGLE_SELECT") {
    if (field.option_items?.length) return { selected: [field.option_items[0].key], other_text: "" };
    return field.options?.[0] || optionText.split(",").map((value: string) => value.trim()).find(Boolean) || "";
  }
  return "";
}

function CompositeDefaults({ components, value, change }: { components: any[]; value: Record<string, unknown>; change: (value: Record<string, unknown>) => void }) {
  return <div className="default-composite-values">{components.map(component => {
    const current = value?.[component.key];
    const update = (next: unknown) => change({ ...value, [component.key]: next });
    return component.type === "COMPOSITE"
      ? <fieldset key={component.key}><legend>{component.label}</legend><CompositeDefaults components={component.components || []} value={(current as Record<string, unknown>) || {}} change={update}/></fieldset>
      : <label key={component.key}>{component.label}{component.type === "BOOLEAN"
        ? <select value={current === true ? "true" : current === false ? "false" : ""} onChange={event => update(event.target.value === "" ? null : event.target.value === "true")}><option value="">Не задано</option><option value="true">Да</option><option value="false">Нет</option></select>
        : <input type={component.type === "DATE" ? "date" : ["INTEGER", "DECIMAL", "MONEY"].includes(component.type) ? "number" : "text"} step={component.type === "INTEGER" ? "1" : "any"} value={String(current ?? "")} onChange={event => update(["INTEGER", "DECIMAL", "MONEY"].includes(component.type) ? event.target.value === "" ? null : Number(event.target.value) : event.target.value)}/>}</label>;
  })}</div>;
}

export function DefaultValueEditor({ field, optionText, requisiteSets = [], change, changeSource = () => {} }: { field: any; optionText: string; requisiteSets?: any[]; change: (value: unknown) => void; changeSource?: (value: unknown) => void }) {
  if (field.calculated) return null;
  const enabled = field.default_value !== null && field.default_value !== undefined;
  const kind = field.field_type;
  const structured = ["SINGLE_SELECT", "MULTI_SELECT"].includes(kind) && !!field.option_items?.length;
  const answer = choiceAnswer(field.default_value);
  const options = [...(field.option_items || []), ...(field.allow_other ? [{ key: OTHER, label: "Иное" }] : [])];
  const selected = answer.selected;
  const updateChoice = (next: any) => change({ ...answer, ...next });
  const source = field.default_source;
  const currentSet = requisiteSets.find(item => item.id === source?.set_id);
  return <details className="default-value-editor">
    <summary>Значение по умолчанию</summary>
    <label>Источник предзаполнения<select aria-label="Источник предзаполнения" value={source ? "REQUISITES" : enabled ? "FIXED" : "NONE"} onChange={event => { const mode=event.target.value;const first=requisiteSets.find(item=>item.status==="ACTIVE"&&item.entries?.length);changeSource(mode==="REQUISITES" ? {set_id:first?.id||"",field_key:first?.entries?.[0]?.key||"",fallback:"NONE"} : null);change(mode==="FIXED" ? initialValue(field, optionText) : null); }}><option value="NONE">Без предзаполнения</option><option value="FIXED">Фиксированное значение</option><option value="REQUISITES" disabled={!requisiteSets.some(item=>item.status==="ACTIVE"&&item.entries?.length)}>Справочник реквизитов</option></select></label>
    {source && <div className="default-requisite-source"><label>Набор реквизитов<select value={source.set_id} onChange={event => { const item=requisiteSets.find(row=>row.id===event.target.value);changeSource({...source,set_id:item?.id||"",field_key:item?.entries?.[0]?.key||""}); }}>{requisiteSets.map(item=><option key={item.id} value={item.id} disabled={item.status!=="ACTIVE"}>{item.name}{item.status!=="ACTIVE" ? " (архив)" : ""}</option>)}</select></label><label>Реквизит<select value={source.field_key} onChange={event=>changeSource({...source,field_key:event.target.value})}>{(currentSet?.entries||[]).map((item:any)=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label>Если значение недоступно<select value={source.fallback} onChange={event => { const fallback=event.target.value;changeSource({...source,fallback});change(fallback==="FIXED" ? initialValue(field,optionText) : null); }}><option value="NONE">Оставить поле пустым</option><option value="FIXED">Использовать запасное значение</option></select></label></div>}
    {(enabled && (!source || source.fallback==="FIXED")) && (structured ? <div className="default-choice-values"><div role="group" aria-label="Варианты по умолчанию">{options.map(option => <label className="check" key={option.key}><input type={kind === "MULTI_SELECT" ? "checkbox" : "radio"} name={`default-${field.field_key}`} checked={selected.includes(option.key)} onChange={event => updateChoice({ selected: kind === "MULTI_SELECT" ? event.target.checked ? [...selected, option.key] : selected.filter(key => key !== option.key) : [option.key] })}/>{option.label}</label>)}</div>{selected.includes(OTHER) && (kind === "MULTI_SELECT" ? <div className="default-other-values">{choiceOtherValues(answer).map((text, index) => <div key={index}><input aria-label={`Свой вариант по умолчанию ${index + 1}`} value={text} onChange={event => { const other_texts = [...choiceOtherValues(answer)];other_texts[index] = event.target.value;updateChoice({ other_text: other_texts[0] || "", other_texts }); }}/><button type="button" onClick={() => { const other_texts = choiceOtherValues(answer).filter((_, position) => position !== index);updateChoice({ other_text: other_texts[0] || "", other_texts }); }}>Удалить</button></div>)}<button type="button" disabled={choiceOtherValues(answer).length >= 20} onClick={() => updateChoice({ other_texts: [...choiceOtherValues(answer), ""] })}>Добавить свой вариант</button></div> : <input aria-label="Свой вариант по умолчанию" value={answer.other_text} onChange={event => updateChoice({ other_text: event.target.value })}/>)}</div>
      : kind === "SINGLE_SELECT" ? <label>Выбранный вариант<select value={String(field.default_value ?? "")} onChange={event => change(event.target.value)}><option value="">Выберите вариант</option>{(field.options?.length ? field.options : optionText.split(",").map((value: string) => value.trim()).filter(Boolean)).map((option: string) => <option key={option} value={option}>{option}</option>)}</select></label>
      : kind === "BOOLEAN" ? <label>Ответ<select value={String(field.default_value)} onChange={event => change(event.target.value === "true")}><option value="true">Да</option><option value="false">Нет</option></select></label>
      : kind === "LIST" ? <div className="default-list-values">{(Array.isArray(field.default_value) ? field.default_value : []).map((item: string, index: number) => <div key={index}><input aria-label={`Элемент по умолчанию ${index + 1}`} value={item} onChange={event => change(field.default_value.map((value: string, position: number) => position === index ? event.target.value : value))}/><button type="button" onClick={() => change(field.default_value.filter((_: string, position: number) => position !== index))}>Удалить</button></div>)}<button type="button" onClick={() => change([...(field.default_value || []), ""])}>Добавить элемент</button></div>
      : kind === "COMPOSITE" ? <CompositeDefaults components={field.components || []} value={field.default_value || {}} change={change}/>
      : <label>Ответ{kind === "MULTILINE_TEXT" ? <textarea value={String(field.default_value ?? "")} onChange={event => change(event.target.value)}/> : <input type={kind === "DATE" ? "date" : ["INTEGER", "DECIMAL", "MONEY"].includes(kind) ? "number" : "text"} step={kind === "INTEGER" ? "1" : "any"} value={String(field.default_value ?? "")} onChange={event => change(["INTEGER", "DECIMAL", "MONEY"].includes(kind) ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)}/>}</label>)}
  </details>;
}
