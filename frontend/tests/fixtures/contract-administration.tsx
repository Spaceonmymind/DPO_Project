import React from 'react';
import { createRoot } from 'react-dom/client';
import { ContractAdministration } from '../../src/ContractAdministration';
let selected=['one'];let completed=['one'];let events:any[]=[];
(window as any).__calls=[];
const owner={id:'user',full_name:'Анна Петрова',external_id:'petrova'};
const item=()=>({id:'draft',title:'Тестовый договор',status:'DRAFT',owner,template:{id:'template',name:'Тренировки'},created_at:'2026-11-25',updated_at:'2026-11-25',completed_count:completed.length,total_stages:3,selected_stage_ids:selected,completed_stage_ids:completed,current_stage:null});
const api=async(path:string,options:any={})=>{
 (window as any).__calls.push([path,options.method||'GET',options.body]);
 if(path.startsWith('/admin/contracts/draft'))return {...item(),can_allow_next:selected.length<3&&selected.every(id=>completed.includes(id)),stages:['one','two','three'].map((id,i)=>({id,name:`Этап ${i+1}`,position:i+1,selected:selected.includes(id),state:!selected.includes(id)?'NOT_CONNECTED':completed.includes(id)?'COMPLETED':id==='one'&&events.some(e=>e.event_type==='UNLOCKED')?'UNLOCKED':id==='two'?'AVAILABLE':'AUTHORIZED'})),events};
 if(path.startsWith('/admin/contracts'))return {items:[item()],total:1,page_size:20};
 if(path.startsWith('/admin/users'))return {items:[{...owner,contract_count:1}],total:1,page_size:20};
 if(path.startsWith('/admin/events'))return {items:events.map(e=>({...e,draft_id:'draft',owner,draft_title:'Тестовый договор',template_name:'Тренировки'})),total:events.length,page_size:20};
 if(path.includes('allow-next')){selected=['one','two','three'];events=[{id:'authorized',stage_name:'Этап 2',event_type:'AUTHORIZED',actor:'Специалист',created_at:'2026-11-25'}];return {};}
 if(path.includes('unlock')){completed=[];events.unshift({id:'unlocked',stage_name:'Этап 1',event_type:'UNLOCKED',actor:'Специалист',reason:JSON.parse(options.body).reason,created_at:'2026-11-25'});return {};}
 throw Error('Unknown API');
};
createRoot(document.getElementById('root')!).render(<ContractAdministration api={api}/>);
