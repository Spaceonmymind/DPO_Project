import React from 'react';
import {GraduationCap,CheckCircle2,Play} from 'lucide-react';
import {tours,type TourId} from './tourDefinitions';
export function OnboardingLauncher({manager,progress,start}:{manager:boolean;progress:Record<string,{version:number;status:string}>;start:(id:TourId)=>void}){
 const ids:TourId[]=manager?['T3','T2','T4']:['T1','T2'];
 return <div className="page learning-page"><header className="pagehead"><div><p>ПОМОЩЬ ПО ПЛАТФОРМЕ</p><h1>Обучение</h1><span>Выберите раздел и пройдите интерактивную экскурсию по интерфейсу.</span></div></header><div className="learning-grid">{ids.map(id=><article key={id}><GraduationCap aria-hidden="true"/><h2>{tours[id].title}</h2><p>{tours[id].description}</p>{progress[id]?.version===1&&<span className="learning-done"><CheckCircle2 size={16}/>Пройдено</span>}<button type="button" className="primary" onClick={()=>start(id)}><Play size={16}/>{progress[id]?.version===1?'Пройти заново':'Начать обучение'}</button></article>)}</div></div>
}
