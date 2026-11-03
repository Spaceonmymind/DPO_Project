export function findTourTarget(name?:string):HTMLElement|null {
 if(!name)return null;
 const explicit=document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
 if(explicit)return explicit;
 const fallback:Record<string,string>={'q-hint':'.question-hint-trigger','q-choice':'.contract-choice-options','q-repeat-add':'.condition-add, .repeating-group button'};
 return document.querySelector<HTMLElement>(fallback[name]||'__missing__');
}
export function waitForTourTarget(name?:string,timeout=8000):Promise<HTMLElement|null>{
 const found=findTourTarget(name); if(found||!name)return Promise.resolve(found);
 return new Promise(resolve=>{const observer=new MutationObserver(()=>{const target=findTourTarget(name);if(target){clearTimeout(timer);observer.disconnect();resolve(target)}});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-tour']});const timer=window.setTimeout(()=>{observer.disconnect();resolve(null)},timeout)});
}
