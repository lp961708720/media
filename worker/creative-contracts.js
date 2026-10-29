import {problem} from './gateway.js';

export const CREATIVE_TASKS = {
  benchmark_breakdown: {label:'结构化对标拆解', kind:'analysis', skill_type:'research', instruction:'只分析提供的对标与来源材料。按目标读者、解决的问题、角度、标题承诺、开头钩子、论证结构、案例、可学习之处、不可直接移植的经历/资源及未知项拆解。不要把相关性说成爆款原因。'},
  project_cards: {label:'人群卡与写作卡', kind:'cards', skill_type:'planning', instruction:'为本篇内容生成人群卡与写作卡。账号长期策略是背景，本次读者和场景要具体；资料不足时列出待确认项。不得虚构亲历、案例或数据。'},
  project_draft: {label:'按已确认卡片写初稿', kind:'draft', skill_type:'writing', instruction:'只根据已确认的人群卡、写作卡和资料创作完整 Markdown 初稿。保留来源 ID，未知事实标注待核实。不要把参考作者的经历写成用户亲历。直接返回正文，不输出 JSON。'},
  project_diagnostic: {label:'分项诊断与修稿建议', kind:'diagnostic', skill_type:'review', instruction:'按指定维度逐项诊断正文。每条问题必须关联提供的段落 ID，并原样引用完整段落 quote。replacement 是该完整段落的替换候选，保留图片标记，不改动其他段落。不要制造并不存在的问题，不作检测率或流量承诺。'},
  project_visual: {label:'视觉分镜规划', kind:'visual', skill_type:'planning', instruction:'为现有正文规划封面和每张图文卡片的任务、唯一重点、可编辑文字及素材引用。只使用提供的图片 ID；没有图片时使用 null。你只能读取图片说明和元数据，没有看到图片像素，不声称已经检查图片。正文与封面承诺应一致。'},
  project_prepublish: {label:'发布前一致性检查', kind:'prepublish', skill_type:'review', instruction:'结合已确认卡片、标题、开头、正文、卡片文字与素材许可记录检查承诺一致性、具体程度、读者匹配和待核实点。不能声称已经实际观察图片内容、核验外部事实、获得平台授权或保证发布效果。只给主观编辑意见。'},
  project_review: {label:'发布版本与真实数据复盘', kind:'review', skill_type:'post_review', instruction:'只针对给定的发布快照及真实采集记录复盘，按事实观察→可能解释→证据→未知项→下一次实验组织。数据中的 null 是未知，不是 0。没有曝光、点击或完读等分母时，不能诊断对应比率或漏斗。不要把时间不同的累计快照当作同窗口实验，不把相关性当因果。'},
  project_rule: {label:'从复盘提出规则草案', kind:'rule', skill_type:'planning', instruction:'基于选定的人工确认复盘，提出一条可复用的编辑规则草案。写明理由、来源证据、适用任务及未知项。规则只影响确认后的未来任务，不篡改历史，不包含脚本、接口密钥或自动发布命令。'}
};
export const CREATIVE_ACTIONS = Object.fromEntries(Object.entries(CREATIVE_TASKS).map(([key,v])=>[key,v.instruction]));
export const DIAGNOSTIC_DIMENSIONS = ['reader','focus','evidence','fact','steps','redundancy'];
export const RULE_SCOPES = ['draft','diagnostic','visual','prepublish','review'];
export const KIND_TASK = {analysis:'benchmark_breakdown',audience:'project_cards',brief:'project_cards',draft:'project_draft',diagnostic:'project_diagnostic',visual:'project_visual',prepublish:'project_prepublish',review:'project_review',rule:'project_rule'};
export const semanticScope = task => ({project_draft:'draft',project_diagnostic:'diagnostic',project_visual:'visual',project_prepublish:'prepublish',project_review:'review'})[task] || null;
export const schemaExamples = {
  benchmark_breakdown:{reader:'目标读者',problem:'问题',angle:'角度',title_promise:'标题承诺',hook:'开头方法',structure:[{heading:'阶段',purpose:'作用',source_ids:[]}],examples:[{description:'案例说明',source_ids:[],transferable:false}],learnable:['可借鉴的方法'],nontransferable:['不可移植的经历或资源'],source_ids:[],unknowns:[]},
  project_cards:{audience:{reader:'本次读者',knowledge_level:'已有知识',scenario:'具体场景',pain:'当前困惑',desired_result:'希望得到的结果',tone:'语气',non_audience:'不覆盖的需求',unknowns:[]},brief:{goal:'内容目标',main_point:'核心观点',title_promise:'标题承诺',opening_task:'开头任务',outline:[{heading:'标题',purpose:'段落任务',evidence_ids:[]}],case_requirements:'所需案例',visual_requirements:'视觉任务',expression_limits:'表达限制',unknowns:[]}},
  project_diagnostic:{summary:'概述',coverage:'本次覆盖范围',issues:[{paragraph_id:'p0001',dimension:'focus',quote:'原样完整段落',reason:'具体问题',replacement:'完整替换段落',priority:'medium',source_ids:[]}],unknowns:[]},
  project_visual:{cover:{title:'封面主标题',text:'副标题或说明',purpose:'封面任务',image_id:null},pages:[{title:'本页标题',text:'本页可编辑正文',purpose:'本页任务',key_point:'唯一重点',image_id:null}],source_ids:[],unknowns:[]},
  project_prepublish:{summary:'总体意见',checks:[{dimension:'承诺一致性',status:'pass',detail:'依据或问题',suggestion:'具体修改',source_ids:[]}],unknowns:[]},
  project_review:{observations:[{text:'事实观察',source_ids:[]}],hypotheses:[{text:'可能解释',source_ids:[],uncertainty:'不确定性'}],unknowns:[],next_experiments:[{title:'实验',change:'下一次只改什么',measure:'观察哪个已有指标',caveat:'可比条件或缺失数据'}]},
  project_rule:{title:'规则名称',instruction:'明确可复用的编辑要求',rationale:'依据与适用边界',scope_actions:['draft'],source_ids:[],unknowns:[]}
};

