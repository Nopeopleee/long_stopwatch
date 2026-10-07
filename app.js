const STORAGE_KEY="long-stopwatch-v1";
const MILESTONE_SEEN_KEY="dipai-last-seen-milestone-v1";
const LIFE_STAGE_SEEN_KEY="dipai-last-seen-life-stage-v1";
const CARE_DEBUG_KEY="disui-care-debug-v1";
const DEBUG_MODE=new URLSearchParams(location.search).get("debug")==="1"||["localhost","127.0.0.1","::1"].includes(location.hostname);
const defaultState={name:"我的碼表",startedAt:null,care:null};
let state=loadState();
const $=id=>document.getElementById(id);
const els={
  title:$("title"),statusPill:$("statusPill"),days:$("days"),hours:$("hours"),minutes:$("minutes"),seconds:$("seconds"),
  startedAtText:$("startedAtText"),rankText:$("rankText"),startBtn:$("startBtn"),renameBtn:$("renameBtn"),
  careStrip:$("careStrip"),careHint:$("careHint"),careFeedCount:$("careFeedCount"),feedBtn:$("feedBtn"),feedBtnLabel:$("feedBtnLabel"),
  milestoneSummary:$("milestoneSummary"),milestoneCount:$("milestoneCount"),milestoneProgress:$("milestoneProgress"),milestones:$("milestones"),
  recentMilestoneIcon:$("recentMilestoneIcon"),recentMilestoneTitle:$("recentMilestoneTitle"),recentMilestoneMeta:$("recentMilestoneMeta"),
  nextMilestoneIcon:$("nextMilestoneIcon"),nextMilestoneTitle:$("nextMilestoneTitle"),nextMilestoneMeta:$("nextMilestoneMeta"),
  milestoneToggle:$("milestoneToggle"),milestoneToggleText:$("milestoneToggleText"),milestoneArchive:$("milestoneArchive"),
  mascotStageShell:$("mascotStageShell"),mascotStageUse:$("mascotStageUse"),lifeStageText:$("lifeStageText"),
  evolutionOverlay:$("evolutionOverlay"),evolutionMascotUse:$("evolutionMascotUse"),evolutionStageTitle:$("evolutionStageTitle"),
  evolutionStageMeta:$("evolutionStageMeta"),evolutionDismiss:$("evolutionDismiss"),
  renameDialog:$("renameDialog"),renameForm:$("renameForm"),renameInput:$("renameInput"),saveRenameBtn:$("saveRenameBtn"),cancelRenameBtn:$("cancelRenameBtn"),
  liveStatus:$("liveStatus"),unlockToast:$("unlockToast"),unlockToastIcon:$("unlockToastIcon"),unlockToastTitle:$("unlockToastTitle"),
  unlockToastMeta:$("unlockToastMeta"),unlockToastDismiss:$("unlockToastDismiss"),
  backupReminder:$("backupReminder"),backupReminderTitle:$("backupReminderTitle"),backupReminderText:$("backupReminderText"),
  backupReminderDismiss:$("backupReminderDismiss"),backupReminderAction:$("backupReminderAction")
};
if(DEBUG_MODE){
  const settingsLink=document.querySelector('a.icon-link[href="./settings.html"]');
  if(settingsLink)settingsLink.href="./settings.html?debug=1";
}
const HOUR=60*60*1000,DAY=24*HOUR;
const CARE_COOLDOWN=12*HOUR;
const CARE_DEATH_ENABLED=false;
const careStatusDefs=[
  {at:0,key:"healthy",name:"健康"},
  {at:24*HOUR,key:"peckish",name:"有點餓"},
  {at:48*HOUR,key:"hungry",name:"飢餓"},
  {at:72*HOUR,key:"weak",name:"虛弱"},
  {at:96*HOUR,key:"sick",name:"生病"},
  {at:144*HOUR,key:"critical",name:"危急"},
  {at:168*HOUR,key:"dead",name:"死亡"}
];
const localDateTimeFormatter=new Intl.DateTimeFormat("zh-TW",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
const lifeStageDefs=[
  {at:0,key:"newborn",name:"新生滴",note:"剛凝聚出來的小水滴"},
  {at:1*DAY,key:"baby",name:"幼滴",note:"開始對這個世界有點好奇了"},
  {at:7*DAY,key:"growing",name:"成長滴",note:"身體和核心都漸漸穩定"},
  {at:30*DAY,key:"adult",name:"成熟滴",note:"已經長成可靠的長期夥伴"},
  {at:365*DAY,key:"companion",name:"老朋友",note:"陪伴留下了屬於你們的水紋"},
  {at:1000*DAY,key:"legend",name:"傳說滴",note:"時間把這隻滴歲養成了傳說"}
];
const milestoneDefs=[
  {at:1*HOUR,label:"第一滴",time:"1 小時",icon:"spark",rank:"第一滴"},
  {at:6*HOUR,label:"小小常駐",time:"6 小時",icon:"sunrise",rank:"穩定小滴"},
  {at:12*HOUR,label:"半日相伴",time:"12 小時",icon:"halfday",rank:"半日夥伴"},
  {at:1*DAY,label:"第一天",time:"1 天",icon:"sprout",rank:"幼年滴歲"},
  {at:3*DAY,label:"三日同行",time:"3 天",icon:"bubbles",rank:"三日同行者"},
  {at:7*DAY,label:"滿一週",time:"7 天",icon:"leaf",rank:"一週常駐"},
  {at:14*DAY,label:"兩週夥伴",time:"14 天",icon:"star",rank:"兩週夥伴"},
  {at:30*DAY,label:"滿月",time:"30 天",icon:"moon",rank:"滿月滴歲"},
  {at:50*DAY,label:"五十日",time:"50 天",icon:"gem",rank:"五十日老手"},
  {at:100*DAY,label:"百日紀念",time:"100 天",icon:"medal",rank:"百日長老"},
  {at:180*DAY,label:"半年相伴",time:"180 天",icon:"shield",rank:"半年守護者"},
  {at:365*DAY,label:"一歲生日",time:"365 天",icon:"cake",rank:"一歲滴歲"},
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
let lastCareStatusKey=null;

function createCare(now=Date.now()){
  return{activatedAt:now,lastFedAt:now,feedCount:0,diedAt:null};
}
function normalizeCare(care,startedAt,now=Date.now()){
  if(!startedAt)return null;
  const safeNow=Math.max(startedAt,now);
  if(!care||!Number.isFinite(care.lastFedAt))return createCare(safeNow);
  const activatedAt=Number.isFinite(care.activatedAt)
    ? Math.min(safeNow,Math.max(startedAt,care.activatedAt))
    : Math.min(safeNow,Math.max(startedAt,care.lastFedAt));
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
    const next={
      name:typeof p.name==="string"&&p.name.trim()?p.name.trim():defaultState.name,
      startedAt,
      care
    };
    if(startedAt&&JSON.stringify(p.care??null)!==JSON.stringify(care)){
      if(window.DisuiStorage)DisuiStorage.saveState(next,{snapshotBefore:false});
      else localStorage.setItem(STORAGE_KEY,JSON.stringify(next));
    }
    return next;
  }catch{return{...defaultState}}
}
function saveState(){
  if(window.DisuiStorage)DisuiStorage.saveState(state);
  else localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
}
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
function formatCareRemaining(ms){
  if(ms<=0)return"現在";
  const minutes=Math.ceil(ms/(60*1000));
  if(minutes<60)return`${minutes} 分鐘`;
  const hours=Math.floor(minutes/60),rest=minutes%60;
  if(hours<48)return rest?`${hours} 小時 ${rest} 分`:`${hours} 小時`;
  return`${Math.ceil(ms/DAY)} 天`;
}
function careStatusForElapsed(elapsed){
  let status=careStatusDefs[0];
  for(const candidate of careStatusDefs){
    if(elapsed<candidate.at)break;
    status=candidate;
  }
  if(!CARE_DEATH_ENABLED&&status.key==="dead")return careStatusDefs[5];
  return status;
}
function getCareDebugHours(){
  if(!DEBUG_MODE)return null;
  const value=Number(localStorage.getItem(CARE_DEBUG_KEY));
  return Number.isFinite(value)&&value>=0?value:null;
}
function getCareElapsed(now=Date.now()){
  const debugHours=getCareDebugHours();
  if(debugHours!==null)return debugHours*HOUR;
  return state.care?Math.max(0,now-state.care.lastFedAt):0;
}
function careHintFor(status,elapsed){
  if(status.key==="healthy"){
    const cooldown=CARE_COOLDOWN-elapsed;
    if(cooldown>0)return`還很飽・${formatCareRemaining(cooldown)}後可以再餵`;
    const hungryIn=24*HOUR-elapsed;
    return hungryIn>0?`現在可以餵食・距離開始餓還有 ${formatCareRemaining(hungryIn)}`:"開始有點餓了。";
  }
  if(status.key==="peckish")return"開始有點餓了，餵一下就會恢復精神。";
  if(status.key==="hungry")return"肚子餓了，現在很適合餵食。";
  if(status.key==="weak")return"有點沒力氣了，餵飽牠會恢復。";
  if(status.key==="sick")return"已經生病了，先餵飽牠讓狀態恢復。";
  if(status.key==="critical")return CARE_DEATH_ENABLED?"現在非常危險，請盡快照顧牠。":"現在很虛弱，但這一版還不會死亡，餵飽就能救回來。";
  return"旅程已經結束。";
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
  announce(`滴歲長大了：${stage.name}`);
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
function pulseMascot(className,duration=900){
  if(!els.mascotStageShell)return;
  els.mascotStageShell.classList.remove(className);
  requestAnimationFrame(()=>els.mascotStageShell.classList.add(className));
  setTimeout(()=>els.mascotStageShell?.classList.remove(className),duration);
}
function updateCareUI(now=Date.now(),{announceChange=false}={}){
  if(!state.startedAt||!state.care){
    lastCareStatusKey=null;
    if(els.careStrip)els.careStrip.hidden=true;
    if(els.mascotStageShell)els.mascotStageShell.dataset.careStatus="dormant";
    document.body.dataset.careStatus="dormant";
    return;
  }
  const elapsed=getCareElapsed(now);
  const status=careStatusForElapsed(elapsed);
  const debugActive=getCareDebugHours()!==null;
  const previous=lastCareStatusKey;
  lastCareStatusKey=status.key;
  if(els.careStrip)els.careStrip.hidden=false;
  if(els.careHint)els.careHint.textContent=(debugActive?"[測試] ":"")+careHintFor(status,elapsed);
  if(els.careFeedCount)els.careFeedCount.textContent=debugActive
    ?`測試模式・真實有效餵食 ${state.care.feedCount.toLocaleString()} 次`
    :`有效餵食 ${state.care.feedCount.toLocaleString()} 次`;
  document.body.classList.toggle("care-debug-active",debugActive);
  if(els.feedBtn&&els.feedBtnLabel){
    const remaining=Math.max(0,CARE_COOLDOWN-elapsed);
    const ready=remaining<=0;
    els.feedBtn.classList.toggle("is-ready",ready);
    els.feedBtn.dataset.careStatus=status.key;
    els.feedBtnLabel.textContent=ready?(status.key==="healthy"?"餵食":"餵飽牠"):"還很飽";
    els.feedBtn.setAttribute("aria-label",ready?"餵食滴歲":`滴歲還很飽，${formatCareRemaining(remaining)}後可以再餵`);
  }
  els.statusPill.textContent=status.name;
  els.statusPill.className=`status-pill running care-${status.key}`;
  if(els.mascotStageShell)els.mascotStageShell.dataset.careStatus=status.key;
  document.body.dataset.careStatus=status.key;
  if(announceChange&&previous&&previous!==status.key)announce(`滴歲的照顧狀態變成${status.name}`);
}
function feedPet(){
  if(!state.startedAt||!state.care)return;
  const now=Date.now();
  const elapsed=getCareElapsed(now);
  const remaining=CARE_COOLDOWN-elapsed;
  if(remaining>0){
    pulseMascot("is-nudged",620);
    if(els.careHint)els.careHint.textContent=`現在還很飽・${formatCareRemaining(remaining)}後再餵就好`;
    announce(`滴歲現在還很飽，${formatCareRemaining(remaining)}後再餵`);
    if(navigator.vibrate)navigator.vibrate(18);
    return;
  }
  if(DEBUG_MODE&&getCareDebugHours()!==null){
    localStorage.setItem(CARE_DEBUG_KEY,"0");
    updateCareUI(now);
    pulseMascot("is-fed",1050);
    if(els.careHint)els.careHint.textContent="[測試] 餵食成功，已模擬恢復健康；真實資料沒有變更。";
    announce("測試模式：餵食後已恢復健康，真實餵食資料沒有變更");
    if(navigator.vibrate)navigator.vibrate([35,35,65]);
    return;
  }
  state={
    ...state,
    care:{
      ...state.care,
      lastFedAt:now,
      feedCount:state.care.feedCount+1,
      diedAt:null
    }
  };
  saveState();
  updateCareUI(now);
  pulseMascot("is-fed",1050);
  if(els.careHint)els.careHint.textContent="吃飽了，現在精神很好。";
  announce(`滴歲吃飽了，累積有效餵食 ${state.care.feedCount} 次`);
  if(navigator.vibrate)navigator.vibrate([35,35,65]);
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
  else els.milestoneSummary.textContent="17 個里程碑全部解鎖。這隻滴歲已經成精。";

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
    updateCareUI();
    updateClock(0);updateRank(0);updateLifeStage(0,{animateEvolution:false});updateMilestones(0,{animateUnlock:false});
    return;
  }

  const elapsed=getElapsed();
  els.startBtn.hidden=true;els.renameBtn.hidden=false;
  updateClock(elapsed);updateRank(elapsed);updateLifeStage(elapsed,{animateEvolution:false});updateCareUI();updateMilestones(elapsed,{animateUnlock});
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
  const careStatus=careStatusForElapsed(getCareElapsed());
  if(careStatus.key!==lastCareStatusKey)updateCareUI(Date.now(),{announceChange:true});
}
function refreshMilestoneDetails(){
  if(!state.startedAt)return;
  const elapsed=getElapsed();
  updateMilestones(elapsed,{animateUnlock:false});
  updateCareUI();
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
function updateBackupReminder(){
  if(!els.backupReminder||!state.startedAt||!window.DisuiStorage){if(els.backupReminder)els.backupReminder.hidden=true;return}
  const {lastExportAt,dismissedAt}=DisuiStorage.getBackupHealth();
  const reference=lastExportAt||state.startedAt;
  const age=Date.now()-reference;
  const dismissedRecently=Number.isFinite(dismissedAt)&&Date.now()-dismissedAt<7*DAY;
  if(age<60*DAY||dismissedRecently){els.backupReminder.hidden=true;return}
  const days=Math.floor(age/DAY);
  els.backupReminderTitle.textContent=lastExportAt?"外部備份有點久了":"這隻滴歲還沒有外部備份";
  els.backupReminderText.textContent=age>=90*DAY
    ?`已經 ${days.toLocaleString()} 天沒有匯出 JSON。IndexedDB 副本無法抵抗清除網站資料。`
    :`距離上次外部備份約 ${days.toLocaleString()} 天；有空時匯出一份 JSON 會更安心。`;
  if(DEBUG_MODE&&els.backupReminderAction)els.backupReminderAction.href="./settings.html?debug=1#data-safety";
  els.backupReminder.hidden=false;
}
async function reconcileStorageSafety({rerender=true}={}){
  if(!window.DisuiStorage)return;
  try{
    const result=await DisuiStorage.reconcile();
    if(result.action==="conflict"&&result.conflict){
      const localDesc=DisuiStorage.describeState(result.conflict.local.state);
      const mirrorDesc=DisuiStorage.describeState(result.conflict.mirror.state);
      const keepLocal=confirm(`發現兩份不同的滴歲資料。\n\n目前主資料：${localDesc}\n安全副本：${mirrorDesc}\n\n按「確定」保留目前主資料；按「取消」改用安全副本。`);
      await DisuiStorage.resolveConflict(keepLocal?"local":"mirror",result.conflict);
    }else if(result.action==="no-valid-state"){
      alert("滴歲的本機資料損壞，而且安全副本與復原點都無法使用。請到設定頁匯入 JSON 備份。");
    }
    const recovered=loadState();
    const changed=JSON.stringify(recovered)!==JSON.stringify(state);
    state=recovered;
    if(rerender||changed){
      previousDoneCount=null;lastMilestoneCount=null;lastLifeStageIndex=null;lastCareStatusKey=null;
      renderPetState();
    }
    await DisuiStorage.ensureDailySnapshot(state).catch(()=>{});
    updateBackupReminder();
  }catch(error){
    console.warn("Storage safety reconciliation failed",error);
    updateBackupReminder();
  }
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
  const bornAt=Date.now();
  state={...state,startedAt:bornAt,care:createCare(bornAt)};
  saveState();previousDoneCount=null;lastMilestoneCount=null;lastLifeStageIndex=null;lastCareStatusKey=null;saveMilestoneSeen(0);saveLifeStageSeen(0);
  renderPetState();startUiTimers();announce("滴歲出生了");
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
els.feedBtn?.addEventListener("click",feedPet);
els.milestoneToggle?.addEventListener("click",toggleMilestoneArchive);
els.backupReminderDismiss?.addEventListener("click",()=>{
  DisuiStorage?.dismissBackupReminder();
  if(els.backupReminder)els.backupReminder.hidden=true;
});

document.addEventListener("visibilitychange",()=>{
  if(document.hidden){stopUiTimers();return}
  state=loadState();previousDoneCount=null;lastMilestoneCount=null;lastLifeStageIndex=null;lastCareStatusKey=null;
  renderPetState();surfaceMissedMilestones();surfaceMissedLifeStage();startUiTimers();reconcileStorageSafety({rerender:false});
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
reconcileStorageSafety({rerender:false});
