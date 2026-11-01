import {confirmedPostAnalysis,postSource} from './benchmarks.js';
import {creativePacks} from './creative-packs.js';
import {defaultRules} from './features.js';
import {problem} from './gateway.js';
import {CREATIVE_TASKS,KIND_TASK,schemaExamples,parseCreativeOutput,validateCreativePayload,paragraphs,semanticScope,DIAGNOSTIC_DIMENSIONS} from './creative-contracts.js';

const uid=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
const row=value=>value?{...value,data:JSON.parse(value.data)}:null;
export const creativeHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
const cleanString=(value)=>typeof value==='string'?value:'';
const unique=value=>[...new Set(value)];
const recordContent=(content,full)=>full?{title:content.data.title,body:content.data.body,platform:content.data.platform,topic_id:content.data.topic_id||null,asset_ids:content.data.asset_ids||[],layout_json:content.data.layout_json||null,image_snapshot_hashes:content.data.image_snapshot_hashes||{}}:{title:content.data.title,platform:content.data.platform,topic_id:content.data.topic_id||null};
const accountProfile=account=>({name:account.name,platform:account.platform,...Object.fromEntries(['positioning','audience','pillars','tone','length','rules','tags'].map(key=>[key,account.data[key]||'']))});

function service(c) {
  const {owner,aid,sql,all,env}=c;
  const project=async id=>{const p=row(await sql('SELECT * FROM creative_projects WHERE id=? AND owner_id=? AND account_id=?',id,owner,aid).first());if(!p)throw problem(404,'创作项目不存在或属于其他账号');return p;};
  const artifact=async id=>{const a=row(await sql('SELECT * FROM creative_artifacts WHERE id=? AND owner_id=? AND account_id=?',id,owner,aid).first());if(!a)throw problem(404,'创作材料不存在或属于其他账号');return a;};
  const artifacts=async pid=>(await all('SELECT * FROM creative_artifacts WHERE project_id=? AND owner_id=? AND account_id=? ORDER BY updated_at DESC,rowid DESC',pid,owner,aid)).map(row);
  const active=async(pid,kind)=>row(await sql("SELECT * FROM creative_artifacts WHERE project_id=? AND owner_id=? AND account_id=? AND kind=? AND status='approved' ORDER BY updated_at DESC,rowid DESC LIMIT 1",pid,owner,aid,kind).first());
  const activeRules=async scope=>scope?(await all("SELECT * FROM creative_artifacts WHERE owner_id=? AND account_id=? AND kind='rule' AND status='applied' ORDER BY id",owner,aid)).map(row).filter(r=>r.data.payload.scope_actions.includes(scope)):[];
  const epoch=async()=>await sql('SELECT revision FROM creative_account_state WHERE owner_id=? AND account_id=?',owner,aid).first();
  async function guardState(p) {
    const account=await c.account(aid),e=await epoch();
    return [{table:'creative_projects',id:p.id,revision:p.revision},{table:'accounts',id:account.id,data:JSON.stringify(account.data),name:account.name,status:account.status},...(e?[{table:'creative_account_state',revision:e.revision}]:[])];
  }
  async function assess(a,{skipContent=false}={}) {
    const reasons=[],guards=await guardState(await project(a.project_id));
    for(const dep of a.data.dependencies||[]) {
      try {
        let value;
        if(dep.type==='project'){const p=await project(a.project_id);value=p.data;}
        else if(dep.type==='account')value=accountProfile(await c.account(aid));
        else if(dep.type==='content'){if(skipContent)continue;const content=await c.record(dep.id,'content',aid);if(content.deleted)throw 0;value=((a.status==='applied'&&a.kind!=='rule')||(a.kind==='diagnostic'&&a.data.applied_issue_ids?.length))&&content.revision===a.data.applied_content_revision?a.data.source_content_snapshot:recordContent(content,dep.full);guards.push({table:'records',id:content.id,revision:content.revision});}
        else if(dep.type==='record'){const source=await c.record(dep.id,dep.kind,aid);if(source.deleted)throw 0;value=source.data;guards.push({table:'records',id:source.id,revision:source.revision});}
        else if(dep.type==='artifact'){const ref=await artifact(dep.id);if(dep.approved&&ref.status!=='approved'&&ref.status!=='applied')throw 0;value=ref.data.payload;guards.push({table:'creative_artifacts',id:ref.id,revision:ref.revision});}
        else if(dep.type==='active_artifact'){const ref=await active(a.project_id,dep.kind);value=ref?{id:ref.id,payload:ref.data.payload}:null;if(ref)guards.push({table:'creative_artifacts',id:ref.id,revision:ref.revision});}
        else if(dep.type==='preference'){const pref=await sql('SELECT data FROM preferences WHERE owner_id=? AND key=?',owner,dep.key).first();value=pref?JSON.parse(pref.data):null;guards.push({table:'preferences',key:dep.key,data:pref?.data??null});}
        else if(dep.type==='rules'){value=(await activeRules(dep.scope)).map(r=>({id:r.id,payload:r.data.payload,version:r.data.version}));}
        else {reasons.push('未知依赖类型');continue;}
        if(await creativeHash(value)!==dep.hash)reasons.push(dep.label+'已变化');
      } catch {reasons.push((dep.label||'引用材料')+'不可用或尚未确认');}
    }
    return {stale:reasons.length>0,reasons:unique(reasons),guards};
  }
  function guardSQL(guards=[]) {
    const queries=[],params=[];
    for(const g of guards) {
      if(g.table==='preferences'){queries.push(g.data===null?'NOT EXISTS(SELECT 1 FROM preferences WHERE owner_id=? AND key=?)':'EXISTS(SELECT 1 FROM preferences WHERE owner_id=? AND key=? AND data=?)');params.push(owner,g.key,...(g.data===null?[]:[g.data]));}
      else if(g.table==='accounts'){queries.push('EXISTS(SELECT 1 FROM accounts WHERE id=? AND owner_id=? AND data=? AND name=? AND status=?)');params.push(g.id,owner,g.data,g.name,g.status);}
      else if(g.table==='creative_account_state'){queries.push('EXISTS(SELECT 1 FROM creative_account_state WHERE owner_id=? AND account_id=? AND revision=?)');params.push(owner,aid,g.revision);}
      else if(['creative_projects','creative_artifacts','records'].includes(g.table)){queries.push(`EXISTS(SELECT 1 FROM ${g.table} WHERE id=? AND owner_id=? AND account_id=? AND revision=?)`);params.push(g.id,owner,aid,g.revision);}
    }
    return {query:queries.length?queries.join(' AND '):'1',params};
  }
  function insertArtifact(a,runId=null,runStatus='succeeded') {
    const condition=runId?" WHERE EXISTS(SELECT 1 FROM ai_runs WHERE id=? AND owner_id=? AND status=?)":'';
    const args=[a.id,owner,aid,a.project_id,a.kind,a.status,JSON.stringify(a.data),1,a.created_at,a.updated_at,...(runId?[runId,owner,runStatus]:[])];
    return [sql('INSERT INTO creative_artifacts SELECT ?,?,?,?,?,?,?,?,?,?'+condition,...args),sql('INSERT INTO creative_artifact_revisions SELECT ?,id,revision,status,data,updated_at FROM creative_artifacts WHERE id=? AND owner_id=?',uid(),a.id,owner)];
  }
  async function createArtifact(p,kind,payload,data={}) {
    const t=now(),a={id:uid(),project_id:p.id,kind,status:'draft',data:{...data,payload},created_at:t,updated_at:t};
    await env.DB.batch([...insertArtifact(a),c.log('creative.'+kind+'.created',a.id,aid)]);return artifact(a.id);
  }
  async function saveArtifact(a,payload,status,expected,{guards=[],extraData={},bumpEpoch=false}={}) {
    if(!Number.isInteger(expected)||a.revision!==expected)throw problem(409,'材料已有新修订，请刷新后比较');
    const t=now(),token=uid(),data={...a.data,...extraData,payload,_mutation_id:token},g=guardSQL(guards);
    const statements=[sql(`UPDATE creative_artifacts SET data=?,status=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND account_id=? AND revision=? AND ${g.query}`,JSON.stringify(data),status,t,a.id,owner,aid,expected,...g.params),sql("INSERT INTO creative_artifact_revisions SELECT ?,id,revision,status,data,updated_at FROM creative_artifacts WHERE id=? AND owner_id=? AND json_extract(data,'$._mutation_id')=?",uid(),a.id,owner,token),sql("UPDATE creative_projects SET revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM creative_artifacts WHERE id=? AND json_extract(data,'$._mutation_id')=?)",t,a.project_id,owner,a.id,token)];
    if(bumpEpoch)statements.push(sql("UPDATE creative_account_state SET revision=revision+1 WHERE owner_id=? AND account_id=? AND EXISTS(SELECT 1 FROM creative_artifacts WHERE id=? AND json_extract(data,'$._mutation_id')=?)",owner,aid,a.id,token));
    statements.push(c.log('creative.'+a.kind+'.'+status,a.id,aid,{revision:expected+1}));
    const result=await env.DB.batch(statements);if(!result[0].meta.changes)throw problem(409,'输入材料已变化，请刷新后重新确认');return artifact(a.id);
  }
  async function applyContent(a,content,newData,expectedArtifact,guards,extraData={}) {
    if(a.revision!==expectedArtifact)throw problem(409,'候选材料已变化');
    const p=await project(a.project_id);if(content.id!==p.content_id)throw problem(400,'稿件不属于此项目');
    const t=now(),token=uid(),data=await c.decorateRecord('content',aid,{...newData,creative_apply_id:a.id,_creative_mutation_id:token},content),g=guardSQL([...guards,{table:'records',id:content.id,revision:content.revision}]);
    const artifactData={...a.data,...extraData,_mutation_id:token,applied_content_revision:content.revision+1},status=extraData.keep_approved?'approved':'applied';
    const statements=[sql(`UPDATE creative_artifacts SET data=?,status=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND account_id=? AND revision=? AND ${g.query}`,JSON.stringify(artifactData),status,t,a.id,owner,aid,a.revision,...g.params),sql("UPDATE records SET data=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND account_id=? AND revision=? AND EXISTS(SELECT 1 FROM creative_artifacts WHERE id=? AND json_extract(data,'$._mutation_id')=?)",JSON.stringify(data),t,content.id,owner,aid,content.revision,a.id,token),sql("INSERT INTO revisions SELECT ?,id,owner_id,revision,data,'creative.applied',updated_at FROM records WHERE id=? AND owner_id=? AND json_extract(data,'$._creative_mutation_id')=?",uid(),content.id,owner,token),sql("INSERT INTO creative_artifact_revisions SELECT ?,id,revision,status,data,updated_at FROM creative_artifacts WHERE id=? AND owner_id=? AND json_extract(data,'$._mutation_id')=?",uid(),a.id,owner,token),sql("UPDATE creative_projects SET revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM records WHERE id=? AND json_extract(data,'$._creative_mutation_id')=?)",t,p.id,owner,content.id,token),c.log('creative.'+a.kind+'.applied',a.id,aid,{content_id:content.id,revision:content.revision+1})];
    const result=await env.DB.batch(statements);if(!result[0].meta.changes||!result[1].meta.changes)throw problem(409,'原稿或输入材料已有变化，未采纳候选');return {content:await c.record(content.id,'content',aid),artifact:await artifact(a.id)};
  }
  return {project,artifact,artifacts,active,activeRules,epoch,guardState,guardSQL,assess,insertArtifact,createArtifact,saveArtifact,applyContent};
}

