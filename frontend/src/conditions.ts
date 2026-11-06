export type Condition={operator:string;field_key?:string;value?:unknown;conditions?:Condition[];condition?:Condition;previous_condition?:Condition};
import { OTHER, choiceAnswer } from "./choices";

const empty=(value:unknown)=>value===undefined||value===null||value===''||(Array.isArray(value)&&value.length===0)||(!!value&&typeof value==='object'&&Array.isArray((value as any).selected)&&(value as any).selected.length===0);
const ordered=(value:any)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(value+'T00:00:00Z').getTime():Number(value);

export function evaluateCondition(condition:Condition|undefined|null,answers:Record<string,unknown>):boolean{
 if(!condition)return true;
 const op=condition.operator;
 if(op==='ALWAYS')return true;
 if(op==='NEVER')return false;
 if(op==='AND')return (condition.conditions||[]).every(x=>evaluateCondition(x,answers));
 if(op==='OR')return (condition.conditions||[]).some(x=>evaluateCondition(x,answers));
 if(op==='NOT')return !evaluateCondition(condition.condition,answers);
 const actual=answers[condition.field_key||''];
 if(op==='CONTAINS_OPTION')return choiceAnswer(actual).selected.includes(String(condition.value));
 if(op==='NOT_CONTAINS_OPTION')return !choiceAnswer(actual).selected.includes(String(condition.value));
 if(op==='OTHER_SELECTED')return choiceAnswer(actual).selected.includes(OTHER);
 if(op==='OTHER_NOT_SELECTED')return !choiceAnswer(actual).selected.includes(OTHER);
 if(op==='IS_EMPTY')return empty(actual);
 if(op==='IS_NOT_EMPTY')return !empty(actual);
 const equal=(a:any,b:any)=>typeof b==='number'?Number(a)===b:a===b;
 if(op==='EQUALS')return equal(actual,condition.value);
 if(op==='NOT_EQUALS')return !equal(actual,condition.value);
 if(op==='IN')return Array.isArray(condition.value)&&condition.value.some(x=>actual&&typeof actual==='object'&&Array.isArray((actual as any).selected)?(actual as any).selected.includes(x):equal(actual,x));
 if(op==='NOT_IN')return Array.isArray(condition.value)&&!condition.value.some(x=>actual&&typeof actual==='object'&&Array.isArray((actual as any).selected)?(actual as any).selected.includes(x):equal(actual,x));
 if(empty(actual))return false;
 const left=ordered(actual),right=ordered(condition.value);
 if(op==='GREATER_THAN')return left>right;
 if(op==='LESS_THAN')return left<right;
 if(op==='GREATER_OR_EQUAL')return left>=right;
 if(op==='LESS_OR_EQUAL')return left<=right;
 return false;
}

export function fieldState(field:any,answers:Record<string,unknown>){
 const visible=evaluateCondition(field.config?.visible_when,answers);
 const conditional=field.config?.required_when?evaluateCondition(field.config.required_when,answers):false;
 return{visible,required:visible&&(field.required||conditional)};
}
