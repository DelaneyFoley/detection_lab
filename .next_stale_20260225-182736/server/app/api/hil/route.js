(()=>{var a={};a.id=201,a.ids=[201],a.modules={261:a=>{"use strict";a.exports=require("next/dist/shared/lib/router/utils/app-paths")},846:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},3033:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},3295:a=>{"use strict";a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},3873:a=>{"use strict";a.exports=require("path")},4457:(a,b,c)=>{"use strict";function d(a){let b=0,c=0,d=0,e=0,f=0,g=a.length;for(let g of a){if(!g.parse_ok||!g.predicted_decision){f++,"DETECTED"===g.ground_truth_label?d++:e++;continue}let a=g.corrected_label||g.ground_truth_label,h=g.predicted_decision;"DETECTED"===a&&"DETECTED"===h?b++:"NOT_DETECTED"===a&&"DETECTED"===h?c++:"DETECTED"===a&&"NOT_DETECTED"===h?d++:e++}let h=b+c>0?b/(b+c):0,i=b+d>0?b/(b+d):0,j=g>0?(b+e)/g:0,k=a.filter(a=>"DETECTED"===(a.corrected_label||a.ground_truth_label)).length;return{tp:b,fp:c,fn:d,tn:e,precision:Math.round(1e4*h)/1e4,recall:Math.round(1e4*i)/1e4,f1:Math.round(1e4*(h+i>0?2*h*i/(h+i):0))/1e4,accuracy:Math.round(1e4*j)/1e4,prevalence:Math.round(1e4*(g>0?k/g:0))/1e4,parse_failure_rate:g>0?Math.round(f/g*1e4)/1e4:0,total:g}}c.d(b,{pH:()=>d})},4870:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},5324:(a,b,c)=>{"use strict";c.r(b),c.d(b,{handler:()=>E,patchFetch:()=>D,routeModule:()=>z,serverHooks:()=>C,workAsyncStorage:()=>A,workUnitAsyncStorage:()=>B});var d={};c.r(d),c.d(d,{POST:()=>y,PUT:()=>x});var e=c(5736),f=c(9117),g=c(4044),h=c(9326),i=c(2324),j=c(261),k=c(4290),l=c(5328),m=c(8928),n=c(6595),o=c(3421),p=c(7679),q=c(1681),r=c(3446),s=c(6439),t=c(1356),u=c(641),v=c(7866),w=c(4457);async function x(a){let b=await a.json(),c=(0,v.L)(),d=new Date().toISOString();if(c.prepare(`
    UPDATE predictions SET
      corrected_label = ?,
      error_tag = ?,
      reviewer_note = ?,
      corrected_at = ?
    WHERE prediction_id = ?
  `).run(b.corrected_label||null,b.error_tag||null,b.reviewer_note||null,d,b.prediction_id),b.corrected_label&&b.update_ground_truth){let a=c.prepare("SELECT * FROM predictions WHERE prediction_id = ?").get(b.prediction_id);if(a){let d=c.prepare("SELECT * FROM runs WHERE run_id = ?").get(a.run_id);if(d){let e=c.prepare("SELECT * FROM datasets WHERE dataset_id = ?").get(d.dataset_id);e&&"ITERATION"===e.split_type&&c.prepare("UPDATE dataset_items SET ground_truth_label = ? WHERE dataset_id = ? AND image_id = ?").run(b.corrected_label,d.dataset_id,a.image_id)}}}return u.NextResponse.json({ok:!0})}async function y(a){let b=await a.json(),c=(0,v.L)(),d=c.prepare("SELECT * FROM predictions WHERE run_id = ?").all(b.run_id),e=(0,w.pH)(d);return c.prepare("UPDATE runs SET metrics_summary = ? WHERE run_id = ?").run(JSON.stringify(e),b.run_id),u.NextResponse.json({metrics:e})}let z=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/hil/route",pathname:"/api/hil",filename:"route",bundlePath:"app/api/hil/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"/Users/delaneyfoley/Developer/projects/vlm-eval copy/src/app/api/hil/route.ts",nextConfigOutput:"",userland:d}),{workAsyncStorage:A,workUnitAsyncStorage:B,serverHooks:C}=z;function D(){return(0,g.patchFetch)({workAsyncStorage:A,workUnitAsyncStorage:B})}async function E(a,b,c){var d;let e="/api/hil/route";"/index"===e&&(e="/");let g=await z.prepare(a,b,{srcPage:e,multiZoneDraftMode:!1});if(!g)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:u,params:v,nextConfig:w,isDraftMode:x,prerenderManifest:y,routerServerContext:A,isOnDemandRevalidate:B,revalidateOnlyGenerated:C,resolvedPathname:D}=g,E=(0,j.normalizeAppPath)(e),F=!!(y.dynamicRoutes[E]||y.routes[D]);if(F&&!x){let a=!!y.routes[D],b=y.dynamicRoutes[E];if(b&&!1===b.fallback&&!a)throw new s.NoFallbackError}let G=null;!F||z.isDev||x||(G="/index"===(G=D)?"/":G);let H=!0===z.isDev||!F,I=F&&!H,J=a.method||"GET",K=(0,i.getTracer)(),L=K.getActiveScopeSpan(),M={params:v,prerenderManifest:y,renderOpts:{experimental:{cacheComponents:!!w.experimental.cacheComponents,authInterrupts:!!w.experimental.authInterrupts},supportsDynamicResponse:H,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:null==(d=w.experimental)?void 0:d.cacheLife,isRevalidate:I,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d)=>z.onRequestError(a,b,d,A)},sharedContext:{buildId:u}},N=new k.NodeNextRequest(a),O=new k.NodeNextResponse(b),P=l.NextRequestAdapter.fromNodeNextRequest(N,(0,l.signalFromNodeResponse)(b));try{let d=async c=>z.handle(P,M).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let d=K.getRootSpanAttributes();if(!d)return;if(d.get("next.span_type")!==m.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${d.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=d.get("next.route");if(e){let a=`${J} ${e}`;c.setAttributes({"next.route":e,"http.route":e,"next.span_name":a}),c.updateName(a)}else c.updateName(`${J} ${a.url}`)}),g=async g=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!(0,h.getRequestMeta)(a,"minimalMode")&&B&&C&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let e=await d(g);a.fetchMetrics=M.renderOpts.fetchMetrics;let i=M.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=M.renderOpts.collectedTags;if(!F)return await (0,o.I)(N,O,e,M.renderOpts.pendingWaitUntil),null;{let a=await e.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(e.headers);j&&(b[r.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==M.renderOpts.collectedRevalidate&&!(M.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&M.renderOpts.collectedRevalidate,d=void 0===M.renderOpts.collectedExpire||M.renderOpts.collectedExpire>=r.INFINITE_CACHE?void 0:M.renderOpts.collectedExpire;return{value:{kind:t.CachedRouteKind.APP_ROUTE,status:e.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:d}}}}catch(b){throw(null==f?void 0:f.isStale)&&await z.onRequestError(a,b,{routerKind:"App Router",routePath:e,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:B})},A),b}},l=await z.handleResponse({req:a,nextConfig:w,cacheKey:G,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:y,isRoutePPREnabled:!1,isOnDemandRevalidate:B,revalidateOnlyGenerated:C,responseGenerator:k,waitUntil:c.waitUntil});if(!F)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==t.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});(0,h.getRequestMeta)(a,"minimalMode")||b.setHeader("x-nextjs-cache",B?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),x&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);return(0,h.getRequestMeta)(a,"minimalMode")&&F||m.delete(r.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,q.getCacheControlHeader)(l.cacheControl)),await (0,o.I)(N,O,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};L?await g(L):await K.withPropagatedContext(a.headers,()=>K.trace(m.BaseServerSpan.handleRequest,{spanName:`${J} ${a.url}`,kind:i.SpanKind.SERVER,attributes:{"http.method":J,"http.target":a.url}},g))}catch(b){if(b instanceof s.NoFallbackError||await z.onRequestError(a,b,{routerKind:"App Router",routePath:E,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:B})}),F)throw b;return await (0,o.I)(N,O,new Response(null,{status:500})),null}}},6439:a=>{"use strict";a.exports=require("next/dist/shared/lib/no-fallback-error.external")},6487:()=>{},7866:(a,b,c)=>{"use strict";c.d(b,{L:()=>l});let d=require("better-sqlite3");var e=c.n(d),f=c(3873),g=c.n(f),h=c(9021),i=c.n(h);let j=g().join(process.cwd(),"data","vlm-eval.db"),k=null;function l(){return k||(i().mkdirSync(g().dirname(j),{recursive:!0}),(k=new(e())(j)).pragma("journal_mode = WAL"),k.pragma("foreign_keys = ON"),k.exec(`
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
  `)),k}},8335:()=>{},9021:a=>{"use strict";a.exports=require("fs")},9121:a=>{"use strict";a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},9294:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-async-storage.external.js")}};var b=require("../../../webpack-runtime.js");b.C(a);var c=b.X(0,[331,692],()=>b(b.s=5324));module.exports=c})();