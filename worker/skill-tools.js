import {problem} from './gateway.js';
export function requiresRedfox(skill){const d=skill?.data||skill||{},g=d.github_source;if(g?.repository)return String(g.repository).toLowerCase()==='redfox-data/redfox-community'&&String(g.path||'').replace(/^\/+|\/+$/g,'')==='skills/wechat-write';return d.name==='wechat-write'&&/fetch_gzh_trends\.py|hotArticleNew|红狐|redfox/i.test(String(d.markdown||'')+' '+String(d.description||''));}
export async function writingRetrieval(c,article,skill,b){
 if(!requiresRedfox(skill))return null;
 if(!b.redfox_asset_id||b.retrieval_mode==='existing_only')throw problem(428,'wechat-write 每次写作都需要本次重新检索，不复用旧结果或跳过检索');
 const asset=await c.record(b.redfox_asset_id,'asset',c.aid),original=await c.sql("SELECT data FROM revisions WHERE record_id=? AND owner_id=? AND revision=1 AND source='redfox.query'",asset.id,c.owner).first();if(!original)throw problem(428,'请为本次写作重新检索红狐');const data=JSON.parse(original.data),query=data.redfox_query;
 if(!query?.id||query.content_id!==article.id||query.skill_version_id!==skill.data.version_id||query.action!==(b.action||'draft')||query.source_revision!==article.revision)throw problem(428,'检索结果不属于本次文章、Skill 或正文版本，请重新检索');
 if(Date.now()-Date.parse(data.redfox_snapshot?.fetched_at)>300000||!Number.isFinite(Date.parse(data.redfox_snapshot?.fetched_at)))throw problem(428,'本次查询时间已过，请重新检索再写作');
 if(asset.data.body!==data.body||JSON.stringify(asset.data.redfox_snapshot)!==JSON.stringify(data.redfox_snapshot))throw problem(428,'检索结果已被修改，请重新检索');
 if(await c.sql("SELECT id FROM ai_runs WHERE owner_id=? AND json_extract(data,'$.retrieval.query_id')=?",c.owner,query.id).first())throw problem(409,'本次查询已用于一次写作，请重新检索');
 if(!data.redfox_snapshot.articles.length)throw problem(428,'本次红狐检索没有返回文章，请调整关键词重新检索后写作');
 return {status:'fresh_search',query_id:query.id,asset_id:asset.id,snapshot:data.redfox_snapshot};
}
