export const TRUSTED_HOSTS=['api.openai.com','api.anthropic.com','api.deepseek.com','dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com','openrouter.ai','api.siliconflow.cn','api.siliconflow.com','api.mistral.ai','api.x.ai','api.together.xyz','api.fireworks.ai','generativelanguage.googleapis.com'];
export const problem=(status,message)=>Object.assign(new Error(message),{status});
export function providerURL(value,{custom=false,loopback=false}={}){
 let u;try{u=new URL(value)}catch{throw problem(400,'模型 API URL 无效')}
 if(u.username||u.password||u.search||u.hash)throw problem(400,'API URL 不允许认证信息、查询串或片段');
 const loop=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if(loop&&loopback&&['http:','https:'].includes(u.protocol))return u.href.replace(/\/$/,'');
 if(u.protocol!=='https:'||u.port||loop||/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)||u.hostname.includes(':')||u.hostname.endsWith('.local')||u.hostname==='metadata.google.internal')throw problem(400,'API 地址须为安全 HTTPS 公网域名；本机模型需要显式启用回环访问');
 if(!TRUSTED_HOSTS.includes(u.hostname)&&!custom)throw problem(400,'自定义域名需要显式勾选授权，服务端仍会拒绝私网 DNS 与重定向');
 return u.href.replace(/\/$/,'');
}

