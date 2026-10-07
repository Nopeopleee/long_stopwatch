const STORAGE_KEY="long-stopwatch-v1";
const defaultState={name:"我的碼表",startedAt:null};
let deferredInstallPrompt=null,holdTimer=null,holdStart=0;
const $=id=>document.getElementById(id);
const els={themeSelect:$("themeSelect"),exportBtn:$("exportBtn"),importBtn:$("importBtn"),importFile:$("importFile"),installBtn:$("installBtn"),installStatus:$("installStatus"),resetBtn:$("resetBtn"),holdProgress:$("holdProgress").firstElementChild};

function loadState(){try{const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return{...defaultState};const p=JSON.parse(raw);return{name:typeof p.name==="string"&&p.name.trim()?p.name.trim():defaultState.name,startedAt:Number.isFinite(p.startedAt)?p.startedAt:null}}catch{return{...defaultState}}}
function saveState(state){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
function exportBackup(){const state=loadState();const payload={version:1,exportedAt:Date.now(),state};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`disui-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url)}
async function importBackup(file){try{const text=await file.text(),payload=JSON.parse(text),incoming=payload?.state??payload;if(!Number.isFinite(incoming.startedAt)||typeof incoming.name!=="string")throw new Error("格式不正確");if(incoming.startedAt>Date.now()+60000)throw new Error("出生時間在未來");saveState({name:incoming.name.trim()||"我的碼表",startedAt:incoming.startedAt});alert("備份已匯入")}catch(err){alert(`匯入失敗：${err.message}`)}finally{els.importFile.value=""}}
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
