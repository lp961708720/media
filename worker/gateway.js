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
export async function decodeSSE(response,protocol,onDelta,signal){
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',output='',usage={},reported=false,finished=false;
 async function event(block){const data=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)return;if(data==='[DONE]'){finished=true;return}let e;try{e=JSON.parse(data)}catch{throw problem(502,'供应商流式事件格式错误')}
 if(e.error||e.type==='error'||e.type==='response.failed')throw problem(502,'供应商流式生成失败');let delta='';
 if(protocol==='responses'){if(e.type==='response.output_text.delta')delta=e.delta||'';if(e.type==='response.completed'){usage={input_tokens:e.response?.usage?.input_tokens||0,output_tokens:e.response?.usage?.output_tokens||0};reported=!!e.response?.usage;finished=true}if(e.type==='response.incomplete')throw problem(502,'模型输出达到限制，部分文本已保留')}
 else if(protocol==='gemini'){delta=e.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';if(e.usageMetadata){usage={input_tokens:e.usageMetadata.promptTokenCount||0,output_tokens:(e.usageMetadata.candidatesTokenCount||0)+(e.usageMetadata.thoughtsTokenCount||0)};reported=true}const finish=e.candidates?.[0]?.finishReason;if(finish&&finish!=='STOP')throw problem(502,'Gemini 输出未完整结束：'+finish);if(finish==='STOP')finished=true}
 else if(protocol==='anthropic'){if(e.type==='content_block_delta')delta=e.delta?.text||'';if(e.type==='message_start'){usage.input_tokens=e.message?.usage?.input_tokens||0;reported=!!e.message?.usage}if(e.type==='message_delta'){if(e.delta?.stop_reason==='max_tokens')throw problem(502,'模型输出达到限制，部分文本已保留');usage.output_tokens=e.usage?.output_tokens||0;reported||=!!e.usage}if(e.type==='message_stop')finished=true}
 else {delta=e.choices?.[0]?.delta?.content||'';if(e.usage){usage={input_tokens:e.usage.prompt_tokens||0,output_tokens:e.usage.completion_tokens||0};reported=true}if(e.choices?.[0]?.finish_reason){if(e.choices[0].finish_reason==='length')throw problem(502,'模型输出达到限制，部分文本已保留');finished=true}}
 if(delta){output+=delta;if(output.length>200000)throw problem(413,'模型输出过大');await onDelta?.(delta,output)}
 }
 try{while(true){if(signal?.aborted)throw signal.reason||problem(499,'任务已取消');const r=await reader.read();if(r.done)break;pending+=decoder.decode(r.value,{stream:true});let m;while((m=pending.match(/\r?\n\r?\n/))){const block=pending.slice(0,m.index);pending=pending.slice(m.index+m[0].length);await event(block)}}pending+=decoder.decode();if(pending.trim())await event(pending);if(!finished)throw problem(502,'模型流中断，部分输出已保留');if(!output.trim())throw problem(502,'模型未返回可用正文');return {output,usage:{input_tokens:usage.input_tokens||0,output_tokens:usage.output_tokens||0},usage_reported:reported};}finally{try{await reader.cancel()}catch{}reader.releaseLock()}
}
export async function requestModel({provider:p,secret,messages,maxTokens,onDelta,signal,fetcher=fetch,parameters={}}){
 const d=p.data,protocol=d.protocol||'openai',base=providerURL(d.base_url,{custom:!!d.allow_custom,loopback:!!d.allow_loopback}),stream=!!d.stream_enabled;
 const params={};if(d.supports_temperature&&parameters.temperature!==undefined){const t=Number(parameters.temperature);if(!Number.isFinite(t)||t<0||t>2)throw problem(400,'temperature 须在 0–2 之间');params.temperature=t}
 if(parameters.temperature!==undefined&&!d.supports_temperature)throw problem(400,'此模型未声明支持 temperature');
 const headers={'content-type':'application/json'},payload={model:d.model,...params};let endpoint;
 if(protocol==='gemini'){headers['x-goog-api-key']=secret;endpoint=base+'/models/'+encodeURIComponent(d.model.replace(/^models\//,''))+(stream?':streamGenerateContent?alt=sse':':generateContent');Object.assign(payload,{systemInstruction:{parts:[{text:messages[0].content}]},contents:messages.slice(1).map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{maxOutputTokens:maxTokens,...params}});delete payload.model;delete payload.temperature}
 else if(protocol==='responses'){if(secret)headers.authorization='Bearer '+secret;endpoint=base+'/responses';Object.assign(payload,{instructions:messages[0].content,input:messages.slice(1),max_output_tokens:maxTokens,store:false,stream})}
 else if(protocol==='anthropic'){headers['x-api-key']=secret;headers['anthropic-version']='2023-06-01';endpoint=base+'/messages';Object.assign(payload,{system:messages[0].content,messages:messages.slice(1),max_tokens:maxTokens,stream})}
 else {if(secret)headers.authorization='Bearer '+secret;endpoint=base+'/chat/completions';Object.assign(payload,{messages,stream,[d.token_parameter==='max_completion_tokens'?'max_completion_tokens':'max_tokens']:maxTokens});if(stream)payload.stream_options={include_usage:true}}
 let resp;try{resp=await fetcher(endpoint,{method:'POST',headers,body:JSON.stringify(payload),redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(Number(d.timeout_ms)||120000)]):AbortSignal.timeout(Number(d.timeout_ms)||120000),allowLoopback:!!d.allow_loopback})}catch(e){if(signal?.aborted)throw problem(499,'任务已取消');throw problem(502,e.name==='TimeoutError'?'模型调用超时':'模型网络连接失败')}
 if(!resp.ok)throw problem(502,({400:'模型参数不兼容',401:'API Key 无效',403:'模型访问权限不足',404:'模型或端点不存在',429:'限流或额度不足'}[resp.status]||'供应商错误')+'（HTTP '+resp.status+'）');
 if(resp.headers.get('content-type')?.includes('text/event-stream'))return decodeSSE(resp,protocol,onDelta,signal);
 const r=await resp.json();let output,usage;
 if(protocol==='gemini'){const candidate=r.candidates?.[0];output=candidate?.content?.parts?.map(p=>p.text||'').join('');if(candidate?.finishReason&&candidate.finishReason!=='STOP'){if(output)await onDelta?.(output,output);throw problem(502,'Gemini 输出未完整结束：'+candidate.finishReason)}usage={input_tokens:r.usageMetadata?.promptTokenCount||0,output_tokens:(r.usageMetadata?.candidatesTokenCount||0)+(r.usageMetadata?.thoughtsTokenCount||0)}}
 else if(protocol==='responses'){if(r.status==='incomplete'||r.error)throw problem(502,'模型响应未完整结束');output=r.output_text||r.output?.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n');usage={input_tokens:r.usage?.input_tokens||0,output_tokens:r.usage?.output_tokens||0}}
 else if(protocol==='anthropic'){output=r.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n');usage={input_tokens:r.usage?.input_tokens||0,output_tokens:r.usage?.output_tokens||0}}
 else {output=r.choices?.[0]?.message?.content;usage={input_tokens:r.usage?.prompt_tokens||0,output_tokens:r.usage?.completion_tokens||0}}
 if((r.choices?.[0]?.finish_reason==='length')||r.stop_reason==='max_tokens'){if(typeof output==='string')await onDelta?.(output,output);throw problem(502,'模型输出达到限制，部分文本已保留')}if(typeof output!=='string'||!output.trim())throw problem(502,'模型未返回可用正文');if(output.length>200000)throw problem(413,'模型输出过大');await onDelta?.(output,output);return {output,usage,usage_reported:!!(r.usage||r.usageMetadata)};
}
