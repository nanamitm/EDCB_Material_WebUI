const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const root = path.join(__dirname, '../');
const source = fs.readFileSync(root+'HttpPublic/E3/js/ts-loader.js','utf8');
const appSource = fs.readFileSync(root+'HttpPublic/E3/js/app.js','utf8');
const defer=()=>{let resolve;let reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{resolve,reject,promise};};
async function tick(){for(let i=0;i<12;i++)await Promise.resolve();}
class Element {
  constructor(){this.children=[];this.style={setProperty(){}};this.value='';this.dataset={};this.options=[];this.listeners={};this.classList={contains:()=>false};}
  addEventListener(n,f,options){if(options?.once){const original=f;f=(...args)=>{this.removeEventListener(n,f);original(...args);};f.original=original;}(this.listeners[n] ||= []).push(f);}
  removeEventListener(n,f){this.listeners[n]=(this.listeners[n]||[]).filter(fn=>fn!==f&&fn.original!==f);}
  appendChild(e){this.children.push(e);return e;} removeChild(e){this.children.splice(this.children.indexOf(e),1);}
  get firstChild(){return this.children[0];} get firstElementChild(){return this.children[0];}
  get childElementCount(){return this.children.length;}
  setAttribute(n,v){(this.attrs ||= {})[n]=v;} getAttribute(n){return this.attrs?.[n];}
  querySelector(){return new Element();} insertBefore(e){this.children.unshift(e);} dispatchEvent(event){for(const fn of [...(this.listeners[event.type]||[])])fn(event);}
}
function setup(live=false){
 const ids=new Map(), selectors=new Map(), requests=[], timers=new Map();let timerId=0;
 const byId=n=>{if(!ids.has(n))ids.set(n,new Element());return ids.get(n);};
 const select=n=>{if(!selectors.has(n))selectors.set(n,new Element());return selectors.get(n);};
 select('#jikkyo-config select[name="id"]').options=[{value:'0'},{value:'1'},{value:'2'}];
 select('#jikkyo-config select[name="tmsec"]').options=Array.from({length:60},()=>({}));
 const video=new Element();video.attrs={src:'/video/old.mp4'};video.currentTime=0;video.duration=120;
 if(live)video.initSrc=new URL('http://localhost/api/view?n=0&id=1-2-3');
 const context={URL,URLSearchParams,AbortController,TextDecoder,Uint8Array,DataView,Event,console,
  location:{href:'http://localhost/E3/'},window:{},localStorage:{getItem(){},removeItem(){},setItem(){}},
  btoa:s=>s,atob:s=>Buffer.from(s,'base64').toString('binary'),
  document:{getElementById:byId,querySelector:select,querySelectorAll:()=>[],createElement:()=>new Element(),createDocumentFragment:()=>new Element(),body:new Element()},
  Danmaku:class{constructor(){this.options={};}clear(){}show(){}hide(){}draw(){}},
  bmlBrowserSetVisibleSize(){},bmlBrowserSetInvisible(){},bmlBrowserPlayTSSection(){},
  setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},setInterval(){return 1;},clearInterval(){},
  fetch(url,options){const d=defer();requests.push({url:String(url),options,...d});return d.promise;}};
 const start=source.indexOf('const datacastMixin'),end=source.indexOf('class TsLiveDatacast',start);
 const Datacast=vm.runInNewContext(source.slice(start,end)+'\nDatacast',context);
 return{instance:new Datacast(video),video,requests,ids,selectors,timers,context,
  async runTimers(){const pending=[...timers.values()];timers.clear();for(const fn of pending)fn();await tick();}};
}

const log = time => ({ok:true,text:async()=>`<!-- J=1;T=${time}\n`});
const timeInput = s => s.selectors.get('#jikkyo-config input[name="tm"]');
const iso = t => new Date(t*1000+32400000).toISOString().substring(0,16);

