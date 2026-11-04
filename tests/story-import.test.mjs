import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import JSZip from 'jszip';
const source=readFileSync(new URL('../public/assets/js/story-import-worker.js',import.meta.url),'utf8');
async function read(name,content,size){
 let result; const self={postMessage:data=>{result=data;}};
 const context=vm.createContext({self,Uint8Array,ArrayBuffer,TextDecoder,TextEncoder,setTimeout,clearTimeout,console});
 vm.runInContext(source,context);
 const bytes=typeof content==='string'?new TextEncoder().encode(content):content;
 await self.onmessage({data:{name,size:size??bytes.length,text:async()=>new TextDecoder().decode(bytes),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}});
 return result;
}
test('imports text, chapters and literal markup without HTML execution',async()=>{
 assert.equal((await read('story.TXT','\uFEFF## Chapter One\r\n\r\n<script>alert(1)</script>')).text,'## Chapter One\n\n<script>alert(1)</script>');
 assert.equal((await read('story.md','A'.repeat(500000))).text.length,500000);
});
test('rejects unsupported, oversized, empty and over-limit documents without partial text',async()=>{
 for(const [name,content,size] of [['story.pdf','hello'],['story.txt','hello',5242881],['story.txt',' '],['story.txt','A'.repeat(500001)],['bad.docx','bad zip']]){
  const result=await read(name,content,size);assert.ok(result.error);assert.equal(result.text,undefined);
 }
});
test('extracts Word paragraphs, Unicode and ignores embedded document styling',async()=>{
 const zip=new JSZip();
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Chapter One</w:t></w:r></w:p><w:p><w:r><w:t>Talia’s journey &amp; the Current.</w:t></w:r></w:p></w:body></w:document>');
 const result=await read('story.docx',await zip.generateAsync({type:'uint8array'}));
 assert.equal(result.text,'Chapter One\n\nTalia’s journey & the Current.');
});
