async function studioRuns(c=state.studio){return c?(await api('runs?accountId='+encodeURIComponent(c.account_id)+'&contentId='+encodeURIComponent(c.id))).filter(r=>!r.data.project_id&&!r.data.post_id&&!['chat','review'].includes(r.data.action)):[];}
const articleActions=new Set(['draft','rewrite','adapt','humanize','postprocess','resume']);
function completeArticle(r){return r?.status==='succeeded'&&!r.data.partial&&!r.data.selection&&!r.data.project_id&&!r.data.post_id&&articleActions.has(r.data.action)&&!!r.data.output?.trim();}
async function loadInitialArticle(c,runs){
 if(c.data.body?.trim())return null;
 const r=runs.find(r=>completeArticle(r)&&r.data.action==='draft'&&r.source_revision===c.revision&&!r.data.source_snapshot?.body?.trim());
 if(!r)return null;
 try{return await api('runs/'+r.id+'/accept?accountId='+encodeURIComponent(c.account_id),{method:'POST',body:{expected_revision:c.revision,candidate:'output'}});}catch(e){if(!/变化|新版本|冲突/.test(e.message))toast('生成结果已保留，载入正文失败：'+e.message);return null;}
}
const manuscriptStudioPage=pages.studio;
pages.studio=async()=>{
 let html=await manuscriptStudioPage();if(!state.studio)return html;
 const saved=await loadInitialArticle(state.studio,state.runs);
 if(saved){state.studio=saved;state.openId=saved.id;html=await manuscriptStudioPage();}
 const runs=state.runs.filter(r=>!r.data.project_id&&!r.data.post_id&&!['chat','review'].includes(r.data.action)),latest=runs.find(r=>completeArticle(r)||partialArticle(r));
 return html.replace(btn('版本历史','history-current','','ghost small'),btn('修改对比','manuscript-diff','','ghost small')+btn('生成记录（'+runs.length+'）','manuscript-runs','','ghost small')+btn('版本历史','history-current','','ghost small'))
  .replace('<input class="editor-title"',`<div class="studio-result-status"><span>正文自动保存 · v${state.studio.revision}；生成记录单独保留。</span>${latest?btn(partialArticle(latest)?'查看已返回文本':'查看最近生成文章',partialArticle(latest)?'view-partial-run':'compare-run',`data-id="${latest.id}"`,'small'):''}</div><input class="editor-title"`)
  .replace(btn('后处理正文','ai-humanize'),btn('后续 Skill 处理正文','postprocess-current'));
};
const manuscriptRunCard=runCard;
runCard=function(r){const d=r.data,displayRun=d.model_diagnostics?.code==='output_limit'&&!d.project_id&&!d.post_id&&d.error?.includes('重新拆解')?{...r,data:{...d,error:'历史写作请求在 '+(d.effective_max_tokens||'原配置')+' Token 额度处未完成；已返回文本仍保留。可按自动额度接续，或免费另存为未完成草稿。'}}:r;let html=manuscriptRunCard(displayRun);if(partialArticle(r)){if(d.model_diagnostics?.code==='output_limit')html=html.replace('运行失败','输出未完成 · 可接续').replace('接续这次生成','按自动额度接续');html+='<div class="inline manuscript-result-actions">'+btn('查看已返回文本','view-partial-run',`data-id="${r.id}"`,'small')+btn('另存为未完成草稿','save-partial-run',`data-id="${r.id}"`,'small')+'</div>';}if(d.effective_max_tokens)html+='<p class="field-hint">请求输出额度：'+Number(d.effective_max_tokens)+' Token · '+(d.output_quota_mode==='auto'?'按预算与模型能力自动分配':d.output_quota_mode==='task'?'本次手动指定':'模型手动配置 / 历史记录')+'</p>';if(d.postprocess_skill_version_id)html=html.replace(' · 直接写作',' · 后续 Skill 处理');if(!completeArticle(r))return html;return html+`<div class="inline manuscript-result-actions">${d.postprocess_skill_snapshot?tag('后续处理：'+d.postprocess_skill_snapshot.title):''}${state.studio?.data.accepted_run_id===r.id?tag('已载入正文','green'):''}${btn('后续 Skill 处理','postprocess-run',`data-id="${r.id}"`,'small')}${btn('另存为新稿件','save-run-copy',`data-id="${r.id}"`,'small')}</div>`;};
const manuscriptExecute=executeAI;
executeAI=async function(action,extra={}){
 const c=state.studio,result=await manuscriptExecute(action,extra);refreshManuscriptSummary();
 if(!c||!result||!currentStudio(c)||state.dirty||state.saving)return result;
 const saved=await loadInitialArticle(c,await studioRuns(c));
 if(saved){
  if(state.saving)try{await state.saving}catch{}
  if(currentStudio(c)){
   if(state.dirty){state.studio.revision=saved.revision;markDirty();await flush();}
   else state.studio=saved;
   await reloadStudioKeepingAssistant(state.studio);toast('初稿已保存并载入正文，可继续编辑或交给后续 Skill 处理');
  }
 }
 return result;
};
runAI=executeAI;
act['ai-humanize']=()=>openPostprocess();
act['postprocess-current']=()=>openPostprocess();
act['humanize-current']=()=>openPostprocess(undefined,{humanizeOnly:true});
act['postprocess-run']=e=>openPostprocess(dataId(e));
async function openPostprocess(runId,{humanizeOnly=false}={}){
 await flush();const c=state.studio;if(!c)throw Error('请先打开稿件');
 const source=runId?state.runs.find(r=>r.id===runId):null;
 if(runId&&!completeArticle(source))throw Error('请选择已完整生成的文章');
 if(!runId&&!c.data.body?.trim())throw Error('正文为空，请先载入生成文章，或从生成记录选择后续处理');
 const skills=(await records('skill')).filter(s=>s.data.enabled&&(humanizeOnly?s.data.skill_type==='humanize':['humanize','editing','writing'].includes(s.data.skill_type))&&(s.data.platform==='all'||s.data.platform===c.data.platform));
 const providers=(await records('provider')).filter(p=>p.data.enabled&&p.data.protocol!=='image');
 if(!skills.length){modal('后续 Skill 处理',`<div class="notice">还没有适用于${esc(platform(c.data.platform))}的写作、编辑或去 AI 味 Skill。请在 Skill 中心导入或启用规则，并检查适用平台。</div>`,null);return;}
 const selected=skills.find(s=>s.data.version_id===c.data.humanize_skill_version_id);if(humanizeOnly&&!selected)throw Error('请先从下拉框选择去 AI 味 Skill');
 const sourceBody=source?source.data.output:c.data.body;
 modal(humanizeOnly?'检查后的文章 · 去 AI 味处理':'后续 Skill 处理',`<div class="notice">处理来源：${source?'已保存的生成文章 · '+esc(fmt(source.created_at)):'当前已保存正文 · v'+c.revision}。结果保存为独立候选，比较并采纳后才替换正文。</div><details><summary>核对本次处理全文（${sourceBody.replace(/\s/g,'').length} 字）</summary><div class="candidate">${esc(sourceBody)}</div></details>${select('skill_version',humanizeOnly?'去 AI 味 Skill':'后续 Skill',selected?.data.version_id||skills[0].data.version_id,skills.map(s=>[s.data.version_id,s.data.title+' · v'+s.data.version]))}${select('provider_id','处理模型',source?.data.provider_id||c.data.provider_id||'',[['','沿用当前稿件 / 账号模型路由'],...providers.map(p=>[p.id,p.data.title])])}${field('instruction',humanizeOnly?'本次去 AI 味补充要求（可不填）':'本次处理要求',humanizeOnly?'':$('#ai-instruction')?.value||'','textarea')}<p class="field-hint">本次只执行所选规则，不会重复运行写作和自动后处理链。费用仍按模型与预算设置检查。</p>`,async f=>{
  if(!currentStudio(c))throw Error('当前稿件已切换，请重新选择');
  const skill=skills.find(s=>s.data.version_id===f.skill_version);if(!skill)throw Error('请选择有效 Skill');
  if(humanizeOnly&&c.data.humanize_skill_version_id!==skill.data.version_id){c.data.humanize_skill_version_id=skill.data.version_id;c.data.humanize_enabled=false;markDirty();await flush();}
  $('#modal').close();const result=await executeAI('postprocess',{source_run_id:runId||undefined,postprocess_skill_version_id:skill.data.version_id,postprocess_skill_type:skill.data.skill_type,provider_id:f.provider_id||undefined,instruction:f.instruction});
  if(result?.status==='succeeded'&&currentStudio(c))await act['compare-run']({dataset:{id:result.id}});
 },true);$('#modal-form [type=submit]').textContent=humanizeOnly?'执行去 AI 味并保存候选':'运行 Skill 并保存候选';
}
act['manuscript-runs']=async()=>{
 await flush();state.runs=await studioRuns();const runs=state.runs.filter(r=>!r.data.project_id&&!r.data.post_id&&!['chat','review'].includes(r.data.action));
 modal('当前稿件的生成记录',`<div class="notice">共 ${runs.length} 次运行。完整结果、失败时的部分输出与历史来源均保留；只列出当前稿件。</div>${runs.length?runs.map(runCard).join(''):empty('还没有生成记录','生成完成后会自动保存在这里。')}`,null,true);
};
act['save-run-copy']=async e=>{
 await flush();const r=state.runs.find(r=>r.id===dataId(e));if(!completeArticle(r))throw Error('此结果不是完整文章');
 const c=state.studio,saved=await api('records/content'+scope(),{method:'POST',body:{data:{title:c.data.title+' · 生成稿',body:r.data.output,summary:c.data.summary||'',platform:c.data.platform,source_content_id:c.id,source_run_id:r.id,provider_id:r.data.provider_id,writing_skill_version_id:null,humanize_enabled:false}}});
 $('#modal').close();await go('studio',saved.id);toast('已另存为独立稿件，可继续修改');
};
act['compare-run']=async e=>{
 await flush();const r=state.runs.find(r=>r.id===dataId(e));if(!r)throw Error('记录已变化，请重新打开生成记录');
 if(['titles','outline','review','report','research','comment_reply'].includes(r.data.action)){modal('独立建议 · 不替换正文','<div class="report-markdown">'+renderMarkdown(r.data.output||'')+'</div>',null,true);return;}
 state.compareRun=r;const c=state.studio;state.comparedRevision=c.revision;const sourceDiff=r.data.action==='postprocess'&&r.source_revision===c.revision,original=r.data.selection?.text||(sourceDiff?r.data.source_snapshot?.body:c.data.body)||'';
 modal('文章修改对比与采纳',`<div class="notice">${sourceDiff?'默认展示所选文章在本次 Skill 处理前后的差异。':'展示当前正文与生成文章的差异。'} 候选基于 v${r.source_revision}，当前正文 v${c.revision}。采纳会创建新版本。</div><div class="inline">${btn('与当前正文对比','compare-current-body','type="button"','small')}${completeArticle(r)?btn('继续用 Skill 处理','postprocess-run',`type="button" data-id="${r.id}"`,'small'):''}</div><div id="article-comparison" class="diff-view">${diffLines(original,r.data.output||'')}</div><details><summary>完整生成文章</summary><div class="candidate">${esc(r.data.output||'')}</div></details>${r.data.humanize_skill_version_id?`<details><summary>自动后处理之前的初稿</summary><div class="candidate">${esc(r.data.draft||'')}</div>${btn('仅采纳初稿','accept-draft','type="button"','small')}</details>`:''}`,async()=>acceptRun('output'),true);
 const submit=$('#modal-form [type=submit]');submit.textContent='采纳到正文并保存新版本';if(c.data.body===r.data.output){submit.textContent='当前正文已是此结果';submit.disabled=true;}else if(sourceDiff&&original!==c.data.body){state.comparedRevision=null;submit.textContent='先与当前正文对比，再决定采纳';submit.disabled=true;}
};
act['compare-current-body']=async()=>{await flush();const r=state.compareRun;state.comparedRevision=state.studio.revision;$('#article-comparison').innerHTML=diffLines(r.data.selection?.text||state.studio.data.body||'',r.data.output||'');const submit=$('#modal-form [type=submit]');submit.disabled=state.studio.data.body===r.data.output;submit.textContent=submit.disabled?'当前正文已是此结果':'采纳到正文并保存新版本';};
act['manuscript-diff']=async()=>{await flush();await showContentHistory(state.studio.id);};
showContentHistory=async function(cid){
 const [c,revs]=await Promise.all([api('records/content/'+cid+scope()),api('records/content/'+cid+'/revisions'+scope())]);state.history={c,revs};
 const previous=revs.find(r=>r.data.body!==c.data.body)||revs.find(r=>r.revision!==c.revision)||revs[0];
 const labels=revs.map(r=>[r.revision,'v'+r.revision+' · '+fmt(r.created_at)+' · '+(r.source==='ai.accepted'?'AI 结果采纳':r.source==='edited'?'编辑保存':r.source)]);
 modal('版本历史与修改对比',`<div class="notice">当前正文 v${c.revision}。选择任意两个版本查看差异；恢复会创建新版本，原版本保留。</div><div class="field-grid">${select('diff_before','修改前版本',previous.revision,labels)}${select('diff_after','修改后版本',c.revision,labels)}</div>${btn('查看所选版本差异','render-version-diff','type="button"','small')}<div class="diff-view" id="revision-comparison"></div><details><summary>全部保存版本（${revs.length}）</summary><div class="revision-list">${revs.map(r=>`<div class="list-row"><div class="list-main"><h4>v${r.revision} · ${esc(r.data.title)}</h4><p>${fmt(r.created_at)} · ${esc(r.source)}</p><details><summary>查看正文快照</summary><pre>${esc(r.data.body||'')}</pre></details></div>${btn('与当前版本对比','compare-revision',`type="button" data-revision="${r.revision}"`,'small')}${r.revision!==c.revision?btn('恢复此版','restore-revision',`type="button" data-revision="${r.revision}"`,'small'):tag('当前版本','green')}</div>`).join('')}</div></details>`,null,true);
 act['render-version-diff']();
};
act['render-version-diff']=()=>{const {revs}=state.history,before=revs.find(r=>String(r.revision)===$('#f-diff_before').value),after=revs.find(r=>String(r.revision)===$('#f-diff_after').value);$('#revision-comparison').innerHTML=diffLines(before?.data.body||'',after?.data.body||'');};
act['compare-revision']=e=>{$('#f-diff_before').value=e.dataset.revision;$('#f-diff_after').value=state.history.c.revision;act['render-version-diff']();};

