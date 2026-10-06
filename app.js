const STORAGE_KEY="long-stopwatch-v1";
const defaultState={name:"我的碼表",startedAt:null};
let state=loadState(),holdTimer=null,holdStart=0;
const $=id=>document.getElementById(id);
const els={title:$("title"),statusPill:$("statusPill"),days:$("days"),hours:$("hours"),minutes:$("minutes"),seconds:$("seconds"),startedAtText:$("startedAtText"),rankText:$("rankText"),startBtn:$("startBtn"),renameBtn:$("renameBtn"),holdProgress:$("holdProgress")?.firstElementChild,milestones:$("milestones"),renameDialog:$("renameDialog"),renameForm:$("renameForm"),renameInput:$("renameInput"),saveRenameBtn:$("saveRenameBtn"),cancelRenameBtn:$("cancelRenameBtn")};
const milestoneDefs=[{days:1,label:"存活一天",icon:"🌱"},{days:7,label:"滿一週",icon:"🪴"},{days:30,label:"滿月",icon:"🌙"},{days:100,label:"百日",icon:"💯"},{days:365,label:"一歲生日",icon:"🎂"},{days:1000,label:"千日傳說",icon:"🏆"}];

function loadState(){try{const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return{...defaultState};const p=JSON.parse(raw);return{name:typeof p.name==="string"&&p.name.trim()?p.name.trim():defaultState.name,startedAt:Number.isFinite(p.startedAt)?p.startedAt:null}}catch{return{...defaultState}}}
function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
const pad2=n=>String(n).padStart(2,"0");
function formatLocalDateTime(ts){if(!ts)return"—";return new Intl.DateTimeFormat("zh-TW",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(ts))}
function rankForDays(days){if(days>=1000)return"千日老祖";if(days>=365)return"一歲老碼表";if(days>=100)return"百日長老";if(days>=30)return"滿月碼表";if(days>=7)return"穩定存活中";if(days>=1)return"幼年碼表";return state.startedAt?"剛出生":"待機中的蛋"}
function getElapsed(){return state.startedAt?Math.max(0,Date.now()-state.startedAt):0}
function renderMilestones(totalDays){els.milestones.innerHTML=milestoneDefs.map(m=>{const done=totalDays>=m.days;const remaining=Math.max(0,m.days-totalDays);return `<div class="milestone ${done?"done":""}"><div class="left"><div class="badge">${m.icon}</div><div><strong>${m.label}</strong><br><small>${m.days.toLocaleString()} 天</small></div></div><small>${done?"已達成":`還差 ${remaining} 天`}</small></div>`}).join("")}
function render(){els.title.textContent=state.name;if(!state.startedAt){els.days.textContent="0";els.hours.textContent="00";els.minutes.textContent="00";els.seconds.textContent="00";els.startedAtText.textContent="—";els.rankText.textContent=rankForDays(0);els.statusPill.textContent="尚未出生";els.statusPill.className="status-pill stopped";els.startBtn.hidden=false;els.renameBtn.hidden=true;renderMilestones(0);return}const elapsed=getElapsed(),totalSeconds=Math.floor(elapsed/1000),totalDays=Math.floor(totalSeconds/86400),daySeconds=totalSeconds%86400,hours=Math.floor(daySeconds/3600),minutes=Math.floor((daySeconds%3600)/60),seconds=daySeconds%60;els.days.textContent=totalDays.toLocaleString();els.hours.textContent=pad2(hours);els.minutes.textContent=pad2(minutes);els.seconds.textContent=pad2(seconds);els.startedAtText.textContent=formatLocalDateTime(state.startedAt);els.rankText.textContent=rankForDays(totalDays);els.statusPill.textContent="存活中";els.statusPill.className="status-pill running";els.startBtn.hidden=true;els.renameBtn.hidden=false;renderMilestones(totalDays)}
function startPet(){if(state.startedAt)return;state={...state,startedAt:Date.now()};saveState();render()}
function openRenameDialog(){els.renameInput.value=state.name||"我的碼表";els.renameDialog.showModal();requestAnimationFrame(()=>{els.renameInput.focus();els.renameInput.select()})}
function saveRenameFromDialog(){const name=els.renameInput.value.trim();if(!name){alert("名字不能是空白");return false}state={...state,name};saveState();render();return true}

els.startBtn.addEventListener("click",startPet);
els.renameBtn.addEventListener("click",openRenameDialog);
els.renameForm.addEventListener("submit",e=>e.preventDefault());
els.saveRenameBtn.addEventListener("click",()=>{if(saveRenameFromDialog())els.renameDialog.close()});
els.cancelRenameBtn.addEventListener("click",()=>els.renameDialog.close());
els.renameInput.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();if(saveRenameFromDialog())els.renameDialog.close()}});

document.addEventListener("visibilitychange",()=>{if(!document.hidden){state=loadState();render()}});

if("serviceWorker" in navigator){
  let refreshing=false;
  let registration=null;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{if(refreshing)return;refreshing=true;window.location.reload()});
  window.addEventListener("load",async()=>{try{registration=await navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"});await registration.update()}catch(err){console.error("Service worker registration/update failed",err)}});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)registration?.update().catch(()=>{})});
  setInterval(()=>registration?.update().catch(()=>{}),60*60*1000);
}

render();setInterval(render,1000);
