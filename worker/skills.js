// Read-only Skill metadata and ZIP handling. Uploaded declarations never grant tools.
import {problem} from './gateway.js';
const fail=message=>{throw problem(400,message)};
const fields=new Set(['name','display_name','display-name','title','description','version']);
const unique=items=>[...new Set(items)];
function scalar(raw,key){
 const value=raw.trim();if(/^[!&*\[{]/.test(value))fail('Skill 的 '+key+' 需要文本值，不能使用标签、锚点或对象');
 if(value.startsWith('"')){const end=value.match(/^"(?:[^"\\]|\\.)*"/);if(!end||!/^\s*(?:#.*)?$/.test(value.slice(end[0].length)))fail('Skill 的 '+key+' 双引号格式无效');try{return String(JSON.parse(end[0]))}catch{fail('Skill 的 '+key+' 转义格式无效')}}
 if(value.startsWith("'")){const end=value.match(/^'(?:[^']|'')*'/);if(!end||!/^\s*(?:#.*)?$/.test(value.slice(end[0].length)))fail('Skill 的 '+key+' 单引号格式无效');return end[0].slice(1,-1).replaceAll("''", "'")}
 const plain=value.replace(/\s+#.*$/,'').trim();return /^(?:null|~)$/i.test(plain)?'':plain;
}
function packageVersion(metadata){for(const value of Object.values(metadata||{})){if(value&&typeof value==='object'){const version=typeof value.version==='string'?value.version:typeof value.latest?.version==='string'?value.latest.version:null;if(version)return version}}return null;}
export function parseSkill(markdown,{metadata={}}={}){
 if(typeof markdown!=='string'||markdown.length>200000)fail('Skill 文件过大或格式无效');
 const raw=markdown.replace(/^\uFEFF/,''),m=raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);if(!m)fail('需要 YAML frontmatter 和 Markdown 规则正文');
 const header=m[1].replace(/\r\n/g,'\n').split('\n'),indent=Math.min(...header.filter(x=>x.trim()).map(x=>x.match(/^\s*/)[0].length));const lines=header.map(x=>x.slice(indent)),meta=Object.create(null),ignored=[];let auxiliary=false;
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(!line.trim()||line.trimStart().startsWith('#'))continue;
  if(/^\s/.test(line)||auxiliary&&/^-\s/.test(line))continue; // Nested auxiliary metadata is data, never executable configuration.
  const match=line.match(/^([a-zA-Z_][\w-]*):(?:\s+(.*)|\s*)$/);if(!match)fail('Skill 元数据格式无效：'+line.slice(0,80));
  const key=match[1],value=match[2]??'';auxiliary=!fields.has(key);if(auxiliary){ignored.push(key);continue}
  if(Object.hasOwn(meta,key))fail('Skill 元数据重复：'+key);
  if(/^[>|][+-]?(?:\s+#.*)?$/.test(value.trim())){
   const block=[];while(i+1<lines.length&&(!lines[i+1].trim()||/^\s/.test(lines[i+1])))block.push(lines[++i]);
   const nonempty=block.filter(x=>x.trim());const indent=nonempty.length?Math.min(...nonempty.map(x=>x.match(/^\s*/)[0].length)):0;
   const stripped=block.map(x=>x.slice(indent));meta[key]=value.trim().startsWith('>')?stripped.join(' ').replace(/\s+/g,' ').trim():stripped.join('\n').trim();
  }else meta[key]=scalar(value,key);
 }
 for(const key of ['name','description'])if(!meta[key]?.trim())fail('Skill 缺少：'+key);
 if(!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(meta.name))fail('name 只允许小写字母、数字、下划线和连字符');
 const warnings=[];const display=meta.display_name||meta['display-name']||meta.title||m[2].match(/^#\s+(.+)$/m)?.[1]?.trim()||meta.name;
 if(!meta.display_name&&!meta['display-name'])warnings.push('未提供 display_name，已使用标题或 name 作为显示名称');
 const fallbackVersion=packageVersion(metadata),version=meta.version||fallbackVersion||'1.0.0';
 if(!meta.version)warnings.push(fallbackVersion?'未提供 version，已读取包元数据中的版本 '+version:'未提供 version，已为工作台版本管理设置初始版本 1.0.0');
 if(!/^[\w.-]{1,60}$/.test(version))fail('Skill version 只支持 1–60 位字母、数字、点、下划线或连字符');
 if(display.length>300||meta.description.length>12000)fail('Skill 显示名称或描述过长');
 if(!m[2].trim())fail('规则正文不能为空');
 if(/(?:\]\(|`)(?:\.\.\/|\/(?:etc|Users|home|tmp)\/)|\bscripts\//i.test(m[2]))fail('Skill 正文引用了越界路径或 scripts/ 程序；工作台仅支持文本规则');
 if(ignored.length)warnings.push('已忽略辅助元数据：'+unique(ignored).join('、')+'；不会据此启用工具、命令或文件访问');
 const canonical='---\nname: '+meta.name+'\ndisplay_name: '+JSON.stringify(display)+'\ndescription: '+JSON.stringify(meta.description)+'\nversion: '+JSON.stringify(version)+'\n---\n'+m[2];
 return {name:meta.name,display_name:display,description:meta.description,version,body:m[2],markdown,canonical_markdown:canonical,warnings,ignored_metadata:unique(ignored)};
}
function safePath(name){
 if(!name||name.startsWith('/')||name.includes('\\')||name.includes(':')||/[\x00-\x1f\x7f]/.test(name)||name.split('/').some(x=>x==='..'||x==='.') )fail('ZIP 含不安全路径：'+name.slice(0,150));
}
const noise=name=>name.startsWith('__MACOSX/')||name.split('/').at(-1)==='.DS_Store'||name.split('/').at(-1).startsWith('._');
const metadataFile=name=>/(?:^|\/)(?:_meta|metadata|manifest|skill|package)\.json$/i.test(name)||/(?:^|\/)agents\/openai\.ya?ml$/i.test(name);
const textFile=name=>/\.(md|txt)$/i.test(name)||/(?:^|\/)(?:LICENSE|COPYING|NOTICE)(?:\.[\w-]+)?$/i.test(name);
export function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0;}
export async function unpackSkill(base64){
 if(typeof base64!=='string'||base64.length>1400000)fail('ZIP 编码无效或超过 1 MB');
 let bytes;try{bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0))}catch{fail('ZIP 编码无效')}
 if(bytes.length>1048576)fail('ZIP 最大 1 MB');if(bytes.length<22)fail('ZIP 目录无效');
 const dv=new DataView(bytes.buffer),decoder=new TextDecoder('utf-8',{fatal:true});const decode=(data,label)=>{try{return decoder.decode(data)}catch{fail(label+'不是有效 UTF-8 文本')}};
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(dv.getUint32(p,true)===0x06054b50&&p+22+dv.getUint16(p+20,true)===bytes.length){end=p;break}
 if(end<0)fail('ZIP 目录无效');const count=dv.getUint16(end+10,true),directory=dv.getUint32(end+16,true),directorySize=dv.getUint32(end+12,true);
 if(dv.getUint16(end+4,true)||dv.getUint16(end+6,true)||dv.getUint16(end+8,true)!==count)fail('不支持分卷 ZIP');
 if(count>256||count===65535)fail('ZIP 条目过多或使用了不支持的 ZIP64 格式');if(directory+directorySize>end)fail('ZIP 中央目录越界');
 let pos=directory,total=0;const entries=[],seen=new Set(),ignored=[];
 for(let i=0;i<count;i++){
  if(pos+46>directory+directorySize||dv.getUint32(pos,true)!==0x02014b50)fail('ZIP 中央目录损坏');
  const flag=dv.getUint16(pos+8,true),method=dv.getUint16(pos+10,true),crc=dv.getUint32(pos+16,true),size=dv.getUint32(pos+20,true),uncomp=dv.getUint32(pos+24,true),len=dv.getUint16(pos+28,true),extra=dv.getUint16(pos+30,true),comment=dv.getUint16(pos+32,true),attr=dv.getUint32(pos+38,true),offset=dv.getUint32(pos+42,true);
  if(pos+46+len+extra+comment>directory+directorySize)fail('ZIP 文件名或条目越界');
  const name=decode(bytes.slice(pos+46,pos+46+len),'ZIP 文件名');pos+=46+len+extra+comment;safePath(name);
  if(flag&1)fail('ZIP 含加密文件：'+name);if(((attr>>>16)&0xf000)===0xa000)fail('ZIP 不接受符号链接：'+name);
  if(seen.has(name.toLowerCase()))fail('ZIP 文件重复：'+name);seen.add(name.toLowerCase());
  if(noise(name)){ignored.push({path:name,reason:'系统附带文件'});continue}
  if(name.split('/').some(x=>x.startsWith('.')))fail('ZIP 含不支持的隐藏路径：'+name);
  if(name.endsWith('/'))continue;
  if(/(?:^|\/)scripts\//i.test(name)||/\.(?:py|js|mjs|cjs|ts|sh|bash|zsh|ps1|bat|cmd|exe|dll|so|dylib|wasm)$/i.test(name))fail('不支持的程序文件：'+name+'；当前工作台只导入文本规则，不运行 Skill 程序');
  const meta=metadataFile(name);if(!meta&&!textFile(name))fail('不支持的 Skill 附件：'+name+'；支持 Markdown/TXT、许可证和常见包元数据');
  total+=uncomp;if(entries.length>=32||uncomp>200000||total>500000||uncomp/Math.max(size,1)>100)fail('ZIP 文件数量、解压大小或压缩比超限');
  if(offset+30>directory||dv.getUint32(offset,true)!==0x04034b50)fail('ZIP 文件头损坏：'+name);
  const localLen=dv.getUint16(offset+26,true),localExtra=dv.getUint16(offset+28,true),start=offset+30+localLen+localExtra;
  if(start+size>directory)fail('ZIP 文件被截断：'+name);
  if(decode(bytes.slice(offset+30,offset+30+localLen),'ZIP 本地文件名')!==name||dv.getUint16(offset+6,true)!==flag||dv.getUint16(offset+8,true)!==method)fail('ZIP 文件头与目录不一致：'+name);
  if(!(flag&8)&&(dv.getUint32(offset+14,true)!==crc||dv.getUint32(offset+18,true)!==size||dv.getUint32(offset+22,true)!==uncomp))fail('ZIP 本地文件大小或校验值不一致：'+name);
  entries.push({name,method,crc,size,uncomp,start,meta});
 }
 if(pos!==directory+directorySize)fail('ZIP 中央目录长度不一致');
 const mains=entries.filter(x=>/(^|\/)SKILL\.md$/i.test(x.name));if(mains.length!==1)fail('ZIP 必须恰好包含一个 SKILL.md');
 const main=mains[0],root=main.name.slice(0,main.name.lastIndexOf('/')+1),files=Object.create(null),metadata=Object.create(null);
 for(const entry of entries){
  let out=bytes.slice(entry.start,entry.start+entry.size);
  if(entry.method===8){
   const reader=new Blob([out]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let n=0;
   try{while(true){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>entry.uncomp||n>200000){await reader.cancel();fail('ZIP 解压超限：'+entry.name)}chunks.push(r.value)}}catch(e){if(e.status)throw e;fail('ZIP 压缩数据损坏：'+entry.name)}
   out=new Uint8Array(n);let at=0;for(const chunk of chunks){out.set(chunk,at);at+=chunk.length}
  }else if(entry.method!==0)fail('ZIP 压缩格式不支持：'+entry.name);
  if(out.length!==entry.uncomp||crc32(out)!==entry.crc)fail('ZIP 内容校验失败：'+entry.name);
  const content=decode(out,entry.name);
  if(entry.meta){
   ignored.push({path:entry.name,reason:'包元数据，不作为模型规则或工具权限'});
   if(/\.json$/i.test(entry.name)){try{const value=JSON.parse(content);if(value&&typeof value==='object'&&!Array.isArray(value))metadata[entry.name]=value}catch{ignored.at(-1).reason='包元数据 JSON 无效，已忽略'}}
  }else if(root&&!entry.name.startsWith(root))ignored.push({path:entry.name,reason:'位于主 Skill 目录之外'});
  else files[entry.name.slice(root.length)]=content;
 }
 const mainName=main.name.slice(root.length),markdown=files[mainName];delete files[mainName];
 return {markdown,files,metadata,main_path:main.name,ignored_files:ignored};
}
export function validateSkillReferences(body,references={}){
 if(!references||typeof references!=='object'||Array.isArray(references))fail('Skill 参考文件格式无效');let total=0;const names=Object.keys(references);
 if(names.length>32)fail('Skill 参考文件最多 32 个');
 for(const [name,value]of Object.entries(references)){safePath(name);if(name.split('/').some(x=>x.startsWith('.'))||!textFile(name)||/(?:^|\/)scripts\//i.test(name)||typeof value!=='string'||value.length>200000)fail('Skill 参考文件路径、格式或大小无效：'+name);total+=value.length}
 if(total>500000)fail('Skill 参考文字总大小超限');
 const linked=[...body.matchAll(/\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^)]*)?\)/g)].map(m=>m[1].replace(/^<|>$/g,''));
 for(const link of linked){if(/^(?:https?:|mailto:)|^#/i.test(link))continue;let path;try{path=decodeURIComponent(link.split('#')[0]).replace(/^\.\//,'')}catch{fail('Skill 引用编码无效：'+link)}safePath(path);if(!names.some(x=>x===path||x.endsWith('/'+path)))fail('缺失 Skill 参考文件：'+path)}
}
export async function inspectSkill(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Skill 导入数据格式无效');
 const packed=input.zip_base64?await unpackSkill(input.zip_base64):null,markdown=packed?.markdown??input.markdown;
 const parsed=parseSkill(markdown,{metadata:packed?.metadata});validateSkillReferences(parsed.body,packed?.files||input.references||{});
 const warnings=unique([...parsed.warnings,...(packed?.ignored_files||[]).map(x=>'忽略 '+x.path+'：'+x.reason)]);
 const suggested_type=/humaniz|reduce[-_ ]ai|(?:去除|去|降低|降)\s*(?:文本中的)?\s*AI\s*(?:写作)?(?:味|痕迹)/i.test(parsed.name+' '+parsed.display_name+' '+parsed.description)?'humanize':/拆解|breakdown|decomposition/i.test(parsed.name+' '+parsed.display_name+' '+parsed.description)?'breakdown':'writing';
 return {suggested_type,parsed,markdown:parsed.canonical_markdown,source_markdown:markdown,references:packed?.files||input.references||{},import_info:{main_path:packed?.main_path||input.source||'SKILL.md',ignored_files:packed?.ignored_files||[],ignored_metadata:parsed.ignored_metadata,warnings,metadata:packed?.metadata||{}}};
}