test('new native caption renderers preserve both OFF and ON settings', async()=>{
 for(const enabled of [false,true]){
  const start=appSource.indexOf('\n    player: {'),end=appSource.indexOf('\n    nvram:',start);
  const p=vm.runInNewContext(`({${appSource.slice(start,end)}}).player`,{config:{xcode:[]},Alpine:{raw:x=>x},URLSearchParams,
   document:{createElement:()=>({canPlayType:()=> 'maybe'})},console});
  p.video={setAttribute(){}};p.set={cap:enabled};
  p.vid={reset(){},destroyHls(){},createCap(){this.cap={isShowing:true,show(){this.isShowing=true;},hide(){this.isShowing=false;}};},loadSubData(){}};
  p.chap={reset(){},setChapters:()=>[[],[]]};
  p.app={ROOT:'',ctok:{xcode:'x'},$refs:{},isPage:()=>true,fetch:async()=>({ok:true,json:async()=>({name:'movie.mp4',path:'video/movie.mp4',public:true})})};
  await p.loadVideo({h:'movie'});assert.equal(p.vid.cap.isShowing,enabled);
 }
});

test('mixed commentary headers populate date/time and seconds',async()=>{
 const s=setup(true);s.instance.toggleJikkyo(true);let first=true;
 s.requests[0].resolve({ok:true,body:{getReader:()=>({read:()=>{
  if(first){first=false;return Promise.resolve({done:false,value:new TextEncoder().encode('<!-- J=1;T=100 -->\n')});}
  return new Promise(()=>{});
 }})}});await tick();
 assert.equal(timeInput(s).value,iso(100));
 assert.equal(s.selectors.get('#jikkyo-config select[name="tmsec"]').options[40].selected,true);
 s.instance.clear();
});

test('normal and download log requests include native video duration',()=>{
 const s=setup();s.instance.toggleJikkyo(true);s.ids.get('kakolog').onclick();
 for(const r of s.requests)assert.equal(new URL(r.url,'http://localhost').searchParams.get('fsec'),'120');
 assert.equal(s.requests.length,2);
});

test('native commentary waits for metadata and removes the listener when disabled',()=>{
 for(const disable of [false,true]){
  const s=setup();s.video.duration=NaN;s.video.readyState=0;s.instance.toggleJikkyo(true);
  assert.equal(s.requests.length,0);
  if(disable)s.instance.toggleJikkyo(false,false);
  s.video.duration=90;s.video.readyState=1;s.video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(s.requests.length,disable?0:1);
  assert.equal(s.video.listeners.loadedmetadata.length,0);
  if(!disable)assert.equal(new URL(s.requests[0].url,'http://localhost').searchParams.get('fsec'),'90');
 }
});

test('a download requested before metadata waits for the duration and is cancelled on clear',()=>{
 for(const clear of [false,true]){
  const s=setup();s.video.readyState=0;s.video.duration=NaN;
  s.ids.get('kakolog').onclick();assert.equal(s.requests.length,0);
  if(clear)s.instance.clear();
  s.video.duration=150;s.video.readyState=1;s.video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(s.requests.length,clear?0:2);
  for(const r of s.requests)assert.equal(new URL(r.url,'http://localhost').searchParams.get('fsec'),'150');
 }
});

test('late commentary bodies and failures cannot overwrite newer video metadata',async()=>{
 for(const fail of [false,true]){
  const s=setup(),body=defer();s.instance.toggleJikkyo(true);
  s.requests[0].resolve({ok:true,text:()=>body.promise});await tick();
  s.instance.clear();s.video.attrs.src='/video/new.mp4';s.instance.loadSubData();
  s.requests[1].resolve(log(200));await tick();
  if(fail)body.reject(new Error('old'));else body.resolve('<!-- J=1;T=100\n');await tick();
  assert.equal(timeInput(s).value,iso(200));
  assert.equal(s.ids.get('jikkyo-chats').children.length,0);
 }
});

test('obsolete finally cannot remove the controller of a newer log request',async()=>{
 const s=setup(),body=defer();s.instance.toggleJikkyo(true);
 s.requests[0].resolve({ok:true,text:()=>body.promise});await tick();
 s.instance.clear();s.video.attrs.src='/video/new.mp4';s.instance.loadSubData();
 body.resolve('<!-- J=1;T=100\n');await tick();s.instance.clear();
 assert.equal(s.requests[1].options.signal.aborted,true);
});

test('manual commentary changes cancel the prior request and allow time reset',()=>{
 const s=setup();s.instance.toggleJikkyo(true);s.instance.jkID=2;
 assert.equal(s.requests[0].options.signal.aborted,true);
 s.instance.jkTM=1000;s.instance.jkTM=0;
 assert.equal(new URL(s.requests.at(-1).url,'http://localhost').searchParams.get('jkTM'),'0');
 assert.equal(new URL(s.requests.at(-1).url,'http://localhost').searchParams.get('jkID'),'2');
});

