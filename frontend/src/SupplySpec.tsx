import { Download, FileText } from 'lucide-react'

export function SupplySpec({c,s,download}:{c:any,s:any,download:(path:string,name:string)=>void}) {
  const d=s.data
  const vat=d.vat_mode==='VAT_PAYER'?`НДС ${d.vat_rate||'—'}%`:d.vat_mode==='NO_VAT'?`Без НДС · ${d.vat_basis||'основание уточняется'}`:'Уточняется'
  return <aside className="context">
    <section className="contextblock">
      <header><div><FileText/><span><h3>Техническое задание</h3><p>{s.status==='CONFIRMED'?'Подтверждено':'ТЗ на поставку · версия '+s.version}</p></span></div></header>
      <section className="spec">
        <article><h3>Позиции: {d.items?.length||0}</h3></article>
        {d.items?.map((item:any,i:number)=><article className="items" key={i}><div><b>{i+1}. {item.description||'Позиция уточняется'}</b><p>Кол-во: {item.quantity||'—'}<br/>Цена: {item.unit_price?`${item.unit_price} ${d.currency||''}`:'—'}<br/>Производитель: {item.manufacturer||'—'}</p><small>Гарантия: {item.warranty_term||'—'}</small></div></article>)}
        <article><h3>Доставка</h3><p>{d.delivery_address||'Уточняется'}</p></article>
        <article><h3>НДС</h3><p>{vat}</p></article>
        <article><h3>Срок</h3><p>{d.delivery_term||'Уточняется'}</p></article>
        <article><h3>Техподдержка</h3><p>{d.support_required===true?d.support_services||'Требуется':d.support_required===false?'Не требуется':'Уточняется'}</p></article>
      </section>
      {s.status==='CONFIRMED'&&<div className="specbuttons exports"><button className="primary" onClick={()=>download('/cases/'+c.id+'/technical-specification/download?format=docx','Техническое_задание_на_поставку.docx')}><Download size={15}/>Сформировать и скачать DOCX</button></div>}
    </section>
  </aside>
}
