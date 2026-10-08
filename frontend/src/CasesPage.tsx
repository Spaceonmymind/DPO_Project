import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import "./cases-page.css";

type CaseItem = { id: string; title: string; state: string };

export function CasesPage({cases,statuses,onOpen}:{cases:CaseItem[];statuses:Record<string,string>;onOpen:(id:string)=>void}) {
  const [query,setQuery]=useState("");
  const [status,setStatus]=useState("ALL");
  const visible=useMemo(()=>cases.filter(item=>
    (status==="ALL"||item.state===status)&&item.title.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"))
  ),[cases,query,status]);

  return <section className="cases-page">
    <div className="cases-heading">
      <div><p>РАБОЧЕЕ ПРОСТРАНСТВО</p><h1>Мои обращения</h1><span>Все созданные обращения и их текущие статусы</span></div>
      <b>{visible.length}</b>
    </div>
    <div className="cases-tools">
      <label className="cases-search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Поиск по обращениям…"/></label>
      <select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Фильтр по статусу">
        <option value="ALL">Все статусы</option>
        {Object.entries(statuses).map(([value,label])=><option value={value} key={value}>{label}</option>)}
      </select>
    </div>
    <div className="cases-list">
      {visible.map(item=><button className="case-card" key={item.id} onClick={()=>onOpen(item.id)}>
        <span>{item.title}</span><small className={`case-status status-${item.state.toLowerCase()}`}>{statuses[item.state]}</small>
      </button>)}
      {!visible.length&&<div className="cases-empty"><b>Ничего не найдено</b><span>Попробуйте изменить запрос или выбрать другой статус.</span></div>}
    </div>
  </section>;
}
