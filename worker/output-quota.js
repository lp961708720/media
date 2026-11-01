import {problem,canControlThinking} from './gateway.js';
// Official DeepSeek API documents 393216 as the maximum, not a default generation cap.
// https://api-docs.deepseek.com/api/create-chat-completion/ (verified 2026-11-01)
export function outputQuota(provider,request,inputChars,stages=1){
 const d=provider.data,explicit=request.max_tokens!==undefined&&request.max_tokens!==null&&request.max_tokens!==''&&Number(request.max_tokens)!==0;
 const mode=explicit?'task':(request.output_token_mode||d.output_token_mode||(canControlThinking(provider)?'auto':'manual'));
 if(!['task','auto','manual'].includes(mode))throw problem(400,'输出额度模式无效');
 const configured=Number(d.model_output_limit),capacity=Number.isSafeInteger(configured)&&configured>0?configured:canControlThinking(provider)?393216:null;
 let max;
 if(mode==='auto'){
  if(!capacity)throw problem(400,'此服务尚未声明模型输出能力，请在模型目录同步能力或填写供应商最大输出 Token；也可选择手动额度');
  const inputCost=(inputChars+1000)*d.input_price/1e6,available=d.per_run_limit/stages-inputCost;
  if(available<=0)throw problem(402,'当前输入的估算费用已达到单次预算，请调整费用预算');
  const affordable=d.output_price>0?Math.floor(available*1e6/d.output_price)-1:capacity;
  max=Math.min(capacity,affordable);
  if(max<1)throw problem(402,'单次预算不足以分配输出额度');
 }else max=explicit?Number(request.max_tokens):Number(d.max_tokens)||8000;
 if(!Number.isSafeInteger(max)||max<1)throw problem(400,'输出额度须为有效正整数；留空使用所选额度模式');
 return {max,mode,capacity,capacity_source:configured>0?'provider_configuration':capacity?'official_deepseek_documentation':null};
}
