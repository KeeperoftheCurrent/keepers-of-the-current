export const emblem='/assets/img/keepers-crest-v4.png';
export function el(tag,text,cls){const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;}
export function renderProfile(p,full=false){
 const root=el('div',null,full?'member-profile':'member-card');const hero=el('div',null,full?'member-hero':'');const img=el('img');img.src=p.portrait||emblem;img.alt=p.portrait?`Portrait of ${p.name}`:'The Current’s emblem';img.width=640;img.height=640;img.loading='lazy';hero.append(img);const copy=el('div');copy.append(el(full?'h1':'h3',p.name));
 for(const [field,label] of [['current_role','Within the Current'],['hynafol_title','Across Hynafol'],['honours','Current honours']])if(p[field]){const t=el('p',null,'member-title');t.append(el('strong',label),document.createTextNode(p[field]));copy.append(t);}
 copy.append(el('p',p.introduction));if(full&&p.affiliations)copy.append(el('p','Affiliations: '+p.affiliations));hero.append(copy);root.append(hero);
 if(full&&p.story){root.append(el('h2','Their story'),el('div',p.story,'member-backstory'));}
 if(full&&p.source){const source=el('a','Read the full source story ↗');source.href=p.source;source.target='_blank';source.rel='noopener noreferrer';root.append(source);}
 if(!full){const link=el('a','Read their story →');link.href='/member.html?id='+encodeURIComponent(p.id);root.append(link);}return root;
}
