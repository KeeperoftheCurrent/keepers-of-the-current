import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {renderProfile} from '../public/assets/js/member-view.js';
import {renderStoryMarkdown} from '../public/assets/js/story-markdown.js';
function withDOM(fn){const previous=globalThis.document;globalThis.document=parseHTML('<html><body></body></html>').document;try{fn();}finally{globalThis.document=previous;}}
test('existing chapter stories render Markdown italics, paragraphs, single breaks and scene dividers without rewriting stored stories',()=>withDOM(()=>{
 const story='## Chapter One\n\n*An italic opening.*\n\nFirst line\nSecond line\n\n* * *\n\nAn **important** word and _another italic_.\n\n## Chapter Two\n\nNext chapter.';
 const p={name:'Example',introduction:'A test.',story};const n=renderProfile(p,true);
 assert.equal(n.querySelectorAll('.story-chapter').length,2);assert.equal(n.querySelectorAll('em').length,2);assert.equal(n.querySelector('em').textContent,'An italic opening.');assert.equal(n.querySelectorAll('br').length,1);assert.equal(n.querySelectorAll('hr').length,1);assert.equal(n.querySelector('strong').textContent,'important');assert.equal(p.story,story);
}));
test('non-chapter stories use the same formatting and unsafe HTML stays literal',()=>withDOM(()=>{
 const n=renderStoryMarkdown('*Safe italics*\nnext line\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[link](javascript:alert(1))');
 assert.equal(n.querySelectorAll('script,img,a').length,0);assert.equal(n.querySelector('em').textContent,'Safe italics');assert.equal(n.querySelectorAll('br').length,1);assert.ok(n.textContent.includes('<script>'));
 const p=renderProfile({name:'Example',story:'*Italics*\nAnother line'},true);assert.equal(p.querySelector('em').textContent,'Italics');
}));
