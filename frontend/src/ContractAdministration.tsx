import React, { useCallback, useEffect, useState } from 'react';
import './contract-administration.css';

type Api = (path: string, options?: any) => Promise<any>;
type Tab = 'contracts' | 'users' | 'events';
const label: Record<string, string> = { DRAFT: 'Черновик', READY: 'Готов к формированию', GENERATED: 'DOCX сформирован', ARCHIVED: 'В архиве', COMPLETED: 'Завершён', NOT_CONNECTED: 'Не подключён', AUTHORIZED: 'Разрешён', AVAILABLE: 'Доступен для заполнения', UNLOCKED: 'Разблокирован для исправления', IN_PROGRESS: 'Заполняется', NOT_STARTED: 'Не начат', AUTHORIZED_EVENT: 'Этап разрешён', UNLOCKED_EVENT: 'Этап разблокирован', COMPLETED_EVENT: 'Этап завершён' };
const date = (value?: string) => value ? new Date(value).toLocaleString('ru-RU') : '—';
const params = (values: Record<string, string | number>) => '?' + new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '').map(([key, value]) => [key, String(value)])).toString();

export function ContractAdministration({ api }: { api: Api }) {
  const [tab, setTab] = useState<Tab>('contracts');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState('');
  const [eventType, setEventType] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [userId, setUserId] = useState('');
  const [result, setResult] = useState<{ items: any[]; total: number; page_size: number }>({ items: [], total: 0, page_size: 20 });
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [allowCount, setAllowCount] = useState(1);
  const [unlockStage, setUnlockStage] = useState('');
  const [reason, setReason] = useState('');
  const [revision, setRevision] = useState(0);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const path = tab === 'contracts' ? '/admin/contracts' : tab === 'users' ? '/admin/users' : '/admin/events';
      const data = await api(path + params({ q: search, page, page_size: 20, ...(tab === 'contracts' ? { status, progress, template_id: templateId, user_id: userId } : tab === 'events' ? { event_type: eventType, template_id: templateId, user_id: userId } : {}) }));
      setResult(data);
    } catch (e: any) { setError(e.message || 'Не удалось загрузить данные'); }
    finally { setLoading(false); }
  }, [api, tab, page, search, status, progress, eventType, templateId, userId, revision]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api('/document-templates').then((items: any[]) => setTemplates(items.map(item => ({ id: item.id, name: item.name })))).catch(() => {}); }, [api]);
  useEffect(() => { if (detail?.id) api('/admin/contracts/' + encodeURIComponent(detail.id)).then(setDetail).catch((e: any) => setError(e.message)); }, [api, revision]);
  const open = async (id: string) => {
    setError(''); setNotice('');
    try { setDetail(await api('/admin/contracts/' + encodeURIComponent(id))); setAllowCount(1); setUnlockStage(''); setReason(''); }
    catch (e: any) { setError(e.message || 'Не удалось открыть договор'); }
  };
  const perform = async (path: string, body?: object) => {
    if (busy || !detail) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api('/contract-drafts/' + encodeURIComponent(detail.id) + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      setDetail(await api('/admin/contracts/' + encodeURIComponent(detail.id)));
      setRevision(value => value + 1); setNotice('Изменение сохранено'); setUnlockStage(''); setReason(''); setAllowCount(1);
    } catch (e: any) { setError(e.message || 'Операция не выполнена'); }
    finally { setBusy(false); }
  };
  const changeTab = (next: Tab) => { setResult({ items: [], total: 0, page_size: 20 }); setTab(next); setPage(1); setDetail(null); setError(''); setNotice(''); };
  const maxPage = Math.max(1, Math.ceil(result.total / result.page_size));
  const remaining = detail ? detail.stages.filter((stage: any) => !stage.selected).length : 0;
  return <div className="page contract-admin" data-testid="contract-admin">
    <div className="contract-admin-heading"><div><p className="contract-admin-eyebrow">Администрирование договоров</p><h1>Пользователи и договоры</h1><p>Контроль заполнения, доступности этапов и действий специалистов.</p></div></div>
    <div className="contract-admin-tabs" role="tablist" aria-label="Разделы управления">
      {([['contracts', 'Договоры'], ['users', 'Пользователи'], ['events', 'История действий']] as const).map(([key, title]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => changeTab(key)}>{title}</button>)}
    </div>
    {error && <p className="contract-admin-error" role="alert">{error}</p>}{notice && <p className="contract-admin-notice" role="status">{notice}</p>}
    {detail ? <section className="contract-admin-detail">
      <button className="contract-admin-back" onClick={() => setDetail(null)}>← К списку</button>
      <div className="contract-admin-detail-header"><div><p className="contract-admin-eyebrow">Договор · {detail.id}</p><h2>{detail.title}</h2><p>{detail.owner.full_name} · {detail.owner.external_id} · {detail.template.name}</p></div><span className="contract-admin-badge">{label[detail.status] || detail.status}</span></div>
      <div className="contract-admin-metrics"><div><b>{detail.completed_count} / {detail.total_stages}</b><span>завершено этапов</span></div><div><b>{detail.current_stage?.name || '—'}</b><span>текущий этап</span></div><div><b>{date(detail.updated_at)}</b><span>последнее изменение</span></div></div>
      <h3>Этапы договора</h3><div className="contract-admin-stages">{detail.stages.map((stage: any) => <div className="contract-admin-stage" key={stage.id}><span className="contract-admin-stage-number">{stage.position}</span><div><b>{stage.name}</b><small>{stage.description || (stage.completed_at ? 'Завершён ' + date(stage.completed_at) : 'Без описания')}</small></div><span className={'contract-admin-state state-' + stage.state.toLowerCase()}>{label[stage.state] || stage.state}</span>{stage.state === 'COMPLETED' && <button type="button" className="contract-admin-link" onClick={() => { setUnlockStage(stage.id); setReason(''); }}>Разблокировать</button>}</div>)}</div>
      {detail.can_allow_next && <form className="contract-admin-action" onSubmit={e => { e.preventDefault(); void perform('/stages/allow-next', { count: allowCount }); }}><div><b>Разрешить следующие этапы</b><p>Подключаются только следующие этапы по порядку. Заполнить их пользователь сможет последовательно.</p></div><label>Количество <select value={allowCount} onChange={e => setAllowCount(Number(e.target.value))}>{Array.from({ length: remaining }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label><button className="contract-admin-primary" disabled={busy}>Разрешить</button></form>}
      {unlockStage && <form className="contract-admin-action" onSubmit={e => { e.preventDefault(); void perform('/stages/' + encodeURIComponent(unlockStage) + '/unlock', { reason: reason.trim() }); }}><div><b>Разблокировать этап для исправления</b><p>Ответы сохранятся. Последующие этапы будут обработаны согласно правилам договора.</p></div><label>Причина <textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={1000} /></label><div className="contract-admin-actions"><button type="button" onClick={() => setUnlockStage('')}>Отмена</button><button className="contract-admin-primary" disabled={busy || reason.trim().length < 3}>Подтвердить</button></div></form>}
      <h3>История этапов</h3>{detail.events.length ? <div className="contract-admin-history">{detail.events.map((event: any) => <div key={event.id}><b>{label[event.event_type + '_EVENT'] || event.event_type}</b> · {event.stage_name}<small>{date(event.created_at)} · {event.actor}{event.reason ? ' · Причина: ' + event.reason : ''} · Выполнено</small></div>)}</div> : <p className="contract-admin-empty">Действий по этапам пока нет.</p>}
    </section> : <>
      <form className="contract-admin-filters" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(query); }}><label>Поиск<input value={query} onChange={e => setQuery(e.target.value)} placeholder={tab === 'users' ? 'ФИО или идентификатор' : 'Пользователь или договор'} /></label>{tab === 'contracts' && <><label>Статус<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Все</option><option value="DRAFT">Черновик</option><option value="READY">Готов к формированию</option><option value="GENERATED">DOCX сформирован</option><option value="ARCHIVED">В архиве</option></select></label><label>Прогресс<select value={progress} onChange={e => { setProgress(e.target.value); setPage(1); }}><option value="">Любой</option><option value="NOT_STARTED">Не начат</option><option value="IN_PROGRESS">В процессе</option><option value="COMPLETED">Завершены подключённые</option></select></label></>}{tab === 'events' && <label>Событие<select value={eventType} onChange={e => { setEventType(e.target.value); setPage(1); }}><option value="">Все</option><option value="AUTHORIZED">Разрешение</option><option value="UNLOCKED">Разблокировка</option><option value="COMPLETED">Завершение</option></select></label>}{tab !== 'users' && <label>Шаблон<select value={templateId} onChange={e => { setTemplateId(e.target.value); setPage(1); }}><option value="">Все шаблоны</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<button className="contract-admin-primary">Найти</button></form>
      <div className="contract-admin-list" role="tabpanel">{loading ? <p className="contract-admin-empty">Загрузка…</p> : result.items.length === 0 ? <p className="contract-admin-empty">Ничего не найдено.</p> : tab === 'contracts' ? <div className="contract-admin-table-wrap"><table><thead><tr><th>Пользователь</th><th>Договор</th><th>Статус</th><th>Прогресс</th><th>Текущий этап</th><th>Создан / изменён</th></tr></thead><tbody>{result.items.map(item => <tr key={item.id} onClick={() => void open(item.id)}><td><b>{item.owner.full_name}</b><small>{item.owner.external_id}</small></td><td><button className="contract-admin-link" onClick={e => { e.stopPropagation(); void open(item.id); }}>{item.title}</button><small>{item.template.name} · {item.id.slice(0, 8)}</small></td><td>{label[item.status] || item.status}</td><td>{item.completed_count} из {item.total_stages}</td><td>{item.current_stage?.name || '—'}</td><td>{date(item.created_at)}<small>{date(item.updated_at)}</small></td></tr>)}</tbody></table></div> : tab === 'users' ? <div className="contract-admin-users">{result.items.map(item => <button key={item.id} onClick={() => { setResult({ items: [], total: 0, page_size: 20 }); setUserId(item.id); setTab('contracts'); setPage(1); }}><span><b>{item.full_name}</b><small>{item.external_id} · Завершено {item.completed_stages ?? 0} из {item.connected_stages ?? 0} подключённых этапов</small></span><strong>{item.contract_count} договоров →</strong></button>)}</div> : <div className="contract-admin-history">{result.items.map(item => <button key={item.id} onClick={() => void open(item.draft_id)}><b>{label[item.event_type + '_EVENT'] || item.event_type} · {item.stage_name}</b><span>{item.owner.full_name} · {item.draft_title} · {item.template_name}</span><small>{date(item.created_at)} · {item.actor}{item.reason ? ' · Причина: ' + item.reason : ''} · Выполнено</small></button>)}</div>}</div>
      <div className="contract-admin-pagination"><span>Всего: {result.total}</span><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Назад</button><span>{page} / {maxPage}</span><button disabled={page >= maxPage} onClick={() => setPage(page + 1)}>Далее</button></div>
    </>}
  </div>;
}