acceptRun=async function(candidate){
 await flush();const c=state.studio,r=state.compareRun;
 if(!c||!r||state.comparedRevision!==c.revision)throw Error('正文已变化，请重新打开对比再采纳');
 const saved=await api('runs/'+r.id+'/accept?accountId='+encodeURIComponent(c.account_id),{method:'POST',body:{expected_revision:c.revision,candidate,confirm_replace_current:!r.data.selection,compared_revision:state.comparedRevision}});
 state.studio=saved;await reloadStudioKeepingAssistant(saved);toast('已采纳并保存新版本，修改前的正文仍在版本历史中');
};
const researchTopicsPage=pages.topics;
pages.topics=async()=>{let html=await researchTopicsPage();for(const topic of state.items||[]){if(!topic.data.post_id)continue;const button=btn('查看完整拆解','topic-research',`data-id="${topic.id}"`,'small');const edit=btn('编辑','edit-topic',`data-id="${topic.id}"`,'ghost small'),listEdit=btn('编辑','edit-topic',`data-id="${topic.id}"`,'small');if(html.includes(edit))html=html.replace(edit,button+edit);else html=html.replace(listEdit,button+listEdit);}return html;};
function linkedResearchHTML(data){const {topic,post,analysis}=data;if(!post)return '<div class="notice">这条灵感没有关联对标文章。</div>';return `<div class="notice">关联原文：《${esc(post.data.title)}》。${analysis?'完整拆解已保留；卡片摘要只是预览。':'尚未确认 AI 拆解，仅有原文与人工笔记。'}${analysis&&!analysis.fresh?'<strong>原文已变化：旧拆解已过期，重新确认后才能用于 AI 创作。</strong>':''}</div>${post.data.url?'<p><a href="'+esc(safeLink(post.data.url))+'" target="_blank" rel="noopener noreferrer">查看原文来源</a></p>':''}${analysis?'<p class="field-hint">分析 Skill：'+esc(analysis.skill_name||'历史规则')+' '+esc(analysis.skill_version||'')+'；运行记录：'+esc(analysis.run_id)+'</p>'+bmReport(analysis.report,analysis.run_id):'<div class="candidate">'+esc(post.data.analysis||post.data.summary||'暂无分析')+'</div>'}<details><summary>原文内容</summary><div class="candidate">${esc(post.data.article_body||'未保存原文')}</div></details>${analysis?.raw_output?'<details><summary>原始模型完整输出</summary><div class="candidate">'+esc(analysis.raw_output)+'</div></details>':''}`;}
act['topic-research']=async e=>{const data=await api('topic-research/'+dataId(e)+scope());modal('灵感来源与完整拆解',linkedResearchHTML(data)+(!data.analysis||data.analysis.fresh?btn('开始创作（引用完整拆解）','topic-write',`type="button" data-id="${data.topic.id}"`,'primary'):''),null,true);};
const sourceStudioPage=pages.studio;
pages.studio=async()=>{const html=await sourceStudioPage();return state.studio?html.replace(btn('修改对比','manuscript-diff','','ghost small'),btn('查看本次引用资料','manuscript-sources','','ghost small')+btn('修改对比','manuscript-diff','','ghost small')):html;};
act['manuscript-sources']=async()=>{const c=state.studio;if(!c)return;let html='';if(c.data.topic_id)html+=linkedResearchHTML(await api('topic-research/'+c.data.topic_id+scope()));const assets=await records('asset');for(const id of c.data.asset_ids||[]){const a=assets.find(x=>x.id===id);if(a)html+='<h3>'+esc(a.data.title)+'</h3><div class="candidate">'+esc(a.data.body||'图片素材')+'</div>';}modal('当前稿件实际引用的资料',html||'<div class="notice">本稿还没有关联灵感来源或显式选用素材。账号中的其他灵感不会自动混入本次写作。</div>',null,true);};
const topicWriteWithSources=act['topic-write'];act['topic-write']=async e=>{if($('#modal').open)$('#modal').close();await topicWriteWithSources(e);};
const redfoxAIPage=pages.ai;
pages.ai=async()=>{const [html,status]=await Promise.all([redfoxAIPage(),api('redfox/config')]);return html+`<section class="panel"><div class="panel-head"><h2>Redfox 公众号热点素材</h2>${btn('配置 Redfox API Key','redfox-config','','small')}</div><p>${status.configured?'已配置 · '+esc(status.mask):'尚未配置专用 Key；模型 API Key 与 Redfox Key 分开保存。'}</p><p class="field-hint">在 AI 创作中点击「Redfox 热点素材」显式查询并引用。只请求官方接口，不执行 Skill 附带的 Python 脚本，不自动充值。</p></section>`;};
act['redfox-config']=async()=>{const status=await api('redfox/config');modal('配置 Redfox API Key',`<div class="notice">此 Key 只用于 redfox.hk 的素材查询，使用本机凭证库加密保存，不发给写作模型，不包含在源码、安装包或备份中。</div><p>${status.configured?'已配置 '+esc(status.mask)+'；填写新值可替换。':'尚未配置。'}</p>${field('api_key','Redfox API Key','','password')}<p><a href="https://redfox.hk/settings/api-keys?source=github" target="_blank" rel="noopener noreferrer">打开 Redfox 官方密钥管理页</a></p>`,async f=>{await api('redfox/config',{method:'PUT',body:{api_key:f.api_key}});toast('Redfox Key 已加密保存');});};
const redfoxStudioPage=pages.studio;
pages.studio=async()=>{const html=await redfoxStudioPage();return html.replace(btn('后续 Skill 处理正文','postprocess-current'),btn('后续 Skill 处理正文','postprocess-current')+btn('Redfox 热点素材','redfox-search'));};
act['redfox-search']=async()=>{
 await flush();const c=state.studio;if(!c)throw Error('请先打开稿件');const status=await api('redfox/config');
 if(!status.configured){modal('Redfox 热点素材',`<div class="notice">尚未配置 Redfox 专用 Key。可以配置后查询真实素材，也可以直接使用已有原文和文字规则写作；没有查询时不会声称已获取实时爆款数据。</div>${btn('配置 Redfox API Key','redfox-config','type="button"','primary small')}`,null);return;}
 modal('查询 Redfox 公众号热点素材',`<div class="notice">本次仅向 Redfox 发送关键词与时间范围，不发送整篇稿件。接口可能消耗 Redfox 积分，与 AI 模型费用预算分开；每次点击只查询一次，不自动扩展时间、充值或重试。</div>${field('keyword','检索关键词','','text','英文逗号分隔，服务商要求最多 5 个、总长不超过 200 字符。')}${select('days','时间范围','7',[['7','近 7 天'],['30','近 30 天']])}<label class="inline"><input type="checkbox" name="consume_points">我确认本次查询可能消耗 Redfox 积分</label><label class="inline"><input type="checkbox" name="attach" checked>查询后作为素材引用到当前稿件</label>`,async f=>{
  if(!currentStudio(c))throw Error('当前稿件已切换，请重新查询');if(f.consume_points!=='on')throw Error('请确认本次查询的积分使用');
  const result=await api('redfox/search?accountId='+encodeURIComponent(c.account_id),{method:'POST',body:{content_id:c.id,keyword:f.keyword,days:Number(f.days),consume_points:true}});
  if(f.attach==='on'&&currentStudio(c)){c.data.asset_ids=[...new Set([...(c.data.asset_ids||[]),result.asset.id])];markDirty();await flush();}
  modal('Redfox 查询结果已保存',`<div class="notice">返回 ${result.count} 篇文章，已保存到本账号素材库${f.attach==='on'?'并引用到当前稿件':''}。可继续生成文章；标题、摘要与互动数据不代表完整正文或实测传播因果。</div><div class="candidate">${esc(result.asset.data.body)}</div>`,null,true);toast('Redfox 素材已保存，后续写作会引用已选资料');
 },true);$('#modal-form [type=submit]').textContent='查询一次并保存素材';
};

