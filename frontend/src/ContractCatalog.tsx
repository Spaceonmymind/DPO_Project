import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { evaluateCondition, fieldState } from "./conditions";
import { calculateAnswers } from "./calculations";
import { ProductQuestionnaire } from "./ProductQuestionnaire";
type Api = (path: string, options?: any) => Promise<any>;
const itemId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function ContractCatalog({ api, go, manager = false }: { api: Api; go?: (path: string) => void; manager?: boolean }) {
  const [catalog, setCatalog] = useState<any[]>([]),
    [products, setProducts] = useState<any[]>([]),
    [productDrafts, setProductDrafts] = useState<any[]>([]),
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
    [loading, setLoading] = useState(true);
  const autosaveReady = useRef(false);
  const savedSnapshot = useRef("{}");
  async function load() {
    let [c, d, p, pd] = await Promise.all([
      api("/contract-catalog"),
      api("/contract-drafts"),
      api("/contract-product-catalog"),
      api("/contract-product-drafts"),
    ]);
    setCatalog(c);
    setDrafts(d);
    setProducts(p);
    setProductDrafts(pd);
  }
  useEffect(() => {
    load()
      .then(async () => {
        const id = new URLSearchParams(location.search).get("draft");
        if (id) await restore(id);
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
          .catch((e: any) =>
            setError(`Автосохранение не выполнено: ${e.message}`),
          ),
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
      let detail = e.message;
      try {
        let parsed = JSON.parse(detail);
        setErrors(parsed.fields || {});
        detail = parsed.message || detail;
      } catch {}
      setError(detail);
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
  async function beginProduct(product_id: string) {
    await run(async () =>
      setProductDraft(await api("/contract-product-drafts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id }),
      })),
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
    setTimeout(() => {
      autosaveReady.current = true;
    }, 0);
  }
  function groupActive(g: any) {
    return evaluateCondition(g.config?.visible_when, answers);
  }
  function validate() {
    let e: any = {};
    draft.schema.fields.forEach((f: any) => {
      if (f.config?.calculated) return;
      let state = fieldState(f, answers);
      if (!state.visible) return;
      let value = answers[f.field_key],
        v = f.config?.validation || {};
      if (
        state.required &&
        (value === undefined || value === null || value === "")
      )
        e[f.field_key] = "Обязательное поле";
      if (
        typeof value === "string" &&
        v.min_length &&
        value.length < v.min_length
      )
        e[f.field_key] = `Минимум ${v.min_length} символов`;
    });
    (draft.schema.repeating_groups || []).forEach((g: any) => {
      if (!groupActive(g)) return;
      let items = answers[g.group_key] || [],
        minimum = Math.max(g.min_items, g.required ? 1 : 0);
      if (items.length < minimum)
        e[g.group_key] = `Добавьте минимум ${minimum} записей`;
      else if (items.length > g.max_items)
        e[g.group_key] = `Можно добавить не больше ${g.max_items} записей`;
      else
        items.some((item: any, index: number) =>
          g.fields.some((f: any) => {
            if (
              !f.config?.calculated &&
              f.required &&
              (item[f.field_key] === undefined ||
                item[f.field_key] === null ||
                item[f.field_key] === "")
            ) {
              e[g.group_key] =
                `Запись № ${index + 1}: заполните поле «${f.label}»`;
              return true;
            }
            return false;
          }),
        );
    });
    setErrors(e);
    return !Object.keys(e).length;
  }
  async function save() {
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
      [...products.map((x) => ({ ...x, product: true })), ...catalog].filter((x) =>
        (x.name + " " + x.category + " " + x.description)
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [catalog, products, query],
  );
  const calculated: any = draft
    ? calculateAnswers(draft.schema, answers)
    : { values: {}, groups: {}, errors: {} };
  const activeFields = draft
    ? draft.schema.fields.filter((f: any) => fieldState(f, answers).visible && !f.config?.calculated)
    : [];
  const completedFields = activeFields.filter((f: any) => {
    const value = answers[f.field_key];
    return value !== undefined && value !== null && value !== "";
  }).length;
  const progress = activeFields.length ? Math.round((completedFields / activeFields.length) * 100) : 100;
  if (productDraft)
    return <ProductQuestionnaire api={api} initial={productDraft} close={() => setProductDraft(undefined)} reload={load} />;
  if (draft)
    return (
      <div className="page contract-questionnaire">
        <button className="back-link" onClick={() => setDraft(null)}>
          <ArrowLeft size={16} />К каталогу
        </button>
        <header className="pagehead">
          <div>
            <p>{draft.template.category}</p>
            <h1>{draft.template.name}</h1>
            <span>Заполните вопросы. Изменения сохраняются автоматически.</span>
          </div>
        </header>
        <section className="questionnaire-progress" aria-label="Прогресс заполнения">
          <div><b>{review ? "Шаг 2 из 2 · Проверка" : "Шаг 1 из 2 · Анкета"}</b><span>{progress}% заполнено</span></div>
          <progress max="100" value={progress}>{progress}%</progress>
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
        <form className="dynamic-form" onSubmit={review ? generate : (event) => { event.preventDefault(); if (validate()) setReview(true); }}>
          {review && <section className="answers-review"><h2>Проверьте ответы</h2><p>Платформа сформирует документ из закреплённой версии шаблона. При необходимости вернитесь к анкете.</p>{activeFields.map((f:any)=><div key={f.id}><span>{f.label}</span><b>{String(answers[f.field_key] ?? "—")}</b></div>)}</section>}
          {!review && <>
          {groups(
            draft.schema.fields.filter(
              (f: any) => fieldState(f, answers).visible,
            ),
          ).map(([group, fields]: any) => (
            <fieldset key={group}>
              <legend>{group}</legend>
              {fields.map((f: any) => (
                <Question
                  key={f.id}
                  field={f}
                  required={fieldState(f, answers).required}
                  value={
                    f.config?.calculated
                      ? calculated.values[f.field_key]
                      : answers[f.field_key]
                  }
                  error={errors[f.field_key] || calculated.errors?.[f.field_key]}
                  change={(value: any) => {
                    setAnswers({ ...answers, [f.field_key]: value });
                    setErrors({ ...errors, [f.field_key]: undefined });
                  }}
                />
              ))}
            </fieldset>
          ))}
          {(draft.schema.repeating_groups || [])
            .filter(groupActive)
            .map((g: any) => (
              <RepeatingGroupForm
                key={g.id}
                group={g}
                items={answers[g.group_key] || []}
                calculatedItems={calculated.groups[g.group_key] || []}
                calculationErrors={calculated.errors || {}}
                error={errors[g.group_key]}
                add={() => addItem(g)}
                remove={(i: number) =>
                  setItems(
                    g,
                    (answers[g.group_key] || []).filter(
                      (_: any, n: number) => n !== i,
                    ),
                  )
                }
                move={(i: number, o: number) => moveItem(g, i, o)}
                change={(i: number, k: string, v: any) =>
                  changeItem(g, i, k, v)
                }
              />
            ))}
          </>}
          <div className="form-actions">
            {review && <button type="button" className="secondary" onClick={() => setReview(false)}><ArrowLeft size={16}/>Вернуться к анкете</button>}
            <button
              type="button"
              className="secondary"
              onClick={save}
              disabled={busy}
            >
              <Save size={16} />
              Сохранить ответы
            </button>
            <button className="primary" disabled={busy}>
              {review ? "Сформировать DOCX" : "Перейти к проверке"}
            </button>
          </div>
          {document && (
            <a className="document-ready" href={document.download_url}>
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
      <label className="catalog-search">
        <Search size={17} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти договор по названию или категории"
        />
      </label>
      <section className="contract-cards">
        {filtered.map((x) => (
          <article key={x.id}>
            <FileText />
            <small>{x.category}</small>
            <h2>{x.name}</h2>
            <p>
              {x.description || "Утверждённый корпоративный шаблон договора."}
            </p>
            <button className="primary" onClick={() => x.product ? beginProduct(x.id) : begin(x.id)}>
              Заполнить договор
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
        <section className="saved-drafts">
          <h2>Продолжить заполнение</h2>
          {drafts.map((x) => (
            <button key={x.id} onClick={() => restore(x.id)}>
              <span>
                <b>{x.template_name}</b>
                <small>
                  {x.generated_stale
                    ? "Ответы изменены — сформируйте новую версию"
                    : x.status === "GENERATED"
                      ? "Документ сформирован"
                      : "Черновик сохранён"}
                </small>
              </span>
              <span>Продолжить</span>
            </button>
          ))}
        </section>
      )}
      {productDrafts.length > 0 && (
        <section className="saved-drafts">
          <h2>Черновики договорных продуктов</h2>
          {productDrafts.map((x: any) => (
            <button key={x.id} onClick={() => restoreProduct(x.id)}>
              <span><b>{x.product_name}</b><small>Единая анкета · {x.decision?.state === "SELECTED" ? "вариант определён" : "продолжите заполнение"}</small></span>
              <span>Продолжить</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
function RepeatingGroupForm({
  group,
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
        className="condition-add"
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
  fields.forEach((f) => {
    let key = f.config?.group || "Основные сведения";
    map.set(key, [...(map.get(key) || []), f]);
  });
  return [...map.entries()];
}
function Question({ field, value, error, change, required }: any) {
  let id = `field-${field.id}`,
    common = {
      id,
      value: value ?? "",
      onChange: (e: any) => change(e.target.value),
      placeholder: field.config?.placeholder,
      required,
      "aria-invalid": !!error,
      "aria-describedby": error ? id + "-error" : undefined,
    };
  if (field.config?.calculated)
    return (
      <output className={`calculated-value ${error ? "invalid" : ""}`} aria-live="polite">
        <span>{field.label}</span>
        <b>{error || (value ?? 0)}</b>
        <small>{error ? "Проверьте исходные значения" : "Рассчитывается автоматически"}</small>
      </output>
    );
  if(field.field_type==="LIST"){let items=Array.isArray(value)?value:[];return <fieldset className={error?"invalid":""}><legend>{field.label}{required&&<i>Обязательно</i>}</legend>{items.map((x:string,i:number)=><div key={i} className="repeat-item"><input value={x} onChange={e=>change(items.map((v:string,n:number)=>n===i?e.target.value:v))}/><button type="button" onClick={()=>change(items.filter((_:string,n:number)=>n!==i))}>Удалить</button><button type="button" disabled={i===0} onClick={()=>{let a=[...items];[a[i-1],a[i]]=[a[i],a[i-1]];change(a)}}>Выше</button></div>)}<button type="button" onClick={()=>change([...items,""])} disabled={items.length>=(field.config?.item_config?.max_items??20)}>Добавить</button>{error&&<b>{error}</b>}</fieldset>}
  if(field.field_type==="COMPOSITE"){let object=value&&typeof value==="object"?value:{};return <fieldset className={error?"invalid":""}><legend>{field.label}{required&&<i>Обязательно</i>}</legend><CompositeInputs components={field.config?.components||[]} value={object} change={change}/>{error&&<b>{error}</b>}</fieldset>}
  return (
    <label className={error ? "invalid" : ""}>
      <span>
        {field.label}
        {required && <i>Обязательное</i>}
      </span>
      {field.config?.description && <small>{field.config.description}</small>}
      {field.field_type === "MULTILINE_TEXT" ? (
        <textarea {...common} />
      ) : field.field_type === "BOOLEAN" ? (
        <select
          {...common}
          value={value === undefined ? "" : String(value)}
          onChange={(e) =>
            change(e.target.value === "" ? "" : e.target.value === "true")
          }
        >
          <option value="">Выберите ответ</option>
          <option value="true">Да</option>
          <option value="false">Нет</option>
        </select>
      ) : field.field_type === "SINGLE_SELECT" ? (
        <select {...common}>
          <option value="">Выберите значение</option>
          {(field.config?.options || []).map((x: string) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      ) : (
        <input
          {...common}
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
      )}{" "}
      {error && <b id={id + "-error"}>{error}</b>}
    </label>
  );
}
function CompositeInputs({components,value,change}:any){return <>{components.map((x:any)=>x.type==="COMPOSITE"?<fieldset key={x.key}><legend>{x.label}</legend><CompositeInputs components={x.components||[]} value={value[x.key]||{}} change={(nested:any)=>change({...value,[x.key]:nested})}/></fieldset>:<label key={x.key}><span>{x.label}{x.required&&<i>Обязательно</i>}</span><input type={x.type==="DATE"?"date":x.type==="INTEGER"?"number":"text"} value={value[x.key]??""} onChange={e=>change({...value,[x.key]:e.target.value})}/></label>)}</>}
