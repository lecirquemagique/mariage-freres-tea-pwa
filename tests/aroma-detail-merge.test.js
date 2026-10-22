'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'collector/collector.js'),'utf8');
function setup(){const c={require,process:{env:{}},console,URL,Buffer,__dirname:path.join(root,'collector')};vm.createContext(c);vm.runInContext(source.slice(0,source.lastIndexOf('\nmain().catch(')),c);const gas={};vm.createContext(gas);vm.runInContext(fs.readFileSync(path.join(root,'backend/mf-image-collector.gs'),'utf8'),gas);return {c,gas};}
const old='ヴァニラ、カラメル、ハニー',expected='ヴァニラ、キャラメル、ヘーゼルナッツ、ハニー';
// Synthetic official-shaped URL; fixture text is supplied by the user, not a live fetch.
const url='https://www.mariagefreres.com/fr/phenix-t924-thes-au-poids.html';
const description='Notre hommage est à la hauteur de son plumage : une composition délicate au subtil parfum de vanille Bourbon, de caramel, de noisette et de miel.';
function product(current=old){return {reference:'T924',name:'PHÉNIX™',productUrl:url,master:{versionKey:'T924-B01','VersionKey':'T924-B01','Primary Reference':'T924','Tリファレンス番号':'T924','現在の公式名':'PHÉNIX™','香味詳細タグ':current}};}
function suggestions(c,p=product()){return c.buildStructuredFactSuggestions({product:p,facts:{url,h1:'PHÉNIX™',productDescription:description},vocabulary:{'香味詳細タグ':new Set(['ヴァニラ','カラメル','ノワゼット','ハニー'])}});}
test('PHÉNIX FR evidence yields one full four-tag suggestion, not a single replacement',()=>{
 const {c}=setup(),all=suggestions(c),details=all.filter(s=>s.column==='香味詳細タグ');assert.equal(details.length,1);assert.equal(details[0].suggested_value,expected);
 assert.deepEqual(Array.from(details[0].confirmed_values),expected.split('、'));assert(details[0].evidence_text.includes('noisette'));assert(details[0].evidence_text.includes('miel'));assert.equal(details[0].requires_human_review,true);
});
test('explicit noisette evidence can introduce the supported new tag even if absent from Master vocabulary',()=>{
 const {c}=setup(),p=product();const all=c.buildStructuredFactSuggestions({product:p,facts:{url,productDescription:description},vocabulary:c.structuredFactVocabulary([p])});
 assert.equal(all.find(s=>s.column==='香味詳細タグ').suggested_value,expected);
});
test('three existing tags plus one new tag merges to four in Collector and GAS',()=>{
 const {c,gas}=setup();for(const result of [c.mergeAromaDetailTags(old,'ヘーゼルナッツ'),gas.mfImageCollectorMergeAromaDetailTags_(old,'ヘーゼルナッツ')])assert.deepEqual(new Set(result.split('、')),new Set(expected.split('、')));
});
test('canonical aliases and repeated tags collapse without dropping unknown tags',()=>{
 const {c,gas}=setup(),current='バニラ、ヴァニラ、カラメル、蜂蜜、ハニー、ノワゼット、未分類の既存香';
 for(const merge of [c.mergeAromaDetailTags,gas.mfImageCollectorMergeAromaDetailTags_]){const result=merge(current,'キャラメル、ヘーゼルナッツ、ハニー、キャラメル');const tags=result.split('、');assert.equal(tags.length,5);for(const tag of ['ヴァニラ','キャラメル','ヘーゼルナッツ','ハニー','未分類の既存香'])assert(tags.includes(tag));}
});
test('current evidence mentioning only caramel cannot delete vanilla or honey',()=>{
 const {c,gas}=setup();assert.deepEqual(new Set(c.mergeAromaDetailTags(old,'キャラメル').split('、')),new Set(['ヴァニラ','キャラメル','ハニー']));
 const result=gas.mfImageCollectorEvaluateStructuredFactChange_('香味詳細タグ',old,old,'キャラメル');assert.deepEqual(new Set(result.next_value.split('、')),new Set(['ヴァニラ','キャラメル','ハニー']));
});
test('empty existing tags receive evidence-supported canonical values',()=>{
 const {c,gas}=setup();assert.equal(c.mergeAromaDetailTags('','カラメル、蜂蜜'),'キャラメル、ハニー');assert.equal(gas.mfImageCollectorEvaluateStructuredFactChange_('香味詳細タグ','','','カラメル、蜂蜜').next_value,'キャラメル、ハニー');
});
test('canonical-only change is proposed and applied, then becomes idempotent',()=>{
 const {c,gas}=setup(),p=product('カラメル、蜂蜜');const suggestion={column:'香味詳細タグ',suggested_value:'キャラメル、ハニー'};
 assert.equal(c.structuredFactSuggestionAlreadyApplied(p,suggestion),false);assert.equal(gas.mfImageCollectorEvaluateStructuredFactChange_('香味詳細タグ','カラメル、蜂蜜','カラメル、蜂蜜',suggestion.suggested_value).next_value,suggestion.suggested_value);
 p.master['香味詳細タグ']=suggestion.suggested_value;assert.equal(c.structuredFactSuggestionAlreadyApplied(p,suggestion),true);assert.equal(gas.mfImageCollectorEvaluateStructuredFactChange_('香味詳細タグ',suggestion.suggested_value,'カラメル、蜂蜜',suggestion.suggested_value).already_applied,true);
});
test('legacy partial suggestion is merged by both Review builders and GAS serializer',()=>{
 const {c,gas}=setup(),p=product(),suggestion={column:'香味詳細タグ',suggested_value:'キャラメル',evidence_text:'caramel',evidence_url:url};
 const review=c.structuredFactReviewCandidate({product:p,facts:{url,h1:'PHÉNIX™'},suggestion});assert(review.suggested_value.includes('ヴァニラ'));assert(review.suggested_value.includes('ハニー'));
 const planned=c.structuredReviewCandidateFromPlan({record:{reference:'T924',name:'PHÉNIX™'},candidate:{field:'香味詳細タグ',target_version_key:'T924-B01',suggested_value:'キャラメル',evidence:'caramel',source_url:url},product:p});assert.equal(planned.suggested_value,review.suggested_value);
 const serialized=gas.mfImageCollectorReviewCandidateToRow_({detection_type:'structured_fact',target_column:'香味詳細タグ',current_value:old,suggested_value:'キャラメル',structured_fact:suggestion},'fixture');assert.equal(serialized['候補値'],review.suggested_value);assert.equal(JSON.parse(serialized['公式情報JSON']).structured_fact.suggested_value,serialized['候補値']);
});
test('PHÉNIX candidate and GAS final value agree exactly; additional live tags are retained',()=>{
 const {c,gas}=setup(),suggested=suggestions(c).find(s=>s.column==='香味詳細タグ').suggested_value;
 assert.equal(gas.mfImageCollectorEvaluateStructuredFactChange_('香味詳細タグ',old,old,suggested).next_value,expected);
 const next=gas.mfImageCollectorEvaluateStructuredFactChange_('香味詳細タグ',old+'、ローズ',old,suggested).next_value;assert(next.endsWith('ローズ'));assert.equal(next.split('、').length,5);
});
test('stale missing existing tags fail closed rather than silently reconstructing history',()=>{
 const {gas}=setup();assert.throws(()=>gas.mfImageCollectorEvaluateStructuredFactChange_('香味詳細タグ','キャラメル',old,expected),/Master value changed/);
});
test('no deletion flags/options bypass the union rule',()=>{
 const {gas}=setup();const result=gas.mfImageCollectorEvaluateStructuredFactChange_('香味詳細タグ',old,old,'キャラメル',{replace_aroma_categories:true,delete_tags:['ヴァニラ','ハニー']});assert(result.next_value.includes('ヴァニラ'));assert(result.next_value.includes('ハニー'));
});
test('tag spelling normalization Review cannot replace detail tags with a subset',()=>{
 const {gas}=setup(),headers=['VersionKey','Primary Reference','Tリファレンス番号','香味詳細タグ'],values=[headers,['T924-B01','T924','T924',old]];
 const review={'検出種別':'structured_fact','対象VersionKey':'T924-B01','Tリファレンス番号':'T924','対象列':'香味詳細タグ','現在値':old,'候補値':'キャラメル',source_type:'tag_spelling_normalization'};
 gas.mfImageCollectorApplyStructuredFact_(review,{dry_run:true,simulate_write:true,master_snapshot:{headers,values}});assert(values[1][3].includes('ヴァニラ'));assert(values[1][3].includes('ハニー'));
});
test('non-detail scalar and category normalization semantics are unchanged',()=>{
 const {gas}=setup();assert.equal(gas.mfImageCollectorEvaluateStructuredFactChange_('産地・地域／茶園','広西','広西','雲南').next_value,'広西、雲南');assert.equal(gas.mfImageCollectorEvaluateStructuredFactChange_('ミルクティー推奨','','','はい').next_value,'はい');
 const scalar=gas.mfImageCollectorEvaluateStructuredFactChange_('現在の公式名','OLD','OLD','NEW');assert.equal(scalar.next_value,'NEW');
});
test('negative and allergen-only new nut/honey mentions are not added',()=>{
 const {c}=setup();for(const text of ['Composition sans noisette ni miel.','Ingredients may contain hazelnuts.']){const all=c.buildStructuredFactSuggestions({product:product(''),facts:{url,productDescription:text},vocabulary:{}});assert(!all.some(s=>s.column==='香味詳細タグ'&&/ヘーゼルナッツ|ハニー/.test(s.suggested_value)));}
});
test('Collector and GAS canonical dictionaries agree across supported aliases',()=>{
 const {c,gas}=setup();for(const token of ['バニラ','カラメル','蜂蜜','ノワゼット','バラ','ショウガ','クローヴ','胡椒','キク','クレーム・ブリュレ','未知タグ'])assert.equal(c.canonicalAromaDetailTag(token),gas.mfImageCollectorCanonicalAromaDetailTag_(token));
});
