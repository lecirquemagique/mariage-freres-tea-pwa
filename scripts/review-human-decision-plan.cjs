'use strict';
// Pure local proposal: use the existing candidate serializer; never writes Sheets.
const TARGETS={586:'TB8884',587:'T4233S',588:'T4236S',589:'T4272S',590:'TE9004V',591:'TE9003N'};
function planHumanDecision({rowNumber,review,page,products,collector,gas,masterSnapshot}) {
 if(TARGETS[rowNumber]!==review['Tリファレンス番号'])throw Error('out_of_scope');
 const ref=TARGETS[rowNumber];
 if(!page.evidenceVerified||!page.refs.includes(ref)||page.official_name!==review['公式名'])throw Error('official_evidence_mismatch');
 // Accept only the same verified page (the site's /en/tea/ alias is already in the saved evidence).
 const canonical=url=>{const u=new URL(url);if(u.origin!=='https://www.mariagefreres.com')throw Error('official_evidence_mismatch');return u.origin+u.pathname.replace(/^\/(en|fr)\/tea\//,'/$1/');};
 if(canonical(page.url)!==canonical(review['公式URL']))throw Error('official_evidence_mismatch');
 if((page.explicit_parent_t_references||[]).length||collector.targetedPageParentNames(page).length)throw Error('explicit_parent_evidence');
 const resolution=collector.resolveReferenceIdentity({reference:ref,page,masterProducts:products});
 if(resolution.mode!=='unresolved')throw Error('not_unresolved');
 const candidate=collector.mergeTargetedUnregisteredReview({reference:ref,pages:[page],primaryPage:page,
   source:{id:'review-evidence-repair',source:'official_search_body'},masterProducts:products});
 collector.applyReferenceResolutionToReview(candidate,resolution);
 // Keep the automatic result unchanged. Human decision stays in the existing column.
 candidate.primary_reference=ref;
 candidate.official_names_by_language={EN:review['公式名']};
 candidate.official_urls_by_language={EN:review['公式URL']};
 candidate.evidence=`REF ${ref}; ${page.official_name}; ${page.url}; Review URL ${review['公式URL']}; ${page.evidenceSource}`;
 const built=gas.mfImageCollectorReviewCandidateToRow_(candidate,review['検出ID']);
 const updates=Object.fromEntries(['公式情報JSON','Collectorが取得した根拠','DB存在確認','DB類似候補','Discovery source'].map(h=>[h,built[h]||'']));
 const proposed={...review,...updates};
 const preflight=gas.mfImageCollectorPreflightReviewRow_(rowNumber,proposed,{master_snapshot:masterSnapshot});
 return {rowNumber,reference:ref,resolution,updates,review:proposed,validation:Array.from(gas.mfImageCollectorReviewDecisionOptions_(proposed)),preflight};
}
module.exports={TARGETS,planHumanDecision};
