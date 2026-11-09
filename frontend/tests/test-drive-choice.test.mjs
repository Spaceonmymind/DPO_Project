import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("document check shows all configured choices in order and sends stable keys", async () => {
  const dom=new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>",{url:"http://localhost/templates"});
  const globals={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true};
  const previous=Object.fromEntries(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const server=await createServer({server:{middlewareMode:true},appType:"custom",logLevel:"silent"});
  const {TestDriveField}=await server.ssrLoadModule("/src/TemplateAdmin.tsx");
  const React=await import("react");const {act}=React;const {createRoot}=await import("react-dom/client");const root=createRoot(dom.window.document.getElementById("root"));
  let value;let field={id:"choice",label:"Способ оплаты",field_type:"SINGLE_SELECT",config:{option_items:[],allow_other:false}};
  const render=()=>root.render(React.createElement(TestDriveField,{field,value,change:next=>{value=next;render();}}));
  const labels=()=>[...dom.window.document.querySelectorAll(".test-drive-options label span")].map(x=>x.textContent);
  try{
    for(const count of [1,2,3,4,10]){
      field={...field,config:{...field.config,option_items:Array.from({length:count},(_,index)=>({key:`item_${index+1}`,label:`Вариант ${index+1}`}))}};
      await act(async()=>render());
      assert.deepEqual(labels(),Array.from({length:count},(_,index)=>`Вариант ${index+1}`));
    }
    await act(async()=>dom.window.document.querySelectorAll('.test-drive-options input')[9].click());
    assert.deepEqual(value.selected,["item_10"]);
    field={...field,config:{...field.config,option_items:[...field.config.option_items].reverse()}};
    await act(async()=>render());
    assert.equal(labels()[0],"Вариант 10");
    assert.equal(dom.window.document.querySelectorAll('.test-drive-options input')[0].checked,true);
    field={...field,field_type:"MULTI_SELECT",config:{...field.config,allow_other:true}};
    await act(async()=>render());
    await act(async()=>dom.window.document.querySelectorAll('.test-drive-options input')[1].click());
    await act(async()=>dom.window.document.querySelectorAll('.test-drive-options input')[10].click());
    assert.deepEqual(value.selected,["item_10","item_9","__other__"]);
    assert.ok(dom.window.document.querySelector('.test-drive-other input'));
  }finally{
    await act(async()=>root.unmount());await server.close();dom.window.close();
    for(const [key,descriptor] of Object.entries(previous))descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  }
});