async function addDependency(deps,type,value,fields={}) {deps.push({type,...fields,hash:await creativeHash(value)});}

async function prepareContext(c,s,p,task,b={}) {
  const {aid}=c,a=await c.account(aid),content=await c.record(p.content_id,'content',aid);
  if(content.deleted||content.data.system_task)throw problem(400,'稿件已删除或不可用于创作项目');
  const dependencies=[],sourceIds=[content.id],imageIds=[],context={account:accountProfile(a),title:content.data.title,platform:content.data.platform,goal:p.data.goal||'',notes:p.data.notes||'',sources:[],cards:{},active_rules:[]};
  const full=['project_draft','project_diagnostic','project_visual','project_prepublish'].includes(task);
  if(task!=='project_review'&&task!=='project_rule'){
    await addDependency(dependencies,'project',p.data,{label:'项目资料与要求'});
    await addDependency(dependencies,'account',accountProfile(a),{label:'账号策略'});
    await addDependency(dependencies,'content',recordContent(content,full),{id:content.id,full,label:full?'稿件内容与排版':'文章标题与目标平台'});
    const refs=[...(p.data.post_ids||[]).map(id=>({id,kind:'post'})),...(p.data.asset_ids||[]).map(id=>({id,kind:'asset'}))];
    if(content.data.topic_id)refs.push({id:content.data.topic_id,kind:'topic'});
    for(const ref of refs){const source=await c.record(ref.id,ref.kind,aid);if(source.deleted)throw problem(409,'选定资料已删除，请重新选择');await addDependency(dependencies,'record',source.data,{id:source.id,kind:source.kind,label:source.data.title||'来源材料'});sourceIds.push(source.id);let data={...source.data};if(source.kind==='post'){const confirmed=await confirmedPostAnalysis(source);if(confirmed&&!confirmed.fresh&&task!=='benchmark_breakdown')throw problem(409,'选定对标文章的原文已变化，请重新拆解并确认：'+source.data.title);const article=postSource(source);if(confirmed?.fresh){context.reference_analyses||=[];context.reference_analyses.push({post_id:source.id,title:article.title,url:article.url,audience:confirmed.report.audience,report:confirmed.report,analysis_run_id:confirmed.run_id});}data={...article,article_body:article.article_body,original_truncated:false,has_confirmed_analysis:!!confirmed?.fresh,analysis_run_id:confirmed?.fresh?confirmed.run_id:null,manual_notes:{summary:source.data.summary||'',hook:source.data.hook||'',analysis:confirmed?'':(source.data.analysis||'')}};}delete data.data_uri;delete data.image_snapshots;delete data.image_snapshot_hashes;let raw=JSON.stringify(data);const truncated=false;context.sources.push({id:source.id,type:source.kind,revision:source.revision,data:truncated?raw:data,truncated});if(source.kind==='asset'&&source.data.asset_type==='image'){imageIds.push(source.id);}}
    if(full){context.content=recordContent(content,true);context.content.body=content.data.body;context.content.truncated=false;}
    if(['project_draft','project_diagnostic','project_visual','project_prepublish'].includes(task))for(const kind of ['audience','brief']){const card=await s.active(p.id,kind);if(!card)throw problem(409,'请先确认本篇的人群卡与写作卡');const fresh=await s.assess(card);if(fresh.stale)throw problem(409,'已确认的'+(kind==='audience'?'人群卡':'写作卡')+'输入已变化，请重新整理并确认');context.cards[kind]={id:card.id,revision:card.revision,...card.data.payload};sourceIds.push(card.id);await addDependency(dependencies,'active_artifact',{id:card.id,payload:card.data.payload},{kind,label:kind==='audience'?'已确认人群卡':'已确认写作卡'});}
    if(task==='project_cards'){const analysis=await s.active(p.id,'analysis');if(analysis){const state=await s.assess(analysis);if(state.stale)throw problem(409,'已确认的对标拆解材料已变化，请先处理');context.analysis={id:analysis.id,...analysis.data.payload};sourceIds.push(analysis.id);}await addDependency(dependencies,'active_artifact',analysis?{id:analysis.id,payload:analysis.data.payload}:null,{kind:'analysis',label:'已确认对标拆解'});}
    const images=unique([...Object.keys(content.data.image_snapshots||{}),...(content.data.card_image_ids||[])]);
    context.images=[];for(const id of images){const asset=await c.record(id,'asset',aid);if(!dependencies.some(d=>d.type==='record'&&d.id===id))await addDependency(dependencies,'record',asset.data,{id,kind:'asset',label:'图片说明与许可'});imageIds.push(id);sourceIds.push(id);context.images.push({id,title:asset.data.title,license:asset.data.license||'',sha256:content.data.image_snapshot_hashes?.[id]||asset.data.sha256,description:cleanString(asset.data.body,3000)});}
    if(task==='benchmark_breakdown'&&!context.sources.some(x=>x.type==='post')&&!p.data.notes?.trim())throw problem(400,'请先选择对标文章，或在项目资料中粘贴有来源说明的材料');
    if(['project_diagnostic','project_visual','project_prepublish'].includes(task)&&!content.data.body.trim())throw problem(400,'请先完成并保存正文');
    if(['project_visual','project_prepublish'].includes(task)){const pref=await c.sql("SELECT data FROM preferences WHERE owner_id=? AND key='platform_rules'",c.owner).first(),saved=pref?JSON.parse(pref.data):null;context.platform_rules=(saved||defaultRules)[content.data.platform];context.platform_rules_note='用户可编辑的工作台参数，并非实时官方限制';await addDependency(dependencies,'preference',saved,{key:'platform_rules',label:'工作台平台校验参数'});context.automatic_counts={title:[...content.data.title].length,body:[...content.data.body.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\s/g,'')].length,cards:content.data.layout_json?.cards?.length||0};}
    if(task==='project_diagnostic'){context.dimensions=Array.isArray(b.dimensions)&&b.dimensions.length?b.dimensions:DIAGNOSTIC_DIMENSIONS;if(context.dimensions.some(x=>!DIAGNOSTIC_DIMENSIONS.includes(x)))throw problem(400,'诊断维度无效');context.paragraphs=paragraphs(content.data.body).filter(x=>x.end<=80000);context.coverage={paragraphs:context.paragraphs.length,total:paragraphs(content.data.body).length};}
  }
  if(task==='project_review') {
    const job=await c.record(b.job_id,'job',aid);if(job.deleted||job.data.status!=='published'||job.data.content_id!==content.id)throw problem(400,'请选择本篇稿件已确认发布的记录');
    const metrics=(await c.list('metric',aid)).filter(m=>m.data.job_id===job.id).sort((x,y)=>Date.parse(y.data.observed_at)-Date.parse(x.data.observed_at)||y.updated_at.localeCompare(x.updated_at));
    const metric=b.metric_id?metrics.find(m=>m.id===b.metric_id):metrics[0];if(!metric)throw problem(400,'请先为该发布记录录入真实指标');if(Date.parse(metric.data.observed_at)<Date.parse(job.data.published_at))throw problem(400,'指标采集时间早于发布时间，请核对后再复盘');
    await addDependency(dependencies,'record',job.data,{id:job.id,kind:'job',label:'发布版本'});await addDependency(dependencies,'record',metric.data,{id:metric.id,kind:'metric',label:'所选指标快照'});
    context.published={id:job.id,revision:job.data.review_revision,url:job.data.url,published_at:job.data.published_at,snapshot:structuredClone(job.data.snapshot||{})};
    if(context.published.snapshot.image_snapshots){context.published.snapshot.image_ids=Object.keys(context.published.snapshot.image_snapshots);delete context.published.snapshot.image_snapshots;}
    if(context.published.snapshot.creative)context.account=context.published.snapshot.creative.account;
    context.title=job.data.snapshot?.title||job.data.title;context.platform=job.data.platform;delete context.goal;delete context.notes;context.metrics={id:metric.id,...metric.data,hours_after_publication:Math.round((Date.parse(metric.data.observed_at)-Date.parse(job.data.published_at))/3600000*100)/100};
    context.context_limitations=job.data.snapshot?.creative?[]:['历史发布未保存人群卡、写作卡等创作上下文，相关判断应保持未知'];context.unavailable_metrics=['exposure','clicks','completion','retention','follows'].filter(k=>metric.data[k]===null||metric.data[k]===undefined);sourceIds.push(job.id,metric.id);
  }
  if(task==='project_rule') {
    const review=await s.artifact(b.review_id);if(review.project_id!==p.id||review.kind!=='review'||review.status!=='approved')throw problem(400,'请先确认本项目的一份复盘，再生成规则草案');const state=await s.assess(review);if(state.stale)throw problem(409,'复盘的发布记录或指标已变化，请重新确认');
    context.review={id:review.id,payload:review.data.payload,input_snapshot:review.data.input_snapshot};sourceIds.push(review.id,...review.data.source_ids);dependencies.push(...review.data.dependencies.filter(d=>d.type==='record'));
    await addDependency(dependencies,'artifact',review.data.payload,{id:review.id,approved:true,label:'已确认复盘'});delete context.notes;delete context.goal;
  }
  const scope=semanticScope(task),rules=await s.activeRules(scope);
  for(const rule of rules){const state=await s.assess(rule);if(state.stale)throw problem(409,'已启用规则的证据已变化，请在规则库停用或重新确认');context.active_rules.push({id:rule.id,title:rule.data.payload.title,instruction:rule.data.payload.instruction,version:rule.data.version});sourceIds.push(rule.id);}
  if(scope)await addDependency(dependencies,'rules',rules.map(r=>({id:r.id,payload:r.data.payload,version:r.data.version})),{scope,label:'当前账号的适用规则'});
  context.allowed_source_ids=unique(sourceIds);
  return {content,context,dependencies,sourceIds:unique(sourceIds),imageIds:unique(imageIds),dimensions:context.dimensions,paragraphs:context.paragraphs||[]};
}

