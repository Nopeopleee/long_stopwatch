const STORAGE_KEY="long-stopwatch-v1";
const MILESTONE_SEEN_KEY="dipai-last-seen-milestone-v1";
const LIFE_STAGE_SEEN_KEY="dipai-last-seen-life-stage-v1";
const defaultState={name:"我的碼表",startedAt:null};
let state=loadState();
const $=id=>document.getElementById(id);
const els={
  title:$("title"),statusPill:$("statusPill"),days:$("days"),hours:$("hours"),minutes:$("minutes"),seconds:$("seconds"),
  startedAtText:$("startedAtText"),rankText:$("rankText"),startBtn:$("startBtn"),renameBtn:$("renameBtn"),
  milestoneSummary:$("milestoneSummary"),milestoneCount:$("milestoneCount"),milestoneProgress:$("milestoneProgress"),milestones:$("milestones"),
  recentMilestoneIcon:$("recentMilestoneIcon"),recentMilestoneTitle:$("recentMilestoneTitle"),recentMilestoneMeta:$("recentMilestoneMeta"),
  nextMilestoneIcon:$("nextMilestoneIcon"),nextMilestoneTitle:$("nextMilestoneTitle"),nextMilestoneMeta:$("nextMilestoneMeta"),
  milestoneToggle:$("milestoneToggle"),milestoneToggleText:$("milestoneToggleText"),milestoneArchive:$("milestoneArchive"),
  mascotStageShell:$("mascotStageShell"),mascotStageUse:$("mascotStageUse"),lifeStageText:$("lifeStageText"),
  evolutionOverlay:$("evolutionOverlay"),evolutionMascotUse:$("evolutionMascotUse"),evolutionStageTitle:$("evolutionStageTitle"),
  evolutionStageMeta:$("evolutionStageMeta"),evolutionDismiss:$("evolutionDismiss"),
  renameDialog:$("renameDialog"),renameForm:$("renameForm"),renameInput:$("renameInput"),saveRenameBtn:$("saveRenameBtn"),cancelRenameBtn:$("cancelRenameBtn"),
  liveStatus:$("liveStatus"),unlockToast:$("unlockToast"),unlockToastIcon:$("unlockToastIcon"),unlockToastTitle:$("unlockToastTitle"),
  unlockToastMeta:$("unlockToastMeta"),unlockToastDismiss:$("unlockToastDismiss")
};
const HOUR=60*60*1000,DAY=24*HOUR;
const localDateTimeFormatter=new Intl.DateTimeFormat("zh-TW",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
const lifeStageDefs=[
  {at:0,key:"newborn",name:"新生滴",note:"剛凝聚出來的小水滴"},
  {at:1*DAY,key:"baby",name:"幼滴",note:"開始對這個世界有點好奇了"},
  {at:7*DAY,key:"growing",name:"成長滴",note:"身體和核心都漸漸穩定"},
  {at:30*DAY,key:"adult",name:"成熟滴",note:"已經長成可靠的長期夥伴"},
  {at:365*DAY,key:"companion",name:"老朋友",note:"陪伴留下了屬於你們的水紋"},
  {at:1000*DAY,key:"legend",name:"傳說滴",note:"時間把這隻滴派養成了傳說"}
];
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
let unlockToastTimer=null;
let lastLifeStageIndex=null;
let evolutionTimer=null;

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
function loadMilestoneSeen(){
  if(!state.startedAt)return null;
  try{
    const raw=localStorage.getItem(MILESTONE_SEEN_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    if(parsed?.startedAt!==state.startedAt||!Number.isInteger(parsed?.count))return null;
    return Math.max(0,Math.min(milestoneDefs.length,parsed.count));
  }catch{return null}
}
function saveMilestoneSeen(count){
  if(!state.startedAt){localStorage.removeItem(MILESTONE_SEEN_KEY);return}
  localStorage.setItem(MILESTONE_SEEN_KEY,JSON.stringify({startedAt:state.startedAt,count:Math.max(0,Math.min(milestoneDefs.length,count)),seenAt:Date.now()}));
}
function loadLifeStageSeen(){
  if(!state.startedAt)return null;
  try{
    const raw=localStorage.getItem(LIFE_STAGE_SEEN_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    if(parsed?.startedAt!==state.startedAt||!Number.isInteger(parsed?.index))return null;
    return Math.max(0,Math.min(lifeStageDefs.length-1,parsed.index));
  }catch{return null}
}
function saveLifeStageSeen(index){
  if(!state.startedAt){localStorage.removeItem(LIFE_STAGE_SEEN_KEY);return}
  localStorage.setItem(LIFE_STAGE_SEEN_KEY,JSON.stringify({
    startedAt:state.startedAt,
    index:Math.max(0,Math.min(lifeStageDefs.length-1,index)),
    seenAt:Date.now()
  }));
}
const pad2=n=>String(n).padStart(2,"0");
function formatLocalDateTime(ts){return ts?localDateTimeFormatter.format(new Date(ts)):"—"}
function getElapsed(){return state.startedAt?Math.max(0,Date.now()-state.startedAt):0}
function milestoneCountForElapsed(elapsed){
  const index=milestoneDefs.findIndex(m=>elapsed<m.at);
  return index===-1?milestoneDefs.length:index;
}
function lifeStageIndexForElapsed(elapsed){
  let index=0;
  for(let i=1;i<lifeStageDefs.length;i++){
    if(elapsed<lifeStageDefs[i].at)break;
    index=i;
  }
  return index;
}
function lifeStageForElapsed(elapsed){return lifeStageDefs[lifeStageIndexForElapsed(elapsed)]}
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
function setMilestoneIcon(useElement,icon){useElement?.setAttribute("href",`./icons/milestones.svg#${icon}`)}
function setMascotIcon(useElement,key){useElement?.setAttribute("href",`./icons/mascots.svg#${key}`)}
function hideEvolution(){
  if(!els.evolutionOverlay)return;
  clearTimeout(evolutionTimer);evolutionTimer=null;
  els.evolutionOverlay.classList.remove("is-visible");
  setTimeout(()=>{if(!els.evolutionOverlay.classList.contains("is-visible"))els.evolutionOverlay.hidden=true},320);
}
function showEvolution(fromIndex,toIndex,{missed=false}={}){
  if(toIndex<=fromIndex)return;
  const stage=lifeStageDefs[toIndex];
  if(!stage)return;
  setMascotIcon(els.evolutionMascotUse,stage.key);
  if(els.evolutionStageTitle)els.evolutionStageTitle.textContent=stage.name;
  if(els.evolutionStageMeta){
    const jumped=toIndex-fromIndex;
    els.evolutionStageMeta.textContent=jumped>1
      ? `你離開期間一口氣跨過 ${jumped} 個階段・${stage.note}`
      : missed?`你離開時悄悄長大了・${stage.note}`:stage.note;
  }
  els.mascotStageShell?.classList.remove("is-evolving");
  requestAnimationFrame(()=>els.mascotStageShell?.classList.add("is-evolving"));
  setTimeout(()=>els.mascotStageShell?.classList.remove("is-evolving"),1700);
  if(els.evolutionOverlay){
    els.evolutionOverlay.hidden=false;
    requestAnimationFrame(()=>els.evolutionOverlay.classList.add("is-visible"));
    clearTimeout(evolutionTimer);
    evolutionTimer=setTimeout(hideEvolution,4600);
  }
  announce(`滴派長大了：${stage.name}`);
  if(navigator.vibrate)navigator.vibrate([55,45,95]);
}
function updateLifeStage(elapsed=getElapsed(),{animateEvolution=false}={}){
  const index=state.startedAt?lifeStageIndexForElapsed(elapsed):0;
  const stage=lifeStageDefs[index];
  setMascotIcon(els.mascotStageUse,stage.key);
  if(els.mascotStageShell)els.mascotStageShell.dataset.stage=state.startedAt?stage.key:"dormant";
  if(els.lifeStageText)els.lifeStageText.textContent=state.startedAt?stage.name:"尚未出生";
  document.body.dataset.lifeStage=state.startedAt?stage.key:"dormant";
  if(animateEvolution&&lastLifeStageIndex!==null&&index>lastLifeStageIndex){
    showEvolution(lastLifeStageIndex,index);
    saveLifeStageSeen(index);
  }
  lastLifeStageIndex=index;
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
function updateJourneyGlance(elapsed,resolvedDoneCount,next){
  const latest=resolvedDoneCount>0?milestoneDefs[resolvedDoneCount-1]:null;

  if(latest){
    setMilestoneIcon(els.recentMilestoneIcon,latest.icon);
    els.recentMilestoneTitle.textContent=latest.label;
    els.recentMilestoneMeta.textContent=`${latest.time}・已解鎖`;
  }else{
    setMilestoneIcon(els.recentMilestoneIcon,"spark");
    els.recentMilestoneTitle.textContent=state.startedAt?"旅程剛開始":"還沒開始旅程";
    els.recentMilestoneMeta.textContent=state.startedAt?"第一滴正在靠近":"開始養之後才會累積里程碑";
  }

  if(next){
    setMilestoneIcon(els.nextMilestoneIcon,next.icon);
    els.nextMilestoneTitle.textContent=next.label;
    els.nextMilestoneMeta.textContent=state.startedAt?`還差 ${formatRemaining(next.at-elapsed)}`:`開始養後 ${next.time}`;
  }else{
    setMilestoneIcon(els.nextMilestoneIcon,"galaxy");
    els.nextMilestoneTitle.textContent="全部完成";
    els.nextMilestoneMeta.textContent="十年神話已經寫完";
  }
}
function animateMilestoneRange(fromCount,toCount){
  for(let i=fromCount;i<toCount;i++){
    const item=milestoneViews[i]?.item;
    if(!item)continue;
    item.classList.remove("just-unlocked");
    requestAnimationFrame(()=>{
      item.classList.add("just-unlocked");
      setTimeout(()=>item.classList.remove("just-unlocked"),900);
    });
  }
}
function hideUnlockToast(){
  if(!els.unlockToast)return;
  clearTimeout(unlockToastTimer);unlockToastTimer=null;
  els.unlockToast.classList.remove("is-visible");
  setTimeout(()=>{if(!els.unlockToast.classList.contains("is-visible"))els.unlockToast.hidden=true},220);
}
function showMissedUnlocks(fromCount,toCount){
  const unlocked=milestoneDefs.slice(fromCount,toCount);
  if(!unlocked.length)return;
  const latest=unlocked[unlocked.length-1];
  animateMilestoneRange(fromCount,toCount);

  if(els.unlockToast){
    els.unlockToastIcon?.setAttribute("href",`./icons/milestones.svg#${latest.icon}`);
    els.unlockToastTitle.textContent=latest.label;
    els.unlockToastMeta.textContent=unlocked.length===1
      ? `${latest.time}・你離開時悄悄達成了`
      : `離開期間共解鎖 ${unlocked.length} 個・最新是 ${latest.time}`;
    els.unlockToast.hidden=false;
    requestAnimationFrame(()=>els.unlockToast.classList.add("is-visible"));
    clearTimeout(unlockToastTimer);
    unlockToastTimer=setTimeout(hideUnlockToast,7000);
  }

  const names=unlocked.map(m=>m.label).join("、");
  announce(`歡迎回來，離開期間解鎖里程碑：${names}`);
  if(navigator.vibrate)navigator.vibrate([45,45,75]);
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
  updateJourneyGlance(elapsed,resolvedDoneCount,next);

  if(!state.startedAt)els.milestoneSummary.textContent="旅程會從第一滴開始。";
  else if(next)els.milestoneSummary.textContent=`已完成 ${resolvedDoneCount} 個里程碑・正在前往 ${next.label}`;
  else els.milestoneSummary.textContent="17 個里程碑全部解鎖。這隻滴派已經成精。";

  milestoneDefs.forEach((m,index)=>{
    const done=elapsed>=m.at;
    const view=milestoneViews[index];
    view.item.classList.toggle("done",done);
    view.status.textContent=done?"已解鎖":`還差 ${formatRemaining(m.at-elapsed)}`;
  });

  if(animateUnlock&&previousDoneCount!==null&&resolvedDoneCount>previousDoneCount){
    const unlocked=milestoneDefs.slice(previousDoneCount,resolvedDoneCount);
    animateMilestoneRange(previousDoneCount,resolvedDoneCount);
    if(unlocked.length)announce(`里程碑解鎖：${unlocked.map(m=>m.label).join("、")}`);
    if(navigator.vibrate)navigator.vibrate(45);
    saveMilestoneSeen(resolvedDoneCount);
  }

  previousDoneCount=resolvedDoneCount;
  lastMilestoneCount=resolvedDoneCount;
}
function renderPetState({animateUnlock=false}={}){
  els.title.textContent=state.name;
  document.body.classList.toggle("has-pet",Boolean(state.startedAt));
  els.startedAtText.textContent=formatLocalDateTime(state.startedAt);

  if(!state.startedAt){
    localStorage.removeItem(MILESTONE_SEEN_KEY);
    localStorage.removeItem(LIFE_STAGE_SEEN_KEY);
    els.statusPill.textContent="尚未出生";els.statusPill.className="status-pill stopped";
    els.startBtn.hidden=false;els.renameBtn.hidden=true;
    updateClock(0);updateRank(0);updateLifeStage(0,{animateEvolution:false});updateMilestones(0,{animateUnlock:false});
    return;
  }

  const elapsed=getElapsed();
  els.statusPill.textContent="存活中";els.statusPill.className="status-pill running";
  els.startBtn.hidden=true;els.renameBtn.hidden=false;
  updateClock(elapsed);updateRank(elapsed);updateLifeStage(elapsed,{animateEvolution:false});updateMilestones(elapsed,{animateUnlock});
}
function surfaceMissedMilestones(){
  if(!state.startedAt)return;
  const currentCount=milestoneCountForElapsed(getElapsed());
  const seenCount=loadMilestoneSeen();
  // 第一次升級到這套機制時，把當前進度當作基準，避免舊里程碑一次全部重播。
  if(seenCount===null){saveMilestoneSeen(currentCount);return}
  if(currentCount<=seenCount)return;
  showMissedUnlocks(seenCount,currentCount);
  saveMilestoneSeen(currentCount);
}
function surfaceMissedLifeStage(){
  if(!state.startedAt)return;
  const currentIndex=lifeStageIndexForElapsed(getElapsed());
  const seenIndex=loadLifeStageSeen();
  // 第一次拿到生命階段功能時，以當前階段為基準，不補播過去所有成長演出。
  if(seenIndex===null){saveLifeStageSeen(currentIndex);return}
  if(currentIndex<=seenIndex)return;
  showEvolution(seenIndex,currentIndex,{missed:true});
  saveLifeStageSeen(currentIndex);
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
  const currentLifeStageIndex=lifeStageIndexForElapsed(elapsed);
  if(currentLifeStageIndex!==lastLifeStageIndex){
    updateLifeStage(elapsed,{animateEvolution:true});
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
function toggleMilestoneArchive(){
  if(!els.milestoneArchive||!els.milestoneToggle)return;
  const willOpen=els.milestoneArchive.hidden;
  els.milestoneArchive.hidden=!willOpen;
  els.milestoneToggle.setAttribute("aria-expanded",String(willOpen));
  els.milestoneToggleText.textContent=willOpen?"收起完整旅程":`查看全部 ${milestoneDefs.length} 個里程碑`;
  if(willOpen)announce("已展開完整里程碑列表");
}
function startPet(){
  if(state.startedAt)return;
  state={...state,startedAt:Date.now()};
  saveState();previousDoneCount=null;lastMilestoneCount=null;lastLifeStageIndex=null;saveMilestoneSeen(0);saveLifeStageSeen(0);
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
els.unlockToastDismiss?.addEventListener("click",hideUnlockToast);
els.evolutionDismiss?.addEventListener("click",hideEvolution);
els.milestoneToggle?.addEventListener("click",toggleMilestoneArchive);

document.addEventListener("visibilitychange",()=>{
  if(document.hidden){stopUiTimers();return}
  state=loadState();previousDoneCount=null;lastMilestoneCount=null;lastLifeStageIndex=null;
  renderPetState();surfaceMissedMilestones();surfaceMissedLifeStage();startUiTimers();
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
surfaceMissedMilestones();
surfaceMissedLifeStage();
startUiTimers();
