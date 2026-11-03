'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
function client(){
  const c={require,process:{env:{}},console,URL,Buffer,__dirname:path.join(root,'collector')};vm.createContext(c);
  const source=fs.readFileSync(path.join(root,'collector/collector.js'),'utf8');
  vm.runInContext(source.slice(0,source.lastIndexOf('\nmain().catch(')),c);return c;
}
// Saved official evidence from the HOJICHA E2E; no live network or production writes.
const urls={FR:'https://www.mariagefreres.com/fr/hojicha-t425-thes-au-poids.html',EN:'https://www.mariagefreres.com/en/hojicha-t425-tea-by-the-weight.html'};
const descriptions={
  FR:'Les feuilles couleur loupe d’orme livrent une note de caroube chocolatée et de muscade. Puis infusées, elles se dévoilent sous des reflets ébène cendré évoquant le souvenir d’un sirop de pralines. La liqueur ambre aux reflets grenat caresse le palais par un voile boisé, puis est empli d’une fragrance vanillée mêlée de sucre de palme au goût de caramel. Présenté dans un sachet noir Mariage Frères.',
  EN:"Our Hojicha is issued from a small, family-run tea garden in the historic village of Nara. The leaves and young twigs of Sencha green tea are roasted artisanally in the family's workshop. Originally a way to conserve the tea, today this heating method is appreciated for the relaxing and flavourful liqueur it produces, accompanying perfectly a meal or a dessert. Japanese saveurs. Presented in a Mariage Frères black pouch."
};
const detail='チョコレート、ヴァニラ、キャラメル、木質';
const major='スパイス、甘香・菓子、カカオ、キャラメル、ウッディ';
const allowedDetails=['チョコレート','ヴァニラ','キャラメル','カラメル','木質','ローズ','ハニー','ヘーゼルナッツ'];
const allowedMajors=['花','果実','ベリー','柑橘','スパイス','ハーブ','ミント','甘香・菓子','カカオ','キャラメル','ナッツ','モルト','植物・青葉','ウッディ'];
function vocabulary(){return {'香味詳細タグ':new Set(allowedDetails),'香味大分類':new Set(allowedMajors)};}
function product(current=''){return {reference:'T425',name:'HOJICHA',productUrl:urls.FR,master:{VersionKey:'T425-B01',versionKey:'T425-B01','Primary Reference':'T425','Tリファレンス番号':'T425','現在の公式名':'HOJICHA','公式商品ページURL':urls.FR,'香味詳細タグ':current,'香味大分類':'','現在の公式説明':''}};}
function suggestions(c,text,current='',vocab=vocabulary()){
  return c.buildStructuredFactSuggestions({product:product(current),facts:{url:urls.FR,productDescription:text},vocabulary:vocab});
}
const value=(items,column)=>items.find(x=>x.column===column)?.suggested_value;

for(const [word,tag,category]of [
  ['vanille','ヴァニラ','甘香・菓子'],['vanillé','ヴァニラ','甘香・菓子'],['vanillée','ヴァニラ','甘香・菓子'],['vanillées','ヴァニラ','甘香・菓子'],
  ['chocolat','チョコレート','カカオ'],['chocolaté','チョコレート','カカオ'],['chocolatée','チョコレート','カカオ'],['chocolatées','チョコレート','カカオ'],
  ['boisé','木質','ウッディ'],['boisée','木質','ウッディ'],['boisés','木質','ウッディ'],
  ['caramel','キャラメル','甘香・菓子、キャラメル']
])test(`explicit flavor form ${word} yields ${tag} and ${category}`,()=>{
  const all=suggestions(client(),`Une note de ${word}.`);
  assert.equal(value(all,'香味詳細タグ'),tag);assert.equal(value(all,'香味大分類'),category);
});

