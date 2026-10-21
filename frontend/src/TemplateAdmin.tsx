import React, { FormEvent, useEffect, useState } from "react";
import {
  FileText,
  Upload,
  Download,
  Link2,
  Trash2,
  Plus,
  Send,
  CheckCircle2,
  Pencil,
  GitBranch,
} from "lucide-react";
type Api = (path: string, options?: any) => Promise<any>;
const TYPES: any = {
  TEXT: "Короткий текст",
  MULTILINE_TEXT: "Многострочный текст",
  INTEGER: "Целое число",
  DECIMAL: "Число",
  MONEY: "Денежная сумма",
  DATE: "Дата",
  BOOLEAN: "Да / нет",
  SINGLE_SELECT: "Выбор из списка",
};
const blank = (position = 1) => ({
  field_key: "",
  label: "",
  field_type: "TEXT",
  required: true,
  position,
  description: "",
  group: "Основные сведения",
  placeholder: "",
  validation: {},
  options: [],
  visible_when: null,
  required_when: null,
});
export function TemplateAdmin({ api }: { api: Api }) {
  const [templates, setTemplates] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(),
    [versions, setVersions] = useState<any[]>([]),
    [version, setVersion] = useState<any>(),
    [preview, setPreview] = useState<any>(),
    [schema, setSchema] = useState<any>(),
    [bindings, setBindings] = useState<any[]>([]),
    [regions, setRegions] = useState<any[]>([]),
    [selection, setSelection] = useState<any>(),
    [regionDraft, setRegionDraft] = useState<any>(),
    [blockStart, setBlockStart] = useState<string>(),
    [field, setField] = useState<any>(blank()),
    [editing, setEditing] = useState<string>(),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [category, setCategory] = useState("Другое"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setTemplates(await api("/document-templates"));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || "Операция не выполнена");
    } finally {
      setBusy(false);
    }
  }
  async function openTemplate(x: any) {
    setSelected(x);
    setVersion(null);
    setPreview(null);
    setSchema(null);
    setBindings([]);
    setVersions(await api(`/document-templates/${x.id}/versions`));
  }
  async function openVersion(x: any) {
    setVersion(x);
    setSelection(null);
    setRegionDraft(null);
    setBlockStart(undefined);
    let b = `/document-templates/${x.template_id}/versions/${x.id}`,
      [p, q, links, areas] = await Promise.all([
        api(b + "/preview"),
        api(b + "/questionnaire"),
        api(b + "/bindings"),
        api(b + "/conditional-regions"),
      ]);
    setPreview(p);
    setSchema(q);
    setBindings(links);
    setRegions(areas);
    setField(blank(q.fields.length + 1));
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      let x = await api("/document-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, category }),
      });
      setName("");
      setCode("");
      await load();
      await openTemplate(x);
    });
  }
  async function upload(file: File) {
    await run(async () => {
      let body = new FormData();
      body.append("file", file);
      let x = await api(`/document-templates/${selected.id}/versions`, {
        method: "POST",
        body,
      });
      setVersions(await api(`/document-templates/${selected.id}/versions`));
      await openVersion(x);
    });
  }
  function selectRange() {
    if (version?.status !== "DRAFT") return;
    let s = window.getSelection();
    if (!s || s.rangeCount !== 1 || s.isCollapsed) return;
    let r = s.getRangeAt(0),
      a = (
        r.startContainer.nodeType === 3
          ? r.startContainer.parentElement
          : (r.startContainer as HTMLElement)
      )?.closest?.("[data-locator]") as HTMLElement | null,
      z = (
        r.endContainer.nodeType === 3
          ? r.endContainer.parentElement
          : (r.endContainer as HTMLElement)
      )?.closest?.("[data-locator]") as HTMLElement | null;
    if (!a || a !== z) {
      setError(
        "Выделение должно находиться внутри одного абзаца или одной ячейки.",
      );
      return;
    }
    let before = document.createRange();
    before.selectNodeContents(a);
    before.setEnd(r.startContainer, r.startOffset);
    let start = before.toString().length,
      text = s.toString();
    if (text.trim())
      setSelection({
        locator: a.dataset.locator,
        start,
        end: start + text.length,
        selected_text: text,
        field_id: schema?.fields[0]?.id || "",
      });
  }
  async function saveField(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      let path = `/document-templates/${selected.id}/versions/${version.id}/fields${editing ? "/" + editing : ""}`;
      await api(path, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(field),
      });
      await openVersion(version);
      setEditing(undefined);
      setNotice("Поле анкеты сохранено.");
    });
  }
  function editField(x: any) {
    setEditing(x.id);
    setField({
      ...x,
      ...x.config,
      validation: x.config.validation || {},
      options: x.config.options || [],
      visible_when: x.config.visible_when || null,
      required_when: x.config.required_when || null,
    });
  }
  async function removeField(id: string) {
    await run(async () => {
      await api(
        `/document-templates/${selected.id}/versions/${version.id}/fields/${id}`,
        { method: "DELETE" },
      );
      await openVersion(version);
    });
  }
  async function bind() {
    await run(async () => {
      await api(
        `/document-templates/${selected.id}/versions/${version.id}/bindings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(selection),
        },
      );
      await openVersion(version);
      setNotice("Фрагмент привязан к вопросу.");
    });
  }
  async function unbind(id: string) {
    await run(async () => {
      await api(
        `/document-templates/${selected.id}/versions/${version.id}/bindings/${id}`,
        { method: "DELETE" },
      );
      await openVersion(version);
    });
  }
  function draftRegion(
    region_type: string,
    start_locator: string,
    end_locator?: string,
  ) {
    setRegionDraft({
      region_key: "",
      region_type,
      start_locator,
      end_locator: start_locator === end_locator ? undefined : end_locator,
      include_when: null,
    });
  }
  function chooseBlock(locator: string) {
    if (!blockStart) {
      setBlockStart(locator);
      setNotice("Начало блока отмечено. Теперь выберите его конец.");
    } else {
      draftRegion("CONDITIONAL_PARAGRAPH_GROUP", blockStart, locator);
      setBlockStart(undefined);
      setNotice("Границы блока выбраны. Настройте правило включения.");
    }
  }
  async function saveRegion() {
    await run(async () => {
      let editingRegion = regionDraft.id,
        path = `/document-templates/${selected.id}/versions/${version.id}/conditional-regions${editingRegion ? "/" + editingRegion : ""}`,
        payload = editingRegion
          ? {
              region_key: regionDraft.region_key,
              include_when: regionDraft.include_when,
            }
          : regionDraft;
      await api(path, {
        method: editingRegion ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await openVersion(version);
      setNotice(
        editingRegion
          ? "Условие области изменено."
          : "Условная область создана.",
      );
    });
  }
  async function removeRegion(id: string) {
    await run(async () => {
      await api(
        `/document-templates/${selected.id}/versions/${version.id}/conditional-regions/${id}`,
        { method: "DELETE" },
      );
      await openVersion(version);
      setNotice("Условная область удалена.");
    });
  }
  async function publish() {
    await run(async () => {
      let x = await api(
        `/document-templates/${selected.id}/versions/${version.id}/publish`,
        { method: "POST" },
      );
      await openVersion(x);
      await load();
      setNotice("Версия опубликована и доступна сотрудникам.");
    });
  }
  return (
    <div className="page template-admin">
      <header className="pagehead">
        <div>
          <p>КОНСТРУКТОР ДОГОВОРОВ</p>
          <h1>Шаблоны документов</h1>
          <span>
            Настройте вопросы, отметьте заменяемые фрагменты и опубликуйте
            договор.
          </span>
        </div>
      </header>
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
      <section className="template-layout">
        <aside className="template-catalog">
          <form className="template-create" onSubmit={create}>
            <h2>Новый шаблон</h2>
            <label>
              Название
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Категория
              <input
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </label>
            <label>
              Служебный код
              <input
                required
                pattern="[A-Za-z0-9_-]+"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              <Plus size={16} />
              Создать
            </button>
          </form>
          <section className="template-list">
            <h2>Шаблоны</h2>
            {templates.map((x) => (
              <button
                key={x.id}
                className={selected?.id === x.id ? "active" : ""}
                onClick={() => openTemplate(x)}
              >
                <FileText />
                <span>
                  <b>{x.name}</b>
                  <small>
                    {x.category} · {x.version_count} версий
                  </small>
                </span>
              </button>
            ))}
          </section>
        </aside>
        <main className="template-workbench">
          {!selected ? (
            <Empty />
          ) : (
            <>
              <header className="template-title">
                <div>
                  <span className="draft-state">
                    {version?.status === "PUBLISHED"
                      ? "Опубликовано"
                      : "Черновик"}
                  </span>
                  <h2>{selected.name}</h2>
                  <p>{selected.category}</p>
                </div>
                <label className="secondary upload-version">
                  <Upload size={16} />
                  Загрузить DOCX
                  <input
                    type="file"
                    accept=".docx"
                    onChange={(e) =>
                      e.target.files?.[0] && upload(e.target.files[0])
                    }
                  />
                </label>
              </header>
              <div className="version-grid">
                <section className="version-list">
                  <h3>Версии</h3>
                  {versions.map((x) => (
                    <button
                      key={x.id}
                      className={version?.id === x.id ? "active" : ""}
                      onClick={() => openVersion(x)}
                    >
                      <b>Версия {x.version_number}</b>
                      <small>{x.original_filename}</small>
                      <span>
                        {x.status === "PUBLISHED"
                          ? "Опубликована"
                          : x.status === "SUPERSEDED"
                            ? "Архивная"
                            : "Черновик"}
                      </span>
                    </button>
                  ))}
                </section>
                <section className="docx-preview">
                  {version && preview ? (
                    <>
                      <header>
                        <div>
                          <h3>Версия {version.version_number}</h3>
                          <p>{preview.nodes.length} структурных фрагментов</p>
                        </div>
                        <a
                          className="secondary"
                          href={`/api/v1/document-templates/${selected.id}/versions/${version.id}/source`}
                        >
                          <Download size={15} />
                          Исходник
                        </a>
                      </header>
                      <div className="builder-grid">
                        <section>
                          <div className="preview-notice">
                            Выделите текст для привязки или условного фрагмента.
                            Для структурной области используйте действия у абзаца.
                          </div>
                          <article
                            className="docx-page"
                            onMouseUp={selectRange}
                          >
                            {preview.nodes.map((node: any) => (
                              <div key={node.locator} className={`preview-node ${regions.some((r) => regionHasNode(r,node.locator)) ? "conditional-area" : ""}`}>
                                <p data-locator={node.locator} className={node.kind === "table_cell" ? "docx-cell" : ""}>
                                  {paint(node.text,bindings.filter((b) => b.locator.node === node.locator),schema?.fields || [],regions.filter((r) => r.region_type === "CONDITIONAL_RUN" && r.locator.node === node.locator))}
                                </p>
                                {version.status === "DRAFT" && <div className="region-actions" aria-label="Выбор условной области">
                                  <button type="button" onClick={() => draftRegion("CONDITIONAL_PARAGRAPH",node.locator)}>Абзац</button>
                                  <button type="button" onClick={() => chooseBlock(node.locator)}>{blockStart ? "Конец блока" : "Начало блока"}</button>
                                  {node.kind === "table_cell" && <><button type="button" onClick={() => draftRegion("CONDITIONAL_TABLE_ROW",node.locator)}>Строка</button><button type="button" onClick={() => draftRegion("CONDITIONAL_TABLE",node.locator)}>Таблица</button></>}
                                </div>}
                              </div>
                            ))}
                          </article>
                          {selection && (
                            <section className="selection-card">
                              <Link2 />
                              <div>
                                <h3>Выбранный фрагмент</h3>
                                <blockquote>
                                  {selection.selected_text}
                                </blockquote>
                                <label>
                                  Вопрос анкеты
                                  <select
                                    value={selection.field_id}
                                    onChange={(e) =>
                                      setSelection({
                                        ...selection,
                                        field_id: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="">Выберите вопрос</option>
                                    {schema?.fields.map((x: any) => (
                                      <option key={x.id} value={x.id}>
                                        {x.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <button
                                  className="primary"
                                  disabled={busy || !selection.field_id}
                                  onClick={bind}
                                >
                                  Создать привязку
                                </button>
                                <button className="secondary" type="button" onClick={() => setRegionDraft({region_key:"",region_type:"CONDITIONAL_RUN",start_locator:selection.locator,start:selection.start,end:selection.end,selected_text:selection.selected_text,include_when:null})}>Сделать условным фрагментом</button>
                              </div>
                            </section>
                          )}
                          {regionDraft && <section className="region-editor" aria-label="Настройка условной области">
                            <h3>{regionDraft.id ? "Изменить условную область" : "Новая условная область"}</h3>
                            <p>{REGION_LABELS[regionDraft.region_type]}</p>
                            <label>Служебный ключ<input required pattern="[A-Za-z][A-Za-z0-9_.-]*" value={regionDraft.region_key} onChange={(e) => setRegionDraft({...regionDraft,region_key:e.target.value})}/></label>
                            <ConditionEditor title="Включать область, когда" value={regionDraft.include_when} fields={schema?.fields || []} change={(value:any) => setRegionDraft({...regionDraft,include_when:value})}/>
                            <div><button type="button" className="primary" disabled={busy || !regionDraft.region_key || !regionDraft.include_when} onClick={saveRegion}>Сохранить область</button><button type="button" className="secondary" onClick={() => setRegionDraft(null)}>Отмена</button></div>
                          </section>}
                        </section>
                        <aside className="questionnaire-builder">
                          <h3>Вопросы анкеты</h3>
                          {version.status === "DRAFT" && (
                            <form onSubmit={saveField}>
                              <label>
                                Раздел
                                <input
                                  value={field.group}
                                  onChange={(e) =>
                                    setField({
                                      ...field,
                                      group: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Вопрос
                                <input
                                  required
                                  value={field.label}
                                  onChange={(e) =>
                                    setField({
                                      ...field,
                                      label: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Ключ поля
                                <input
                                  required
                                  pattern="[A-Za-z][A-Za-z0-9_.-]*"
                                  value={field.field_key}
                                  onChange={(e) =>
                                    setField({
                                      ...field,
                                      field_key: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Тип
                                <select
                                  value={field.field_type}
                                  onChange={(e) =>
                                    setField({
                                      ...field,
                                      field_type: e.target.value,
                                    })
                                  }
                                >
                                  {Object.entries(TYPES).map(([k, v]) => (
                                    <option key={k} value={k}>
                                      {v as string}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Подсказка
                                <input
                                  value={field.placeholder}
                                  onChange={(e) =>
                                    setField({
                                      ...field,
                                      placeholder: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              {field.field_type === "SINGLE_SELECT" && (
                                <label>
                                  Варианты через запятую
                                  <input
                                    value={field.options.join(", ")}
                                    onChange={(e) =>
                                      setField({
                                        ...field,
                                        options: e.target.value
                                          .split(",")
                                          .map((x) => x.trim())
                                          .filter(Boolean),
                                      })
                                    }
                                  />
                                </label>
                              )}
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={field.required}
                                  onChange={(e) =>
                                    setField({
                                      ...field,
                                      required: e.target.checked,
                                    })
                                  }
                                />
                                Всегда обязательный вопрос
                              </label>
                              <ConditionEditor
                                title="Показывать вопрос, когда"
                                value={field.visible_when}
                                fields={(schema?.fields || []).filter(
                                  (x: any) => x.id !== editing,
                                )}
                                change={(value: any) =>
                                  setField({ ...field, visible_when: value })
                                }
                              />
                              <ConditionEditor
                                title="Делать обязательным, когда"
                                value={field.required_when}
                                fields={(schema?.fields || []).filter(
                                  (x: any) => x.id !== editing,
                                )}
                                change={(value: any) =>
                                  setField({ ...field, required_when: value })
                                }
                              />
                              <button className="primary" disabled={busy}>
                                {editing
                                  ? "Сохранить изменения"
                                  : "Добавить вопрос"}
                              </button>
                            </form>
                          )}
                          <div className="field-list">
                            {schema?.fields.map((x: any) => (
                              <article key={x.id}>
                                <div>
                                  <b>{x.label}</b>
                                  <small>
                                    {TYPES[x.field_type]} ·{" "}
                                    {
                                      bindings.filter(
                                        (b) => b.field_id === x.id,
                                      ).length
                                    }{" "}
                                    вхождений
                                    {x.config?.visible_when ||
                                    x.config?.required_when
                                      ? " · Есть условия"
                                      : ""}
                                  </small>
                                </div>
                                {version.status === "DRAFT" && (
                                  <span>
                                    <button
                                      aria-label="Изменить вопрос"
                                      onClick={() => editField(x)}
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      aria-label="Удалить вопрос"
                                      onClick={() => removeField(x.id)}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </span>
                                )}
                              </article>
                            ))}
                          </div>
                          <h3>Привязки</h3>
                          <div className="binding-list">
                            {bindings.map((b: any) => (
                              <article key={b.id}>
                                <span>
                                  <b>
                                    {schema?.fields.find(
                                      (x: any) => x.id === b.field_id,
                                    )?.label || "Без вопроса"}
                                  </b>
                                  <small>
                                    Вхождение {b.occurrence_index}: «
                                    {b.selected_text}»
                                  </small>
                                </span>
                                {version.status === "DRAFT" && (
                                  <button
                                    aria-label="Удалить привязку"
                                    onClick={() => unbind(b.id)}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </article>
                            ))}
                          </div>
                          <h3>Условные области</h3>
                          <div className="binding-list region-list">
                            {regions.length === 0 && <p className="region-empty">Области ещё не настроены.</p>}
                            {regions.map((r:any) => <article key={r.id}><span><b>{r.region_key}</b><small>{REGION_LABELS[r.region_type]}</small></span>{version.status === "DRAFT" && <span><button aria-label="Изменить условную область" onClick={() => setRegionDraft({...r})}><Pencil size={14}/></button><button aria-label="Удалить условную область" onClick={() => removeRegion(r.id)}><Trash2 size={14}/></button></span>}</article>)}
                          </div>
                          {version.status === "DRAFT" && (
                            <button
                              className="publish"
                              onClick={publish}
                              disabled={busy}
                            >
                              <Send size={15} />
                              Проверить и опубликовать
                            </button>
                          )}
                          {version.status === "PUBLISHED" && (
                            <p className="binding-ok">
                              <CheckCircle2 />
                              Версия доступна сотрудникам.
                            </p>
                          )}
                        </aside>
                      </div>
                    </>
                  ) : (
                    <Empty upload />
                  )}
                </section>
              </div>
            </>
          )}
        </main>
      </section>
    </div>
  );
}

const OPS: any = {
  EQUALS: "равно",
  NOT_EQUALS: "не равно",
  IN: "входит в список",
  NOT_IN: "не входит в список",
  IS_EMPTY: "не заполнено",
  IS_NOT_EMPTY: "заполнено",
  GREATER_THAN: "больше",
  LESS_THAN: "меньше",
  GREATER_OR_EQUAL: "больше или равно",
  LESS_OR_EQUAL: "меньше или равно",
};
const REGION_LABELS:any={CONDITIONAL_RUN:"Фрагмент текста",CONDITIONAL_PARAGRAPH:"Абзац",CONDITIONAL_PARAGRAPH_GROUP:"Блок соседних абзацев",CONDITIONAL_TABLE_ROW:"Строка таблицы",CONDITIONAL_TABLE:"Таблица"};
function regionHasNode(region:any,node:string){let loc=region.locator;if(region.region_type==="CONDITIONAL_RUN"||region.region_type==="CONDITIONAL_PARAGRAPH")return loc.node===node;if(region.region_type==="CONDITIONAL_PARAGRAPH_GROUP")return loc.nodes.includes(node);let prefix=`${loc.part}#/tbl[${loc.table}]`;return node.startsWith(region.region_type==="CONDITIONAL_TABLE_ROW"?`${prefix}/tr[${loc.row}]`:prefix)}
const rowFrom = (x: any) => {
  let neg = x?.operator === "NOT",
    n = neg ? x.condition : x;
  return {
    field_key: n?.field_key || "",
    operator: n?.operator || "EQUALS",
    value: Array.isArray(n?.value) ? n.value.join(", ") : (n?.value ?? ""),
    negated: neg,
  };
};
const rowsFrom = (value: any) =>
  !value
    ? []
    : (value.operator === "AND" || value.operator === "OR"
        ? value.conditions
        : [value]
      ).map(rowFrom);
function ConditionEditor({ title, value, fields, change }: any) {
  const rows = rowsFrom(value),
    join = value?.operator === "OR" ? "OR" : "AND";
  function emit(next: any[], group = join) {
    if (!next.length) return change(null);
    let nodes = next.map((r) => {
      let source = fields.find((f: any) => f.field_key === r.field_key),
        raw: any = r.value;
      if (["INTEGER"].includes(source?.field_type))
        raw = Number.parseInt(raw, 10);
      else if (["DECIMAL", "MONEY"].includes(source?.field_type))
        raw = Number(raw);
      else if (source?.field_type === "BOOLEAN") raw = raw === "true";
      if (["IN", "NOT_IN"].includes(r.operator))
        raw = String(r.value)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) =>
            ["INTEGER", "DECIMAL", "MONEY"].includes(source?.field_type)
              ? Number(x)
              : source?.field_type === "BOOLEAN"
                ? x === "true"
                : x,
          );
      let node: any = { operator: r.operator, field_key: r.field_key };
      if (!["IS_EMPTY", "IS_NOT_EMPTY"].includes(r.operator)) node.value = raw;
      return r.negated ? { operator: "NOT", condition: node } : node;
    });
    change(
      nodes.length === 1 ? nodes[0] : { operator: group, conditions: nodes },
    );
  }
  return (
    <fieldset className="condition-editor">
      <legend>
        <GitBranch size={14} />
        {title}
      </legend>
      {!rows.length ? (
        <button
          type="button"
          className="condition-add"
          onClick={() =>
            emit([
              {
                field_key: fields[0]?.field_key || "",
                operator: "EQUALS",
                value: "",
                negated: false,
              },
            ])
          }
          disabled={!fields.length}
        >
          <Plus size={14} />
          Добавить условие
        </button>
      ) : (
        <>
          <label>
            Объединение
            <select
              value={join}
              onChange={(e) => emit(rows, e.target.value)}
              disabled={rows.length < 2}
            >
              <option value="AND">Все условия (И)</option>
              <option value="OR">Любое условие (ИЛИ)</option>
            </select>
          </label>
          {rows.map((row: any, index: number) => (
            <ConditionRow
              key={index}
              row={row}
              fields={fields}
              change={(next: any) => {
                let copy = [...rows];
                copy[index] = next;
                emit(copy);
              }}
              remove={() =>
                emit(rows.filter((_: any, i: number) => i !== index))
              }
            />
          ))}
          <button
            type="button"
            className="condition-add"
            onClick={() =>
              emit([
                ...rows,
                {
                  field_key: fields[0]?.field_key || "",
                  operator: "EQUALS",
                  value: "",
                  negated: false,
                },
              ])
            }
          >
            <Plus size={14} />
            Добавить условие
          </button>
        </>
      )}
    </fieldset>
  );
}
function ConditionRow({ row, fields, change, remove }: any) {
  let source = fields.find((x: any) => x.field_key === row.field_key),
    ordered = ["INTEGER", "DECIMAL", "MONEY", "DATE"].includes(
      source?.field_type,
    ),
    ops = Object.entries(OPS).filter(
      ([k]) =>
        ordered ||
        ![
          "GREATER_THAN",
          "LESS_THAN",
          "GREATER_OR_EQUAL",
          "LESS_OR_EQUAL",
        ].includes(k),
    ),
    noValue = ["IS_EMPTY", "IS_NOT_EMPTY"].includes(row.operator);
  return (
    <div className="condition-row">
      <label>
        Поле
        <select
          required
          value={row.field_key}
          onChange={(e) =>
            change({ ...row, field_key: e.target.value, value: "" })
          }
        >
          {fields.map((x: any) => (
            <option key={x.id} value={x.field_key}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Оператор
        <select
          value={row.operator}
          onChange={(e) => change({ ...row, operator: e.target.value })}
        >
          {ops.map(([k, v]) => (
            <option key={k} value={k}>
              {v as string}
            </option>
          ))}
        </select>
      </label>
      {!noValue && (
        <label>
          Значение
          {source?.field_type === "SINGLE_SELECT" ? (
            <select
              value={row.value}
              onChange={(e) => change({ ...row, value: e.target.value })}
            >
              <option value="">Выберите значение</option>
              {source.config.options.map((x: string) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          ) : source?.field_type === "BOOLEAN" ? (
            <select
              value={String(row.value)}
              onChange={(e) => change({ ...row, value: e.target.value })}
            >
              <option value="true">Да</option>
              <option value="false">Нет</option>
            </select>
          ) : (
            <input
              required
              type={
                source?.field_type === "DATE"
                  ? "date"
                  : ordered
                    ? "number"
                    : "text"
              }
              value={row.value}
              onChange={(e) => change({ ...row, value: e.target.value })}
              placeholder={
                ["IN", "NOT_IN"].includes(row.operator)
                  ? "Значения через запятую"
                  : ""
              }
            />
          )}
        </label>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={row.negated}
          onChange={(e) => change({ ...row, negated: e.target.checked })}
        />
        Отрицание (НЕ)
      </label>
      <button
        type="button"
        className="condition-remove"
        aria-label="Удалить условие"
        onClick={remove}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
function Empty({ upload = false }: { upload?: boolean }) {
  return (
    <section className="platform-empty">
      <FileText />
      <h2>{upload ? "Загрузите исходный DOCX" : "Выберите шаблон"}</h2>
      <p>
        {upload
          ? "Оригинал сохранится неизменяемым."
          : "Здесь появятся версии и настройки анкеты."}
      </p>
    </section>
  );
}
function paint(text:string,items:any[],fields:any[],conditional:any[]=[]){
 const ranges=[...items.map(b=>({start:b.locator.text_start,end:b.locator.text_end,kind:"binding",title:fields.find(x=>x.id===b.field_id)?.label||"Привязка"})),...conditional.map(r=>({start:r.locator.text_start,end:r.locator.text_end,kind:"conditional",title:`Условная область: ${r.region_key}`}))];
 if(!ranges.length)return text;
 const points=[...new Set([0,text.length,...ranges.flatMap(r=>[r.start,r.end])])].sort((a,b)=>a-b);
 return points.slice(0,-1).map((start,index)=>{let end=points[index+1],active=ranges.filter(r=>r.start<=start&&r.end>=end),value=text.slice(start,end);if(!active.length)return value;return <mark key={`${start}-${end}`} className={active.some(r=>r.kind==="conditional")?"conditional-run":""} title={active.map(r=>r.title).join(" · ")}>{value}</mark>});
}
