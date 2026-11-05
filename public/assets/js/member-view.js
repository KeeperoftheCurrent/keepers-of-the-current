import {renderStoryMarkdown} from './story-markdown.js?v=1';
import {renderStoryDocument} from './story-format.js?v=1';
export const emblem='/assets/img/keepers-crest-v4.png';
export function el(tag,text,cls){const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;}
export function renderProfile(p,full=false){
 const root=el('div',null,full?'member-profile':'member-card');const hero=el('div',null,full?'member-hero':'');const img=el('img');img.src=p.portrait||emblem;img.alt=p.portrait?`Portrait of ${p.name}`:'The Current’s emblem';img.width=640;img.height=640;img.loading='lazy';hero.append(img);const copy=el('div');copy.append(el(full?'h1':'h3',p.name));
 for(const [field,label] of [['current_role','Within the Current'],['hynafol_title','Across Hynafol'],['honours','Current honours']])if(p[field]){const t=el('p',null,'member-title');t.append(el('strong',label),document.createTextNode(p[field]));copy.append(t);}
 copy.append(el('p',p.introduction));if(full&&p.affiliations)copy.append(el('p','Affiliations: '+p.affiliations));hero.append(copy);root.append(hero);
 if(full&&p.story){
 const book=el('section',null,'story-book');book.append(el('p','The Book of '+p.name,'eyebrow'),el('h2','A life in chapters'));
 if(p.story_document){try{
 const doc=typeof p.story_document==='string'?JSON.parse(p.story_document):p.story_document;
 const controls=el('div',null,'actions');const expand=el('button','Open all chapters');expand.type='button';const close=el('button','Close all chapters');close.type='button';controls.append(expand,close);book.append(controls);
 let group=[],title='',count=0;
 function flush(){if(!group.length)return;if(title){const details=el('details',null,'story-chapter');details.open=count++===0;details.append(el('summary',title),renderStoryDocument({version:1,blocks:group}));book.append(details);}else book.append(renderStoryDocument({version:1,blocks:group}));group=[];}
 for(const original of doc.blocks){const text=original.runs.map(r=>r.text).join('');const numbered=/^\s*\d{1,2}\s*[·]\s+\S.{0,150}$/.test(text);const block=numbered&&!original.heading?{...original,heading:2}:original;if(block.heading){flush();title=text.trim();}if(!text.trim()&&group.length===1&&group[0].heading)continue;group.push(block);}flush();
 expand.addEventListener('click',()=>book.querySelectorAll('details').forEach(d=>d.open=true));close.addEventListener('click',()=>book.querySelectorAll('details').forEach(d=>d.open=false));
 if(!count)controls.remove();root.append(book);return root;
 }catch{/* Older stories remain readable as plain text. */}}
 const chapters=p.story.split(/^##\s+/m).filter(x=>x.trim());
 if(chapters.length>1||p.story.startsWith('## ')){
  const controls=el('div',null,'actions');const expand=el('button','Open all chapters');expand.type='button';const close=el('button','Close all chapters');close.type='button';controls.append(expand,close);book.append(controls);
  chapters.forEach((chapter,i)=>{const lines=chapter.trim().split('\n');const title=lines.shift();const details=el('details',null,'story-chapter');details.open=i===0;details.append(el('summary',`${String(i+1).padStart(2,'0')} · ${title}`));const content=el('div',null,'chapter-content');content.append(renderStoryMarkdown(lines.join('\n').trim()));details.append(content);book.append(details);});
  expand.addEventListener('click',()=>book.querySelectorAll('details').forEach(d=>d.open=true));close.addEventListener('click',()=>book.querySelectorAll('details').forEach(d=>d.open=false));
 }else{book.append(renderStoryMarkdown(p.story));}root.append(book);
 }

 if(!full){const link=el('a','Read their story →');link.href='/member.html?id='+encodeURIComponent(p.id);root.append(link);}return root;
}
