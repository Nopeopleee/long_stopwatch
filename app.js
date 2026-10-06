const STORAGE_KEY="long-stopwatch-v1";
const defaultState={name:"我的碼表",startedAt:null};
let state=loadState();
const $=id=>document.getElementById(id);
const els={
  title:$("title"),statusPill:$("statusPill"),days:$("days"),hours:$("hours"),minutes:$("minutes"),seconds:$("seconds"),
  startedAtText:$("startedAtText"),rankText:$("rankText"),startBtn:$("startBtn"),renameBtn:$("renameBtn"),
  milestoneSummary:$("milestoneSummary"),milestoneCount:$("milestoneCount"),milestoneProgress:$("milestoneProgress"),milestones:$("milestones"),
  renameDialog:$("renameDialog"),renameForm:$("renameForm"),renameInput:$("renameInput"),saveRenameBtn:$("saveRenameBtn"),cancelRenameBtn:$("cancelRenameBtn"),
  liveStatus:$("liveStatus")
};
const HOUR=60*60*1000,DAY=24*HOUR;
const localDateTimeFormatter=new Intl.DateTimeFormat("zh-TW",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
const milestoneDefs=[
  {at:1*HOUR,label:"第一滴",time:"1 小時",icon:"spark",rank:"第一滴"},
  {at:6*HOUR,label:"小小常駐",time:"6 小時",icon:"sunrise",rank:"穩定小滴"},
  {at:12*HOUR,label:"半日相伴",time:"12 小時",icon:"halfday",rank:"半日夥伴"},
  {at:1*DAY,label:"第一天",time:"1 天",icon:"sprout",rank:"幼年滴派"},
  {at:3*DAY,label:"三日同行",time:"3 天",icon:"bubbles",rank:"三日同行者"},
  {at:7*DAY,label:"滿一週",time:"7 天",icon:"leaf",rank:"一週常駐"},
  {at:14*DAY,label:"兩週夥伴",time:"14 天",icon:"star",rank:"兩週夥伴"},
  {at:30*DAY,label:"滿月",time:"30 天",icon:"moon",rank:"滿月滴派"},
  {at:50*DAY,label:"五十日",time:"50 天",icon:"gem",rank:"五十日老手"},
  {at:100*DAY,label:"百日紀念",time:"100 天",icon:"medal",rank:"百日長老"},
  {at:180*DAY,label:"半年相伴",time:"180 天",icon:"shield",rank:"半年守護者"},
  {at:365*DAY,label:"一歲生日",time:"365 天",icon:"cake",rank:"一歲滴派"},
  {at:500*DAY,label:"五百日",time:"500 天",icon:"crown",rank:"五百日元老"},
  {at:730*DAY,label:"兩週年",time:"730 天",icon:"rings",rank:"兩週年老友"},
  {at:1000*DAY,label:"千日傳說",time:"1,000 天",icon:"trophy",rank:"千日老祖"},
  {at:2000*DAY,label:"兩千日",time:"2,000 天",icon:"comet",rank:"兩千日傳說"},
  {at:3650*DAY,label:"十年神話",time:"3,650 天",icon:"galaxy",rank:"十年神話"}
];

let milestoneViews=[];
let previousDoneCount=null;
let lastMilestoneCount=null;
let clockTimer=null;
let milestoneTimer=null;

function loadState(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw)return{...defaultState};
    const p=JSON.parse(raw);
    return{
      name:typeof p.name==="string"&&p.name.trim()?p.name.trim():defaultState.name,
      startedAt:Number.isFinite(p.startedAt)?p.startedAt:null
    };
  }catch{return{...defaultState}}
}
function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
const pad2=n=>String(n).padStart(2,"0");
function formatLocalDateTime(ts){return ts?localDateTimeFormatter.format(new Date(ts)):"—"}
function getElapsed(){return state.startedAt?Math.max(0,Date.now()-state.startedAt):0}
function milestoneCountForElapsed(elapsed){
  const index=milestoneDefs.findIndex(m=>elapsed<m.at);
  return index===-1?milestoneDefs.length:index;
}
function rankForElapsed(elapsed){
  if(!state.startedAt)return"待機中的蛋";
  const count=milestoneCountForElapsed(elapsed);
  return count===0?"剛出生":milestoneDefs[count-1].rank;
}
function formatRemaining(ms){
  if(ms<60*1000)return"不到 1 分鐘";
  if(ms<DAY){
    const minutes=Math.ceil(ms/(60*1000));
    if(minutes<60)return`${minutes} 分鐘`;
    return`${Math.ceil(ms/HOUR)} 小時`;
  }
  return`${Math.ceil(ms/DAY).toLocaleString()} 天`;
}
function announce(message){
  if(!els.liveStatus)return;
  els.liveStatus.textContent="";
  requestAnimationFrame(()=>{els.liveStatus.textContent=message});
}
function initMilestones(){
  els.milestones.innerHTML="";
  milestoneViews=milestoneDefs.map(m=>{
    const item=document.createElement("div");
    item.className="milestone";
    item.innerHTML=`<div class="left"><div class="badge" aria-hidden="true"><svg viewBox="0 0 64 64"><use href="./icons/milestones.svg#${m.icon}"></use></svg></div><div class="milestone-copy"><strong>${m.label}</strong><small>${m.time}</small></div></div><small class="milestone-status"></small>`;
    els.milestones.appendChild(item);
    return{item,status:item.querySelector(".milestone-status")};
  });
}
function updateClock(elapsed=getElapsed()){
  if(!state.startedAt){
    els.days.textContent="0";els.hours.textContent="00";els.minutes.textContent="00";els.seconds.textContent="00";
    return;
  }
  const totalSeconds=Math.floor(elapsed/1000),totalDays=Math.floor(totalSeconds/86400),daySeconds=totalSeconds%86400;
  els.days.textContent=totalDays.toLocaleString();
  els.hours.textContent=pad2(Math.floor(daySeconds/3600));
  els.minutes.textContent=pad2(Math.floor((daySeconds%3600)/60));
  els.seconds.textContent=pad2(daySeconds%60);
}
function updateRank(elapsed=getElapsed()){els.rankText.textContent=rankForElapsed(elapsed)}
function updateMilestones(elapsed=getElapsed(),{animateUnlock=true}={}){
  const resolvedDoneCount=milestoneCountForElapsed(elapsed);
  const next=milestoneDefs[resolvedDoneCount]??null;
  const prevAt=resolvedDoneCount===0?0:milestoneDefs[resolvedDoneCount-1].at;
  const progress=next?Math.max(0,Math.min(100,(elapsed-prevAt)/(next.at-prevAt)*100)):100;

  els.milestoneCount.textContent=`${resolvedDoneCount} / ${milestoneDefs.length}`;
  els.milestoneProgress.style.width=`${progress}%`;

  if(!state.startedAt)els.milestoneSummary.textContent="開始養之後就會累積里程碑。";
  else if(next)els.milestoneSummary.textContent=`下一個：${next.label}・還差 ${formatRemaining(next.at-elapsed)}`;
  else els.milestoneSummary.textContent="全部里程碑都解鎖了。這隻滴派已經成精。";

  milestoneDefs.forEach((m,index)=>{
    const done=elapsed>=m.at;
    const view=milestoneViews[index];
    view.item.classList.toggle("done",done);
    view.status.textContent=done?"已解鎖":`還差 ${formatRemaining(m.at-elapsed)}`;
  });

  if(animateUnlock&&previousDoneCount!==null&&resolvedDoneCount>previousDoneCount){
    const unlocked=[];
    for(let i=previousDoneCount;i<resolvedDoneCount;i++){
      const item=milestoneViews[i]?.item;
      if(!item)continue;
      unlocked.push(milestoneDefs[i].label);
      item.classList.remove("just-unlocked");
      requestAnimationFrame(()=>{
        item.classList.add("just-unlocked");
        setTimeout(()=>item.classList.remove("just-unlocked"),900);
      });
    }
    if(unlocked.length)announce(`里程碑解鎖：${unlocked.join("、")}`);
    if(navigator.vibrate)navigator.vibrate(45);
  }

  previousDoneCount=resolvedDoneCount;
  lastMilestoneCount=resolvedDoneCount;
}
function renderPetState({animateUnlock=false}={}){
  els.title.textContent=state.name;
  document.body.classList.toggle("has-pet",Boolean(state.startedAt));
  els.startedAtText.textContent=formatLocalDateTime(state.startedAt);

  if(!state.startedAt){
    els.statusPill.textContent="尚未出生";els.statusPill.className="status-pill stopped";
    els.startBtn.hidden=false;els.renameBtn.hidden=true;
    updateClock(0);updateRank(0);updateMilestones(0,{animateUnlock:false});
    return;
  }

  const elapsed=getElapsed();
  els.statusPill.textContent="存活中";els.statusPill.className="status-pill running";
  els.startBtn.hidden=true;els.renameBtn.hidden=false;
  updateClock(elapsed);updateRank(elapsed);updateMilestones(elapsed,{animateUnlock});
}
function tickClock(){
  if(!state.startedAt)return;
  const elapsed=getElapsed();
  updateClock(elapsed);
  const currentMilestoneCount=milestoneCountForElapsed(elapsed);
  if(currentMilestoneCount!==lastMilestoneCount){
    updateRank(elapsed);
    updateMilestones(elapsed,{animateUnlock:true});
  }
}
function refreshMilestoneDetails(){
  if(!state.startedAt)return;
  const elapsed=getElapsed();
  updateMilestones(elapsed,{animateUnlock:false});
}
function startUiTimers(){
  stopUiTimers();
  if(document.hidden)return;
  clockTimer=setInterval(tickClock,1000);
  milestoneTimer=setInterval(refreshMilestoneDetails,60*1000);
}
function stopUiTimers(){
  if(clockTimer){clearInterval(clockTimer);clockTimer=null}
  if(milestoneTimer){clearInterval(milestoneTimer);milestoneTimer=null}
}
function startPet(){
  if(state.startedAt)return;
  state={...state,startedAt:Date.now()};
  saveState();previousDoneCount=null;lastMilestoneCount=null;
  renderPetState();startUiTimers();announce("滴派出生了");
}
function openRenameDialog(){
  els.renameInput.value=state.name||"我的碼表";
  els.renameDialog.showModal();
  requestAnimationFrame(()=>{els.renameInput.focus();els.renameInput.select()});
}
function saveRenameFromDialog(){
  const name=els.renameInput.value.trim();
  if(!name){alert("名字不能是空白");return false}
  state={...state,name};saveState();els.title.textContent=state.name;announce(`名字已改成 ${state.name}`);return true;
}

els.startBtn.addEventListener("click",startPet);
els.renameBtn.addEventListener("click",openRenameDialog);
els.renameForm.addEventListener("submit",e=>e.preventDefault());
els.saveRenameBtn.addEventListener("click",()=>{if(saveRenameFromDialog())els.renameDialog.close()});
els.cancelRenameBtn.addEventListener("click",()=>els.renameDialog.close());
els.renameInput.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();if(saveRenameFromDialog())els.renameDialog.close()}});

document.addEventListener("visibilitychange",()=>{
  if(document.hidden){stopUiTimers();return}
  state=loadState();previousDoneCount=null;lastMilestoneCount=null;renderPetState();startUiTimers();
});

if("serviceWorker" in navigator){
  let refreshing=false;
  let registration=null;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{if(refreshing)return;refreshing=true;window.location.reload()});
  window.addEventListener("load",async()=>{try{registration=await navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"});await registration.update()}catch(err){console.error("Service worker registration/update failed",err)}});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)registration?.update().catch(()=>{})});
  setInterval(()=>registration?.update().catch(()=>{}),60*60*1000);
}

initMilestones();
renderPetState();
startUiTimers();
