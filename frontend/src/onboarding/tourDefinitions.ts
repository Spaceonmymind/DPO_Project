import content from './tourContent.json';
export type TourId = 'T1' | 'T2' | 'T3' | 'T4';
export type TourStep = { id:string; title:string; body:string; target?:string; route?:string; position:'top'|'bottom'|'left'|'right'|'center'; optional?:boolean; stage?:number; alternative?:string; deferred?:boolean };
const ranges:Record<TourId,string[]> = {
 T1: Array.from({length:14},(_,i)=>`U-${String(i+1).padStart(2,'0')}`),
 T2: Array.from({length:9},(_,i)=>`A-${String(i+1).padStart(2,'0')}`),
 T3: Array.from({length:9},(_,i)=>`D-${String(i+1).padStart(2,'0')}`),
 T4: Array.from({length:16},(_,i)=>`W-${String(i+1).padStart(2,'0')}`),
};
const routeByStep:Record<string,string> = { 'U-09':'/contracts','U-10':'/contracts','U-11':'/contracts','U-12':'/documents','U-13':'/documents','U-14':'/documents','D-06':'/contracts','D-07':'/templates','D-08':'/templates','D-09':'/templates' };
const optional = new Set(['U-11','U-12','U-13','A-04','A-05','A-06','W-03','W-09','W-11']);
const alternatives:Record<string,string> = {'U-10':'Опубликованные шаблоны появятся здесь после их утверждения специалистами ДПО.'};
const stages:Record<string,number> = {'W-10':3,'W-12':3,'W-13':4,'W-14':5,'W-15':6};
function position(raw:string):TourStep['position'] { if(raw.includes('центру'))return 'center'; if(raw.includes('Справа'))return 'right';if(raw.includes('Слева'))return 'left';if(raw.includes('Над'))return 'top';return 'bottom'; }
export const tours:Record<TourId,{title:string;description:string;steps:TourStep[]}> = Object.fromEntries((Object.entries(ranges) as [TourId,string[]][]).map(([id,ids])=>[id,{title:({T1:'Основы платформы',T2:'Заполнение договора',T3:'Основы платформы',T4:'Конструктор шаблонов'} as Record<TourId,string>)[id],description:({T1:'Главная, каталог и документы',T2:'Вопросы, проверка и готовый договор',T3:'Рабочие разделы специалиста ДПО',T4:'Настройка шаблона и привязок Word'} as Record<TourId,string>)[id],steps:ids.map(key=>{const item=content[key as keyof typeof content];const target=item.target.match(/data-tour="([^"]+)"/)?.[1];return {id:key,title:item.title,body:item.body,target,route:routeByStep[key],position:position(item.position),optional:optional.has(key),stage:stages[key],alternative:alternatives[key],deferred:key==='A-08'||key==='A-09'};})}])) as Record<TourId,{title:string;description:string;steps:TourStep[]}>;