export async function publicationCreativeSnapshot(c,content) {
  const s=service({...c,aid:content.account_id}),p=row(await c.sql('SELECT * FROM creative_projects WHERE owner_id=? AND account_id=? AND content_id=?',c.owner,content.account_id,content.id).first());
  if(!p)return null;
  const cards={};for(const kind of ['audience','brief']){const a=await s.active(p.id,kind);if(a){const fresh=await s.assess(a);cards[kind]={id:a.id,revision:a.revision,payload:a.data.payload,stale:fresh.stale};}}
  const run=content.data.accepted_run_id?row(await c.sql('SELECT * FROM ai_runs WHERE id=? AND owner_id=? AND account_id=? AND content_id=?',content.data.accepted_run_id,c.owner,content.account_id,content.id).first()):null;
  const image_metadata=[];for(const id of Object.keys(content.data.image_snapshots||{})){const asset=await c.record(id,'asset',content.account_id);image_metadata.push({id,title:asset.data.title,license:asset.data.license||'',description:asset.data.body||'',sha256:content.data.image_snapshot_hashes?.[id]||null});}
  return {accepted_draft_context:run?.data.creative_input_snapshot||null,body_changed_since_ai_candidate:run?![run.data.output,run.data.draft].includes(content.data.body):null,image_metadata,project_id:p.id,account:accountProfile(await c.account(content.account_id)),cards,rules:(await s.activeRules('draft')).map(r=>({id:r.id,revision:r.revision,version:r.data.version,payload:r.data.payload})),captured_at:now(),accepted_run_id:content.data.accepted_run_id||null,accepted_artifact_id:content.data.creative_apply_id||null};
}

