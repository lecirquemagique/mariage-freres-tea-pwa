'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
function client(){const c={require,process:{env:{}},console,URL,Buffer,__dirname:path.join(__dirname,'../collector')};vm.createContext(c);const s=fs.readFileSync(path.join(__dirname,'../collector/collector.js'),'utf8');vm.runInContext(s.slice(0,s.lastIndexOf('\nmain().catch(')),c);return c;}
const urls={FR:'https://www.mariagefreres.com/fr/hojicha-t425-thes-au-poids.html',EN:'https://www.mariagefreres.com/en/hojicha-t425-tea-by-the-weight.html',JP:'https://www.mariagefreres.co.jp/view/item/000000009999'};
function request(){const fields=['公式商品ページURL','公式掲載状態','現行ステータス','現在の公式名','現在の公式説明','茶種タグ','産地・国','香味詳細タグ'];return {request_id:'offline-language-fixture',request_type:'complete_card',source:'PWA',version_key:'T425-B01',primary_reference:'T425',tea_reference:'T425',missing_fields:fields,target:{...Object.fromEntries(fields.map(f=>[f,''])),VersionKey:'T425-B01','Primary Reference':'T425','Tリファレンス番号':'T425','銘柄名（黒い本）':'HOJICHA'}};}
function page(language,patch={}){const url=urls[language];return {ok:true,url,language,refs:['T425'],official_name:'HOJICHA',acquisition_method:language==='FR'?'cdp_navigation':'cdp_existing_dom',facts:{url,canonical:url,h1:'HOJICHA',productSummary:'REF T425',category:language==='FR'?'Thé vert':'Green tea',productDescription:language==='FR'?'Notre thé vient de Nara.':'Our tea comes from Nara.',structuredProductData:JSON.stringify({'@type':'Product',sku:'T425',name:'HOJICHA',offers:{availability:'https://schema.org/InStock'}})},...patch};}
function fail(pages){const p=client().buildCardResearchPlan(request(),pages);assert.equal(p.candidates.length,0);assert.equal(p.product_group.status,'version_ambiguous');return p;}

test('FR/EN exact product identities form one group while preserving both official URLs',()=>{
 const p=client().buildCardResearchPlan(request(),[page('FR'),page('EN')]);
 assert.equal(p.product_group.product_count,1);assert.equal(p.product_group.language_variants,true);assert.equal(p.product_group.status,'verified');
 assert.equal(p.product_group.official_urls_by_language.FR,urls.FR);assert.equal(p.product_group.official_urls_by_language.EN,urls.EN);assert(p.candidates.length>0);
});
test('different page REF fails closed despite matching display name',()=>fail([page('FR'),page('EN',{refs:['T426']})]));
test('same REF with a different official name fails closed',()=>fail([page('FR'),page('EN',{official_name:'OTHER TEA'})]));
test('abnormal or absent canonical fails closed',()=>{for(const canonical of ['',urls.FR]){const en=page('EN');en.facts.canonical=canonical;fail([page('FR'),en]);}});
test('unofficial URL cannot be hidden behind a valid official product',()=>fail([page('FR'),page('EN',{url:'https://example.com/en/hojicha-t425-tea-by-the-weight.html'})]));
test('contradictory structured Product SKU fails closed',()=>{const en=page('EN');en.facts.structuredProductData=JSON.stringify({'@type':'Product',sku:'T426',name:'HOJICHA'});fail([page('FR'),en]);});
test('contradictory product category fails closed',()=>{const en=page('EN');en.facts.category='White tea';fail([page('FR'),en]);});
test('an explicit different target VersionKey fails closed',()=>fail([page('FR'),page('EN',{target_version_key:'T425-C01'})]));
test('URL reference mismatch, packaging mismatch or second product in same language does not group',()=>{
 for(const url of [urls.EN.replace('t425','t426'),urls.EN.replace('tea-by-the-weight','iconic-tea-tins'),urls.EN.replace('hojicha','another-tea')]){
  const other=page('EN',{url});other.facts.canonical=url;fail([page('FR'),page('EN'),other]);
 }
});
test('three-language product groups require explicit official reciprocal links for opaque JP IDs',()=>{
 const pages=['FR','EN','JP'].map(l=>page(l));
 for(const p of pages)p.facts.researchLanguageLinks=pages.filter(o=>o!==p).map(o=>({url:o.url,language:o.language==='JP'?'ja-JP':o.language.toLowerCase()}));
 const plan=client().buildCardResearchPlan(request(),pages);assert.equal(plan.product_group.product_count,1);assert.equal(plan.language_evidence.length,3);assert.equal(plan.product_group.official_urls_by_language.JP,urls.JP);
 pages[0].facts.researchLanguageLinks=[];fail(pages);
});
test('language-specific descriptions, availability and acquisition method survive candidate serialization',()=>{
 const p=client().buildCardResearchPlan(request(),[page('FR'),page('EN')]),candidate=p.candidates.find(x=>x.target_column==='現在の公式説明');
 assert.equal(candidate.suggested_value,'翻訳レビュー候補');assert.equal(candidate.human_review_required,true);
 const encoded=JSON.parse(JSON.stringify(candidate));for(const lang of ['FR','EN']){
  const e=encoded.language_evidence.find(x=>x.evidence_language===lang);assert.equal(e.source_url,urls[lang]);assert.equal(e.canonical,urls[lang]);assert.equal(e.availability,'販売中');assert(e.description);assert(e.acquisition_method);
  assert(encoded.evidence_text.includes(e.description));assert(encoded.evidence_text.includes(e.source_url));assert(encoded.evidence_text.includes(e.acquisition_method));
 }
});
test('conflicting stock values withhold that field instead of choosing the first language',()=>{
 const en=page('EN');en.facts.structuredProductData=JSON.stringify({'@type':'Product',sku:'T425',name:'HOJICHA',offers:{availability:'https://schema.org/OutOfStock'}});
 const p=client().buildCardResearchPlan(request(),[page('FR'),en]);
 assert(!p.candidates.some(c=>c.target_column==='現行ステータス'));assert.equal(p.review_conflicts[0].target_column,'現行ステータス');assert.equal(p.unresolved['現行ステータス'],'version_ambiguous');
 assert.equal(p.language_evidence.find(e=>e.evidence_language==='EN').availability,'一時欠品・入荷待ち');assert(p.candidates.some(c=>c.target_column==='現在の公式説明'));
});
test('language label alone cannot establish a variant relationship',()=>{const en=page('EN');en.language='FR';fail([page('FR'),en]);});
test('rejected conflicting product still blocks grouping of otherwise matching variants',()=>fail([page('FR'),page('EN'),{ok:false,url:urls.FR,reject_reason:'target_ref_mismatch:T426'}]));
test('reversing language input order does not change candidates or the selected scalar URL',()=>{
 const c=client(),a=c.buildCardResearchPlan(request(),[page('FR'),page('EN')]),b=c.buildCardResearchPlan(request(),[page('EN'),page('FR')]);
 assert.deepEqual(Array.from(a.candidates,x=>[x.target_column,x.suggested_value,x.evidence_url]),Array.from(b.candidates,x=>[x.target_column,x.suggested_value,x.evidence_url]));
});
