'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/master-audit-disabled-entry.gs'),'utf8');
function context(){
 const c={Date,JSON,Set};vm.createContext(c);
 vm.runInContext(fs.readFileSync(process.env.MF_GAS_TEST_SOURCE||path.join(root,'backend/mf-image-collector.gs'),'utf8'),c);
 vm.runInContext(process.env.MF_MASTER_AUDIT_TEST_SOURCE?fs.readFileSync(process.env.MF_MASTER_AUDIT_TEST_SOURCE,'utf8'):fixture,c);
 const properties={},calls={master:0,property:0,read:0,release:0};
 c.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>calls.release++})};
 c.PropertiesService={getScriptProperties:()=>({getProperty:k=>properties[k]||null,setProperty(){calls.property++;},deleteProperty(){calls.property++;}})};
 c.mfMasterAuditAssert_=(ok,reason)=>{if(!ok)throw Error(reason);};
 c.mfMasterAuditRead_=()=>{calls.read++;return {};};
 c.mfMasterAuditPlan_=()=>({status:'planned',schemaReady:true,requests:[],masterCells:1,auditRowCount:1});
 c.mfMasterAuditCommit_=()=>{calls.master++;throw Error('Unexpected write');};
 c.mfImageCollectorJson_=x=>x;c.mfImageCollectorJsonOrJsonp_=x=>x;
 return {c,properties,calls};
}
for(const action of ['mfMasterAuditApply_','masterAuditApply','masterAudit']){
 test('normal POST does not expose inactive management writer: '+action,()=>{
  const {c,calls}=context();const result=c.mfImageCollectorDoPost({postData:{contents:JSON.stringify({action,dryRun:false})}});
  assert.equal(result.ok,false);assert.equal(result.error,'Unsupported action.');assert.equal(calls.read,0);assert.equal(calls.master,0);assert.equal(calls.property,0);
 });
 test('normal GET does not expose inactive management writer: '+action,()=>{
  const {c,calls}=context();const result=c.mfImageCollectorDoGet({parameter:{action,dryRun:false}});
  assert.equal(result.ok,false);assert.equal(result.error,'Unsupported action.');assert.equal(calls.read,0);assert.equal(calls.master,0);assert.equal(calls.property,0);
 });
}
test('production management entry defaults to preview with zero writes',()=>{
 const {c,calls}=context(),r=c.mfMasterAuditApply_({operationId:'boundary-fixture'});
 assert.equal(r.status,'dry_run');assert.equal(r.writePerformed,false);assert.equal(calls.master,0);assert.equal(calls.property,0);assert.equal(calls.release,1);
});
for(const flag of [undefined,'false','TRUE'])test('explicit write is rejected without exact enabled gate: '+String(flag),()=>{
 const {c,calls,properties}=context();if(flag!==undefined)properties.MF_MASTER_AUDIT_WRITE_ENABLED=flag;
 const r=c.mfMasterAuditApply_({operationId:'boundary-fixture'},{dryRun:false});
 assert.equal(r.status,'rejected');assert.equal(r.reason,'audit_write_disabled');assert.equal(r.writePerformed,false);assert.equal(calls.master,0);assert.equal(calls.property,0);assert.equal(calls.release,1);
});
test('preview cannot become a write merely because gate is configured',()=>{
 const {c,calls,properties}=context();properties.MF_MASTER_AUDIT_WRITE_ENABLED='true';
 assert.equal(c.mfMasterAuditApply_({operationId:'boundary-fixture'},{dryRun:true}).status,'dry_run');assert.equal(calls.master,0);assert.equal(calls.property,0);
});
test('test-only excerpt matches actual production entry when fresh source is supplied',()=>{
 const {c}=context(),saved={};vm.createContext(saved);vm.runInContext(fixture,saved);
 assert.equal(c.mfMasterAuditApply_.toString().replace(/\r\n/g,'\n'),saved.mfMasterAuditApply_.toString().replace(/\r\n/g,'\n'));
});