// Only official hybrid DeepSeek Chat models declare this wire parameter.
export function canControlThinking(p){const d=p.data||p;try{return (d.protocol||'openai')==='openai'&&new URL(d.base_url).hostname==='api.deepseek.com'&&/^deepseek-(flash|v4(?:\.\d+)?-(?:flash|pro))$/.test(d.model)}catch{return false}}
const visibleText=v=>typeof v==='string'?v:Array.isArray(v)?v.filter(p=>!p.thought&&['text','output_text',undefined].includes(p.type)).map(p=>typeof p.text==='string'?p.text:'').join(''):'';
const responseText=r=>visibleText(r.output_text)||r.output?.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text||'').join('\n')||'';
function tokenUsage(r,protocol){if(protocol==='gemini')return {input_tokens:r.promptTokenCount||0,output_tokens:(r.candidatesTokenCount||0)+(r.thoughtsTokenCount||0),reasoning_tokens:r.thoughtsTokenCount||0};return {input_tokens:r.input_tokens??r.prompt_tokens??0,output_tokens:r.output_tokens??r.completion_tokens??0,reasoning_tokens:r.completion_tokens_details?.reasoning_tokens??r.output_tokens_details?.reasoning_tokens??0}}
function failure(meta,output,message){const length=['length','max_tokens','max_output_tokens','MAX_TOKENS'].includes(meta.finish_reason);const text=message||(length?(output.trim()?'模型输出达到本次上限，已返回的部分正文已保留':'模型输出达到本次上限，但尚未返回可用正文'+(meta.reasoning_received?'（检测到推理阶段活动）':'')):'模型响应未完整结束');return Object.assign(problem(502,text),{model_meta:{...meta,code:length?'output_limit':'incomplete',visible_output_chars:output.length}})}
export async function decodeSSE(response,protocol,onDelta,signal){
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',output='',usage={input_tokens:0,output_tokens:0,reasoning_tokens:0},reported=false,finished=false,finishReason=null,terminalError=false,reasoning=false;
 const meta=()=>({finish_reason:finishReason,usage,usage_reported:reported,reasoning_received:reasoning||usage.reasoning_tokens>0});
 async function event(block){const data=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)return;if(data==='[DONE]'){finished=true;return}let e;try{e=JSON.parse(data)}catch{throw failure(meta(),output,'供应商流式事件格式错误')}
 if(e.error||e.type==='error'||e.type==='response.failed')throw failure(meta(),output,'供应商流式生成失败');let delta='';
 if(protocol==='responses'){
  if(e.type==='response.output_text.delta')delta=visibleText(e.delta);
  if(e.type?.startsWith('response.reasoning'))reasoning=true;
  if(['response.completed','response.incomplete'].includes(e.type)){if(e.response?.usage){usage=tokenUsage(e.response.usage,protocol);reported=true}if(!output)delta=responseText(e.response||{});finished=true;finishReason=e.type==='response.incomplete'?(e.response?.incomplete_details?.reason||'incomplete'):'completed';terminalError=e.type==='response.incomplete';}
 }else if(protocol==='gemini'){
  const parts=e.candidates?.[0]?.content?.parts||[];reasoning||=parts.some(p=>p.thought&&p.text);delta=visibleText(parts);
  if(e.usageMetadata){usage=tokenUsage(e.usageMetadata,protocol);reported=true}const finish=e.candidates?.[0]?.finishReason;if(finish){finishReason=finish;finished=true;terminalError=finish!=='STOP'}
 }else if(protocol==='anthropic'){
  if(e.type==='content_block_delta'){delta=e.delta?.text||'';reasoning||=!!e.delta?.thinking}
  if(e.type==='message_start'&&e.message?.usage){usage={...usage,...tokenUsage(e.message.usage,protocol)};reported=true}
  if(e.type==='message_delta'){if(e.usage){usage.output_tokens=e.usage.output_tokens||0;reported=true}if(e.delta?.stop_reason){finishReason=e.delta.stop_reason;terminalError=!['end_turn','stop_sequence'].includes(finishReason)}}
  if(e.type==='message_stop')finished=true;
 }else{
  delta=visibleText(e.choices?.[0]?.delta?.content);reasoning||=!!e.choices?.[0]?.delta?.reasoning_content;
  if(e.usage){usage=tokenUsage(e.usage,protocol);reported=true}const finish=e.choices?.[0]?.finish_reason;if(finish){finishReason=finish;finished=true;terminalError=finish!=='stop'}
 }
 // Save the current event's text before acting on its finish reason. Usage may arrive next.
 if(delta){output+=delta;if(output.length>200000)throw problem(413,'模型输出过大');await onDelta?.(delta,output)}
 }
 try{while(true){if(signal?.aborted)throw signal.reason||problem(499,'任务已取消');const r=await reader.read();if(r.done)break;pending+=decoder.decode(r.value,{stream:true});let m;while((m=pending.match(/\r?\n\r?\n/))){const block=pending.slice(0,m.index);pending=pending.slice(m.index+m[0].length);await event(block)}}pending+=decoder.decode();if(pending.trim())await event(pending);if(terminalError)throw failure(meta(),output);if(!finished)throw failure(meta(),output,'模型流中断，'+(output?'已返回的部分正文已保留':'尚未返回可用正文'));if(!output.trim())throw failure(meta(),output,'模型未返回可用正文'+(reasoning?'（仅检测到推理阶段活动）':''));return {output,usage,usage_reported:reported};}catch(e){if(signal?.aborted)throw problem(499,'任务已取消');if(e.model_meta||e.status)throw e;throw failure(meta(),output,'模型流中断，'+(output?'已返回的部分正文已保留':'尚未返回可用正文'));}finally{try{await reader.cancel()}catch{}reader.releaseLock()}
}
export async function requestModel({provider:p,secret,messages,maxTokens,onDelta,signal,fetcher=fetch,parameters={}}){
 const d=p.data,protocol=d.protocol||'openai',base=providerURL(d.base_url,{custom:!!d.allow_custom,loopback:!!d.allow_loopback}),stream=!!d.stream_enabled;
 const params={};if(d.supports_temperature&&parameters.temperature!==undefined){const t=Number(parameters.temperature);if(!Number.isFinite(t)||t<0||t>2)throw problem(400,'temperature 须在 0–2 之间');params.temperature=t}
 if(parameters.temperature!==undefined&&!d.supports_temperature)throw problem(400,'此模型未声明支持 temperature');
 if(parameters.thinking_mode!==undefined&&!['default','enabled','disabled'].includes(parameters.thinking_mode))throw problem(400,'思考模式无效');
 if(parameters.thinking_mode&&parameters.thinking_mode!=='default'){if(!canControlThinking(p))throw problem(400,'此思考模式参数仅支持官方 DeepSeek 混合模型 Chat 接口');params.thinking={type:parameters.thinking_mode}}
 const headers={'content-type':'application/json'},payload={model:d.model,...params};let endpoint;
 if(protocol==='gemini'){headers['x-goog-api-key']=secret;endpoint=base+'/models/'+encodeURIComponent(d.model.replace(/^models\//,''))+(stream?':streamGenerateContent?alt=sse':':generateContent');Object.assign(payload,{systemInstruction:{parts:[{text:messages[0].content}]},contents:messages.slice(1).map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{maxOutputTokens:maxTokens,...params}});delete payload.model;delete payload.temperature}
 else if(protocol==='responses'){if(secret)headers.authorization='Bearer '+secret;endpoint=base+'/responses';Object.assign(payload,{instructions:messages[0].content,input:messages.slice(1),max_output_tokens:maxTokens,store:false,stream})}
 else if(protocol==='anthropic'){headers['x-api-key']=secret;headers['anthropic-version']='2023-06-01';endpoint=base+'/messages';Object.assign(payload,{system:messages[0].content,messages:messages.slice(1),max_tokens:maxTokens,stream})}
 else {if(secret)headers.authorization='Bearer '+secret;endpoint=base+'/chat/completions';Object.assign(payload,{messages,stream,[d.token_parameter==='max_completion_tokens'?'max_completion_tokens':'max_tokens']:maxTokens});if(stream)payload.stream_options={include_usage:true}}
 let resp;try{resp=await fetcher(endpoint,{method:'POST',headers,body:JSON.stringify(payload),redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(Number(d.timeout_ms)||120000)]):AbortSignal.timeout(Number(d.timeout_ms)||120000),allowLoopback:!!d.allow_loopback})}catch(e){if(signal?.aborted)throw problem(499,'任务已取消');throw problem(502,e.name==='TimeoutError'?'模型调用超时':'模型网络连接失败')}
 if(!resp.ok)throw problem(502,({400:'模型参数不兼容',401:'API Key 无效',403:'模型访问权限不足',404:'模型或端点不存在',429:'限流或额度不足'}[resp.status]||'供应商错误')+'（HTTP '+resp.status+'）');
 if(resp.headers.get('content-type')?.includes('text/event-stream'))return decodeSSE(resp,protocol,onDelta,signal);
 const r=await resp.json();let output='',finishReason=null,reasoning=false;const rawUsage=r.usage||r.usageMetadata,usage=tokenUsage(rawUsage||{},protocol);
 if(protocol==='gemini'){const candidate=r.candidates?.[0],parts=candidate?.content?.parts||[];output=visibleText(parts);reasoning=parts.some(p=>p.thought&&p.text);finishReason=candidate?.finishReason||null}
 else if(protocol==='responses'){output=responseText(r);finishReason=r.status==='incomplete'?(r.incomplete_details?.reason||'incomplete'):r.error?'error':null;reasoning=r.output?.some(p=>p.type==='reasoning')||false}
 else if(protocol==='anthropic'){output=r.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')||'';finishReason=r.stop_reason||null;reasoning=r.content?.some(p=>p.type==='thinking')||false}
 else {output=visibleText(r.choices?.[0]?.message?.content);finishReason=r.choices?.[0]?.finish_reason||null;reasoning=!!r.choices?.[0]?.message?.reasoning_content}
 if(output.length>200000)throw problem(413,'模型输出过大');if(output)await onDelta?.(output,output);
 const meta={finish_reason:finishReason,usage,usage_reported:!!rawUsage,reasoning_received:reasoning||usage.reasoning_tokens>0};
 if(finishReason&&!['stop','STOP','end_turn','stop_sequence','completed'].includes(finishReason))throw failure(meta,output);if(!output.trim())throw failure(meta,output,'模型未返回可用正文'+(reasoning?'（仅检测到推理阶段活动）':''));return {output,usage,usage_reported:!!rawUsage};
}
