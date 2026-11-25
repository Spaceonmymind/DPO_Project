import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';import {createServer} from 'vite';import {chromium} from 'playwright-core';
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('administrative center lists and manages stages', {skip:!existsSync(chrome),timeout:30000},async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'silent'});await server.listen();const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage();page.setDefaultTimeout(4000);page.on("pageerror",e=>console.log("PAGE ERROR",e.message));await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/contract-administration.html`);
 await page.getByRole('cell',{name:/Анна Петрова/}).waitFor();await page.getByRole('tab',{name:'Пользователи'}).click();await page.getByText('1 договоров').waitFor();
 await page.getByRole('tab',{name:'Договоры'}).click();await page.getByRole('button',{name:'Тестовый договор'}).click();await page.getByRole('heading',{name:'Этапы договора'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Разрешить',exact:true}).count(),0);
 await page.getByRole('button',{name:'Разблокировать'}).click();await page.getByLabel('Причина').fill('Исправление');await page.getByRole('button',{name:'Подтвердить'}).click();await page.getByText('Разблокирован для исправления').waitFor();
 await page.getByRole('button',{name:/К списку/}).click();await page.getByRole('tab',{name:'История действий'}).click();await page.getByText(/Причина: Исправление/).waitFor();
 }finally{await browser.close();await server.close();}
});
