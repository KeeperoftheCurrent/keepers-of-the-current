// Rebuild the visible web checklists from the same data imported by email.ts.
import {readFile,writeFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
const root=new URL('../',import.meta.url);
const guides=JSON.parse(await readFile(new URL('public/assets/data/trial-guides.json',root),'utf8'));
const file=new URL('public/trials.html',root), {document}=parseHTML(await readFile(file,'utf8'));
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=a=>'<ul>'+a.map(x=>'<li>'+escape(x)+'</li>').join('')+'</ul>';
for(const[id,g]of Object.entries(guides)){
 const section=document.getElementById(id);if(!section)throw Error('Missing trial '+id);
 section.querySelector('.quick-guide').innerHTML=`<h3>Before you start</h3>${list(g.prepare)}${g.steps.map(([title,...items])=>`<h3>${escape(title)}</h3>${list(items)}`).join('')}<p><strong>Finish:</strong> ${escape(g.finish)}</p><p><a href="/seeker.html">Add trials to my plan →</a></p>`;
}
await writeFile(file,document.toString());