test('old mixed-stream chunks and completion leave the newer connection intact',async()=>{
 for(const result of [{done:true},{done:false,value:new TextEncoder().encode('<!-- J=1;T=100 -->\n')}]){
  const s=setup(true),read=defer();s.instance.toggleJikkyo(true);
  s.requests[0].resolve({ok:true,body:{getReader:()=>({read:()=>read.promise})}});await tick();
  s.instance.clear();s.video.initSrc=new URL('http://localhost/api/view?n=0&id=1-2-4');s.instance.loadSubData();
  read.resolve(result);await tick();
  assert.equal(s.requests[1].options.signal.aborted,false);assert.equal(timeInput(s).value,'');
  assert.equal(s.timers.size,0);
 }
});

test('mixed-stream retries are bounded and clearing cancels a pending retry',async()=>{
 for(const stop of [false,true]){
  const s=setup(true);s.instance.toggleJikkyo(true);
  for(let i=0;i<3;i++){
   s.requests[i].resolve({ok:false,status:404,statusText:'missing'});await tick();
   if(stop){s.instance.clear();await s.runTimers();assert.equal(s.requests.length,1);break;}
   await s.runTimers();
  }
  if(!stop){assert.equal(s.requests.length,3);assert.equal(s.timers.size,0);}
 }
});

test('late PSC errors and finally do not alter a newer data broadcast request',async()=>{
 const s=setup(),body=defer();s.instance.toggleDatacast(true);
 s.requests[0].resolve({ok:true,arrayBuffer:()=>body.promise});await tick();
 s.instance.clear();s.video.attrs.src='/video/new.mp4';s.instance.loadSubData();
 body.reject(new Error('obsolete PSC'));await tick();
 assert.equal(s.selectors.get('.remote-control-indicator').innerText,'');
 s.instance.clear();assert.equal(s.requests[1].options.signal.aborted,true);
});

test('clearing cancels a log download and restores its button without late reloads',async()=>{
 const s=setup();s.instance.toggleJikkyo(true);const button=s.ids.get('kakolog');button.innerText='download';
 button.onclick();s.instance.clear();
 assert.equal(s.requests[1].options.signal.aborted,true);assert.equal(button.innerText,'download');assert.equal(button.disabled,false);
 s.requests[1].resolve({ok:true,text:async()=>'done'});await tick();assert.equal(s.requests.length,2);
});

test('successful log import cancels an old log read and fetches imported contents',async()=>{
 const s=setup();s.instance.toggleJikkyo(true);s.ids.get('kakolog').onclick();
 s.requests[1].resolve({ok:true,text:async()=>'done'});await tick();
 assert.equal(s.requests[0].options.signal.aborted,true);assert.equal(s.requests.length,3);
 s.requests[2].resolve(log(500));await tick();assert.equal(timeInput(s).value,iso(500));
});

test('chapter destruction removes shared navigation and old video listeners',()=>{
 const s=setup(),start=source.indexOf('class chapterTvt');
 const Chapter=vm.runInNewContext(source.slice(start)+'\nchapterTvt',s.context),seeks=[];
 const oldVideo=new Element();oldVideo.currentTime=0;
 const old=new Chapter(oldVideo);old.setChapters('c-10000cA-40000cB',60);old.setSeek=n=>seeks.push(n);
 old.destroy();old.destroy();
 const video=new Element();video.currentTime=30;
 const latest=new Chapter(video);latest.setChapters('c-10000cA-40000cB',60);latest.setSeek=n=>seeks.push(n);
 s.ids.get('nextChap').dispatchEvent(new Event('click'));assert.deepEqual(seeks,[39]);
 assert.equal(oldVideo.listeners.timeupdate.length,0);assert.equal(s.ids.get('nextChap').listeners.click.length,1);
 latest.destroy();assert.equal(s.ids.get('nextChap').listeners.click.length,0);
});

test('player disposes its previous chapter controller before video reinitialization',()=>{
 const start=appSource.indexOf('      videoInit() {')+'      videoInit() {'.length;
 const end=appSource.indexOf('        if (!this.$refs.video)',start);
 const calls=[];const p={chap:{destroy(){calls.push('chapter');}},vid:{destroy(){calls.push('player');}}};
 vm.runInNewContext(`(function(){${appSource.slice(start,end)}})`,{Alpine:{raw:x=>x}}).call(p);
 assert.deepEqual(calls,['chapter','player']);assert.equal(p.chap,null);
});
