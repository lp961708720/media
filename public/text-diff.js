// Bounded LCS with full-text fallback: comparison never truncates either manuscript.
function diffSequence(before,after,budget=250000){
 let start=0,endA=before.length,endB=after.length;
 while(start<endA&&start<endB&&before[start]===after[start])start++;
 while(endA>start&&endB>start&&before[endA-1]===after[endB-1]){endA--;endB--;}
 const a=before.slice(start,endA),b=after.slice(start,endB),parts=[];
 const append=(type,items)=>{if(items.length)parts.push({type,text:items.join('')});};
 append('same',before.slice(0,start));
 if(a.length&&b.length&&(a.length+1)*(b.length+1)<=budget){
  const width=b.length+1,rows=new Uint32Array((a.length+1)*width);
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)rows[i*width+j]=a[i]===b[j]?rows[(i+1)*width+j+1]+1:Math.max(rows[(i+1)*width+j],rows[i*width+j+1]);
  let i=0,j=0,type='',buffer=[];
  const push=(next,value)=>{if(type!==next){append(type,buffer);type=next;buffer=[];}buffer.push(value);};
  while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){push('same',a[i++]);j++;}else if(j<b.length&&(i===a.length||rows[i*width+j+1]>=rows[(i+1)*width+j]))push('add',b[j++]);else push('remove',a[i++]);}
  append(type,buffer);
 }else{append('remove',a);append('add',b);}
 append('same',before.slice(endA));return parts;
}
function diffLines(oldText,newText){
 const old=String(oldText??''),next=String(newText??'');
 if(old===next)return '<p class="field-hint">正文相同，没有文字修改。</p><pre class="diff-same">'+esc(old)+'</pre>';
 const lines=s=>s.match(/[^\n]*\n|[^\n]+$/g)||[];
 const parts=diffSequence(lines(old),lines(next)),html=[];
 for(let i=0;i<parts.length;){
  if(parts[i].type==='same'){html.push('<pre class="diff-same">'+esc(parts[i++].text)+'</pre>');continue;}
  let before='',after='';
  while(i<parts.length&&parts[i].type!=='same'){const p=parts[i++];if(p.type==='remove')before+=p.text;else after+=p.text;}
  const chars=diffSequence(Array.from(before),Array.from(after),400000);
  const column=(side)=>chars.filter(p=>p.type!==side).map(p=>p.type==='same'?esc(p.text):p.type==='remove'?'<del>'+esc(p.text)+'</del>':'<ins>'+esc(p.text)+'</ins>').join('');
  html.push('<div class="diff-pair"><section><small>修改前 · 删除标红</small><pre aria-label="修改前">'+column('add')+'</pre></section><section><small>修改后 · 新增标绿</small><pre aria-label="修改后">'+column('remove')+'</pre></section></div>');
 }
 return html.join('');
}
