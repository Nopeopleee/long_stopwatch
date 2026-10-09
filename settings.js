const STORAGE_KEY="long-stopwatch-v1";
const CARE_DEBUG_KEY="disui-care-debug-v1";
const DEBUG_MODE=new URLSearchParams(location.search).get("debug")==="1"||["localhost","127.0.0.1","::1"].includes(location.hostname);
const defaultState={name:"我的碼表",startedAt:null,care:null};
let deferredInstallPrompt=null,holdTimer=null,holdStart=0;
const $=id=>document.getElementById(id);
const els={themeSelect:$("themeSelect"),exportBtn:$("exportBtn"),importBtn:$("importBtn"),importFile:$("importFile"),installBtn:$("installBtn"),installStatus:$("installStatus"),resetBtn:$("resetBtn"),holdProgress:$("holdProgress").firstElementChild,debugSection:$("debugSection"),debugCareSelect:$("debugCareSelect"),debugCareStatus:$("debugCareStatus"),applyCareDebugBtn:$("applyCareDebugBtn"),clearCareDebugBtn:$("clearCareDebugBtn"),debugHomeLink:$("debugHomeLink"),backLink:document.querySelector(".back-link"),primaryStorageStatus:$("primaryStorageStatus"),primaryStorageBadge:$("primaryStorageBadge"),mirrorStorageStatus:$("mirrorStorageStatus"),mirrorStorageBadge:$("mirrorStorageBadge"),snapshotStatus:$("snapshotStatus"),snapshotCountBadge:$("snapshotCountBadge"),lastExportStatus:$("lastExportStatus"),backupHealthBadge:$("backupHealthBadge"),createSnapshotBtn:$("createSnapshotBtn"),viewSnapshotsBtn:$("viewSnapshotsBtn"),snapshotDialog:$("snapshotDialog"),snapshotDialogClose:$("snapshotDialogClose"),snapshotList:$("snapshotList")};

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
    if(startedAt&&JSON.stringify(p.care??null)!==JSON.stringify(care))saveState(next,{snapshotBefore:false});
    return next;
  }catch{return{...defaultState}}
}
function saveState(state,options){
  if(window.DisuiStorage)return DisuiStorage.saveState(state,options);
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
}
function exportBackup(){
  const state=loadState();
  const payload={version:2,exportedAt:Date.now(),state};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`disui-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);
  DisuiStorage?.recordExport();
  refreshSafetyStatus();
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
    if(window.DisuiStorage){
      const current=loadState();
      if(current.startedAt)await DisuiStorage.createSnapshot(current,"before-import",{force:true}).catch(()=>{});
    }
    saveState({name:incoming.name.trim()||"我的碼表",startedAt,care});
    localStorage.removeItem(CARE_DEBUG_KEY);
    alert(hadCare||!startedAt?"備份已匯入":"備份已匯入；這是舊版備份，照顧系統會從現在開始計算");
  }catch(err){alert(`匯入失敗：${err.message}`)}
  finally{els.importFile.value=""}
}
function startHoldReset(){const state=loadState();if(!state.startedAt)return;clearInterval(holdTimer);holdStart=performance.now();els.resetBtn.classList.add("holding");holdTimer=setInterval(()=>{const elapsed=performance.now()-holdStart,pct=Math.min(100,elapsed/2000*100);els.holdProgress.style.width=`${pct}%`;if(elapsed>=2000){clearInterval(holdTimer);holdTimer=null;const finish=async()=>{if(window.DisuiStorage)await DisuiStorage.createSnapshot(state,"before-reset",{force:true}).catch(()=>{});saveState({...defaultState});localStorage.removeItem(CARE_DEBUG_KEY);els.holdProgress.style.width="0%";els.resetBtn.classList.remove("holding");if(navigator.vibrate)navigator.vibrate([80,50,120]);alert("滴歲已重置");window.location.href="./"};finish()}},40)}
function cancelHoldReset(){clearInterval(holdTimer);holdTimer=null;els.holdProgress.style.width="0%";els.resetBtn.classList.remove("holding")}
function refreshInstallState(){if(window.matchMedia("(display-mode: standalone)").matches||navigator.standalone){els.installBtn.disabled=true;els.installStatus.textContent="已安裝";return}if(deferredInstallPrompt){els.installBtn.disabled=false;els.installStatus.textContent="可安裝成獨立 App";return}els.installBtn.disabled=true;els.installStatus.textContent="可從瀏覽器選單加入主畫面"}

const safetyDateFormatter=new Intl.DateTimeFormat("zh-TW",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
function relativeTime(ts){
  if(!Number.isFinite(ts))return"尚無紀錄";
  const diff=Math.max(0,Date.now()-ts),minutes=Math.floor(diff/60000),hours=Math.floor(diff/3600000),days=Math.floor(diff/86400000);
  if(minutes<1)return"剛剛";
  if(hours<1)return`${minutes} 分鐘前`;
  if(days<1)return`${hours} 小時前`;
  if(days<30)return`${days} 天前`;
  return safetyDateFormatter.format(new Date(ts));
}
function setSafetyBadge(el,text,tone=""){
  if(!el)return;
  el.textContent=text;
  el.className="safety-badge"+(tone?" "+tone:"");
}
async function reconcileStorageSafety(){
  if(!window.DisuiStorage)return;
  try{
    const result=await DisuiStorage.reconcile();
    if(result.action==="conflict"&&result.conflict){
      const localDesc=DisuiStorage.describeState(result.conflict.local.state);
      const mirrorDesc=DisuiStorage.describeState(result.conflict.mirror.state);
      const keepLocal=confirm(`發現兩份不同的滴歲資料。\n\n目前主資料：${localDesc}\n安全副本：${mirrorDesc}\n\n按「確定」保留目前主資料；按「取消」改用安全副本。`);
      await DisuiStorage.resolveConflict(keepLocal?"local":"mirror",result.conflict);
    }else if(result.action==="no-valid-state"){
      alert("本機主資料與安全副本都沒有通過完整性檢查，而且找不到可自動復原的快照。請從 JSON 備份匯入。");
    }
    await DisuiStorage.ensureDailySnapshot(loadState()).catch(()=>{});
  }catch(error){console.warn("Storage safety reconciliation failed",error)}
}
async function refreshSafetyStatus(){
  if(!window.DisuiStorage)return;
  const summary=await DisuiStorage.getSafetySummary();
  if(els.primaryStorageStatus)els.primaryStorageStatus.textContent=summary.localValid?"主要資料可正常讀取":"主要資料需要修復";
  setSafetyBadge(els.primaryStorageBadge,summary.localValid?"正常":"異常",summary.localValid?"good":"bad");

  if(els.mirrorStorageStatus)els.mirrorStorageStatus.textContent=!summary.idbAvailable
    ?"此瀏覽器無法使用 IndexedDB"
    :summary.mirrorValid?`安全副本已同步・${relativeTime(summary.mirrorUpdatedAt)}`:"尚未建立安全副本";
  setSafetyBadge(els.mirrorStorageBadge,!summary.idbAvailable?"不可用":summary.mirrorValid?"正常":"待建立",!summary.idbAvailable?"bad":summary.mirrorValid?"good":"warn");

  if(els.snapshotStatus)els.snapshotStatus.textContent=summary.latestSnapshotAt?`最近建立於 ${relativeTime(summary.latestSnapshotAt)}`:"還沒有復原點";
  if(els.snapshotCountBadge)setSafetyBadge(els.snapshotCountBadge,`${summary.snapshotCount} / 10`,summary.snapshotCount?"good":"warn");

  const current=loadState();
  const ref=summary.lastExportAt||current.startedAt;
  const age=ref?Date.now()-ref:0;
  if(els.lastExportStatus)els.lastExportStatus.textContent=summary.lastExportAt?`上次匯出：${relativeTime(summary.lastExportAt)}`:"尚未匯出 JSON 備份";
  if(!current.startedAt)setSafetyBadge(els.backupHealthBadge,"尚未開始","");
  else if(summary.lastExportAt&&age<30*86400000)setSafetyBadge(els.backupHealthBadge,"良好","good");
  else if(!summary.lastExportAt&&age<30*86400000)setSafetyBadge(els.backupHealthBadge,"尚無備份","");
  else if(age<60*86400000)setSafetyBadge(els.backupHealthBadge,"建議備份","warn");
  else setSafetyBadge(els.backupHealthBadge,"建議備份","bad");
}
function snapshotReasonLabel(reason){
  return({auto:"每日自動",manual:"手動建立",migration:"首次建立",["before-import"]:"匯入前",["before-reset"]:"重置前",["before-restore"]:"還原前",["before-repair"]:"修復前",["conflict-loser"]:"衝突保留"})[reason]||reason||"快照";
}
async function openSnapshotDialog(){
  if(!window.DisuiStorage||!els.snapshotDialog||!els.snapshotList)return;
  const items=await DisuiStorage.listSnapshots();
  els.snapshotList.innerHTML="";
  if(!items.length){
    const empty=document.createElement("div");empty.className="snapshot-empty";empty.textContent="還沒有復原點。";els.snapshotList.appendChild(empty);
  }else{
    items.forEach(item=>{
      const row=document.createElement("div");row.className="snapshot-item";
      const copy=document.createElement("div");copy.className="snapshot-copy";
      const strong=document.createElement("strong");strong.textContent=DisuiStorage.describeState(item.state);
      const span=document.createElement("span");span.textContent=safetyDateFormatter.format(new Date(item.createdAt));
      const small=document.createElement("small");small.textContent=snapshotReasonLabel(item.reason);
      copy.append(strong,span,small);
      const btn=document.createElement("button");btn.type="button";btn.className="snapshot-restore";btn.textContent="還原";
      btn.addEventListener("click",async()=>{
        if(!confirm("要把滴歲還原到這個復原點嗎？\n目前狀態會先再保存一份，所以還可以救回來。"))return;
        btn.disabled=true;
        try{
          await DisuiStorage.restoreSnapshot(item.id);
          localStorage.removeItem(CARE_DEBUG_KEY);
          alert("已還原這個復原點");
          window.location.href=DEBUG_MODE?"./?debug=1":"./";
        }catch(error){alert("還原失敗："+error.message);btn.disabled=false}
      });
      row.append(copy,btn);els.snapshotList.appendChild(row);
    });
  }
  els.snapshotDialog.showModal();
}
async function createManualSnapshot(){
  if(!window.DisuiStorage)return;
  const current=loadState();
  if(!current.startedAt){alert("滴歲出生後才需要建立復原點");return}
  els.createSnapshotBtn.disabled=true;
  try{
    await DisuiStorage.createSnapshot(current,"manual",{force:true});
    await refreshSafetyStatus();
    alert("已建立本機復原點");
  }catch(error){alert("建立快照失敗："+error.message)}
  finally{els.createSnapshotBtn.disabled=false}
}

const debugCareLabels=new Map([
  [0,"剛餵完（0 小時）"],[12,"可再次餵食（12 小時）"],[24,"有點餓（24 小時）"],[48,"飢餓（48 小時）"],
  [72,"虛弱（72 小時）"],[96,"生病（96 小時）"],[144,"危急（144 小時）"],[192,"超過死亡門檻（192 小時）"]
]);
function getDebugCareHours(){
  const value=Number(localStorage.getItem(CARE_DEBUG_KEY));
  return Number.isFinite(value)&&value>=0?value:null;
}
function refreshDebugTools(){
  if(!DEBUG_MODE||!els.debugSection)return;
  els.debugSection.hidden=false;
  if(els.backLink)els.backLink.href="./?debug=1";
  if(els.debugHomeLink)els.debugHomeLink.href="./?debug=1";
  const hours=getDebugCareHours();
  if(hours!==null&&els.debugCareSelect)els.debugCareSelect.value=String(hours);
  if(els.debugCareStatus)els.debugCareStatus.textContent=hours===null?"目前使用真實照顧時間":`目前模擬：${debugCareLabels.get(hours)||hours+" 小時沒餵"}`;
}
function applyCareDebug(){
  const state=loadState();
  if(!state.startedAt){alert("要先有一隻滴歲才能測照顧狀態");return}
  const hours=Number(els.debugCareSelect?.value);
  if(!Number.isFinite(hours)||hours<0)return;
  localStorage.setItem(CARE_DEBUG_KEY,String(hours));
  refreshDebugTools();
}
function clearCareDebug(){
  localStorage.removeItem(CARE_DEBUG_KEY);
  refreshDebugTools();
}

els.themeSelect.value=getThemePreference();
els.themeSelect.addEventListener("change",()=>setThemePreference(els.themeSelect.value));
els.exportBtn.addEventListener("click",exportBackup);
els.importBtn.addEventListener("click",()=>els.importFile.click());
els.importFile.addEventListener("change",()=>{const file=els.importFile.files?.[0];if(file)importBackup(file)});
els.resetBtn.addEventListener("pointerdown",e=>{e.preventDefault();startHoldReset()});
["pointerup","pointerleave","pointercancel"].forEach(evt=>els.resetBtn.addEventListener(evt,cancelHoldReset));
els.applyCareDebugBtn?.addEventListener("click",applyCareDebug);
els.clearCareDebugBtn?.addEventListener("click",clearCareDebug);
els.createSnapshotBtn?.addEventListener("click",createManualSnapshot);
els.viewSnapshotsBtn?.addEventListener("click",openSnapshotDialog);
els.snapshotDialogClose?.addEventListener("click",()=>els.snapshotDialog.close());
els.snapshotDialog?.addEventListener("click",event=>{if(event.target===els.snapshotDialog)els.snapshotDialog.close()});
refreshDebugTools();
reconcileStorageSafety().then(refreshSafetyStatus);

window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();deferredInstallPrompt=event;refreshInstallState()});
els.installBtn.addEventListener("click",async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;refreshInstallState()});
window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;refreshInstallState()});
window.addEventListener("load",()=>setTimeout(refreshInstallState,250));

if("serviceWorker" in navigator){
  let refreshing=false;
  let registration=null;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{if(refreshing)return;refreshing=true;window.location.reload()});
  window.addEventListener("load",async()=>{try{registration=await navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"});await registration.update()}catch(err){console.error("Service worker registration/update failed",err)}});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){registration?.update().catch(()=>{});reconcileStorageSafety().then(refreshSafetyStatus)}});
}


// Manual cloud enrollment; do not upload or replace local data on page load.
const cloudStatus=document.getElementById("cloudStatus");
const cloudBindBtn=document.getElementById("cloudBindBtn");
const cloudRestoreBtn=document.getElementById("cloudRestoreBtn");
const cloudCopyBtn=document.getElementById("cloudCopyBtn");
const cloudRotateBtn=document.getElementById("cloudRotateBtn");
const cloudDisconnectBtn=document.getElementById("cloudDisconnectBtn");
function updateCloudStatus(){
  const binding=window.DisuiCloud?.binding();
  const state=loadState();
  const matched=window.DisuiCloud?.active(state);
  if(cloudStatus)cloudStatus.textContent=!window.DisuiCloud?.supported()
    ?"目前網址不支援雲端 API，請使用正式網站"
    :matched?`已綁定：${binding.id}（雲端餵食）`
    :binding?"這個瀏覽器綁定了另一隻滴歲，請先確認本機資料"
    :"尚未綁定；既有寵物不會自動上傳";
  if(cloudBindBtn)cloudBindBtn.disabled=!window.DisuiCloud?.supported()||!!binding||!state.startedAt;
  if(cloudCopyBtn)cloudCopyBtn.disabled=!matched;
  if(cloudRotateBtn)cloudRotateBtn.disabled=!matched;
  if(cloudDisconnectBtn)cloudDisconnectBtn.disabled=!binding;
}
cloudBindBtn?.addEventListener("click",async()=>{
  const state=loadState();
  if(!confirm("將目前滴歲的名稱、出生時間與餵食紀錄上傳到 D1？出生時間會標記為舊資料，不作為可信排行依據。"))return;
  cloudBindBtn.disabled=true;
  try{
    if(window.DisuiStorage)await DisuiStorage.createSnapshot(state,"before-cloud-bind",{force:true});
    const data=await DisuiCloud.connectLocal(state);
    alert("已綁定雲端！請立即複製並妥善保存還原資訊。雲端同步從現在開始生效。");
    updateCloudStatus();
  }catch(error){alert(`雲端綁定失敗：${error.message}`);updateCloudStatus()}
});
cloudRestoreBtn?.addEventListener("click",async()=>{
  if(!window.DisuiCloud?.supported()){alert("請在正式網站操作");return}
  const id=prompt("請貼上寵物 ID（UUID）");
  if(!id)return;
  const token=prompt("請貼上 64 位十六進位還原密鑰（不要與任何人分享）");
  if(!token)return;
  try{
    const restore=await DisuiCloud.restore(id,token);
    const previous=loadState();
    if(previous.startedAt&&!confirm("此操作會用雲端寵物取代目前畫面上的本機寵物。原本資料將先建立本機快照，確定繼續嗎？"))return;
    if(window.DisuiStorage&&previous.startedAt)await DisuiStorage.createSnapshot(previous,"before-cloud-restore",{force:true});
    saveState(restore.state);
    restore.bind();
    localStorage.removeItem(CARE_DEBUG_KEY);
    alert("雲端還原完成！即將返回首頁。");
    location.href="./";
  }catch(error){alert(`還原失敗：${error.message}`)}
});
cloudCopyBtn?.addEventListener("click",async()=>{
  const state=loadState();
  const b=DisuiCloud.active(state);
  if(!b)return;
  try{
    await navigator.clipboard.writeText(`滴歲雲端還原資訊\\nID: ${b.id}\\n密鑰: ${b.token}`);
    alert("還原資訊已複製，請存到密碼管理器或安全的離線位置。");
  }catch{alert("複製失敗；瀏覽器可能不允許存取剪貼簿")}
});
cloudRotateBtn?.addEventListener("click",async()=>{
  const state=loadState();
  if(!confirm("確定輪替密鑰？舊密鑰會失效，其他裝置也會需要更新。請在輪替後立即保存新密鑰。"))return;
  try{
    await DisuiCloud.rotate(state);
    updateCloudStatus();
    alert("密鑰已輪替，請立即使用「複製還原資訊」備份新的密鑰。");
  }catch(error){alert(`密鑰輪替失敗：${error.message}`)}
});
updateCloudStatus();

cloudDisconnectBtn?.addEventListener("click",()=>{
  if(!DisuiCloud.binding())return;
  if(!confirm("解除雲端綁定後將改為本機餵食。遠端資料不會被刪除。請確認已備份寵物 ID 與密鑰。"))return;
  DisuiCloud.disconnect();
  updateCloudStatus();
});
