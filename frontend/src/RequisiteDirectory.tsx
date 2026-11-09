import { useEffect, useState, type FormEvent } from "react";
import "./requisite-directory.css";

type Entry = { key: string; label: string; value: string };
type SetItem = { id: string; name: string; status: "ACTIVE" | "ARCHIVED"; revision: number; entries: Entry[] };
const empty = (): SetItem => ({ id: "", name: "", status: "ACTIVE", revision: 0, entries: [] });

export function RequisiteDirectory({ api }: { api: (path: string, options?: any) => Promise<any> }) {
  const [items, setItems] = useState<SetItem[]>([]);
  const [draft, setDraft] = useState<SetItem | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = () => api("/requisite-sets?include_archived=true").then(setItems);
  useEffect(() => { reload().catch((cause) => setError(cause.message)); }, [api]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api(draft!.id ? `/requisite-sets/${draft!.id}` : "/requisite-sets", {
        method: draft!.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft!.name, entries: draft!.entries, ...(draft!.id ? { revision: draft!.revision } : {}) }),
      });
      await reload(); setDraft(null);
    } catch (cause: any) { setError(cause.message); } finally { setBusy(false); }
  }
  async function archive(item: SetItem) {
    if (!window.confirm(`Архивировать набор «${item.name}»?`)) return;
    setBusy(true); setError("");
    try { await api(`/requisite-sets/${item.id}/archive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: item.revision }) }); await reload(); if (draft?.id === item.id) setDraft(null); }
    catch (cause: any) { setError(cause.message); } finally { setBusy(false); }
  }
  const editEntry = (index: number, patch: Partial<Entry>) => setDraft(current => current && ({ ...current, entries: current.entries.map((entry, position) => position === index ? { ...entry, ...patch } : entry) }));
  return <main className="page requisite-directory"><header className="pagehead"><div><p>АДМИНИСТРИРОВАНИЕ</p><h1>Справочник реквизитов</h1><span>Значения копируются в новую анкету и затем редактируются сотрудником независимо от справочника.</span></div><button type="button" className="primary" onClick={() => { setDraft(empty()); setError(""); }}>Создать набор</button></header>
    {error && <div className="platform-error" role="alert">{error}</div>}
    <div className="requisite-layout"><section><label>Поиск по названию<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти набор"/></label><div className="requisite-list">{items.filter(item => item.name.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru"))).map(item => <article key={item.id}><div><b>{item.name}</b><small>{item.status === "ACTIVE" ? `${item.entries.length} реквизитов` : "Архив"}</small></div><button type="button" className="secondary" onClick={() => { setDraft(structuredClone(item)); setError(""); }}>Просмотреть</button></article>)}{!items.length && <p>Наборов пока нет.</p>}</div></section>
    {draft && <form onSubmit={save}><h2>{draft.id ? draft.name : "Новый набор"}</h2><label>Название набора<input required maxLength={240} value={draft.name} disabled={draft.status === "ARCHIVED"} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label><div className="requisite-entries"><h3>Реквизиты</h3>{draft.entries.map((entry, index) => <div className="requisite-entry" key={index}><label>Ключ<input required pattern="[A-Za-z][A-Za-z0-9_]{1,79}" title="Латинские буквы, цифры и подчёркивание" value={entry.key} disabled={draft.status === "ARCHIVED"} onChange={event => editEntry(index, { key: event.target.value })}/></label><label>Название<input required maxLength={160} value={entry.label} disabled={draft.status === "ARCHIVED"} onChange={event => editEntry(index, { label: event.target.value })}/></label><label>Значение<input maxLength={2000} value={entry.value} disabled={draft.status === "ARCHIVED"} onChange={event => editEntry(index, { value: event.target.value })}/></label>{draft.status === "ACTIVE" && <button type="button" className="secondary" aria-label={`Удалить реквизит ${index + 1}`} onClick={() => setDraft({ ...draft, entries: draft.entries.filter((_, position) => position !== index) })}>Удалить</button>}</div>)}{draft.status === "ACTIVE" && <button type="button" className="secondary" onClick={() => setDraft({ ...draft, entries: [...draft.entries, { key: "", label: "", value: "" }] })}>Добавить реквизит</button>}</div><div className="requisite-actions">{draft.status === "ACTIVE" && <button className="primary" disabled={busy}>Сохранить</button>}<button type="button" className="secondary" onClick={() => setDraft(null)}>Закрыть</button>{draft.id && draft.status === "ACTIVE" && <button type="button" className="secondary" disabled={busy} onClick={() => archive(draft)}>Архивировать</button>}</div></form>}</div></main>;
}
