import React, { useEffect, useState } from "react";
import { Copy, Download, FileText, FolderOpen, Pencil, RefreshCw } from "lucide-react";

type Api = (path: string, options?: any) => Promise<any>;
type Row = { id: string; kind: "template" | "product"; title: string; template_name?: string; product_name?: string; created_at: string; updated_at: string; generated?: string | null; status: string };

export function MyDocuments({ api, go }: { api: Api; go: (path: string) => void }) {
  const [items, setItems] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ mode: "copy" | "rename"; item: Row } | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  async function reload() {
    const [templates, products] = await Promise.all([api("/contract-drafts"), api("/contract-product-drafts")]);
    setItems([...templates.map((item: any) => ({ ...item, kind: "template" as const })), ...products.map((item: any) => ({ ...item, kind: "product" as const }))].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
  }
  useEffect(() => { reload().catch((e) => setError(e.message)); }, []);
  const draftPath = (item: Row) => item.kind === "product" ? `/contract-product-drafts/${item.id}` : `/contract-drafts/${item.id}`;
  const editPath = (item: Row) => item.kind === "product" ? `/contracts?productDraft=${item.id}` : `/contracts?draft=${item.id}`;
  function openDialog(mode: "copy" | "rename", item: Row) {
    setDialog({ mode, item });
    setTitle(mode === "copy" ? `Копия — ${item.title || item.product_name || item.template_name}`.slice(0, 200) : item.title || item.product_name || item.template_name || "");
    setError("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dialog) return;
    const clean = title.trim();
    if (!clean || clean.length > 200) { setError("Название должно содержать от 1 до 200 символов."); return; }
    setBusy(true); setError("");
    try {
      const path = `${draftPath(dialog.item)}/${dialog.mode === "copy" ? "duplicate" : "title"}`;
      const result = await api(path, { method: dialog.mode === "copy" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: clean }) });
      setDialog(null);
      if (dialog.mode === "copy") go(dialog.item.kind === "product" ? `/contracts?productDraft=${result.id}` : `/contracts?draft=${result.id}`);
      else await reload();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="page documents-page">
    <header className="pagehead"><div><p>МОЁ РАБОЧЕЕ ПРОСТРАНСТВО</p><h1>Мои документы</h1><span>Черновики анкет и сформированные договоры доступны только вам.</span></div><button className="primary" onClick={() => go("/contracts")}>Создать договор</button></header>
    {error && <div className="platform-error" role="alert">{error}</div>}
    {items.length ? <section className="documents-list"><header><span>Документ</span><span>Статус</span><span>Действия</span></header>{items.map((item) => <article key={`${item.kind}-${item.id}`}>
      <FileText aria-hidden="true"/><span><b>{item.title || item.product_name || item.template_name}</b><small>Создан {new Date(item.created_at).toLocaleDateString("ru-RU")}</small></span>
      <em className={item.generated ? "ready" : "draft"}>{item.generated ? "Сформирован" : "Черновик"}</em>
      <div>{!item.generated && <button type="button" className="secondary" onClick={() => go(editPath(item))}><RefreshCw size={14}/>Продолжить</button>}<button type="button" className="secondary" onClick={() => openDialog("copy", item)}><Copy size={14}/>Дублировать</button><button type="button" className="secondary" onClick={() => openDialog("rename", item)}><Pencil size={14}/>Переименовать</button>{item.generated && <a className="secondary" href={`/api/v1/generated-documents/${item.generated}/download`}><Download size={14}/>Скачать</a>}</div>
    </article>)}</section> : <section className="documents-empty"><FolderOpen/><h2>Документов пока нет</h2><p>Выберите договор в каталоге и начните заполнение анкеты.</p><button className="primary" onClick={() => go("/contracts")}>Открыть каталог</button></section>}
    {dialog && <div className="document-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><form className="document-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="document-dialog-title" onKeyDown={(event) => { if (event.key === "Escape") setDialog(null); }}><h2 id="document-dialog-title">{dialog.mode === "copy" ? "Дублировать документ" : "Переименовать документ"}</h2><label htmlFor="document-title">Название документа</label><input id="document-title" autoFocus maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} required/><div className="form-actions"><button type="button" className="secondary" onClick={() => setDialog(null)}>Отмена</button><button className="primary" disabled={busy}>{dialog.mode === "copy" ? "Создать копию" : "Сохранить"}</button></div></form></div>}
  </div>;
}
