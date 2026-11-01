import {problem} from './gateway.js';
export function requiresRedfox(skill){const d=skill?.data||skill||{},text=String(d.markdown||'')+' '+String(d.description||'');return /fetch_gzh_trends\.py|hotArticleNew/i.test(text)||(/redfox|红狐/i.test(text)&&/检索|查询爆款|爆款.*雷达/i.test(text));}
export async function writingRetrieval(c,article,skill,b){
 if(!requiresRedfox(skill))return null;
 const ids=article.data.asset_ids||[];if(b.redfox_asset_id&&!ids.includes(b.redfox_asset_id))throw problem(400,'请先将红狐检索结果引用到本篇文章');
 let selected=null;for(const id of b.redfox_asset_id?[b.redfox_asset_id]:[...ids].reverse()){
  const asset=await c.record(id,'asset',c.aid);if(!asset.data.redfox_snapshot)continue;
  const original=await c.sql("SELECT data FROM revisions WHERE record_id=? AND owner_id=? AND revision=1 AND source='redfox.query'",id,c.owner).first();if(!original)continue;const data=JSON.parse(original.data);
  if(asset.data.body!==data.body||JSON.stringify(asset.data.redfox_snapshot)!==JSON.stringify(data.redfox_snapshot))continue;
  selected={asset_id:id,snapshot:data.redfox_snapshot};break;
 }
 if(b.retrieval_mode==='existing_only')return {status:selected?.snapshot.articles.length?'snapshot_available':selected?'empty_results':'explicitly_skipped',...selected,note:'用户明确选择仅使用已有资料，不发起新查询'};
 if(!selected)throw problem(428,'此写作 Skill 包含红狐检索流程，请先检索并引用结果，或明确选择仅用已有资料写作');
 if(!selected.snapshot.articles.length)throw problem(428,'红狐检索没有返回文章，请调整关键词，或明确选择仅用已有资料写作');
 return {status:'snapshot_ready',...selected};
}
