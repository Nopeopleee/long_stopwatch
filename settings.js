const STORAGE_KEY="long-stopwatch-v1";
const defaultState={name:"我的碼表",startedAt:null,care:null};
let deferredInstallPrompt=null,holdTimer=null,holdStart=0;
const $=id=>document.getElementById(id);
const els={themeSelect:$("themeSelect"),exportBtn:$("exportBtn"),importBtn:$("importBtn"),importFile:$("importFile"),installBtn:$("installBtn"),installStatus:$("installStatus"),resetBtn:$("resetBtn"),holdProgress:$("holdProgress").firstElementChild};

function createCare(now=Date.now()){return{activatedAt:now,lastFedAt:now,feedCount:0,diedAt:null}}
function normalizeCare(care,startedAt,now=Date.now()){
  if(!startedAt)return null;
  const safeNow=Math.max(startedAt,now);
  if(!care||!Number.isFinite(care.lastFedAt))return createCare(safeNow);
  const activatedAt=Number.isFinite(care.activatedAt)?Math.min(safeNow,Math.max(startedAt,care.activatedAt)):Math.min(safeNow,Math.max(startedAt,care.lastFedAt));
  const lastFedAt=Math.min(safeNow,Math.max(startedAt,care.lastFedAt));
  const feedCount=Number.isInteger(care.feedCount)&&care.feedCount>=0?care.feedCount:0;
  const diedAt=Number.isFinite(care.diedAt)?care.diedAt:null;
  return{activatedAt,lastFedAt,feedCount,diedAt};
}
function loadState(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw)return{...defaultState};
    const p=JSON.parse(raw);
    const startedAt=Number.isFinite(p.startedAt)?p.startedAt:null;
    const care=normalizeCare(p.care,startedAt);
    const next={name:typeof p.name==="string"&&p.name.trim()?p.name.trim():defaultState.name,startedAt,care};
    if(startedAt&&JSON.stringify(p.care??null)!==JSON.stringify(care))saveState(next);
    return next;
  }catch{return{...defaultState}}
}
function saveState(state){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
function exportBackup(){
  const state=loadState();
  const payload={version:2,exportedAt:Date.now(),state};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`disui-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);
}
async function importBackup(file){
  try{
    const text=await file.text(),payload=JSON.parse(text),incoming=payload?.state??payload;
    if(!incoming||typeof incoming.name!=="string")throw new Error("格式不正確");
    let startedAt=null;
    if(incoming.startedAt!==null&&incoming.startedAt!==undefined){
      if(!Number.isFinite(incoming.startedAt))throw new Error("格式不正確");
      startedAt=incoming.startedAt;
      if(startedAt>Date.now()+60000)throw new Error("出生時間在未來");
    }
    const hadCare=startedAt&&Number.isFinite(incoming.care?.lastFedAt);
    const care=normalizeCare(incoming.care,startedAt,Date.now());
    saveState({name:incoming.name.trim()||"我的碼表",startedAt,care});
    alert(hadCare||!startedAt?"備份已匯入":"備份已匯入；這是舊版備份，照顧系統會從現在開始計算");
  }catch(err){alert(`匯入失敗：${err.message}`)}
  finally{els.importFile.value=""}
}
function startHoldReset(){const state=loadState();if(!state.startedAt)return;clearInterval(holdTimer);holdStart=performance.now();els.resetBtn.classList.add("holding");holdTimer=setInterval(()=>{const elapsed=performance.now()-holdStart,pct=Math.min(100,elapsed/2000*100);els.holdProgress.style.width=`${pct}%`;if(elapsed>=2000){clearInterval(holdTimer);holdTimer=null;saveState({...defaultState});els.holdProgress.style.width="0%";els.resetBtn.classList.remove("holding");if(navigator.vibrate)navigator.vibrate([80,50,120]);alert("滴歲已重置");window.location.href="./"}},40)}
function cancelHoldReset(){clearInterval(holdTimer);holdTimer=null;els.holdProgress.style.width="0%";els.resetBtn.classList.remove("holding")}
function refreshInstallState(){if(window.matchMedia("(display-mode: standalone)").matches||navigator.standalone){els.installBtn.disabled=true;els.installStatus.textContent="已安裝";return}if(deferredInstallPrompt){els.installBtn.disabled=false;els.installStatus.textContent="可安裝成獨立 App";return}els.installBtn.disabled=true;els.installStatus.textContent="可從瀏覽器選單加入主畫面"}

els.themeSelect.value=getThemePreference();
els.themeSelect.addEventListener("change",()=>setThemePreference(els.themeSelect.value));
els.exportBtn.addEventListener("click",exportBackup);
els.importBtn.addEventListener("click",()=>els.importFile.click());
els.importFile.addEventListener("change",()=>{const file=els.importFile.files?.[0];if(file)importBackup(file)});
els.resetBtn.addEventListener("pointerdown",e=>{e.preventDefault();startHoldReset()});
["pointerup","pointerleave","pointercancel"].forEach(evt=>els.resetBtn.addEventListener(evt,cancelHoldReset));

window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();deferredInstallPrompt=event;refreshInstallState()});
els.installBtn.addEventListener("click",async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;refreshInstallState()});
window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;refreshInstallState()});
window.addEventListener("load",()=>setTimeout(refreshInstallState,250));

if("serviceWorker" in navigator){
  let refreshing=false;
  let registration=null;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{if(refreshing)return;refreshing=true;window.location.reload()});
  window.addEventListener("load",async()=>{try{registration=await navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"});await registration.update()}catch(err){console.error("Service worker registration/update failed",err)}});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)registration?.update().catch(()=>{})});
}
