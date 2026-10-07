(() => {
  const STORAGE_KEY="long-stopwatch-v1";
  const $=id=>document.getElementById(id);
  const btn=$("shareAchievementBtn");
  const dialog=$("shareDialog");
  const closeBtn=$("shareCloseBtn");
  const canvas=$("shareCanvas");
  const downloadBtn=$("downloadShareBtn");
  const nativeShareBtn=$("nativeShareBtn");
  const formatButtons=[...document.querySelectorAll("[data-share-format]")];
  if(!btn||!dialog||!canvas)return;

  const ctx=canvas.getContext("2d");
  let format="square";
  let currentBlob=null;
  let currentSnapshot=null;
  const formats={
    square:{width:1080,height:1080},
    story:{width:1080,height:1920}
  };

  function readPet(){
    try{
      const raw=localStorage.getItem(STORAGE_KEY);
      if(!raw)return null;
      const parsed=JSON.parse(raw);
      if(!Number.isFinite(parsed.startedAt))return null;
      return{
        name:typeof parsed.name==="string"&&parsed.name.trim()?parsed.name.trim():"我的碼表",
        startedAt:parsed.startedAt
      };
    }catch{return null}
  }

  function syncEntry(){
    btn.hidden=!readPet();
  }

  function announce(message){
    const live=$("liveStatus");
    if(!live)return;
    live.textContent="";
    requestAnimationFrame(()=>{live.textContent=message});
  }

  function getSnapshot(){
    const pet=readPet();
    if(!pet)return null;
    const elapsed=Math.max(0,Date.now()-pet.startedAt);
    const totalSeconds=Math.floor(elapsed/1000);
    const days=Math.floor(totalSeconds/86400);
    const daySeconds=totalSeconds%86400;
    const hours=Math.floor(daySeconds/3600);
    const minutes=Math.floor((daySeconds%3600)/60);
    const seconds=daySeconds%60;
    const birth=new Intl.DateTimeFormat("zh-TW",{year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(pet.startedAt));
    return{
      name:pet.name,
      days,
      clock:[hours,minutes,seconds].map(n=>String(n).padStart(2,"0")).join(":"),
      rank:$("rankText")?.textContent?.trim()||"剛出生",
      recent:$("recentMilestoneTitle")?.textContent?.trim()||"旅程剛開始",
      recentMeta:$("recentMilestoneMeta")?.textContent?.trim()||"第一滴正在靠近",
      milestoneCount:$("milestoneCount")?.textContent?.trim()||"0 / 17",
      birth
    };
  }

  function roundRectPath(c,x,y,w,h,r){
    const radius=Math.min(r,w/2,h/2);
    c.beginPath();
    c.moveTo(x+radius,y);
    c.arcTo(x+w,y,x+w,y+h,radius);
    c.arcTo(x+w,y+h,x,y+h,radius);
    c.arcTo(x,y+h,x,y,radius);
    c.arcTo(x,y,x+w,y,radius);
    c.closePath();
  }

  function fillRound(c,x,y,w,h,r,fill,stroke){
    roundRectPath(c,x,y,w,h,r);
    c.fillStyle=fill;c.fill();
    if(stroke){c.strokeStyle=stroke;c.lineWidth=2;c.stroke()}
  }

  function fitFont(c,text,maxWidth,start,min,weight){
    let size=start;
    while(size>min){
      c.font=weight+" "+size+"px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans TC', sans-serif";
      if(c.measureText(text).width<=maxWidth)break;
      size-=2;
    }
    return size;
  }

  function drawDrop(c,cx,cy,size,palette){
    c.save();
    c.translate(cx,cy);
    const g=c.createLinearGradient(-size*.35,-size*.55,size*.4,size*.5);
    g.addColorStop(0,palette.accent);
    g.addColorStop(.58,palette.accent2);
    g.addColorStop(1,palette.accent3);
    c.fillStyle=g;
    c.shadowColor=palette.glow;
    c.shadowBlur=size*.22;
    c.beginPath();
    c.moveTo(0,-size*.62);
    c.bezierCurveTo(size*.18,-size*.34,size*.46,-size*.06,size*.46,size*.22);
    c.bezierCurveTo(size*.46,size*.53,size*.25,size*.7,0,size*.7);
    c.bezierCurveTo(-size*.25,size*.7,-size*.46,size*.53,-size*.46,size*.22);
    c.bezierCurveTo(-size*.46,-size*.06,-size*.18,-size*.34,0,-size*.62);
    c.closePath();
    c.fill();
    c.shadowBlur=0;
    c.globalAlpha=.38;
    c.fillStyle="white";
    c.beginPath();
    c.ellipse(-size*.14,-size*.05,size*.08,size*.16,-.6,0,Math.PI*2);
    c.fill();
    c.restore();
  }

  function drawSpark(c,cx,cy,size,color){
    c.save();c.translate(cx,cy);c.fillStyle=color;
    c.beginPath();
    for(let i=0;i<16;i++){
      const a=-Math.PI/2+i*Math.PI/8;
      const r=i%2===0?size:size*.42;
      const x=Math.cos(a)*r,y=Math.sin(a)*r;
      if(i===0)c.moveTo(x,y);else c.lineTo(x,y);
    }
    c.closePath();c.fill();c.restore();
  }

  function palette(){
    const light=document.documentElement.dataset.theme==="light";
    return light?{
      bg:"#edf6fb",bg2:"#dcecf6",text:"#10202c",muted:"#5c7283",panel:"rgba(255,255,255,.78)",
      line:"rgba(20,72,102,.12)",accent:"#168fc2",accent2:"#42bfd0",accent3:"#6472df",
      glow:"rgba(22,143,194,.28)",pill:"#dceef5"
    }:{
      bg:"#071018",bg2:"#0b1823",text:"#f5fbff",muted:"#91a8ba",panel:"rgba(15,32,45,.78)",
      line:"rgba(190,233,255,.12)",accent:"#6bdcff",accent2:"#8bf1d7",accent3:"#9ba8ff",
      glow:"rgba(91,207,255,.28)",pill:"#132a38"
    };
  }

  function background(c,w,h,p){
    const base=c.createLinearGradient(0,0,w,h);
    base.addColorStop(0,p.bg2);base.addColorStop(.48,p.bg);base.addColorStop(1,p.bg);
    c.fillStyle=base;c.fillRect(0,0,w,h);

    const rg=c.createRadialGradient(w*.78,h*.16,20,w*.78,h*.16,w*.72);
    rg.addColorStop(0,p.glow);rg.addColorStop(.5,"rgba(80,145,255,.07)");rg.addColorStop(1,"rgba(0,0,0,0)");
    c.fillStyle=rg;c.fillRect(0,0,w,h);

    const rg2=c.createRadialGradient(w*.08,h*.84,20,w*.08,h*.84,w*.55);
    rg2.addColorStop(0,"rgba(139,241,215,.12)");rg2.addColorStop(1,"rgba(0,0,0,0)");
    c.fillStyle=rg2;c.fillRect(0,0,w,h);

    c.save();c.globalAlpha=.18;c.strokeStyle=p.accent;c.lineWidth=2;
    [220,340,470].forEach(r=>{c.beginPath();c.arc(w*.82,h*.16,r,0,Math.PI*2);c.stroke()});
    c.restore();
  }

  function drawBrand(c,x,y,p,scale){
    drawDrop(c,x+20*scale,y+20*scale,24*scale,p);
    c.fillStyle=p.text;
    c.font="800 "+(30*scale)+"px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    c.fillText("滴派",x+58*scale,y+27*scale);
    c.fillStyle=p.muted;
    c.font="500 "+(15*scale)+"px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    c.fillText("把時間養成一隻寵物",x+58*scale,y+50*scale);
  }

  function renderSquare(s){
    const w=1080,h=1080,p=palette();
    canvas.width=w;canvas.height=h;background(ctx,w,h,p);
    drawBrand(ctx,72,66,p,1);

    ctx.fillStyle=p.muted;ctx.font="700 22px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("陪伴中的滴派",72,190);
    const nameSize=fitFont(ctx,s.name,790,68,38,"800");
    ctx.fillStyle=p.text;ctx.font="800 "+nameSize+"px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText(s.name,72,260);

    drawDrop(ctx,862,248,118,p);

    ctx.fillStyle=p.muted;ctx.font="700 20px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("已陪伴",72,390);
    const dayText=String(s.days);
    const daySize=fitFont(ctx,dayText,570,190,112,"800");
    ctx.fillStyle=p.text;ctx.font="800 "+daySize+"px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText(dayText,70,565);
    const dayWidth=ctx.measureText(dayText).width;
    ctx.fillStyle=p.muted;ctx.font="700 38px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("天",82+dayWidth,553);

    ctx.fillStyle=p.text;ctx.font="600 48px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.fillText(s.clock,76,640);

    fillRound(ctx,72,686,936,126,28,p.panel,p.line);
    ctx.fillStyle=p.muted;ctx.font="700 17px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("目前稱號",100,728);
    const rankSize=fitFont(ctx,s.rank,410,32,23,"760");
    ctx.fillStyle=p.text;ctx.font="760 "+rankSize+"px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText(s.rank,100,774);

    ctx.fillStyle=p.muted;ctx.font="700 17px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("最近里程碑",570,728);
    drawSpark(ctx,592,771,17,p.accent2);
    const milestoneSize=fitFont(ctx,s.recent,350,28,20,"760");
    ctx.fillStyle=p.text;ctx.font="760 "+milestoneSize+"px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText(s.recent,625,779);

    const parts=s.milestoneCount.split("/");
    const count=parseInt(parts[0],10)||0,total=parseInt(parts[1],10)||17;
    ctx.fillStyle=p.line;fillRound(ctx,72,850,936,12,6,p.line);
    fillRound(ctx,72,850,936*Math.min(1,count/total),12,6,p.accent);
    ctx.fillStyle=p.muted;ctx.font="600 18px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("里程碑 "+s.milestoneCount,72,900);
    ctx.textAlign="right";ctx.fillText("出生於 "+s.birth,1008,900);ctx.textAlign="left";

    ctx.fillStyle=p.muted;ctx.font="500 17px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("時間沒有停下來，我們也還在一起。",72,986);
    ctx.textAlign="right";ctx.fillStyle=p.accent;ctx.font="750 17px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("DIPAI",1008,986);ctx.textAlign="left";
  }

  function renderStory(s){
    const w=1080,h=1920,p=palette();
    canvas.width=w;canvas.height=h;background(ctx,w,h,p);
    drawBrand(ctx,72,82,p,1.08);

    ctx.fillStyle=p.muted;ctx.font="700 23px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("陪伴中的滴派",72,260);
    const nameSize=fitFont(ctx,s.name,900,82,42,"800");
    ctx.fillStyle=p.text;ctx.font="800 "+nameSize+"px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText(s.name,72,350);

    ctx.save();ctx.globalAlpha=.22;ctx.strokeStyle=p.accent;ctx.lineWidth=2;
    [260,390,520].forEach(r=>{ctx.beginPath();ctx.arc(540,650,r,0,Math.PI*2);ctx.stroke()});ctx.restore();
    drawDrop(ctx,540,625,200,p);

    ctx.textAlign="center";
    ctx.fillStyle=p.muted;ctx.font="700 24px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("已陪伴",540,900);
    const dayText=String(s.days);
    const daySize=fitFont(ctx,dayText,760,240,140,"800");
    ctx.fillStyle=p.text;ctx.font="800 "+daySize+"px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText(dayText,520,1100);
    const measured=ctx.measureText(dayText).width;
    ctx.textAlign="left";ctx.fillStyle=p.muted;ctx.font="700 44px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("天",540+measured/2,1080);
    ctx.textAlign="center";ctx.fillStyle=p.text;ctx.font="600 52px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.fillText(s.clock,540,1195);ctx.textAlign="left";

    fillRound(ctx,72,1295,936,250,34,p.panel,p.line);
    ctx.fillStyle=p.muted;ctx.font="700 18px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("目前稱號",110,1344);
    const rankSize=fitFont(ctx,s.rank,820,42,26,"780");
    ctx.fillStyle=p.text;ctx.font="780 "+rankSize+"px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText(s.rank,110,1405);

    ctx.fillStyle=p.muted;ctx.font="700 18px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("最近里程碑",110,1475);
    drawSpark(ctx,135,1516,19,p.accent2);
    const recentSize=fitFont(ctx,s.recent,720,34,23,"760");
    ctx.fillStyle=p.text;ctx.font="760 "+recentSize+"px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText(s.recent,174,1527);

    const parts=s.milestoneCount.split("/");
    const count=parseInt(parts[0],10)||0,total=parseInt(parts[1],10)||17;
    fillRound(ctx,72,1600,936,12,6,p.line);
    fillRound(ctx,72,1600,936*Math.min(1,count/total),12,6,p.accent);
    ctx.fillStyle=p.muted;ctx.font="600 19px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("里程碑 "+s.milestoneCount,72,1656);
    ctx.textAlign="right";ctx.fillText("出生於 "+s.birth,1008,1656);ctx.textAlign="left";

    ctx.fillStyle=p.text;ctx.font="700 28px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("時間沒有停下來，",72,1770);
    ctx.fillText("我們也還在一起。",72,1812);
    ctx.textAlign="right";ctx.fillStyle=p.accent;ctx.font="800 20px system-ui, -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText("滴派 · DIPAI",1008,1810);ctx.textAlign="left";
  }

  function render(){
    currentSnapshot=getSnapshot();
    if(!currentSnapshot)return;
    currentBlob=null;downloadBtn.disabled=true;nativeShareBtn.disabled=true;
    if(format==="story")renderStory(currentSnapshot);else renderSquare(currentSnapshot);
    canvas.toBlob(blob=>{
      currentBlob=blob;
      downloadBtn.disabled=!blob;
      nativeShareBtn.disabled=!blob;
    },"image/png");
  }

  function setFormat(next){
    if(!formats[next]||next===format)return;
    format=next;
    formatButtons.forEach(button=>{
      const active=button.dataset.shareFormat===format;
      button.classList.toggle("is-active",active);
      button.setAttribute("aria-pressed",String(active));
    });
    render();
  }

  function fileName(){
    const safe=(currentSnapshot?.name||"dipai").replace(/[\\/:*?"<>|]/g,"-").slice(0,32);
    return "dipai-"+safe+"-"+format+".png";
  }

  function download(){
    if(!currentBlob)return;
    const url=URL.createObjectURL(currentBlob);
    const a=document.createElement("a");
    a.href=url;a.download=fileName();document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    announce("成就卡已下載");
  }

  function nativeShare(){
    if(!currentBlob||!currentSnapshot)return;
    const file=new File([currentBlob],fileName(),{type:"image/png"});
    const data={
      files:[file],
      title:"滴派 · "+currentSnapshot.name,
      text:currentSnapshot.name+" 已經陪伴 "+currentSnapshot.days+" 天了。"
    };
    if(typeof navigator.share!=="function"||(typeof navigator.canShare==="function"&&!navigator.canShare({files:[file]}))){
      download();
      announce("這個瀏覽器無法直接分享圖片，已改為下載 PNG");
      return;
    }
    navigator.share(data).then(()=>announce("成就卡已送出分享")).catch(error=>{
      if(error?.name!=="AbortError")announce("分享沒有成功，可以改用下載 PNG");
    });
  }

  btn.addEventListener("click",()=>{
    currentSnapshot=getSnapshot();
    if(!currentSnapshot){syncEntry();return}
    render();
    dialog.showModal();
  });
  closeBtn?.addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close()});
  formatButtons.forEach(button=>button.addEventListener("click",()=>setFormat(button.dataset.shareFormat)));
  downloadBtn?.addEventListener("click",download);
  nativeShareBtn?.addEventListener("click",nativeShare);

  const observer=new MutationObserver(syncEntry);
  observer.observe(document.body,{attributes:true,attributeFilter:["class"]});
  syncEntry();
})();