function refreshManuscriptSummary(){
 const c=state.studio;if(!c||state.page!=='studio')return;
 const runs=state.runs.filter(r=>r.content_id===c.id&&!r.data.project_id&&!r.data.post_id),button=document.querySelector('[data-act="manuscript-runs"]'),status=document.querySelector('.studio-result-status span');
 if(button)button.textContent='生成记录（'+runs.length+'）';
 if(status)status.textContent='正文自动保存 · v'+c.revision+'；生成记录单独保留。';
 const latest=runs.find(r=>completeArticle(r)||partialArticle(r)),bar=document.querySelector('.studio-result-status');
 if(latest&&bar){const action=partialArticle(latest)?'view-partial-run':'compare-run',label=partialArticle(latest)?'查看已返回文本':'查看最近生成文章';let link=bar.querySelector('[data-act]');if(!link)bar.insertAdjacentHTML('beforeend',btn(label,action,`data-id="${latest.id}"`,'small'));else{link.dataset.act=action;link.dataset.id=latest.id;link.textContent=label;}}
}

function partialArticle(r){return !['chat','review'].includes(r.data.action)&&['failed','interrupted','cancelled'].includes(r.status)&&!r.data.project_id&&!r.data.post_id&&!!(r.data.partial_output||r.data.output);}
act['view-partial-run']=e=>{const r=state.runs.find(r=>r.id===dataId(e));if(!r||!partialArticle(r))throw Error('没有可查看的部分文本');modal('已返回部分文本 · 尚未完成',`<div class="notice">这次生成尚未完整结束，返回内容已经保存。可以免费另存为可编辑草稿；接续会发起新模型调用，并继续遵守费用预算。</div><div class="candidate">${esc(r.data.partial_output||r.data.output)}</div><div class="inline">${btn('另存为未完成草稿','save-partial-run',`type="button" data-id="${r.id}"`,'primary small')}${btn('按自动额度接续','resume-run',`type="button" data-id="${r.id}"`,'small')}${btn('复制已返回文本','copy-partial-run',`type="button" data-id="${r.id}"`,'small')}</div>`,null,true);};
act['copy-partial-run']=async e=>{const r=state.runs.find(r=>r.id===dataId(e));if(r)await navigator.clipboard.writeText(r.data.partial_output||r.data.output||'');toast('部分文本已复制');};
act['save-partial-run']=async e=>{await flush();const c=state.studio,saved=await api('runs/'+dataId(e)+'/save-partial?accountId='+encodeURIComponent(c.account_id),{method:'POST',body:{}});$('#modal').close();await go('studio',saved.id);toast('已另存为可编辑的未完成草稿；原稿与生成记录仍保留');};
act['resume-run']=async e=>{const r=state.runs.find(r=>r.id===dataId(e));if(!r)throw Error('请重新打开生成记录');if($('#modal').open)$('#modal').close();const extra={resumed_from:r.id,provider_id:r.data.provider_id,instruction:r.data.instruction||''};if(r.data.model_diagnostics?.code==='output_limit'){extra.output_token_mode='auto';extra.max_tokens=undefined;}const c=state.studio,result=await executeAI('resume',extra);if(result?.status==='succeeded'&&currentStudio(c))await act['compare-run']({dataset:{id:result.id}});};
const quotaProviderForm=editProvider;
editProvider=async function(p){await quotaProviderForm(p);const mode=$('#f-output_token_mode'),manual=$('#f-max_tokens')?.closest('.field');if(mode&&manual){const update=()=>manual.hidden=mode.value!=='manual';mode.onchange=update;update();}};
act['model-catalog']=async e=>{const provider=(await records('provider')).find(p=>p.id===dataId(e));if(!provider)throw Error('模型配置不存在');toast('正在读取供应商模型能力…');const result=await api('providers/'+provider.id+'/models',{method:'POST',body:{}});state.modelCatalog={provider,models:result.models};const current=result.models.find(m=>m.id===provider.data.model);modal('供应商模型目录与能力',`<div class="notice">当前模型：${esc(provider.data.model)}。能力来自供应商响应；自动额度按费用预算与最大输出能力计算，不沿用旧的 8000。</div>${current?.max_output_tokens?btn('同步当前模型能力并启用自动额度','sync-output-capacity','type="button"','primary small'):'<p class="field-hint">接口未提供当前模型的最大输出能力，可在配置中按供应商说明填写。</p>'}<div class="candidate">${result.models.map(m=>esc(m.id)+' · 最大输出 '+(m.max_output_tokens||'未提供')+' · 上下文 '+(m.context_window||'未提供')).join('\n')}</div>`,null,true);};
act['sync-output-capacity']=async()=>{const {provider,models}=state.modelCatalog,m=models.find(m=>m.id===provider.data.model);if(!m?.max_output_tokens)throw Error('服务商未返回输出能力');await api('records/provider/'+provider.id,{method:'PATCH',body:{revision:provider.revision,data:{model_output_limit:m.max_output_tokens,model_context_window:m.context_window,output_token_mode:'auto'}}});$('#modal').close();await render();toast('已读取模型能力并启用自动额度，费用预算保留');};
