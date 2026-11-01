// Fetch a public, revision-pinned directory as the same ZIP consumed by local uploads.
import {problem} from './gateway.js';
import {safePath,crc32,inspectSkill} from './skills.js';
const encoder=new TextEncoder(),hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const validSHA=s=>typeof s==='string'&&/^[a-f0-9]{40}$/i.test(s);
export function parseGitHubSkillURL(value,refOverride=''){
 let u;try{u=new URL(value)}catch{throw problem(400,'请输入有效 GitHub 地址')}
 if(u.protocol!=='https:'||!['github.com','www.github.com','raw.githubusercontent.com'].includes(u.hostname)||u.port||u.username||u.password)throw problem(400,'仅支持公开 GitHub 的 HTTPS 仓库、目录或 SKILL.md 链接');
 let parts;try{parts=u.pathname.split('/').filter(Boolean).map(decodeURIComponent)}catch{throw problem(400,'GitHub 地址编码无效')}
 const owner=parts.shift(),repo=parts.shift()?.replace(/\.git$/,'');if(!owner||!repo||![owner,repo].every(x=>/^[\w.-]+$/.test(x)&&!['.','..'].includes(x)))throw problem(400,'GitHub 仓库地址无效');
 let kind='tree';if(u.hostname!=='raw.githubusercontent.com'&&parts.length){kind=parts.shift();if(!['tree','blob'].includes(kind))throw problem(400,'请粘贴仓库、Skill 目录或 SKILL.md 文件链接')}else if(u.hostname==='raw.githubusercontent.com')kind='blob';
 for(const part of parts){if(!part||part==='.'||part==='..'||/[\\\x00-\x1f\x7f]/.test(part))throw problem(400,'GitHub 地址含不安全路径')}
 if(typeof refOverride!=='string')throw problem(400,'分支名须为文本');
 u.search='';u.hash='';return {owner,repo,parts,kind,refOverride:refOverride.trim(),url:u.href};
}
export function storedSkillZip(files){
 const local=[],central=[];let offset=0;const entries=Object.entries(files).sort(([a],[b])=>a.localeCompare(b));
 for(const [path,text]of entries){safePath(path);const name=encoder.encode(path),body=encoder.encode(text),crc=crc32(body),header=new Uint8Array(30),h=new DataView(header.buffer),dir=new Uint8Array(46),d=new DataView(dir.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,crc,true);h.setUint32(18,body.length,true);h.setUint32(22,body.length,true);h.setUint16(26,name.length,true);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint32(16,crc,true);d.setUint32(20,body.length,true);d.setUint32(24,body.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);local.push(header,name,body);central.push(dir,name);offset+=header.length+name.length+body.length;}
 const centralSize=central.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);const out=new Uint8Array(offset+centralSize+22);let at=0;for(const chunk of [...local,...central,end]){out.set(chunk,at);at+=chunk.length}return out;
}
function base64(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text)}
export async function fetchGitHubSkill(value,{ref='',fetcher=fetch}={}){
 const input=parseGitHubSkillURL(value,ref),base='https://api.github.com/repos/'+encodeURIComponent(input.owner)+'/'+encodeURIComponent(input.repo),cache=new Map();
 async function api(path,{missing=false}={}){if(cache.has(path))return cache.get(path);let r;try{r=await fetcher(base+path,{method:'GET',headers:{accept:'application/vnd.github+json','user-agent':'Media-Studio-Skill-Installer'},redirect:'manual',signal:AbortSignal.timeout(30000)})}catch{throw problem(502,'无法连接 GitHub，请检查网络后重试；已有 Skill 未改动')}
  if(r.status===404&&missing)return null;if(r.status===403||r.status===429)throw problem(429,'GitHub 访问频率或权限限制，请稍后重试；当前仅支持公开仓库');if(!r.ok)throw problem(502,'GitHub 无法读取该公开仓库或分支（HTTP '+r.status+'）');
  let data;try{data=await r.json()}catch{throw problem(502,'GitHub 返回了无效数据')}cache.set(path,data);return data;}
 let branch='HEAD',path=[],commit;
 if(input.parts.length){const p=input.parts;if(input.refOverride){const refParts=input.refOverride.split('/');let used=p[0]===input.refOverride?1:refParts.every((s,i)=>p[i]===s)?refParts.length:0;if(!used)throw problem(400,'指定分支与链接不一致');branch=input.refOverride;path=p.slice(used);commit=await api('/commits/'+encodeURIComponent(branch)+'?per_page=1',{missing:true});}
  else{for(let n=1;n<=p.length;n++){const candidate=p.slice(0,n).join('/'),found=await api('/commits/'+encodeURIComponent(candidate)+'?per_page=1',{missing:true});if(found){branch=candidate;path=p.slice(n);commit=found;break}}}}
 else commit=await api('/commits/HEAD?per_page=1',{missing:true});
 if(!commit||!validSHA(commit.sha)||!validSHA(commit.commit?.tree?.sha))throw problem(404,'找不到公开仓库或指定分支；私有仓库暂不支持');
 if(input.kind==='blob'){if(!/^SKILL\.md$/i.test(path.at(-1)||''))throw problem(400,'文件链接请指向 SKILL.md；其他情况请粘贴 Skill 目录地址');path.pop()}
 let treeSHA=commit.commit.tree.sha;for(const name of path){safePath(name);const tree=await api('/git/trees/'+treeSHA);if(tree.truncated)throw problem(400,'GitHub 目录列表不完整，请选择更具体的 Skill 目录');const entry=tree.tree?.find(x=>x.path===name&&x.type==='tree');if(!entry||!validSHA(entry.sha))throw problem(404,'GitHub 中找不到 Skill 目录：'+path.join('/'));treeSHA=entry.sha;}
 const tree=await api('/git/trees/'+treeSHA+'?recursive=1');if(tree.truncated||!Array.isArray(tree.tree))throw problem(400,'GitHub 目录列表不完整，未安装任何内容');const entries=tree.tree.filter(x=>x.type!=='tree');
 if(entries.length>32)throw problem(400,'该目录超过上传安装支持的文件数量，请选择单个 Skill 目录');let size=0;const seen=new Set();for(const e of entries){safePath(e.path);if(e.type!=='blob'||!['100644','100755'].includes(e.mode)||!validSHA(e.sha))throw problem(400,'Skill 目录包含符号链接、子模块或不支持的条目：'+e.path);if(seen.has(e.path.toLowerCase()))throw problem(400,'Skill 文件名重复：'+e.path);seen.add(e.path.toLowerCase());size+=e.size||0;if(e.size>200000||size>500000)throw problem(400,'该 Skill 超过上传安装支持的包大小');}
 if(entries.filter(e=>/(^|\/)SKILL\.md$/i.test(e.path)).length!==1)throw problem(400,'请粘贴只包含一个 SKILL.md 的具体 Skill 目录地址');
 const files=Object.create(null),decoder=new TextDecoder('utf-8',{fatal:true});for(let i=0;i<entries.length;i+=4){await Promise.all(entries.slice(i,i+4).map(async e=>{const blob=await api('/git/blobs/'+e.sha);if(blob.encoding!=='base64'||typeof blob.content!=='string')throw problem(502,'GitHub 文件内容格式无效：'+e.path);let bytes;try{bytes=Uint8Array.from(atob(blob.content.replace(/\s/g,'')),c=>c.charCodeAt(0))}catch{throw problem(502,'GitHub 文件编码无效：'+e.path)}const header=encoder.encode('blob '+bytes.length+'\0'),raw=new Uint8Array(header.length+bytes.length);raw.set(header);raw.set(bytes,header.length);if(bytes.length!==e.size||hex(new Uint8Array(await crypto.subtle.digest('SHA-1',raw)))!==e.sha.toLowerCase())throw problem(502,'GitHub 文件完整性校验失败：'+e.path);try{files[e.path]=decoder.decode(bytes)}catch{throw problem(400,'Skill 包仅支持文本附件：'+e.path)}}));}
 const zip_base64=base64(storedSkillZip(files)),preview=await inspectSkill({zip_base64}),github_source={url:input.url,repository:input.owner+'/'+input.repo,ref:branch,commit:commit.sha,path:path.join('/'),files:entries.map(({path,sha,size})=>({path,sha,size}))};
 return {preview,package:{zip_base64,source:input.url,github_source}};
}