test('muscade and pralines authorize categories, never unapproved detail tags',()=>{
  const c=client();for(const [word,category]of [['muscade','スパイス'],['praline','甘香・菓子'],['pralines','甘香・菓子'],['pralinée','甘香・菓子']]){
    const all=suggestions(c,`Une note de ${word}.`);assert.equal(value(all,'香味大分類'),category);assert.equal(value(all,'香味詳細タグ'),undefined);
  }
});
test('FR fragrance and woody veil are explicit aroma contexts without a generic note word',()=>{
  const c=client();assert.equal(value(suggestions(c,'Une fragrance vanillée.'),'香味詳細タグ'),'ヴァニラ');
  assert.equal(value(suggestions(c,'Un voile boisé.'),'香味詳細タグ'),'木質');
  assert.equal(suggestions(c,'Un jardin boisé.').filter(x=>/香味/.test(x.column)).length,0);
});
test('caroube alone never implies cocoa/chocolate or an invented detail',()=>{
  const all=suggestions(client(),'Une note de caroube.');assert.equal(all.filter(x=>/香味/.test(x.column)).length,0);
});
test('caroube chocolatée uses the explicit chocolate adjective as evidence',()=>{
  const all=suggestions(client(),'Une note de caroube chocolatée.');assert.equal(value(all,'香味詳細タグ'),'チョコレート');assert.equal(value(all,'香味大分類'),'カカオ');
});
test('word boundaries exclude compounds and unrelated FR words',()=>{
  const c=client();for(const text of ['vanilline','vanillier','antivanille','chocolatier','chocolaterie','chocolatine','Boise','boiserie','reboisée','framboisée','muscadet','supraline']){
    assert.equal(suggestions(c,`Une note de ${text}.`).filter(x=>/香味/.test(x.column)).length,0,text);
  }
});
test('new detail rules still require the existing detail vocabulary',()=>{
  const all=suggestions(client(),descriptions.FR,'',{'香味詳細タグ':new Set(['キャラメル']),'香味大分類':new Set(allowedMajors)});
  assert.equal(value(all,'香味詳細タグ'),'キャラメル');assert.equal(value(all,'香味大分類'),major);
});
test('canonicalizing one category to several keeps the complete valid set',()=>{
  const c=client(),out=[];c.addStructuredSuggestion(out,product(),{column:'香味大分類',suggested_value:'キャラメル'});
  assert.equal(out.length,1);assert.equal(out[0].suggested_value,'甘香・菓子、キャラメル');
  c.addStructuredSuggestion(out,product(),{column:'香味大分類',suggested_value:'甘香・菓子、キャラメル'});assert.equal(out.length,1);
});
test('empty, undefined and mixed-invalid category values fail closed',()=>{
  const c=client();for(const proposed of ['', '  ',null,undefined,'未定義分類','甘香・菓子、未定義分類','スパイス、謎の香り']){
    const out=[];c.addStructuredSuggestion(out,product(),{column:'香味大分類',suggested_value:proposed});assert.equal(out.length,0,String(proposed));
  }
});
test('HOJICHA yields one full detail set and one ordered category set with all evidence',()=>{
  const all=suggestions(client(),descriptions.FR);
  assert.equal(value(all,'香味詳細タグ'),detail);assert.equal(value(all,'香味大分類'),major);
  for(const column of ['香味詳細タグ','香味大分類']){
    const items=all.filter(x=>x.column===column);assert.equal(items.length,1);assert.equal(items[0].requires_human_review,true);
    for(const text of ['chocolatée','vanillée','caramel','boisé'])assert(items[0].evidence_text.includes(text),text);
  }
  const cats=all.find(x=>x.column==='香味大分類');assert(cats.evidence_text.includes('muscade'));assert(cats.evidence_text.includes('pralines'));
  for(const forbidden of ['ナツメグ','プラリネ','キャロブ','イナゴマメ'])assert(!value(all,'香味詳細タグ').includes(forbidden));
});
test('partial new evidence preserves canonical existing tags and deduplicates',()=>{
  const all=suggestions(client(),'Une note de chocolatée et de caramel.','ローズ、カラメル、ヴァニラ、ハニー、カラメル');
  assert.equal(value(all,'香味詳細タグ'),'チョコレート、キャラメル、ローズ、ヴァニラ、ハニー');
});
test('other structured columns keep their independent values',()=>{
  const all=suggestions(client(),'Origin Japan. Une note de chocolatée et de muscade.');
  assert.equal(value(all,'産地・国'),'日本');assert.equal(all.filter(x=>x.column==='産地・国').length,1);
});
test('PHENIX retains the approved four-tag union and now keeps caramel category',()=>{
  const c=client(),all=suggestions(c,'Notre hommage est à la hauteur de son plumage : une composition délicate au subtil parfum de vanille Bourbon, de caramel, de noisette et de miel.','ヴァニラ、カラメル、ハニー');
  assert.equal(value(all,'香味詳細タグ'),'ヴァニラ、キャラメル、ヘーゼルナッツ、ハニー');assert.equal(value(all,'香味大分類'),'甘香・菓子、キャラメル');
});

