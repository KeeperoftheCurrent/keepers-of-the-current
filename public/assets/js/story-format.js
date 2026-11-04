// Render a constrained data model using DOM/text APIs, never submitted HTML.
export function renderStoryDocument(serialized){
 const doc=typeof serialized==='string'?JSON.parse(serialized):serialized;
 const root=document.createElement('div');root.className='formatted-story';
 function apply(node,s={}){
  if(typeof s.font==='string'&&/^[\p{L}\p{N} _-]{1,80}$/u.test(s.font))node.style.fontFamily=`"${s.font}", Georgia, serif`;
  if(Number.isFinite(s.size))node.style.fontSize=`${Math.max(6,Math.min(96,s.size))/12}rem`;
  for(const [key,css]of [['color','color'],['background','backgroundColor']])if(/^#[a-f0-9]{6}$/i.test(s[key]||''))node.style[css]=s[key];
  if(typeof s.bold==='boolean')node.style.fontWeight=s.bold?'700':'400';
  if(typeof s.italic==='boolean')node.style.fontStyle=s.italic?'italic':'normal';
  if(s.underline||s.strike)node.style.textDecoration=[s.underline?'underline':'',s.strike?'line-through':''].filter(Boolean).join(' ');
  if(['left','right','center','justify'].includes(s.align))node.style.textAlign=s.align;
  for(const [key,css]of [['before','marginTop'],['after','marginBottom'],['indent','paddingLeft']])if(Number.isFinite(s[key]))node.style[css]=`${Math.max(0,Math.min(100,s[key]))/12}rem`;
  if(Number.isFinite(s.line))node.style.lineHeight=String(Math.max(.8,Math.min(4,s.line)));
 }
 for(const block of doc.blocks||[]){
  const p=document.createElement(block.heading>=1&&block.heading<=6?'h'+block.heading:'p');apply(p,block.style);
  if(block.marker)p.append(document.createTextNode(block.marker));
  for(const run of block.runs||[]){const span=document.createElement('span');span.textContent=run.text;apply(span,run.style);p.append(span);}
  if(!p.textContent)p.append(document.createElement('br'));
  root.append(p);
 }
 return root;
}
