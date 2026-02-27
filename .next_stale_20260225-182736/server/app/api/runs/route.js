(()=>{var a={};a.id=912,a.ids=[912],a.modules={261:a=>{"use strict";a.exports=require("next/dist/shared/lib/router/utils/app-paths")},846:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},2524:(a,b,c)=>{"use strict";c.d(b,{A:()=>i});var d=c(5511);let e={randomUUID:d.randomUUID},f=new Uint8Array(256),g=f.length,h=[];for(let a=0;a<256;++a)h.push((a+256).toString(16).slice(1));let i=function(a,b,c){if(e.randomUUID&&!b&&!a)return e.randomUUID();let i=(a=a||{}).random??a.rng?.()??(g>f.length-16&&((0,d.randomFillSync)(f),g=0),f.slice(g,g+=16));if(i.length<16)throw Error("Random bytes length must be >= 16");if(i[6]=15&i[6]|64,i[8]=63&i[8]|128,b){if((c=c||0)<0||c+16>b.length)throw RangeError(`UUID byte range ${c}:${c+15} is out of buffer bounds`);for(let a=0;a<16;++a)b[c+a]=i[a];return b}return function(a,b=0){return(h[a[b+0]]+h[a[b+1]]+h[a[b+2]]+h[a[b+3]]+"-"+h[a[b+4]]+h[a[b+5]]+"-"+h[a[b+6]]+h[a[b+7]]+"-"+h[a[b+8]]+h[a[b+9]]+"-"+h[a[b+10]]+h[a[b+11]]+h[a[b+12]]+h[a[b+13]]+h[a[b+14]]+h[a[b+15]]).toLowerCase()}(i)}},3033:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},3295:a=>{"use strict";a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},3873:a=>{"use strict";a.exports=require("path")},4457:(a,b,c)=>{"use strict";function d(a){let b=0,c=0,d=0,e=0,f=0,g=a.length;for(let g of a){if(!g.parse_ok||!g.predicted_decision){f++,"DETECTED"===g.ground_truth_label?d++:e++;continue}let a=g.corrected_label||g.ground_truth_label,h=g.predicted_decision;"DETECTED"===a&&"DETECTED"===h?b++:"NOT_DETECTED"===a&&"DETECTED"===h?c++:"DETECTED"===a&&"NOT_DETECTED"===h?d++:e++}let h=b+c>0?b/(b+c):0,i=b+d>0?b/(b+d):0,j=g>0?(b+e)/g:0,k=a.filter(a=>"DETECTED"===(a.corrected_label||a.ground_truth_label)).length;return{tp:b,fp:c,fn:d,tn:e,precision:Math.round(1e4*h)/1e4,recall:Math.round(1e4*i)/1e4,f1:Math.round(1e4*(h+i>0?2*h*i/(h+i):0))/1e4,accuracy:Math.round(1e4*j)/1e4,prevalence:Math.round(1e4*(g>0?k/g:0))/1e4,parse_failure_rate:g>0?Math.round(f/g*1e4)/1e4:0,total:g}}c.d(b,{pH:()=>d})},4870:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},5511:a=>{"use strict";a.exports=require("crypto")},6439:a=>{"use strict";a.exports=require("next/dist/shared/lib/no-fallback-error.external")},6487:()=>{},7866:(a,b,c)=>{"use strict";c.d(b,{L:()=>l});let d=require("better-sqlite3");var e=c.n(d),f=c(3873),g=c.n(f),h=c(9021),i=c.n(h);let j=g().join(process.cwd(),"data","vlm-eval.db"),k=null;function l(){return k||(i().mkdirSync(g().dirname(j),{recursive:!0}),(k=new(e())(j)).pragma("journal_mode = WAL"),k.pragma("foreign_keys = ON"),k.exec(`
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
  `)),k}},8335:()=>{},9021:a=>{"use strict";a.exports=require("fs")},9121:a=>{"use strict";a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},9294:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},9849:(a,b,c)=>{"use strict";c.r(b),c.d(b,{handler:()=>M,patchFetch:()=>L,routeModule:()=>H,serverHooks:()=>K,workAsyncStorage:()=>I,workUnitAsyncStorage:()=>J});var d={};c.r(d),c.d(d,{GET:()=>F,POST:()=>G});var e=c(5736),f=c(9117),g=c(4044),h=c(9326),i=c(2324),j=c(261),k=c(4290),l=c(5328),m=c(8928),n=c(6595),o=c(3421),p=c(7679),q=c(1681),r=c(3446),s=c(6439),t=c(1356),u=c(641),v=c(7866),w=c(2524),x=c(4364),y=c(9021),z=c.n(y),A=c(3873),B=c.n(A);async function C(a,b,c,d){let e=new x.ij(a).getGenerativeModel({model:b.model||"gemini-2.5-flash",generationConfig:{temperature:b.temperature,topP:b.top_p,maxOutputTokens:b.max_output_tokens},systemInstruction:b.system_prompt}),f=await D(d),g=b.user_prompt_template.replace("{{DETECTION_CODE}}",c);try{let a=(await e.generateContent([g,...f])).response.text(),b=function(a,b){try{let b=a.trim();b.startsWith("```")&&(b=b.replace(/^```(?:json)?\s*/,"").replace(/\s*```$/,""));let c=JSON.parse(b);if("string"!=typeof c.detection_code||!["DETECTED","NOT_DETECTED"].includes(c.decision)||"number"!=typeof c.confidence||"string"!=typeof c.evidence)return{result:null,ok:!1};let d=["detection_code","decision","confidence","evidence"];if(Object.keys(c).filter(a=>!d.includes(a)).length>0)return{result:null,ok:!1};return{result:c,ok:!0}}catch{return{result:null,ok:!1}}}(a,0);return{parsed:b.result,raw:a,parseOk:b.ok}}catch(b){let a=b instanceof Error?b.message:String(b);return{parsed:null,raw:`ERROR: ${a}`,parseOk:!1}}}async function D(a){if(a.startsWith("data:")){let b=a.match(/^data:([^;]+);base64,(.+)$/);if(b)return[{inlineData:{mimeType:b[1],data:b[2]}}]}if(a.startsWith("/")||a.startsWith("./")){let b=B().isAbsolute(a)?a:B().join(process.cwd(),a),c=z().readFileSync(b);return[{inlineData:{mimeType:{".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".gif":"image/gif",".webp":"image/webp"}[B().extname(b).toLowerCase()]||"image/jpeg",data:c.toString("base64")}}]}if(a.startsWith("http")){let b=await fetch(a),c=await b.arrayBuffer();return[{inlineData:{mimeType:b.headers.get("content-type")||"image/jpeg",data:Buffer.from(c).toString("base64")}}]}let b=B().join(process.cwd(),"data","uploads",a);if(z().existsSync(b)){let a=z().readFileSync(b);return[{inlineData:{mimeType:".png"===B().extname(b).toLowerCase()?"image/png":"image/jpeg",data:a.toString("base64")}}]}return[]}var E=c(4457);async function F(a){let b=a.nextUrl.searchParams.get("detection_id"),c=a.nextUrl.searchParams.get("run_id"),d=(0,v.L)();if(c){let a=d.prepare("SELECT * FROM runs WHERE run_id = ?").get(c);if(!a)return u.NextResponse.json({error:"Not found"},{status:404});let b=d.prepare("SELECT * FROM predictions WHERE run_id = ? ORDER BY image_id").all(c);return u.NextResponse.json({...a,metrics_summary:JSON.parse(a.metrics_summary||"{}"),decoding_params:JSON.parse(a.decoding_params||"{}"),predictions:b})}let e=(b?d.prepare("SELECT * FROM runs WHERE detection_id = ? ORDER BY created_at DESC").all(b):d.prepare("SELECT * FROM runs ORDER BY created_at DESC").all()).map(a=>({...a,metrics_summary:JSON.parse(a.metrics_summary||"{}")}));return u.NextResponse.json(e)}async function G(a){let b=await a.json(),c=(0,v.L)(),{api_key:d,prompt_version_id:e,dataset_id:f,detection_id:g,model_override:h}=b;if(!d)return u.NextResponse.json({error:"API key required"},{status:400});let i=c.prepare("SELECT * FROM prompt_versions WHERE prompt_version_id = ?").get(e);if(!i)return u.NextResponse.json({error:"Prompt not found"},{status:404});let j=c.prepare("SELECT * FROM datasets WHERE dataset_id = ?").get(f);if(!j)return u.NextResponse.json({error:"Dataset not found"},{status:404});let k=c.prepare("SELECT * FROM dataset_items WHERE dataset_id = ? ORDER BY image_id").all(f),l=c.prepare("SELECT * FROM detections WHERE detection_id = ?").get(g);if(!l)return u.NextResponse.json({error:"Detection not found"},{status:404});let m=(0,w.A)(),n=new Date().toISOString(),o={model:h||i.model,temperature:i.temperature,top_p:i.top_p,max_output_tokens:i.max_output_tokens};c.prepare(`
    INSERT INTO runs (run_id, detection_id, prompt_version_id, prompt_snapshot, decoding_params, dataset_id, dataset_hash, split_type, created_at, status, total_images, processed_images)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, 0)
  `).run(m,g,e,JSON.stringify({system_prompt:i.system_prompt,user_prompt_template:i.user_prompt_template}),JSON.stringify(o),f,j.dataset_hash,j.split_type,n,k.length);let p=c.prepare(`
    INSERT INTO predictions (prediction_id, run_id, image_id, image_uri, ground_truth_label, predicted_decision, confidence, evidence, parse_ok, raw_response)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),q={...i,prompt_structure:JSON.parse(i.prompt_structure||"{}"),model:h||i.model},r=[];for(let a=0;a<k.length;a++){let b=k[a];try{let e=await C(d,q,l.detection_code,b.image_uri),f={prediction_id:(0,w.A)(),run_id:m,image_id:b.image_id,image_uri:b.image_uri,ground_truth_label:b.ground_truth_label,predicted_decision:e.parsed?.decision||null,confidence:e.parsed?.confidence??null,evidence:e.parsed?.evidence||null,parse_ok:e.parseOk,raw_response:e.raw,corrected_label:null,error_tag:null,reviewer_note:null,corrected_at:null};p.run(f.prediction_id,m,f.image_id,f.image_uri,f.ground_truth_label,f.predicted_decision,f.confidence,f.evidence,+!!f.parse_ok,f.raw_response),r.push(f),c.prepare("UPDATE runs SET processed_images = ? WHERE run_id = ?").run(a+1,m)}catch(f){let d=f instanceof Error?f.message:String(f),e={prediction_id:(0,w.A)(),run_id:m,image_id:b.image_id,image_uri:b.image_uri,ground_truth_label:b.ground_truth_label,predicted_decision:null,confidence:null,evidence:null,parse_ok:!1,raw_response:`ERROR: ${d}`,corrected_label:null,error_tag:null,reviewer_note:null,corrected_at:null};p.run(e.prediction_id,m,e.image_id,e.image_uri,e.ground_truth_label,null,null,null,0,e.raw_response),r.push(e),c.prepare("UPDATE runs SET processed_images = ? WHERE run_id = ?").run(a+1,m)}}let s=(0,E.pH)(r);return c.prepare("UPDATE runs SET metrics_summary = ?, status = 'completed' WHERE run_id = ?").run(JSON.stringify(s),m),u.NextResponse.json({run_id:m,metrics:s,status:"completed",total:k.length})}let H=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/runs/route",pathname:"/api/runs",filename:"route",bundlePath:"app/api/runs/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"/Users/delaneyfoley/Developer/projects/vlm-eval copy/src/app/api/runs/route.ts",nextConfigOutput:"",userland:d}),{workAsyncStorage:I,workUnitAsyncStorage:J,serverHooks:K}=H;function L(){return(0,g.patchFetch)({workAsyncStorage:I,workUnitAsyncStorage:J})}async function M(a,b,c){var d;let e="/api/runs/route";"/index"===e&&(e="/");let g=await H.prepare(a,b,{srcPage:e,multiZoneDraftMode:!1});if(!g)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:u,params:v,nextConfig:w,isDraftMode:x,prerenderManifest:y,routerServerContext:z,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,resolvedPathname:C}=g,D=(0,j.normalizeAppPath)(e),E=!!(y.dynamicRoutes[D]||y.routes[C]);if(E&&!x){let a=!!y.routes[C],b=y.dynamicRoutes[D];if(b&&!1===b.fallback&&!a)throw new s.NoFallbackError}let F=null;!E||H.isDev||x||(F="/index"===(F=C)?"/":F);let G=!0===H.isDev||!E,I=E&&!G,J=a.method||"GET",K=(0,i.getTracer)(),L=K.getActiveScopeSpan(),M={params:v,prerenderManifest:y,renderOpts:{experimental:{cacheComponents:!!w.experimental.cacheComponents,authInterrupts:!!w.experimental.authInterrupts},supportsDynamicResponse:G,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:null==(d=w.experimental)?void 0:d.cacheLife,isRevalidate:I,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d)=>H.onRequestError(a,b,d,z)},sharedContext:{buildId:u}},N=new k.NodeNextRequest(a),O=new k.NodeNextResponse(b),P=l.NextRequestAdapter.fromNodeNextRequest(N,(0,l.signalFromNodeResponse)(b));try{let d=async c=>H.handle(P,M).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let d=K.getRootSpanAttributes();if(!d)return;if(d.get("next.span_type")!==m.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${d.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=d.get("next.route");if(e){let a=`${J} ${e}`;c.setAttributes({"next.route":e,"http.route":e,"next.span_name":a}),c.updateName(a)}else c.updateName(`${J} ${a.url}`)}),g=async g=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!(0,h.getRequestMeta)(a,"minimalMode")&&A&&B&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let e=await d(g);a.fetchMetrics=M.renderOpts.fetchMetrics;let i=M.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=M.renderOpts.collectedTags;if(!E)return await (0,o.I)(N,O,e,M.renderOpts.pendingWaitUntil),null;{let a=await e.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(e.headers);j&&(b[r.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==M.renderOpts.collectedRevalidate&&!(M.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&M.renderOpts.collectedRevalidate,d=void 0===M.renderOpts.collectedExpire||M.renderOpts.collectedExpire>=r.INFINITE_CACHE?void 0:M.renderOpts.collectedExpire;return{value:{kind:t.CachedRouteKind.APP_ROUTE,status:e.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:d}}}}catch(b){throw(null==f?void 0:f.isStale)&&await H.onRequestError(a,b,{routerKind:"App Router",routePath:e,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:A})},z),b}},l=await H.handleResponse({req:a,nextConfig:w,cacheKey:F,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:y,isRoutePPREnabled:!1,isOnDemandRevalidate:A,revalidateOnlyGenerated:B,responseGenerator:k,waitUntil:c.waitUntil});if(!E)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==t.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});(0,h.getRequestMeta)(a,"minimalMode")||b.setHeader("x-nextjs-cache",A?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),x&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);return(0,h.getRequestMeta)(a,"minimalMode")&&E||m.delete(r.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,q.getCacheControlHeader)(l.cacheControl)),await (0,o.I)(N,O,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};L?await g(L):await K.withPropagatedContext(a.headers,()=>K.trace(m.BaseServerSpan.handleRequest,{spanName:`${J} ${a.url}`,kind:i.SpanKind.SERVER,attributes:{"http.method":J,"http.target":a.url}},g))}catch(b){if(b instanceof s.NoFallbackError||await H.onRequestError(a,b,{routerKind:"App Router",routePath:D,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:A})}),E)throw b;return await (0,o.I)(N,O,new Response(null,{status:500})),null}}}};var b=require("../../../webpack-runtime.js");b.C(a);var c=b.X(0,[331,692,364],()=>b(b.s=9849));module.exports=c})();