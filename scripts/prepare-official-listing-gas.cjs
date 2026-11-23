'use strict';
// Prepare local files only. Never saves Apps Script or changes a deployment.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EXPECTED_V97_MAIN='955819413ed4b56859f17b81f4b2f3ef195bc2a94f3bb73ce2fcb468f0c9ed1f';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function patch(source){
 if(sha(source)!==EXPECTED_V97_MAIN)throw Error('Fresh production main no longer matches verified v97. Re-baseline before preparing.');
 const once=(a,b)=>{if(source.split(a).length!==2)throw Error('Patch location is ambiguous.');source=source.replace(a,b);};
 once('if (hasValue) rows.push(row);',"if (hasValue) {\n      if (typeof row['公式掲載根拠／出典'] === 'undefined') row['公式掲載根拠／出典'] = '';\n      rows.push(row);\n    }");
 once("var values = headerName === '公式商品ページURL状態'","var values = headerName === '公式掲載状態'\n    ? mfImageCollectorOfficialListingAllowed_(sheet.getDataRange().getValues(), columnNumber - 1)\n    : headerName === '公式商品ページURL状態'");
 return source;
}
function prepare(input,out){
 const source=fs.readFileSync(input,'utf8'),candidate=patch(source),module=fs.readFileSync(path.join(__dirname,'../backend/official-listing.gs'),'utf8').replace(/\r\n/g,'\n');
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'mf-image-collector.gs'),candidate,{flag:'wx'});
 fs.writeFileSync(path.join(out,'official-listing.gs'),module,{flag:'wx'});
 const result={local_only:true,production_writes:0,expected_version:97,input_sha256:sha(source),candidate_main_sha256:sha(candidate),new_module_sha256:sha(module),
  changed_existing_sources:['mf-image-collector.gs: API evidence empty default and listing validation branch'],added_sources:['official-listing.gs'],
  unchanged:['image-intent.gs','image-identity.gs','all other existing GAS sources','appsscript.json','Script Properties','deployment ID/URL'],requires_fresh_source_manifest_comparison:true};
 fs.writeFileSync(path.join(out,'candidate-manifest.json'),JSON.stringify(result,null,2),{flag:'wx'});return result;
}
if(require.main===module){if(!process.argv[3])throw Error('Usage: node scripts/prepare-official-listing-gas.cjs <fresh-v97-main-file> <new-local-output-directory>');console.log(JSON.stringify(prepare(process.argv[2],process.argv[3]),null,2));}
module.exports={patch,prepare,EXPECTED_V97_MAIN};
