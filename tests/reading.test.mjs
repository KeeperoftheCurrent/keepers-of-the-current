import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import{parseHTML}from'linkedom';
const read=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const guides=JSON.parse(read('assets/data/trial-guides.json'));
test('all public journeys have skip links, optional reading preferences and a consistent navigation',()=>{
 for(const page of ['index','current','trials','rewards','seeker','lookup','tracker']){
  const{document:d}=parseHTML(read(page+'.html'));
  assert.ok(d.querySelector('main#main-content'));assert.ok(d.querySelector('a[href="#main-content"]'));
  assert.ok(d.querySelector('#larger-text'));assert.ok(d.querySelector('#light-background'));
  assert.equal(d.querySelectorAll('.site-nav>a').length,4);
  assert.ok(d.querySelector('link[href="/assets/css/reading.css"]'));
 }
});
test('all nine deep links retain original rules and web checklists match email source',()=>{
 const{document:d}=parseHTML(read('trials.html'));assert.equal(Object.keys(guides).length,9);
 for(const[id,g]of Object.entries(guides)){
  const section=d.getElementById(id);assert.equal(section.tagName,'DETAILS');assert.ok(!section.hasAttribute('open'));
  assert.ok(section.querySelector('.original-copy .tier-body').textContent.length>100);
  const copy=section.querySelector('.quick-guide').textContent;
  for(const item of [...g.prepare,...g.steps.flat(),g.finish])assert.ok(copy.includes(item),id+': '+item);
 }
 assert.equal(d.querySelectorAll('details[open]').length,0);
});
test('long lore is optional and the homepage has no screen-dependent redirect',()=>{
 const{document:d}=parseHTML(read('current.html'));assert.equal(d.querySelectorAll('details[open]').length,0);
 assert.equal(d.querySelectorAll('.read-section').length,6);
 assert.ok(!read('index.html').includes('window.location.replace'));
});
