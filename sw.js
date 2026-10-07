const CACHE="disui-v22";
const PRECACHE=[
  "./",
  "./index.html",
  "./settings.html",
  "./styles.css?v=award-v1",
  "./journey.css?v=journey-v2",
  "./share.css?v=share-v1",
  "./mascot.css?v=care-v2",
  "./common.js?v=award-v1",
  "./app.js?v=debug-v1",
  "./share-card.js?v=debug-v1",
  "./settings.js?v=debug-v1",
  "./manifest.webmanifest",
  "./icons/icon-192.webp?v=icon-v2",
  "./icons/icon-512.webp?v=icon-v2",
  "./icons/icon-maskable-512.webp?v=icon-v2",
  "./icons/milestones.svg",
  "./icons/mascots.svg"
];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE)).then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting()});

async function fetchAndCache(request){
  const response=await fetch(request);
  if(response.ok){
    const cache=await caches.open(CACHE);
    await cache.put(request,response.clone());
  }
  return response;
}

async function networkFirst(request){
  try{return await fetchAndCache(request)}
  catch{
    const cached=await caches.match(request);
    if(cached)return cached;
    if(request.mode==="navigate"){
      const url=new URL(request.url);
      const fallback=url.pathname.endsWith("/settings.html")?"./settings.html":"./index.html";
      const page=await caches.match(fallback);
      if(page)return page;
    }
    return Response.error();
  }
}

async function cacheFirst(request){
  const cached=await caches.match(request);
  if(cached)return cached;
  try{return await fetchAndCache(request)}catch{return Response.error()}
}

function staleWhileRevalidate(request,event){
  const network=fetchAndCache(request).catch(()=>null);
  event.waitUntil(network);
  return caches.match(request).then(cached=>{
    if(cached)return cached;
    return network.then(response=>response||Response.error());
  });
}

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;

  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  const acceptsHtml=request.headers.get("accept")?.includes("text/html");
  const isNavigation=request.mode==="navigate"||acceptsHtml;
  const isVersionedStatic=url.searchParams.has("v")&&/\.(?:css|js)$/i.test(url.pathname);

  if(isNavigation){
    event.respondWith(networkFirst(request));
    return;
  }

  if(isVersionedStatic){
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request,event));
});