const isObject=v=>v&&typeof v==='object'&&!Array.isArray(v);
function text(v,name,{optional=false,max=6000}={}) {
  if(typeof v!=='string'||v.length>max||(!optional&&!v.trim()))throw problem(422,name+'应为'+(optional?'':'非空')+'文本，且不超过 '+max+' 字');
  return v.trim();
}
function array(v,name,max=40){if(!Array.isArray(v)||v.length>max)throw problem(422,name+'应为不超过 '+max+' 项的数组');return v;}
function strings(v,name,max=30){return array(v,name,max).map(x=>text(x,name,{max:2000}));}
function ids(v,allowed,name='source_ids'){return array(v,name,50).map(x=>{if(typeof x!=='string'||!allowed.has(x))throw problem(422,'引用了未提供的来源：'+String(x));return x;});}
function object(v,name){if(!isObject(v))throw problem(422,name+'格式应为对象');return v;}
function unknowns(v){return strings(v??[],'待确认项');}
function audience(v){object(v,'人群卡');const out={};for(const key of ['reader','knowledge_level','scenario','pain','desired_result','tone','non_audience'])out[key]=text(v[key]??'',key,{optional:['knowledge_level','non_audience'].includes(key),max:3000});out.unknowns=unknowns(v.unknowns);return out;}
function brief(v,allowed){object(v,'写作卡');const out={};for(const key of ['goal','main_point','title_promise','opening_task','case_requirements','visual_requirements','expression_limits'])out[key]=text(v[key]??'',key,{optional:['case_requirements','visual_requirements','expression_limits'].includes(key),max:5000});out.outline=array(v.outline,'正文结构',30).map(x=>({heading:text(x.heading,'结构标题',{max:300}),purpose:text(x.purpose,'结构任务'),evidence_ids:ids(x.evidence_ids??[],allowed,'evidence_ids')}));if(!out.outline.length)throw problem(422,'写作卡至少包含一个正文结构');out.unknowns=unknowns(v.unknowns);return out;}
export function paragraphs(body){
  const result=[];for(const m of String(body).matchAll(/[^\r\n]+(?:\r?\n(?![ \t]*\r?\n)[^\r\n]+)*/g)){if(!m[0].trim())continue;result.push({id:'p'+String(result.length+1).padStart(4,'0'),start:m.index,end:m.index+m[0].length,text:m[0]});}return result;
}
export function parseCreativeOutput(task,output,context={}) {
  if(task==='project_draft'){if(typeof output!=='string'||!output.trim()||output.length>200000)throw problem(422,'初稿为空或过大');return {body:output};}
  let v;try{const raw=String(output).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');v=JSON.parse(raw);}catch{throw problem(422,'模型未返回有效 JSON，原始结果已保留，请重试或手工整理');}
  return validateCreativePayload(task,v,context);
}
export function validateCreativePayload(task,input,{sourceIds=[],paragraphs:parts=[],imageIds=[],dimensions=DIAGNOSTIC_DIMENSIONS}={}) {
  const v=object(input,'任务输出'),allowed=new Set(sourceIds),images=new Set(imageIds);
  if(task==='project_cards')return {audience:audience(v.audience),brief:brief(v.brief,allowed)};
  if(task==='audience')return audience(v);
  if(task==='brief')return brief(v,allowed);
  if(task==='benchmark_breakdown') {
    const out={};for(const key of ['reader','problem','angle','title_promise','hook'])out[key]=text(v[key],key);
    out.structure=array(v.structure,'论证结构',30).map(x=>({heading:text(x.heading,'阶段标题',{max:300}),purpose:text(x.purpose,'阶段作用'),source_ids:ids(x.source_ids??[],allowed)}));
    out.examples=array(v.examples??[],'案例',30).map(x=>({description:text(x.description,'案例说明'),source_ids:ids(x.source_ids??[],allowed),transferable:x.transferable===true}));
    out.learnable=strings(v.learnable??[],'可借鉴项');out.nontransferable=strings(v.nontransferable??[],'不可迁移项');out.source_ids=ids(v.source_ids??[],allowed);out.unknowns=unknowns(v.unknowns);return out;
  }
  if(task==='project_diagnostic') {
    const seen=new Set();const issues=array(v.issues,'诊断问题',40).map((x,index)=>{const p=parts.find(p=>p.id===x.paragraph_id);if(!p||x.quote!==p.text)throw problem(422,'诊断引用的段落不存在或与原文不一致');if(!DIAGNOSTIC_DIMENSIONS.includes(x.dimension)||!dimensions.includes(x.dimension))throw problem(422,'诊断维度无效');if(seen.has(p.id))throw problem(422,'同一段落请合并为一个替换候选');seen.add(p.id);const replacement=text(x.replacement,'替换段落',{max:12000});const markers=s=>[...s.matchAll(/!\[[^\]]*\]\(media:[^)]+\)/g)].map(m=>m[0]).sort().join('\n');if(markers(replacement)!==markers(p.text))throw problem(422,'局部修稿不得删改图片引用');return {id:'issue-'+(index+1),paragraph_id:p.id,start:p.start,end:p.end,dimension:x.dimension,quote:p.text,reason:text(x.reason,'问题原因'),replacement,priority:['low','medium','high'].includes(x.priority)?x.priority:'medium',source_ids:ids(x.source_ids??[],allowed)};});
    return {summary:text(v.summary,'诊断概述'),coverage:text(v.coverage??'提供的段落','覆盖范围'),issues,unknowns:unknowns(v.unknowns)};
  }
  if(task==='project_visual') {
    const image=id=>{if(id===null||id===''||id===undefined)return null;if(!images.has(id))throw problem(422,'使用了未提供的当前账号图片');return id;};
    const cover=object(v.cover,'封面');return {cover:{title:text(cover.title,'封面标题',{max:300}),text:text(cover.text??'','封面说明',{optional:true,max:5000}),purpose:text(cover.purpose,'封面任务'),image_id:image(cover.image_id)},pages:array(v.pages,'卡片',30).map(x=>({title:text(x.title??'','卡片标题',{optional:true,max:300}),text:text(x.text,'卡片正文',{max:10000}),purpose:text(x.purpose,'本页任务'),key_point:text(x.key_point,'本页重点'),image_id:image(x.image_id)})),source_ids:ids(v.source_ids??[],allowed),unknowns:unknowns(v.unknowns),image_inspection:'not_performed'};
  }
  if(task==='project_prepublish')return {summary:text(v.summary,'检查概述'),checks:array(v.checks,'检查项',30).map(x=>({dimension:text(x.dimension,'检查维度',{max:300}),status:['pass','revise','unknown'].includes(x.status)?x.status:'unknown',detail:text(x.detail,'检查依据'),suggestion:text(x.suggestion??'','修改建议',{optional:true}),source_ids:ids(x.source_ids??[],allowed)})),unknowns:unknowns(v.unknowns),image_inspection:'not_performed'};
  if(task==='project_review')return {observations:array(v.observations,'事实观察',30).map(x=>({text:text(x.text,'观察'),source_ids:ids(x.source_ids??[],allowed)})),hypotheses:array(v.hypotheses,'可能解释',30).map(x=>({text:text(x.text,'可能解释'),source_ids:ids(x.source_ids??[],allowed),uncertainty:text(x.uncertainty,'不确定性')})),unknowns:unknowns(v.unknowns),next_experiments:array(v.next_experiments,'下一步实验',20).map(x=>({title:text(x.title,'实验标题',{max:300}),change:text(x.change,'改动'),measure:text(x.measure,'观察指标'),caveat:text(x.caveat,'可比条件')}))};
  if(task==='project_rule')return {title:text(v.title,'规则名称',{max:200}),instruction:text(v.instruction,'规则内容',{max:10000}),rationale:text(v.rationale,'规则依据'),scope_actions:array(v.scope_actions,'适用任务',RULE_SCOPES.length).map(x=>{if(!RULE_SCOPES.includes(x))throw problem(422,'规则适用任务无效');return x;}),source_ids:ids(v.source_ids??[],allowed),unknowns:unknowns(v.unknowns)};
  if(task==='project_draft')return {body:text(v.body,'初稿',{max:200000})};
  throw problem(400,'任务类型不存在');
}