export async function creativeRoutes(c) {
  const {path,method,aid,owner,sql,all,body,env}=c;
  if(!['creative-projects','creative-artifacts','creative-rules','creative-catalog'].includes(path[0]))return null;
  if(!aid)throw problem(400,'请选择当前账号');const account=await c.account(aid),s=service(c);
  if(path[0]==='creative-catalog'&&method==='GET')return json({tasks:CREATIVE_TASKS,dimensions:DIAGNOSTIC_DIMENSIONS,packs:creativePacks});
  if(path[0]==='creative-rules'&&method==='GET'){const rules=(await all("SELECT * FROM creative_artifacts WHERE owner_id=? AND account_id=? AND kind='rule' ORDER BY updated_at DESC,rowid DESC",owner,aid)).map(row);return json(await Promise.all(rules.map(async a=>({...a,assessment:await s.assess(a)}))));}
  if(path[0]==='creative-projects'&&method==='GET') {
    if(!path[1])return json((await all("SELECT p.*,json_extract(r.data,'$.title') AS title,r.revision AS content_revision FROM creative_projects p JOIN records r ON r.id=p.content_id WHERE p.owner_id=? AND p.account_id=? AND r.deleted=0 ORDER BY p.updated_at DESC,p.rowid DESC",owner,aid)).map(row));
    const p=await s.project(path[1]),content=await c.record(p.content_id,'content',aid),artifacts=await s.artifacts(p.id);if(content.deleted)throw problem(404,'稿件已移入回收站');const jobs=(await c.list('job',aid)).filter(j=>j.data.content_id===content.id);return json({project:p,content,artifacts:await Promise.all(artifacts.map(async a=>({...a,assessment:await s.assess(a)}))),rules:await s.activeRules('draft'),jobs,metrics:(await c.list('metric',aid)).filter(m=>jobs.some(j=>j.id===m.data.job_id))});
  }
  if(account.status!=='active'&&method!=='GET')throw problem(400,'账号已停用，不能创建或修改创作流程');
  const b=['POST','PATCH','PUT','DELETE'].includes(method)?await body():{};
  if(path[0]==='creative-catalog'&&path[2]==='install'&&method==='POST'){const pack=creativePacks.find(p=>p.key===path[1]);if(!pack)throw problem(404,'方法包不存在');const old=(await c.list('skill',aid)).find(s=>s.data.source===pack.source&&s.data.scope_account_id===aid);if(old)return json(old);const data=await c.validate('skill',null,{markdown:pack.markdown,skill_type:pack.skill_type,platform:pack.platform,scope_account_id:aid,source:pack.source,enabled:true});return json(await c.create('skill',null,data,'creative.pack.imported'));}
  if(path[0]==='creative-projects'&&!path[1]&&method==='POST') {
    const content=await c.record(b.content_id,'content',aid);if(content.deleted||content.data.system_task)throw problem(400,'请选择当前账号的有效稿件');const duplicate=row(await sql('SELECT * FROM creative_projects WHERE owner_id=? AND content_id=?',owner,content.id).first());if(duplicate)return json(duplicate);
    const t=now(),id=uid(),data={goal:'',notes:'',post_ids:[],asset_ids:content.data.asset_ids||[]};if(content.data.topic_id){const topic=await c.record(content.data.topic_id,'topic',aid);if(topic.data.post_id)data.post_ids=[topic.data.post_id];}
    await env.DB.batch([sql('INSERT OR IGNORE INTO creative_account_state VALUES (?,?,1)',owner,aid),sql('INSERT INTO creative_projects VALUES (?,?,?,?,?,1,?,?)',id,owner,aid,content.id,JSON.stringify(data),t,t),sql('INSERT INTO creative_project_revisions VALUES (?,?,?,?,?)',uid(),id,1,JSON.stringify(data),t),c.log('creative.project.created',id,aid)]);return json(await s.project(id),201);
  }
  if(path[0]==='creative-projects') {
    const p=await s.project(path[1]);
    if(method==='PATCH'&&!path[2]) {
      if(p.revision!==b.revision)throw problem(409,'项目已有变化，请刷新');const input=b.data;if(!input||typeof input!=='object')throw problem(400,'项目资料格式无效');if(input.post_ids!==undefined&&!Array.isArray(input.post_ids)||input.asset_ids!==undefined&&!Array.isArray(input.asset_ids))throw problem(400,'来源选择应为数组');const data={goal:cleanString(input.goal,4000),notes:cleanString(input.notes,20000),post_ids:unique(input.post_ids||[]),asset_ids:unique(input.asset_ids||[])};
      if(data.post_ids.length>10||data.asset_ids.length>20)throw problem(400,'单项目最多 10 篇对标、20 项素材');for(const [key,kind]of [['post_ids','post'],['asset_ids','asset']])for(const id of data[key]){const ref=await c.record(id,kind,aid);if(ref.deleted)throw problem(400,'不能添加已删除资料');}
      const t=now(),token=uid();data._mutation_id=token;const result=await env.DB.batch([sql('UPDATE creative_projects SET data=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?',JSON.stringify(data),t,p.id,owner,p.revision),sql("INSERT INTO creative_project_revisions SELECT ?,id,revision,data,updated_at FROM creative_projects WHERE id=? AND owner_id=? AND json_extract(data,'$._mutation_id')=?",uid(),p.id,owner,token),c.log('creative.project.updated',p.id,aid)]);if(!result[0].meta.changes)throw problem(409,'保存冲突');return json(await s.project(p.id));
    }
    if(path[2]==='manual-cards'&&method==='POST') {
      if(b.revision!==p.revision)throw problem(409,'项目已有变化，请刷新');const input=await prepareContext(c,s,p,'project_cards'),payload=validateCreativePayload('project_cards',b.data,{sourceIds:input.sourceIds});const t=now(),audienceId=uid(),briefId=uid(),common={dependencies:input.dependencies,input_snapshot:input.context,source_ids:input.sourceIds,manual:true,origin:'manual',source_content_revision:input.content.revision};
      const audience={id:audienceId,project_id:p.id,kind:'audience',status:'draft',data:{...common,payload:payload.audience},created_at:t,updated_at:t},brief={id:briefId,project_id:p.id,kind:'brief',status:'draft',data:{...common,dependencies:[...input.dependencies,{type:'artifact',id:audienceId,approved:true,label:'对应人群卡',hash:await creativeHash(payload.audience)},{type:'active_artifact',kind:'audience',label:'当前已确认人群卡',hash:await creativeHash({id:audienceId,payload:payload.audience})}],payload:payload.brief},created_at:t,updated_at:t};await env.DB.batch([...s.insertArtifact(audience),...s.insertArtifact(brief),c.log('creative.cards.manual',p.id,aid)]);return json({artifacts:[await s.artifact(audienceId),await s.artifact(briefId)]});
    }
    if(path[2]==='run'&&method==='POST') {
      const task=CREATIVE_TASKS[b.task];if(!task)throw problem(400,'创作任务不存在');const input=await prepareContext(c,s,p,b.task,b),t=now();
      let skill=null;const version=b.skill_version_id===''?null:b.skill_version_id||(b.task==='project_draft'?input.content.data.writing_skill_version_id:null);if(version)skill=await c.skillByVersion(version,aid,input.content.data.platform,task.skill_type);
      const instruction=task.instruction+(b.task==='project_draft'?'':'\n只输出符合以下示例字段的 JSON，不输出代码围栏。数组为空就输出 []，不编造来源。\n'+JSON.stringify(schemaExamples[b.task]))+'\n用户补充要求：'+cleanString(b.instruction,10000);
      const creative={project_id:p.id,task:b.task,task_skill:skill?.data||null,source_ids:input.sourceIds,input_snapshot:input.context,dependencies:input.dependencies,instruction,
        async prepareOutput(output,runData,runId,runStatus='succeeded') {
          const parsed=parseCreativeOutput(b.task,output,input),rows=[];if(b.task==='project_review'){const labels={exposure:'曝光',clicks:'点击',completion:'完读',retention:'留存',follows:'关注转化'};parsed.unknowns=unique([...parsed.unknowns,...(input.context.context_limitations||[]),...(input.context.unavailable_metrics?.length?['未采集 '+input.context.unavailable_metrics.map(k=>labels[k]||k).join('、')+'，相关指标及比率保持未知']:[])]);}const common={dependencies:input.dependencies,input_snapshot:input.context,source_ids:input.sourceIds,run_id:runId,source_content_revision:input.content.revision,source_content_snapshot:recordContent(input.content,true),task:b.task,task_skill_snapshot:skill?.data||null,postprocessing_failed:runStatus==='failed'};
          const make=(kind,payload,extras={})=>{const a={id:uid(),project_id:p.id,kind,status:'draft',data:{...common,...extras,payload},created_at:t,updated_at:t};rows.push(a);return a;};
          if(b.task==='project_cards'){const a=make('audience',parsed.audience);make('brief',parsed.brief,{dependencies:[...input.dependencies,{type:'artifact',id:a.id,approved:true,label:'对应人群卡',hash:await creativeHash(parsed.audience)},{type:'active_artifact',kind:'audience',label:'当前已确认人群卡',hash:await creativeHash({id:a.id,payload:parsed.audience})}]});}
          else make(task.kind,parsed,b.task==='project_rule'?{family_id:uid(),version:'1.0.0'}:b.task==='project_draft'?{before_humanize_body:runData.draft}:{});
          return {structured:parsed,artifact_ids:rows.map(a=>a.id),statements:rows.flatMap(a=>s.insertArtifact(a,runId,runStatus))};
        }
      };
      return c.handleRuns({...c,path:['runs'],method:'POST',creative,body:async()=>({content_id:input.content.id,source_revision:input.content.revision,action:b.task,provider_id:b.provider_id||null,max_tokens:b.max_tokens,parameters:b.parameters||{},allow_fallback:!!b.allow_fallback,instruction:cleanString(b.instruction,10000)})});
    }
  }
  if(path[0]==='creative-artifacts') {
    const a=await s.artifact(path[1]),p=await s.project(a.project_id),content=await c.record(p.content_id,'content',aid);if(content.deleted)throw problem(400,'稿件已删除，请先恢复');
    if(!path[2]&&method==='GET')return json({...a,assessment:await s.assess(a)});
    if(path[2]==='revisions'&&method==='GET')return json((await all('SELECT * FROM creative_artifact_revisions WHERE artifact_id=? ORDER BY revision DESC',a.id)).map(row));
    if(path[2]==='edit'&&method==='POST') {
      if(a.status==='applied')throw problem(409,'已应用材料请创建新版本，或先停用规则');if(a.kind==='diagnostic'&&a.data.applied_issue_ids?.length&&!b.rebase)throw problem(409,'已经采纳过部分段落，请核对并按最新正文重新保存');const context=a.data.input_snapshot||{},input=await prepareContext(c,s,p,KIND_TASK[a.kind],a.kind==='review'?{job_id:context.published?.id,metric_id:context.metrics?.id}:a.kind==='rule'?{review_id:context.review?.id}:{});
      const payload=validateCreativePayload(a.kind==='audience'?'audience':a.kind==='brief'?'brief':KIND_TASK[a.kind],b.payload,{sourceIds:input.sourceIds,paragraphs:input.paragraphs,imageIds:input.imageIds});const fresh=await s.assess(a);if(fresh.stale&&!b.rebase)throw problem(409,'输入材料已变化，请先核对，再明确按最新输入保存');
      const dependencies=b.rebase?[...input.dependencies]:a.data.dependencies;if(b.rebase&&a.kind==='brief'){const audience=await s.active(p.id,'audience');if(!audience)throw problem(409,'请先确认当前人群卡');await addDependency(dependencies,'active_artifact',{id:audience.id,payload:audience.data.payload},{kind:'audience',label:'当前已确认人群卡'});}
      return json(await s.saveArtifact(a,payload,'draft',b.revision,{guards:await s.guardState(p),extraData:{dependencies,input_snapshot:b.rebase?input.context:a.data.input_snapshot,source_ids:b.rebase?input.sourceIds:a.data.source_ids,manual:true,...(b.rebase?{source_content_revision:input.content.revision,source_content_snapshot:recordContent(input.content,true),applied_issue_ids:[],applied_content_revision:null,before_humanize_body:null}:{}),rebased_from:b.rebase?{id:a.id,revision:a.revision}:a.data.rebased_from}}));
    }
    if(path[2]==='approve'&&method==='POST') {
      if(a.status==='applied')throw problem(409,'该材料已经应用');const fresh=await s.assess(a);if(fresh.stale)throw problem(409,'输入材料已变化，请先修订材料或重新生成');if((a.data.payload.unknowns||[]).length&&!b.confirm_unknowns)throw problem(400,'请确认已检查待核实项，未知信息仍会保留');
      return json(await s.saveArtifact(a,a.data.payload,'approved',b.revision,{guards:fresh.guards,extraData:{approved_at:now(),approved_by:owner,review_notes:cleanString(b.notes,6000)}}));
    }
    if(path[2]==='reject'&&method==='POST'){if(a.status==='applied')throw problem(409,'请先停用已启用规则');return json(await s.saveArtifact(a,a.data.payload,'rejected',b.revision,{guards:await s.guardState(p)}));}
    if(path[2]==='apply'&&method==='POST') {
      if(a.status==='applied')return json({already_applied:true,content,artifact:a});if(a.status!=='approved')throw problem(409,'请先确认候选材料');if(b.content_revision!==content.revision)throw problem(409,'原稿已有变化，请刷新后比较');
      if(a.kind==='diagnostic') {
        const issue=a.data.payload.issues.find(x=>x.id===b.issue_id);if(!issue)throw problem(404,'修稿建议不存在');const done=a.data.applied_issue_ids||[];if(done.includes(issue.id))return json({already_applied:true,content,artifact:a});if((a.data.applied_content_revision??a.data.source_content_revision)!==content.revision)throw problem(409,'诊断后的原稿已有其他修改，请重新诊断');
        const source=a.data.source_content_snapshot.body,compose=ids=>{let result=source;for(const item of a.data.payload.issues.filter(x=>ids.includes(x.id)).sort((x,y)=>y.start-x.start))result=result.slice(0,item.start)+item.replacement+result.slice(item.end);return result;};
        if(content.data.body!==compose(done))throw problem(409,'原文已变化，请重新诊断');const fresh=await s.assess(a,{skipContent:true});if(fresh.stale)throw problem(409,'诊断所用材料已变化');const next=[...done,issue.id];return json(await s.applyContent(a,content,{...content.data,body:compose(next)},b.revision,fresh.guards,{applied_issue_ids:next,keep_approved:next.length<a.data.payload.issues.length}));
      }
      const fresh=await s.assess(a);if(fresh.stale)throw problem(409,'候选基于旧输入，不能直接覆盖当前内容');
      if(a.kind==='draft'){const body=b.candidate==='before_humanize'?a.data.before_humanize_body:a.data.payload.body;if(!body)throw problem(400,'所选候选为空');return json(await s.applyContent(a,content,{...content.data,body,accepted_run_id:a.data.run_id||null},b.revision,fresh.guards));}
      if(a.kind==='visual'){const cards=[{id:uid(),type:'cover',...a.data.payload.cover},...a.data.payload.pages.map(x=>({id:uid(),type:x.image_id?'image':'text',...x}))];return json(await s.applyContent(a,content,{...content.data,layout_json:{theme:'lavender',font_size:32,ratio:'3:4',...content.data.layout_json,cards},card_image_ids:unique(cards.map(x=>x.image_id).filter(Boolean))},b.revision,fresh.guards));}
      throw problem(400,'此材料是分析或建议，不能替换稿件');
    }
    if(a.kind==='rule'&&path[2]==='activate'&&method==='POST') {
      if(a.status!=='approved')throw problem(409,'请先确认规则草案');if(!a.data.payload.scope_actions.length)throw problem(400,'规则至少选择一个适用任务');const old=await sql("SELECT id FROM creative_artifacts WHERE owner_id=? AND account_id=? AND kind='rule' AND status='applied' AND json_extract(data,'$.family_id')=?",owner,aid,a.data.family_id).first();if(old)throw problem(409,'此规则已有启用版本，请先停用旧版本');const fresh=await s.assess(a);if(fresh.stale)throw problem(409,'规则依据已变化，请重新确认');return json(await s.saveArtifact(a,a.data.payload,'applied',b.revision,{guards:fresh.guards,bumpEpoch:true,extraData:{activated_at:now()}}));
    }
    if(a.kind==='rule'&&path[2]==='deactivate'&&method==='POST'){if(a.status!=='applied')throw problem(409,'规则未启用');return json(await s.saveArtifact(a,a.data.payload,'approved',b.revision,{guards:await s.guardState(p),bumpEpoch:true}));}
    if(a.kind==='rule'&&path[2]==='fork'&&method==='POST') {
      if(a.revision!==b.revision)throw problem(409,'材料已变化');const version=cleanString(b.version,60);if(!/^[\w.-]+$/.test(version)||await sql("SELECT id FROM creative_artifacts WHERE owner_id=? AND account_id=? AND kind='rule' AND json_extract(data,'$.family_id')=? AND json_extract(data,'$.version')=?",owner,aid,a.data.family_id,version).first())throw problem(400,'请输入此规则未使用过的新版本号');
      const payload=validateCreativePayload('project_rule',b.payload||a.data.payload,{sourceIds:a.data.source_ids});try{return json(await s.createArtifact(p,'rule',payload,{...a.data,payload,version,manual:true,forked_from:{id:a.id,revision:a.revision},approved_at:null,approved_by:null,activated_at:null,_mutation_id:undefined}));}catch(e){if(String(e.message).includes('UNIQUE constraint failed'))throw problem(409,'此规则版本号已被使用，请换一个版本号');throw e;}
    }
    if(path[2]==='to-topic'&&method==='POST') {
      if(a.kind!=='review'||a.status!=='approved')throw problem(409,'请先确认复盘');if(a.revision!==b.revision)throw problem(409,'复盘已有变化');const experiment=a.data.payload.next_experiments[Number(b.index)];if(!experiment)throw problem(400,'实验不存在');const existing=(await c.list('topic',aid)).find(t=>t.data.creative_review_id===a.id&&t.data.creative_experiment_index===Number(b.index));if(existing)return json(existing);
      const fresh=await s.assess(a);if(fresh.stale)throw problem(409,'复盘依据已变化，请先重新确认');try{return json(await c.create('topic',aid,{title:experiment.title,description:experiment.change,angle:experiment.measure+'\n可比条件：'+experiment.caveat,status:'idea',priority:'normal',creative_review_id:a.id,creative_experiment_index:Number(b.index)},'creative.review_topic'));}catch(e){if(String(e.message).includes('UNIQUE constraint failed')){const existing=(await c.list('topic',aid)).find(t=>t.data.creative_review_id===a.id&&t.data.creative_experiment_index===Number(b.index));if(existing)return json(existing);}throw e;}
    }
  }
  throw problem(404,'创作项目操作不存在');
}
