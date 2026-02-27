(()=>{var a={};a.id=86,a.ids=[86],a.modules={261:a=>{"use strict";a.exports=require("next/dist/shared/lib/router/utils/app-paths")},573:(a,b,c)=>{"use strict";c.r(b),c.d(b,{handler:()=>F,patchFetch:()=>E,routeModule:()=>A,serverHooks:()=>D,workAsyncStorage:()=>B,workUnitAsyncStorage:()=>C});var d={};c.r(d),c.d(d,{GET:()=>x,POST:()=>y,PUT:()=>z});var e=c(5736),f=c(9117),g=c(4044),h=c(9326),i=c(2324),j=c(261),k=c(4290),l=c(5328),m=c(8928),n=c(6595),o=c(3421),p=c(7679),q=c(1681),r=c(3446),s=c(6439),t=c(1356),u=c(641),v=c(7866),w=c(2524);async function x(){let a=(0,v.L)();!function(){let a=(0,v.L)();if(a.prepare("SELECT COUNT(*) as c FROM detections").get().c>0)return;let b=(0,w.A)(),c=new Date().toISOString();a.prepare(`
    INSERT INTO detections (detection_id, detection_code, display_name, description, label_policy, decision_rubric, metric_thresholds, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b,"SMOKE_VISIBLE","Visible Smoke Detection","Detects whether visible smoke is present in the image. Used for fire safety monitoring.",`DETECTED: Visible smoke plume, haze clearly attributable to smoke, or smoke billowing from a source.
NOT_DETECTED: Clear sky, fog/mist (not smoke), steam, clouds, dust.
Edge cases: Very faint haze should be NOT_DETECTED unless clearly smoke-like in color/pattern.`,JSON.stringify(["Look for gray, white, or dark plumes rising from a source","Distinguish smoke from clouds (smoke has irregular, turbulent patterns)","Distinguish smoke from fog/mist (smoke tends to be darker, rises upward)","Distinguish smoke from steam (steam dissipates quickly, is white)","If uncertain between smoke and atmospheric haze, choose NOT_DETECTED"]),JSON.stringify({min_precision:.85,min_recall:.9,min_f1:.87,primary_metric:"recall"}),c,c);let d=(0,w.A)(),e=`You are a visual detection system. Your task is to analyze images for a specific detection type and return a structured JSON response.

You must ONLY return valid JSON matching the exact schema provided. No markdown, no commentary, no extra text.`,f=`Analyze this image for the detection: {{DETECTION_CODE}}

Detection: Visible Smoke Detection
Policy: DETECTED means visible smoke plume, haze clearly attributable to smoke, or smoke billowing from a source. NOT_DETECTED means clear sky, fog, mist, steam, clouds, or dust.

Decision Rubric:
1. Look for gray, white, or dark plumes rising from a source
2. Distinguish smoke from clouds (smoke has irregular, turbulent patterns)
3. Distinguish smoke from fog/mist (smoke tends to be darker, rises upward)
4. Distinguish smoke from steam (steam dissipates quickly, is white)
5. If uncertain between smoke and atmospheric haze, choose NOT_DETECTED

Return ONLY this JSON:
{
  "detection_code": "{{DETECTION_CODE}}",
  "decision": "DETECTED" or "NOT_DETECTED",
  "confidence": <float 0-1>,
  "evidence": "<short phrase describing visual basis>"
}`;a.prepare(`
    INSERT INTO prompt_versions (prompt_version_id, detection_id, version_label, system_prompt, user_prompt_template, prompt_structure, model, temperature, top_p, max_output_tokens, change_notes, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(d,b,"v1.0",e,f,JSON.stringify({detection_identity:"Visible Smoke Detection — identify whether smoke is visible in the image",label_policy:"DETECTED: Visible smoke plume, haze clearly attributable to smoke. NOT_DETECTED: Clear sky, fog, mist, steam, clouds, dust.",decision_rubric:"1. Look for gray/white/dark plumes rising from source\n2. Distinguish from clouds (irregular turbulent patterns)\n3. Distinguish from fog/mist (darker, rises upward)\n4. Distinguish from steam (dissipates quickly)\n5. If uncertain, choose NOT_DETECTED",output_schema:'{"detection_code":"SMOKE_VISIBLE","decision":"DETECTED|NOT_DETECTED","confidence":0.0,"evidence":"short phrase"}',examples:""}),"gemini-2.5-flash",0,1,1024,"Initial prompt version for smoke detection","system",c);let g=(0,w.A)(),h=(0,w.A)();a.prepare(`
    INSERT INTO datasets (dataset_id, name, detection_id, split_type, dataset_hash, size, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(g,"Smoke Golden Set",b,"GOLDEN","seed-golden",6,c,c),a.prepare(`
    INSERT INTO datasets (dataset_id, name, detection_id, split_type, dataset_hash, size, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(h,"Smoke Iteration Set",b,"ITERATION","seed-iteration",4,c,c);let i=a.prepare(`
    INSERT INTO dataset_items (item_id, dataset_id, image_id, image_uri, ground_truth_label)
    VALUES (?, ?, ?, ?, ?)
  `);for(let a of[{image_id:"smoke_001",uri:"https://picsum.photos/seed/smoke1/400/300",label:"DETECTED"},{image_id:"smoke_002",uri:"https://picsum.photos/seed/smoke2/400/300",label:"DETECTED"},{image_id:"smoke_003",uri:"https://picsum.photos/seed/smoke3/400/300",label:"DETECTED"},{image_id:"clear_001",uri:"https://picsum.photos/seed/clear1/400/300",label:"NOT_DETECTED"},{image_id:"clear_002",uri:"https://picsum.photos/seed/clear2/400/300",label:"NOT_DETECTED"},{image_id:"clear_003",uri:"https://picsum.photos/seed/clear3/400/300",label:"NOT_DETECTED"}])i.run((0,w.A)(),g,a.image_id,a.uri,a.label);for(let a of[{image_id:"smoke_010",uri:"https://picsum.photos/seed/smoke10/400/300",label:"DETECTED"},{image_id:"smoke_011",uri:"https://picsum.photos/seed/smoke11/400/300",label:"DETECTED"},{image_id:"clear_010",uri:"https://picsum.photos/seed/clear10/400/300",label:"NOT_DETECTED"},{image_id:"clear_011",uri:"https://picsum.photos/seed/clear11/400/300",label:"NOT_DETECTED"}])i.run((0,w.A)(),h,a.image_id,a.uri,a.label)}();let b=a.prepare("SELECT * FROM detections ORDER BY created_at DESC").all().map(a=>({...a,decision_rubric:JSON.parse(a.decision_rubric||"[]"),metric_thresholds:JSON.parse(a.metric_thresholds||"{}")}));return u.NextResponse.json(b)}async function y(a){let b=await a.json(),c=(0,v.L)(),d=(0,w.A)(),e=new Date().toISOString();return c.prepare(`
    INSERT INTO detections (detection_id, detection_code, display_name, description, label_policy, decision_rubric, metric_thresholds, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(d,b.detection_code,b.display_name,b.description||"",b.label_policy||"",JSON.stringify(b.decision_rubric||[]),JSON.stringify(b.metric_thresholds||{primary_metric:"f1"}),e,e),u.NextResponse.json({detection_id:d})}async function z(a){let b=await a.json(),c=(0,v.L)(),d=new Date().toISOString();return c.prepare(`
    UPDATE detections SET
      display_name = ?,
      description = ?,
      label_policy = ?,
      decision_rubric = ?,
      metric_thresholds = ?,
      approved_prompt_version = ?,
      updated_at = ?
    WHERE detection_id = ?
  `).run(b.display_name,b.description||"",b.label_policy||"",JSON.stringify(b.decision_rubric||[]),JSON.stringify(b.metric_thresholds||{}),b.approved_prompt_version||null,d,b.detection_id),u.NextResponse.json({ok:!0})}let A=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/detections/route",pathname:"/api/detections",filename:"route",bundlePath:"app/api/detections/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"/Users/delaneyfoley/Developer/projects/vlm-eval copy/src/app/api/detections/route.ts",nextConfigOutput:"",userland:d}),{workAsyncStorage:B,workUnitAsyncStorage:C,serverHooks:D}=A;function E(){return(0,g.patchFetch)({workAsyncStorage:B,workUnitAsyncStorage:C})}async function F(a,b,c){var d;let e="/api/detections/route";"/index"===e&&(e="/");let g=await A.prepare(a,b,{srcPage:e,multiZoneDraftMode:!1});if(!g)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:u,params:v,nextConfig:w,isDraftMode:x,prerenderManifest:y,routerServerContext:z,isOnDemandRevalidate:B,revalidateOnlyGenerated:C,resolvedPathname:D}=g,E=(0,j.normalizeAppPath)(e),F=!!(y.dynamicRoutes[E]||y.routes[D]);if(F&&!x){let a=!!y.routes[D],b=y.dynamicRoutes[E];if(b&&!1===b.fallback&&!a)throw new s.NoFallbackError}let G=null;!F||A.isDev||x||(G="/index"===(G=D)?"/":G);let H=!0===A.isDev||!F,I=F&&!H,J=a.method||"GET",K=(0,i.getTracer)(),L=K.getActiveScopeSpan(),M={params:v,prerenderManifest:y,renderOpts:{experimental:{cacheComponents:!!w.experimental.cacheComponents,authInterrupts:!!w.experimental.authInterrupts},supportsDynamicResponse:H,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:null==(d=w.experimental)?void 0:d.cacheLife,isRevalidate:I,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d)=>A.onRequestError(a,b,d,z)},sharedContext:{buildId:u}},N=new k.NodeNextRequest(a),O=new k.NodeNextResponse(b),P=l.NextRequestAdapter.fromNodeNextRequest(N,(0,l.signalFromNodeResponse)(b));try{let d=async c=>A.handle(P,M).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let d=K.getRootSpanAttributes();if(!d)return;if(d.get("next.span_type")!==m.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${d.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=d.get("next.route");if(e){let a=`${J} ${e}`;c.setAttributes({"next.route":e,"http.route":e,"next.span_name":a}),c.updateName(a)}else c.updateName(`${J} ${a.url}`)}),g=async g=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!(0,h.getRequestMeta)(a,"minimalMode")&&B&&C&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let e=await d(g);a.fetchMetrics=M.renderOpts.fetchMetrics;let i=M.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=M.renderOpts.collectedTags;if(!F)return await (0,o.I)(N,O,e,M.renderOpts.pendingWaitUntil),null;{let a=await e.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(e.headers);j&&(b[r.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==M.renderOpts.collectedRevalidate&&!(M.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&M.renderOpts.collectedRevalidate,d=void 0===M.renderOpts.collectedExpire||M.renderOpts.collectedExpire>=r.INFINITE_CACHE?void 0:M.renderOpts.collectedExpire;return{value:{kind:t.CachedRouteKind.APP_ROUTE,status:e.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:d}}}}catch(b){throw(null==f?void 0:f.isStale)&&await A.onRequestError(a,b,{routerKind:"App Router",routePath:e,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:B})},z),b}},l=await A.handleResponse({req:a,nextConfig:w,cacheKey:G,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:y,isRoutePPREnabled:!1,isOnDemandRevalidate:B,revalidateOnlyGenerated:C,responseGenerator:k,waitUntil:c.waitUntil});if(!F)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==t.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});(0,h.getRequestMeta)(a,"minimalMode")||b.setHeader("x-nextjs-cache",B?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),x&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);return(0,h.getRequestMeta)(a,"minimalMode")&&F||m.delete(r.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,q.getCacheControlHeader)(l.cacheControl)),await (0,o.I)(N,O,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};L?await g(L):await K.withPropagatedContext(a.headers,()=>K.trace(m.BaseServerSpan.handleRequest,{spanName:`${J} ${a.url}`,kind:i.SpanKind.SERVER,attributes:{"http.method":J,"http.target":a.url}},g))}catch(b){if(b instanceof s.NoFallbackError||await A.onRequestError(a,b,{routerKind:"App Router",routePath:E,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:B})}),F)throw b;return await (0,o.I)(N,O,new Response(null,{status:500})),null}}},846:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},2524:(a,b,c)=>{"use strict";c.d(b,{A:()=>i});var d=c(5511);let e={randomUUID:d.randomUUID},f=new Uint8Array(256),g=f.length,h=[];for(let a=0;a<256;++a)h.push((a+256).toString(16).slice(1));let i=function(a,b,c){if(e.randomUUID&&!b&&!a)return e.randomUUID();let i=(a=a||{}).random??a.rng?.()??(g>f.length-16&&((0,d.randomFillSync)(f),g=0),f.slice(g,g+=16));if(i.length<16)throw Error("Random bytes length must be >= 16");if(i[6]=15&i[6]|64,i[8]=63&i[8]|128,b){if((c=c||0)<0||c+16>b.length)throw RangeError(`UUID byte range ${c}:${c+15} is out of buffer bounds`);for(let a=0;a<16;++a)b[c+a]=i[a];return b}return function(a,b=0){return(h[a[b+0]]+h[a[b+1]]+h[a[b+2]]+h[a[b+3]]+"-"+h[a[b+4]]+h[a[b+5]]+"-"+h[a[b+6]]+h[a[b+7]]+"-"+h[a[b+8]]+h[a[b+9]]+"-"+h[a[b+10]]+h[a[b+11]]+h[a[b+12]]+h[a[b+13]]+h[a[b+14]]+h[a[b+15]]).toLowerCase()}(i)}},3033:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},3295:a=>{"use strict";a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},3873:a=>{"use strict";a.exports=require("path")},4870:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},5511:a=>{"use strict";a.exports=require("crypto")},6439:a=>{"use strict";a.exports=require("next/dist/shared/lib/no-fallback-error.external")},6487:()=>{},7866:(a,b,c)=>{"use strict";c.d(b,{L:()=>l});let d=require("better-sqlite3");var e=c.n(d),f=c(3873),g=c.n(f),h=c(9021),i=c.n(h);let j=g().join(process.cwd(),"data","vlm-eval.db"),k=null;function l(){return k||(i().mkdirSync(g().dirname(j),{recursive:!0}),(k=new(e())(j)).pragma("journal_mode = WAL"),k.pragma("foreign_keys = ON"),k.exec(`
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
  `)),k}},8335:()=>{},9021:a=>{"use strict";a.exports=require("fs")},9121:a=>{"use strict";a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},9294:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-async-storage.external.js")}};var b=require("../../../webpack-runtime.js");b.C(a);var c=b.X(0,[331,692],()=>b(b.s=573));module.exports=c})();