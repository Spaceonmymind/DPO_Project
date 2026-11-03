import React,{createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {OnboardingOverlay} from './OnboardingOverlay';
import {OnboardingLauncher} from './OnboardingLauncher';
import {findTourTarget,waitForTourTarget} from './tourTargets';
import {tours,type TourId,type TourStep} from './tourDefinitions';
import './onboarding.css';
type Progress=Record<string,{version:number;status:string;completed_at?:string}>;
type Context={start:(id:TourId)=>void;launcher:React.ReactNode;progress:Progress};
const C=createContext<Context|null>(null);
export const useOnboarding=()=>{const value=useContext(C);if(!value)throw new Error('OnboardingProvider missing');return value};
export function OnboardingProvider({user,api,route,navigate,children}:{user:any;api:(path:string,options?:any)=>Promise<any>;route:string;navigate:(path:string)=>void;children:React.ReactNode}){
 const manager=Boolean(user.roles?.some((r:string)=>['dpo_specialist','administrator'].includes(r)));
 const [progress,setProgress]=useState<Progress>({});const [loaded,setLoaded]=useState(false);
 const [active,setActive]=useState<{id:TourId;index:number;replay:boolean}|null>(null);
 const [resolved,setResolved]=useState<{step:TourStep;target:HTMLElement|null;index:number;total:number}|null>(null);
 const [pending,setPending]=useState<TourId|null>(null);
 const attempted=useRef(new Set<string>());const generation=useRef(0);const initialSide=useRef<string|null>(null);const skipped=useRef(new Set<string>());
 useEffect(()=>{api('/auth/me/onboarding').then((x:Progress)=>{setProgress(x);setLoaded(true)}).catch(()=>setLoaded(true))},[api,user.id]);
 const restoreSide=()=>{if(initialSide.current!==null){window.dispatchEvent(new CustomEvent('tour-sidebar',{detail:{closed:initialSide.current==='1'}}));initialSide.current=null}};
 const complete=useCallback(async(status:'COMPLETED'|'SKIPPED',session:{id:TourId;replay:boolean})=>{setActive(null);setResolved(null);generation.current++;restoreSide();if(session.id==='T2')sessionStorage.removeItem('dpo-tour-t2-pending');try{const result=await api(`/auth/me/onboarding/${session.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,status})});setProgress(x=>({...x,[session.id]:result}))}catch{}if(status==='COMPLETED'&&session.id==='T1')navigate('/contracts')},[api,navigate]);
 const start=useCallback((id:TourId)=>{if((id==='T3'||id==='T4')&&!manager)return;generation.current++;skipped.current.clear();attempted.current.add(id);if(id==='T4'&&!findTourTarget('tpl-tabs')){setPending('T4');navigate('/templates');return}if(id==='T2'&&!findTourTarget('q-header')){setPending('T2');navigate('/contracts');return}if(id==='T1'||id==='T3')navigate('/');initialSide.current=localStorage.getItem('side');setPending(null);setActive({id,index:0,replay:true})},[manager,navigate]);
 useEffect(()=>{if(!loaded||active)return;const check=()=>{
  if(pending&&findTourTarget(pending==='T4'?'tpl-tabs':'q-header')){initialSide.current=localStorage.getItem('side');setActive({id:pending,index:0,replay:true});setPending(null);return}
  const base=manager?'T3':'T1';if(route==='/'&&!attempted.current.has(base)&&progress[base]?.version!==1&&findTourTarget('home-metrics')){attempted.current.add(base);skipped.current.clear();initialSide.current=localStorage.getItem('side');setActive({id:base,index:0,replay:false});return}
  if(findTourTarget('q-header')&&!attempted.current.has('T2')&&progress.T2?.version!==1){attempted.current.add('T2');skipped.current.clear();initialSide.current=localStorage.getItem('side');setActive({id:'T2',index:0,replay:false});return}
  if(manager&&route==='/templates'&&findTourTarget('tpl-tabs')&&!attempted.current.has('T4')&&progress.T4?.version!==1){attempted.current.add('T4');skipped.current.clear();initialSide.current=localStorage.getItem('side');setActive({id:'T4',index:0,replay:false})}
 };const observer=new MutationObserver(check);observer.observe(document.body,{childList:true,subtree:true});const timer=setTimeout(check,0);return()=>{clearTimeout(timer);observer.disconnect()}},[loaded,active,pending,route,manager,progress]);
 const move=useCallback((delta:number)=>{if(!active)return;const next=active.index+delta;if(next<0)return;if(next>=tours[active.id].steps.length){void complete('COMPLETED',active);return}if(active.id==='T2'&&next===7){setActive(null);setResolved(null);sessionStorage.setItem('dpo-tour-t2-pending','8');restoreSide();return}setActive({...active,index:next})},[active,complete]);
 useEffect(()=>{if(!active){setResolved(null);return}const token=++generation.current;const steps=tours[active.id].steps;const raw=steps[active.index];if(!raw){void complete('COMPLETED',active);return}let cancelled=false;
 (async()=>{if(raw.route&&route!==raw.route){navigate(raw.route);return}if(raw.stage)window.dispatchEvent(new CustomEvent('tour-template-stage',{detail:raw.stage}));if(raw.target==='sidebar'||raw.target?.startsWith('sidebar-')||raw.target==='profile'){if(localStorage.getItem('side')==='1')window.dispatchEvent(new CustomEvent('tour-sidebar',{detail:{closed:false}}))}
 const target=await waitForTourTarget(raw.target,raw.target?(raw.optional?1200:8000):0);if(cancelled||generation.current!==token)return;
 if(!target&&raw.target&&!raw.alternative){skipped.current.add(raw.id);setActive({...active,index:active.index+1});return}
 const step=target?raw:raw.alternative?{...raw,target:undefined,position:'center' as const,body:raw.alternative}:raw;
 const available=steps.length-skipped.current.size;
 const ordinal=active.index-[...skipped.current].filter(id=>steps.findIndex(item=>item.id===id)<active.index).length;
 setResolved({step,target,index:ordinal,total:available});
 })();return()=>{cancelled=true}},[active,route,navigate,complete]);
 useEffect(()=>{if(!loaded||active||progress.T2?.version===1||attempted.current.has('T2-deferred'))return;const pendingStep=sessionStorage.getItem('dpo-tour-t2-pending');if(!pendingStep)return;const observer=new MutationObserver(()=>{if(findTourTarget(pendingStep==='8'?'q-generate':'q-download')){attempted.current.add('T2-deferred');initialSide.current=localStorage.getItem('side');setActive({id:'T2',index:Number(pendingStep)-1,replay:false})}});observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect()},[loaded,active,progress]);
 const launcher=<OnboardingLauncher manager={manager} progress={progress} start={start}/>;
 return <C.Provider value={{start,launcher,progress}}>{children}{active&&resolved&&<OnboardingOverlay step={resolved.step} index={resolved.index} total={resolved.total} target={resolved.target} onNext={()=>{if(active.id==='T2'&&active.index===7){sessionStorage.setItem('dpo-tour-t2-pending','9');attempted.current.delete('T2-deferred');setActive(null);setResolved(null);restoreSide()}else move(1)}} onBack={()=>move(-1)} onSkip={()=>void complete('SKIPPED',active)}/>}</C.Provider>
}
