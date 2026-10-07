(() => {
  "use strict";

  const STORAGE_KEY="long-stopwatch-v1";
  const LOCAL_META_KEY="disui-storage-meta-v1";
  const BACKUP_HEALTH_KEY="disui-backup-health-v1";
  const BACKUP_DISMISS_KEY="disui-backup-reminder-dismissed-v1";
  const LAST_REPAIR_KEY="disui-last-storage-repair-v1";
  const DB_NAME="disui-storage-v1";
  const DB_VERSION=1;
  const RECORDS="records";
  const SNAPSHOTS="snapshots";
  const MIRROR_KEY="pet-state";
  const MAX_SNAPSHOTS=10;
  const DAY=24*60*60*1000;
  const FUTURE_TOLERANCE=60*1000;
  let dbPromise=null;
  let writeQueue=Promise.resolve();

  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const now=()=>Date.now();

  function canonicalState(state){
    if(!state||typeof state!=="object")return null;
    return{
      name:typeof state.name==="string"?state.name:"",
      startedAt:state.startedAt??null,
      care:state.care?{
        activatedAt:state.care.activatedAt??null,
        lastFedAt:state.care.lastFedAt??null,
        feedCount:state.care.feedCount??0,
        diedAt:state.care.diedAt??null
      }:null
    };
  }
  function signature(state){return JSON.stringify(canonicalState(state))}

  function validateState(state,{at=now()}={}){
    const errors=[];
    if(!state||typeof state!=="object")return{valid:false,errors:["state 不是物件"]};
    if(typeof state.name!=="string"||!state.name.trim())errors.push("name 無效");
    const born=state.startedAt!==null&&state.startedAt!==undefined;
    if(born){
      if(!Number.isFinite(state.startedAt)||state.startedAt<0)errors.push("startedAt 無效");
      else if(state.startedAt>at+FUTURE_TOLERANCE)errors.push("startedAt 在未來");
    }
    if(!born&&state.care!=null)errors.push("未出生卻有 care");
    if(born&&state.care!=null){
      const c=state.care;
      if(typeof c!=="object")errors.push("care 無效");
      else{
        if(!Number.isFinite(c.activatedAt)||c.activatedAt<state.startedAt||c.activatedAt>at+FUTURE_TOLERANCE)errors.push("activatedAt 無效");
        if(!Number.isFinite(c.lastFedAt)||c.lastFedAt<state.startedAt||c.lastFedAt>at+FUTURE_TOLERANCE)errors.push("lastFedAt 無效");
        if(!Number.isInteger(c.feedCount)||c.feedCount<0)errors.push("feedCount 無效");
        if(c.diedAt!==null&&c.diedAt!==undefined){
          if(!Number.isFinite(c.diedAt)||c.diedAt<state.startedAt||c.diedAt>at+FUTURE_TOLERANCE)errors.push("diedAt 無效");
        }
      }
    }
    return{valid:errors.length===0,errors};
  }

  function readLocalRaw(){
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw===null)return{exists:false,valid:false,state:null,updatedAt:0,errors:["不存在"]};
    try{
      const state=JSON.parse(raw);
      const checked=validateState(state);
      let updatedAt=0;
      try{
        const meta=JSON.parse(localStorage.getItem(LOCAL_META_KEY)||"null");
        if(Number.isFinite(meta?.updatedAt))updatedAt=meta.updatedAt;
      }catch{}
      return{exists:true,valid:checked.valid,state,updatedAt,errors:checked.errors};
    }catch{
      return{exists:true,valid:false,state:null,updatedAt:0,errors:["JSON 無法解析"]};
    }
  }

  function writeLocal(state,updatedAt=now()){
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    localStorage.setItem(LOCAL_META_KEY,JSON.stringify({updatedAt}));
    return updatedAt;
  }

  function openDB(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      if(!("indexedDB" in window)){reject(new Error("IndexedDB 不可用"));return}
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(RECORDS))db.createObjectStore(RECORDS,{keyPath:"key"});
        if(!db.objectStoreNames.contains(SNAPSHOTS)){
          const store=db.createObjectStore(SNAPSHOTS,{keyPath:"id"});
          store.createIndex("createdAt","createdAt");
        }
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error("IndexedDB 開啟失敗"));
      request.onblocked=()=>reject(new Error("IndexedDB 被其他分頁阻擋"));
    });
    dbPromise.catch(()=>{dbPromise=null});
    return dbPromise;
  }

  async function idbGetRecord(){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(RECORDS,"readonly");
      const req=tx.objectStore(RECORDS).get(MIRROR_KEY);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error);
    });
  }
  async function idbPutRecord(state,updatedAt=now()){
    const db=await openDB();
    const record={key:MIRROR_KEY,state:clone(state),updatedAt,signature:signature(state)};
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(RECORDS,"readwrite");
      tx.objectStore(RECORDS).put(record);
      tx.oncomplete=()=>resolve(record);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||new Error("IndexedDB 寫入中止"));
    });
  }
  async function idbListSnapshots(){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(SNAPSHOTS,"readonly");
      const req=tx.objectStore(SNAPSHOTS).getAll();
      req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>b.createdAt-a.createdAt));
      req.onerror=()=>reject(req.error);
    });
  }
  async function pruneSnapshots(){
    const items=await idbListSnapshots();
    if(items.length<=MAX_SNAPSHOTS)return;
    const db=await openDB();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(SNAPSHOTS,"readwrite");
      const store=tx.objectStore(SNAPSHOTS);
      items.slice(MAX_SNAPSHOTS).forEach(item=>store.delete(item.id));
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
    });
  }

  async function createSnapshot(state,reason="manual",{force=false}={}){
    const checked=validateState(state);
    if(!checked.valid)throw new Error("目前資料未通過完整性檢查");
    const items=await idbListSnapshots();
    const sig=signature(state);
    const latest=items[0]||null;
    if(!force&&latest){
      if(latest.signature===sig&&now()-latest.createdAt<DAY)return latest;
      if(reason==="auto"&&now()-latest.createdAt<DAY)return latest;
    }
    const createdAt=now();
    const id=createdAt+"-"+(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2));
    const snapshot={id,createdAt,reason,state:clone(state),signature:sig};
    const db=await openDB();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(SNAPSHOTS,"readwrite");
      tx.objectStore(SNAPSHOTS).put(snapshot);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
    });
    await pruneSnapshots();
    return snapshot;
  }

  function enqueue(task){
    writeQueue=writeQueue.catch(()=>{}).then(task);
    return writeQueue;
  }

  function saveState(state,{snapshotBefore=true}={}){
    const checked=validateState(state);
    if(!checked.valid)throw new Error("拒絕儲存無效狀態："+checked.errors.join("、"));
    const updatedAt=writeLocal(state);
    enqueue(async()=>{
      try{
        const previous=await idbGetRecord();
        if(snapshotBefore&&previous?.state&&previous.signature!==signature(state)){
          await createSnapshot(previous.state,"auto").catch(()=>{});
        }
        await idbPutRecord(state,updatedAt);
      }catch(error){
        console.warn("IndexedDB mirror write failed",error);
      }
    });
    return updatedAt;
  }

  function chooseNewer(local,mirror){
    const l=local.updatedAt||0,m=mirror.updatedAt||0;
    if(Math.abs(l-m)>=1500)return l>m?"local":"mirror";
    return null;
  }

  async function reconcile(){
    await writeQueue.catch(()=>{});
    const local=readLocalRaw();
    let mirror=null,idbError=null;
    try{mirror=await idbGetRecord()}catch(error){idbError=error}
    const mirrorCheck=mirror?.state?validateState(mirror.state):{valid:false,errors:["不存在"]};
    const mirrorCandidate=mirror?{...mirror,valid:mirrorCheck.valid,errors:mirrorCheck.errors}:null;

    if(idbError){
      return{state:local.valid?clone(local.state):null,action:"idb-unavailable",local,mirror:null,error:idbError};
    }

    if(local.valid&&!mirrorCandidate){
      const stamp=local.updatedAt||now();
      if(!local.updatedAt)localStorage.setItem(LOCAL_META_KEY,JSON.stringify({updatedAt:stamp}));
      await idbPutRecord(local.state,stamp);
      await createSnapshot(local.state,"migration").catch(()=>{});
      return{state:clone(local.state),action:"mirror-created",local,mirror:null};
    }

    if(!local.valid&&mirrorCandidate?.valid){
      writeLocal(mirrorCandidate.state,mirrorCandidate.updatedAt||now());
      localStorage.setItem(LAST_REPAIR_KEY,JSON.stringify({at:now(),from:"indexeddb",reason:local.errors?.join("、")||"主資料無效"}));
      return{state:clone(mirrorCandidate.state),action:"local-repaired",local,mirror:mirrorCandidate};
    }

    if(local.valid&&mirrorCandidate?.valid){
      const localSig=signature(local.state),mirrorSig=signature(mirrorCandidate.state);
      if(localSig===mirrorSig){
        const stamp=Math.max(local.updatedAt||0,mirrorCandidate.updatedAt||0,1);
        if(!local.updatedAt&&stamp>1)localStorage.setItem(LOCAL_META_KEY,JSON.stringify({updatedAt:stamp}));
        await createSnapshot(local.state,"auto").catch(()=>{});
        return{state:clone(local.state),action:"in-sync",local,mirror:mirrorCandidate};
      }

      const newer=chooseNewer(local,mirrorCandidate);
      if(newer==="local"){
        const stamp=local.updatedAt||now();
        await createSnapshot(mirrorCandidate.state,"before-repair").catch(()=>{});
        await idbPutRecord(local.state,stamp);
        localStorage.setItem(LAST_REPAIR_KEY,JSON.stringify({at:now(),from:"local",reason:"主資料較新"}));
        return{state:clone(local.state),action:"mirror-repaired",local,mirror:mirrorCandidate};
      }
      if(newer==="mirror"){
        await createSnapshot(local.state,"before-repair").catch(()=>{});
        writeLocal(mirrorCandidate.state,mirrorCandidate.updatedAt||now());
        localStorage.setItem(LAST_REPAIR_KEY,JSON.stringify({at:now(),from:"indexeddb",reason:"安全副本較新"}));
        return{state:clone(mirrorCandidate.state),action:"local-repaired",local,mirror:mirrorCandidate};
      }

      return{
        state:clone(local.state),
        action:"conflict",
        local,
        mirror:mirrorCandidate,
        conflict:{
          local:{state:clone(local.state),updatedAt:local.updatedAt||0},
          mirror:{state:clone(mirrorCandidate.state),updatedAt:mirrorCandidate.updatedAt||0}
        }
      };
    }

    if(local.valid){
      await idbPutRecord(local.state,local.updatedAt||now()).catch(()=>{});
      return{state:clone(local.state),action:"mirror-repaired",local,mirror:mirrorCandidate};
    }

    try{
      const snapshots=await idbListSnapshots();
      const recovery=snapshots.find(item=>item?.state&&validateState(item.state).valid);
      if(recovery){
        const stamp=now();
        writeLocal(recovery.state,stamp);
        await idbPutRecord(recovery.state,stamp);
        localStorage.setItem(LAST_REPAIR_KEY,JSON.stringify({at:stamp,from:"snapshot",reason:"主資料與安全副本都無效，自動使用最近有效快照"}));
        return{state:clone(recovery.state),action:"snapshot-repaired",local,mirror:mirrorCandidate,snapshot:recovery};
      }
    }catch{}

    const empty=!local.exists&&!mirrorCandidate;
    return{state:null,action:empty?"empty":"no-valid-state",local,mirror:mirrorCandidate};
  }

  async function resolveConflict(choice,conflict){
    if(!conflict||!["local","mirror"].includes(choice))throw new Error("無效的衝突選擇");
    const selected=conflict[choice];
    const other=conflict[choice==="local"?"mirror":"local"];
    if(other?.state)await createSnapshot(other.state,"conflict-loser",{force:true}).catch(()=>{});
    const stamp=Math.max(now(),selected.updatedAt||0);
    writeLocal(selected.state,stamp);
    await idbPutRecord(selected.state,stamp);
    localStorage.setItem(LAST_REPAIR_KEY,JSON.stringify({at:now(),from:choice,reason:"手動處理衝突"}));
    return clone(selected.state);
  }

  async function ensureDailySnapshot(state){
    if(!state?.startedAt||!validateState(state).valid)return null;
    return createSnapshot(state,"auto");
  }

  async function listSnapshots(){
    return (await idbListSnapshots()).map(item=>({...item,state:clone(item.state)}));
  }

  async function restoreSnapshot(id){
    const items=await idbListSnapshots();
    const target=items.find(item=>item.id===id);
    if(!target)throw new Error("找不到這個復原點");
    const current=readLocalRaw();
    if(current.valid)await createSnapshot(current.state,"before-restore",{force:true}).catch(()=>{});
    const stamp=now();
    writeLocal(target.state,stamp);
    await idbPutRecord(target.state,stamp);
    localStorage.setItem(LAST_REPAIR_KEY,JSON.stringify({at:stamp,from:"snapshot",reason:"手動還原復原點"}));
    return clone(target.state);
  }

  function recordExport(){
    const payload={lastExportAt:now()};
    localStorage.setItem(BACKUP_HEALTH_KEY,JSON.stringify(payload));
    localStorage.removeItem(BACKUP_DISMISS_KEY);
    return payload.lastExportAt;
  }
  function getBackupHealth(){
    let lastExportAt=null,dismissedAt=null;
    try{
      const p=JSON.parse(localStorage.getItem(BACKUP_HEALTH_KEY)||"null");
      if(Number.isFinite(p?.lastExportAt))lastExportAt=p.lastExportAt;
    }catch{}
    try{
      const p=JSON.parse(localStorage.getItem(BACKUP_DISMISS_KEY)||"null");
      if(Number.isFinite(p?.at))dismissedAt=p.at;
    }catch{}
    return{lastExportAt,dismissedAt};
  }
  function dismissBackupReminder(){
    localStorage.setItem(BACKUP_DISMISS_KEY,JSON.stringify({at:now()}));
  }

  async function getSafetySummary(){
    const local=readLocalRaw();
    const backup=getBackupHealth();
    let mirror=null,snapshots=[],idbAvailable=true;
    try{
      mirror=await idbGetRecord();
      snapshots=await idbListSnapshots();
    }catch{ idbAvailable=false; }
    const mirrorValid=mirror?.state?validateState(mirror.state).valid:false;
    let lastRepair=null;
    try{
      const p=JSON.parse(localStorage.getItem(LAST_REPAIR_KEY)||"null");
      if(Number.isFinite(p?.at))lastRepair=p;
    }catch{}
    return{
      localValid:local.valid,
      localErrors:local.errors,
      idbAvailable,
      mirrorValid,
      mirrorUpdatedAt:mirror?.updatedAt||null,
      snapshotCount:snapshots.length,
      latestSnapshotAt:snapshots[0]?.createdAt||null,
      lastExportAt:backup.lastExportAt,
      lastRepair
    };
  }

  function describeState(state){
    if(!state)return"無資料";
    if(!state.startedAt)return"尚未出生";
    const days=Math.max(0,Math.floor((now()-state.startedAt)/DAY));
    return`${state.name||"我的碼表"}・已陪伴 ${days.toLocaleString()} 天`;
  }

  window.DisuiStorage={
    saveState,
    reconcile,
    resolveConflict,
    validateState,
    ensureDailySnapshot,
    createSnapshot,
    listSnapshots,
    restoreSnapshot,
    recordExport,
    getBackupHealth,
    dismissBackupReminder,
    getSafetySummary,
    describeState,
    readLocalRaw,
    constants:{STORAGE_KEY,LOCAL_META_KEY,BACKUP_HEALTH_KEY,DB_NAME,MAX_SNAPSHOTS}
  };
})();