function request(){const p=product();return {request_id:'offline-hojicha-aroma-audit',request_type:'complete_card',source:'PWA',version_key:'T425-B01',primary_reference:'T425',tea_reference:'T425',target:p.master,missing_fields:['現在の公式説明','香味詳細タグ','香味大分類'],vocabulary:{'香味詳細タグ':allowedDetails,'香味大分類':allowedMajors}};}
function page(language,text=descriptions[language]){const url=urls[language];return {ok:true,url,language,refs:['T425'],official_name:'HOJICHA',acquisition_method:'cdp_navigation',facts:{url,canonical:url,h1:'HOJICHA',productSummary:'REF T425',category:language==='FR'?'Thé vert':'Green tea',productDescription:text}};}
test('HOJICHA complete_card FR/EN preview generates the corrected three candidates, no writes',async()=>{
  const c=client(),r=request(),before=JSON.stringify(r);let calls=0;
  const result=await c.processCardResearchRequest({request:r,inspect:async()=>[page('FR'),page('EN')],dryRun:true,call:async()=>{calls++;throw Error('No production APIs allowed');}});
  const plan=result.plan;assert.equal(plan.candidates.length,3);assert.equal(plan.product_group.language_variants,true);assert.equal(plan.review_conflicts.length,0);
  assert.equal(plan.candidates.find(x=>x.target_column==='香味詳細タグ').suggested_value,detail);
  assert.equal(plan.candidates.find(x=>x.target_column==='香味大分類').suggested_value,major);
  const translation=plan.candidates.find(x=>x.target_column==='現在の公式説明');assert.equal(translation.suggested_value,'翻訳レビュー候補');
  for(const lang of ['FR','EN'])assert(translation.evidence_text.includes(descriptions[lang]));
  for(const candidate of plan.candidates){assert.equal(candidate.language_evidence.length,2);assert.equal(candidate.human_review_required,true);assert.equal(candidate.current_value,'');}
  assert.equal(calls,0);assert.equal(result.normal_image_products,0);assert.equal(result.master_writes,0);assert.equal(JSON.stringify(r),before);
});
test('single-language complete_card retains all categories instead of the first match',()=>{
  const plan=client().buildCardResearchPlan(request(),[page('FR')]);assert.equal(plan.candidates.find(x=>x.target_column==='香味大分類').suggested_value,major);
});
test('positive language-specific aroma sets are unioned with provenance, not scalar conflicts',()=>{
  const c=client(),r=request(),en=page('EN','A flavour of rose.');r.vocabulary['香味詳細タグ']=[...allowedDetails,'ローズ'];
  const plan=c.buildCardResearchPlan(r,[page('FR'),en]),cats=plan.candidates.find(x=>x.target_column==='香味大分類');
  assert.equal(cats.suggested_value,'花、'+major);assert(cats.evidence_text.includes('rose'));assert(cats.evidence_text.includes('muscade'));assert.equal(plan.review_conflicts.length,0);
});
test('Version/REF/name/canonical safety remains fail closed for HOJICHA',()=>{
  const c=client();for(const patch of [{refs:['T426']},{official_name:'OTHER TEA'},{facts:{...page('EN').facts,canonical:urls.FR}}]){
    const plan=c.buildCardResearchPlan(request(),[page('FR'),{...page('EN'),...patch}]);assert.equal(plan.candidates.length,0);assert.equal(plan.product_group.status,'version_ambiguous');
  }
});
