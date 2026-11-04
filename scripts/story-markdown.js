import {lexer} from 'marked';
// Tokenize Markdown but build only inert, allowlisted DOM nodes. Never render raw HTML.
export function renderStoryMarkdown(text){
 const root=document.createElement('div');root.className='story-markdown';
 function append(parent,tokens,depth=0){
  if(depth>40){parent.append(document.createTextNode(tokens.map(t=>t.raw||t.text||'').join('')));return;}
  for(const t of tokens){
   let tag;
   if(t.type==='space')continue;
   if(t.type==='hr'){parent.append(document.createElement('hr'));continue;}
   if(t.type==='br'){parent.append(document.createElement('br'));continue;}
   if(t.type==='list'){const list=document.createElement(t.ordered?'ol':'ul');if(t.ordered&&Number.isSafeInteger(t.start))list.start=t.start;for(const item of t.items){const li=document.createElement('li');append(li,item.tokens,depth+1);list.append(li);}parent.append(list);continue;}
   if(t.type==='code'){const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=t.text;pre.append(code);parent.append(pre);continue;}
   tag={paragraph:'p',blockquote:'blockquote',em:'em',strong:'strong',del:'s',codespan:'code'}[t.type];
   if(t.type==='heading')tag='h'+Math.max(3,Math.min(6,t.depth));
   if(tag){const n=document.createElement(tag);if(t.tokens)append(n,t.tokens,depth+1);else n.textContent=t.text||'';parent.append(n);continue;}
   if(t.tokens)append(parent,t.tokens,depth+1);
   else parent.append(document.createTextNode(t.type==='html'?t.raw:t.text||t.raw||''));
  }
 }
 append(root,lexer(text,{gfm:true,breaks:true}));return root;
}
