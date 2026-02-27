(()=>{var a={};a.id=797,a.ids=[797],a.modules={261:a=>{"use strict";a.exports=require("next/dist/shared/lib/router/utils/app-paths")},846:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},1420:(a,b,c)=>{"use strict";c.r(b),c.d(b,{handler:()=>H,patchFetch:()=>G,routeModule:()=>C,serverHooks:()=>F,workAsyncStorage:()=>D,workUnitAsyncStorage:()=>E});var d={};c.r(d),c.d(d,{DELETE:()=>B,GET:()=>z,POST:()=>A});var e=c(5736),f=c(9117),g=c(4044),h=c(9326),i=c(2324),j=c(261),k=c(4290),l=c(5328),m=c(8928),n=c(6595),o=c(3421),p=c(7679),q=c(1681),r=c(3446),s=c(6439),t=c(1356),u=c(641),v=c(7866),w=c(2524),x=c(5511),y=c.n(x);async function z(a){let b,c=a.nextUrl.searchParams.get("detection_id"),d=a.nextUrl.searchParams.get("dataset_id"),e=(0,v.L)();if(d){let a=e.prepare("SELECT * FROM datasets WHERE dataset_id = ?").get(d),b=e.prepare("SELECT * FROM dataset_items WHERE dataset_id = ? ORDER BY image_id").all(d);return u.NextResponse.json({dataset:a,items:b})}return b=c?e.prepare("SELECT * FROM datasets WHERE detection_id = ? ORDER BY created_at DESC").all(c):e.prepare("SELECT * FROM datasets ORDER BY created_at DESC").all(),u.NextResponse.json(b)}async function A(a){let b=await a.json(),c=(0,v.L)(),d=(0,w.A)(),e=new Date().toISOString(),f=b.items||[],g=JSON.stringify(f.map(a=>({image_id:a.image_id,label:a.ground_truth_label}))),h=y().createHash("sha256").update(g).digest("hex").slice(0,16);c.prepare(`
    INSERT INTO datasets (dataset_id, name, detection_id, split_type, dataset_hash, size, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(d,b.name,b.detection_id,b.split_type,h,f.length,e,e);let i=c.prepare(`
    INSERT INTO dataset_items (item_id, dataset_id, image_id, image_uri, ground_truth_label)
    VALUES (?, ?, ?, ?, ?)
  `);return c.transaction(a=>{for(let b of a)i.run((0,w.A)(),d,b.image_id,b.image_uri,b.ground_truth_label)})(f),u.NextResponse.json({dataset_id:d})}async function B(a){let b=await a.json(),c=(0,v.L)();return c.prepare("DELETE FROM dataset_items WHERE dataset_id = ?").run(b.dataset_id),c.prepare("DELETE FROM datasets WHERE dataset_id = ?").run(b.dataset_id),u.NextResponse.json({ok:!0})}let C=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/datasets/route",pathname:"/api/datasets",filename:"route",bundlePath:"app/api/datasets/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"/Users/delaneyfoley/Developer/projects/vlm-eval copy/src/app/api/datasets/route.ts",nextConfigOutput:"",userland:d}),{workAsyncStorage:D,workUnitAsyncStorage:E,serverHooks:F}=C;function G(){return(0,g.patchFetch)({workAsyncStorage:D,workUnitAsyncStorage:E})}async function H(a,b,c){var d;let e="/api/datasets/route";"/index"===e&&(e="/");let g=await C.prepare(a,b,{srcPage:e,multiZoneDraftMode:!1});if(!g)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:u,params:v,nextConfig:w,isDraftMode:x,prerenderManifest:y,routerServerContext:z,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,resolvedPathname:D}=g,E=(0,j.normalizeAppPath)(e),F=!!(y.dynamicRoutes[E]||y.routes[D]);if(F&&!x){let a=!!y.routes[D],b=y.dynamicRoutes[E];if(b&&!1===b.fallback&&!a)throw new s.NoFallbackError}let G=null;!F||C.isDev||x||(G="/index"===(G=D)?"/":G);let H=!0===C.isDev||!F,I=F&&!H,J=a.method||"GET",K=(0,i.getTracer)(),L=K.getActiveScopeSpan(),M={params:v,prerenderManifest:y,renderOpts:{experimental:{cacheComponents:!!w.experimental.cacheComponents,authInterrupts:!!w.experimental.authInterrupts},supportsDynamicResponse:H,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:null==(d=w.experimental)?void 0:d.cacheLife,isRevalidate:I,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d)=>C.onRequestError(a,b,d,z)},sharedContext:{buildId:u}},N=new k.NodeNextRequest(a),O=new k.NodeNextResponse(b),P=l.NextRequestAdapter.fromNodeNextRequest(N,(0,l.signalFromNodeResponse)(b));try{let d=async c=>C.handle(P,M).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let d=K.getRootSpanAttributes();if(!d)return;if(d.get("next.span_type")!==m.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${d.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=d.get("next.route");if(e){let a=`${J} ${e}`;c.setAttributes({"next.route":e,"http.route":e,"next.span_name":a}),c.updateName(a)}else c.updateName(`${J} ${a.url}`)}),g=async g=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!(0,h.getRequestMeta)(a,"minimalMode")&&A&&B&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let e=await d(g);a.fetchMetrics=M.renderOpts.fetchMetrics;let i=M.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=M.renderOpts.collectedTags;if(!F)return await (0,o.I)(N,O,e,M.renderOpts.pendingWaitUntil),null;{let a=await e.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(e.headers);j&&(b[r.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==M.renderOpts.collectedRevalidate&&!(M.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&M.renderOpts.collectedRevalidate,d=void 0===M.renderOpts.collectedExpire||M.renderOpts.collectedExpire>=r.INFINITE_CACHE?void 0:M.renderOpts.collectedExpire;return{value:{kind:t.CachedRouteKind.APP_ROUTE,status:e.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:d}}}}catch(b){throw(null==f?void 0:f.isStale)&&await C.onRequestError(a,b,{routerKind:"App Router",routePath:e,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:A})},z),b}},l=await C.handleResponse({req:a,nextConfig:w,cacheKey:G,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:y,isRoutePPREnabled:!1,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,responseGenerator:k,waitUntil:c.waitUntil});if(!F)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==t.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});(0,h.getRequestMeta)(a,"minimalMode")||b.setHeader("x-nextjs-cache",A?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),x&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);return(0,h.getRequestMeta)(a,"minimalMode")&&F||m.delete(r.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,q.getCacheControlHeader)(l.cacheControl)),await (0,o.I)(N,O,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};L?await g(L):await K.withPropagatedContext(a.headers,()=>K.trace(m.BaseServerSpan.handleRequest,{spanName:`${J} ${a.url}`,kind:i.SpanKind.SERVER,attributes:{"http.method":J,"http.target":a.url}},g))}catch(b){if(b instanceof s.NoFallbackError||await C.onRequestError(a,b,{routerKind:"App Router",routePath:E,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:A})}),F)throw b;return await (0,o.I)(N,O,new Response(null,{status:500})),null}}},2524:(a,b,c)=>{"use strict";c.d(b,{A:()=>i});var d=c(5511);let e={randomUUID:d.randomUUID},f=new Uint8Array(256),g=f.length,h=[];for(let a=0;a<256;++a)h.push((a+256).toString(16).slice(1));let i=function(a,b,c){if(e.randomUUID&&!b&&!a)return e.randomUUID();let i=(a=a||{}).random??a.rng?.()??(g>f.length-16&&((0,d.randomFillSync)(f),g=0),f.slice(g,g+=16));if(i.length<16)throw Error("Random bytes length must be >= 16");if(i[6]=15&i[6]|64,i[8]=63&i[8]|128,b){if((c=c||0)<0||c+16>b.length)throw RangeError(`UUID byte range ${c}:${c+15} is out of buffer bounds`);for(let a=0;a<16;++a)b[c+a]=i[a];return b}return function(a,b=0){return(h[a[b+0]]+h[a[b+1]]+h[a[b+2]]+h[a[b+3]]+"-"+h[a[b+4]]+h[a[b+5]]+"-"+h[a[b+6]]+h[a[b+7]]+"-"+h[a[b+8]]+h[a[b+9]]+"-"+h[a[b+10]]+h[a[b+11]]+h[a[b+12]]+h[a[b+13]]+h[a[b+14]]+h[a[b+15]]).toLowerCase()}(i)}},3033:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},3295:a=>{"use strict";a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},3873:a=>{"use strict";a.exports=require("path")},4870:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},5511:a=>{"use strict";a.exports=require("crypto")},6439:a=>{"use strict";a.exports=require("next/dist/shared/lib/no-fallback-error.external")},6487:()=>{},7866:(a,b,c)=>{"use strict";c.d(b,{L:()=>l});let d=require("better-sqlite3");var e=c.n(d),f=c(3873),g=c.n(f),h=c(9021),i=c.n(h);let j=g().join(process.cwd(),"data","vlm-eval.db"),k=null;function l(){return k||(i().mkdirSync(g().dirname(j),{recursive:!0}),(k=new(e())(j)).pragma("journal_mode = WAL"),k.pragma("foreign_keys = ON"),k.exec(`
    CREATE TABLE IF NOT EXISTS detections (
      detection_id TEXT PRIMARY KEY,
      detection_code TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      label_policy TEXT NOT NULL DEFAULT '',
      decision_rubric TEXT NOT NULL DEFAULT '[]',
      metric_thresholds TEXT NOT NULL DEFAULT '{}',
      approved_prompt_version TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_versions (
      prompt_version_id TEXT PRIMARY KEY,
      detection_id TEXT NOT NULL,
      version_label TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      user_prompt_template TEXT NOT NULL,
      prompt_structure TEXT NOT NULL DEFAULT '{}',
      model TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
      temperature REAL NOT NULL DEFAULT 0,
      top_p REAL NOT NULL DEFAULT 1,
      max_output_tokens INTEGER NOT NULL DEFAULT 1024,
      change_notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      golden_set_regression_result TEXT,
      FOREIGN KEY (detection_id) REFERENCES detections(detection_id)
    );

    CREATE TABLE IF NOT EXISTS datasets (
      dataset_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      detection_id TEXT NOT NULL,
      split_type TEXT NOT NULL CHECK(split_type IN ('GOLDEN','ITERATION','HELD_OUT_EVAL','CUSTOM')),
      dataset_hash TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (detection_id) REFERENCES detections(detection_id)
    );

    CREATE TABLE IF NOT EXISTS dataset_items (
      item_id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      image_id TEXT NOT NULL,
      image_uri TEXT NOT NULL,
      ground_truth_label TEXT NOT NULL CHECK(ground_truth_label IN ('DETECTED','NOT_DETECTED')),
      FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
    );

    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      detection_id TEXT NOT NULL,
      prompt_version_id TEXT NOT NULL,
      prompt_snapshot TEXT NOT NULL,
      decoding_params TEXT NOT NULL,
      dataset_id TEXT NOT NULL,
      dataset_hash TEXT NOT NULL,
      split_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metrics_summary TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'running',
      total_images INTEGER NOT NULL DEFAULT 0,
      processed_images INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (detection_id) REFERENCES detections(detection_id),
      FOREIGN KEY (prompt_version_id) REFERENCES prompt_versions(prompt_version_id),
      FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
    );

    CREATE TABLE IF NOT EXISTS predictions (
      prediction_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      image_id TEXT NOT NULL,
      image_uri TEXT NOT NULL,
      ground_truth_label TEXT NOT NULL,
      predicted_decision TEXT,
      confidence REAL,
      evidence TEXT,
      parse_ok INTEGER NOT NULL DEFAULT 1,
      raw_response TEXT NOT NULL DEFAULT '',
      corrected_label TEXT,
      error_tag TEXT,
      reviewer_note TEXT,
      corrected_at TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_predictions_run_id ON predictions(run_id);
    CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset_id ON dataset_items(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_versions_detection_id ON prompt_versions(detection_id);
    CREATE INDEX IF NOT EXISTS idx_datasets_detection_id ON datasets(detection_id);
    CREATE INDEX IF NOT EXISTS idx_runs_detection_id ON runs(detection_id);
  `)),k}},8335:()=>{},9021:a=>{"use strict";a.exports=require("fs")},9121:a=>{"use strict";a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},9294:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-async-storage.external.js")}};var b=require("../../../webpack-runtime.js");b.C(a);var c=b.X(0,[331,692],()=>b(b.s=1420));module.exports=c})();