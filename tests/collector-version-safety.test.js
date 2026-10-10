'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(process.env.MF_GAS_TEST_SOURCE || path.join(root,'backend/mf-image-collector.gs'),'utf8');
const headers=['VersionKey','Primary Reference','Tリファレンス番号','バージョン','現在の公式名','現在の公式説明','現在のカテゴリ','公式商品ページURL','茶葉画像URL','茶葉サムネイルURL','水色画像URL','茶葉画像状態','茶葉サムネイル状態','水色画像状態','公式商品ページURL状態','現行ステータス','初回確認日','最終確認日','産地・国','黒い本掲載','茶種タグ','燻製茶'];
const url=ref=>`https://www.mariagefreres.com/fr/test-${ref.toLowerCase()}-thes-au-poids.html`;
function setup(reverse=false){
 const row=(key,ref)=>headers.map(h=>({VersionKey:key,'Primary Reference':ref,'Tリファレンス番号':ref,'現行ステータス':'販売中','初回確認日':'2026-09-05','最終確認日':'2026-09-05'}[h]||''));
 const data=[headers.slice(),...(reverse?[row('T8307-C01','T8307'),row('T8307-B01','T8307')]:[row('T8307-B01','T8307'),row('T8307-C01','T8307')]),row('T2006-N01','T2006')];
 const writes=[],drive=[],effects=[];
 const sheet={getDataRange:()=>({getValues:()=>data.map(r=>r.slice())}),getLastColumn:()=>data[0].length,insertColumnAfter:()=>{effects.push('column');data.forEach(r=>r.push(''));},getRange:(r,c)=>({getValue:()=>data[r-1][c-1]||'',setValue:v=>{writes.push({r,c,v});data[r-1][c-1]=v;}})};
 const ctx={PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},DriveApp:{getFolderById:()=>{drive.push('folder');return {};}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);ctx.mfImageCollectorAssertSecret_=()=>{};ctx.mfImageCollectorOpenSpreadsheet_=()=>({getSheetByName:()=>sheet});
 ctx.mfImageCollectorApplyStatusValidation_=()=>effects.push('validation');
 ctx.mfImageCollectorGetOrCreateSubfolder_=()=>({});
 ctx.mfImageCollectorUpsertFile_=(_f,name)=>{drive.push(name);return {file:{getId:()=>name,getName:()=>name},action:'created'};};
 ctx.mfImageCollectorTrashLegacyLiqueurFiles_=()=>drive.push('legacy-cleanup');
 return {ctx,data,writes,drive,effects};
}
const images=['tea','teaThumbnail','liqueur'].map(image_type=>({image_type,url:'https://example.test/'+image_type,status:'available'}));
const routes={
 upload:(g,ref,key)=>g.mfImageCollectorUploadImageResults_({reference:ref,version_key:key,images:images.map(i=>({...i,file_name:i.image_type+'.jpg',data_base64:'AA=='}))}),
 images:(g,ref,key)=>g.mfImageCollectorUpdateSheet_(ref,images,key),
 productURL:(g,ref,key)=>g.mfImageCollectorUpdateProductPageUrl_({reference:ref,version_key:key,status:'available',product_page_url:url(ref)}),
 officialInfo:(g,ref,key)=>g.mfImageCollectorUpdateMasterOfficialInfo_({reference:ref,version_key:key,official_description:'現行説明',official_category:'白茶'}),
 defaults:(g,ref,key)=>g.mfImageCollectorUpdateMasterNewTeaDefaults_({reference:ref,version_key:key,dry_run:false,official_name:'BLANC JASMIN',official_category:'白茶',product_page_url:url(ref)}),
 review:(g,ref,key)=>g.mfImageCollectorApplyApprovedReview_({'Tリファレンス番号':ref,'公式名':'BLANC JASMIN','公式URL':url(ref)},'既存銘柄を更新',key,{}),
 structured:(g,ref,key)=>g.mfImageCollectorApplyStructuredFact_({'Tリファレンス番号':ref,'対象VersionKey':key,'対象列':'産地・国','現在値':'','候補値':'中国'},{}),
};
for(const reverse of [false,true])for(const [name,run] of Object.entries(routes)){
 test(`${name}: primary-only ambiguous, zero cells/headers/Drive writes, reverse=${reverse}`,()=>{const x=setup(reverse),before=JSON.stringify(x.data);assert.throws(()=>run(x.ctx,'T8307',''),/ambiguous/i);assert.equal(JSON.stringify(x.data),before);assert.equal(x.writes.length,0);assert.equal(x.drive.length,0);assert.equal(x.effects.length,0);});
 test(`${name}: explicit C01 updates only C01, reverse=${reverse}`,()=>{const x=setup(reverse);run(x.ctx,'T8307','T8307-C01');assert(x.writes.some(w=>w.r>1));assert(x.writes.filter(w=>w.r>1).every(w=>x.data[w.r-1][0]==='T8307-C01'));for(const r of x.data.slice(1)){assert.equal(r[15],'販売中');assert.equal(r[16],'2026-09-05');assert.equal(r[17],'2026-09-05');}});
 test(`${name}: unrelated single Version still works, reverse=${reverse}`,()=>{const x=setup(reverse);run(x.ctx,'T2006','');assert(x.writes.some(w=>w.r===4));assert(x.writes.filter(w=>w.r>1).every(w=>w.r===4));});
}
test('upload rejects ambiguity before Drive operations or header creation',()=>{const x=setup();assert.throws(()=>x.ctx.mfImageCollectorUploadImageResults_({reference:'T8307',images}),/ambiguous/i);assert.deepEqual(x.drive,[]);assert.deepEqual(x.writes,[]);});
for(const [key,ref,pattern] of [['T8307-C99','T8307',/not found/i],['T8307-C01','T2006',/mismatch/i]])test('invalid explicit target never falls back: '+key+'/'+ref,()=>{for(const run of Object.values(routes)){const x=setup();assert.throws(()=>run(x.ctx,ref,key),pattern);assert.equal(x.writes.length,0);}});
test('duplicate explicit keys fail closed',()=>{const x=setup();x.data.push(x.data[2].slice());assert.throws(()=>x.ctx.mfImageCollectorUpdateSheet_('T8307',images,'T8307-C01'),/duplicated/i);assert.equal(x.writes.length,0);});
test('unique name or URL does not auto-resolve multiple Versions',()=>{const x=setup();x.data[2][4]='BLANC JASMIN';x.data[2][7]=url('T8307');const r=x.ctx.mfImageCollectorResolveStructuredFactMasterRow_(x.data,x.data[0],{'Tリファレンス番号':'T8307','公式名':'BLANC JASMIN','公式URL':url('T8307')});assert.equal(r.ok,false);assert.match(r.reason,/ambiguous/i);});
test('description Review requires a strict C01 target and updates only C01',()=>{const x=setup();x.ctx.mfImageCollectorApplyOfficialDescriptionTranslation_({'Tリファレンス番号':'T8307','対象VersionKey':'T8307-C01','現在値':''},{approved_japanese_description:'人間確認済み説明'});assert.equal(x.writes.length,1);assert.equal(x.data[x.writes[0].r-1][0],'T8307-C01');});
function client(){const ctx={require,process:{env:{}},console,URL,Buffer,__dirname:path.join(root,'collector')};vm.createContext(ctx);const code=fs.readFileSync(path.join(root,'collector/collector.js'),'utf8');vm.runInContext(code.slice(0,code.lastIndexOf('\nmain().catch(')),ctx);return ctx;}
function products(){return ['T8307-B01','T8307-C01','T2006-N01'].map(key=>({reference:key.split('-')[0],name:key,productUrl:url(key.split('-')[0]),master:{versionKey:key}}));}
test('client normal, ref-selected, backfill and enrichment paths exclude both ambiguous rows',()=>{const g=client(),ps=products();for(const selected of [g.selectProducts({}, {products:{}},null,ps),g.selectProducts({}, {products:{}},['T8307'],ps),g.selectOfficialDescriptionBackfillProducts(ps),g.selectEnrichmentProducts(ps)])assert(Array.from(selected).every(p=>p.reference==='T2006'));assert.equal(g.selectProducts({}, {products:{}},null,ps).length,1);});
test('client resolvers never use first row/name/URL to choose a Version',()=>{const g=client(),ps=products();assert.equal(g.findMasterProductByReference(ps,'T8307'),null);assert.equal(g.resolveStructuredFactMasterProduct({reference:'T8307',masterProducts:ps,facts:{url:ps[1].productUrl},officialName:ps[1].name}),null);assert.equal(g.findMasterProductByReference(ps,'T2006').master.versionKey,'T2006-N01');});
test('client write helpers reject known ambiguity before fetch',async()=>{const g=client(),p=products()[0];p.master.referenceAmbiguous=true;for(const name of ['writeBackImageResults','writeBackProductPageUrl','writeBackMasterOfficialInfo'])await assert.rejects(g[name]({product:p,config:{}}),/ambiguous/i);});
test('client fetched Master marks both Versions ambiguous without dropping either',async()=>{const g=client();g.fetch=async()=>({ok:true,text:async()=>'__mfCollectorCb('+JSON.stringify({ok:true,rows:products().map(p=>({VersionKey:p.master.versionKey,'Primary Reference':p.reference,'Tリファレンス番号':p.reference,'現在の公式名':p.name}))})+');'});const result=await g.fetchMasterProducts({masterSource:{gasApiUrl:'https://example.test/exec'}},root,false);assert.equal(result.products.length,3);assert.deepEqual(Array.from(result.products,p=>p.master.referenceAmbiguous),[true,true,false]);});
test('Review dispatch preserves explicitly selected C01 for structured facts',()=>{const x=setup();x.ctx.mfImageCollectorApplyApprovedReview_({'検出種別':'structured_fact','Tリファレンス番号':'T8307','対象列':'産地・国','現在値':'','候補値':'中国'},'既存銘柄を更新','T8307-C01',{});assert.equal(x.writes.length,1);assert.equal(x.data[x.writes[0].r-1][0],'T8307-C01');});
test('Sales SKU automatic parent resolution sees both B01 and C01',()=>{const x=setup();const candidates=x.ctx.mfImageCollectorSalesSkuParentRows_(x.data,x.data[0]).filter(p=>p.reference==='T8307');assert.equal(candidates.length,2);assert.throws(()=>x.ctx.mfImageCollectorSelectSalesSkuParentCandidate_(candidates,{},'fixture'),/ambiguous/i);});
