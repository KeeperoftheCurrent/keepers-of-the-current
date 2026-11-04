import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import JSZip from 'jszip';
const source=readFileSync(new URL('../public/assets/js/story-import-worker.js',import.meta.url),'utf8');
async function read(name,content,size){
 let result; const self={setImmediate,clearImmediate,importScripts(){},postMessage:data=>{result=data;}};
 const context=vm.createContext({self,Uint8Array,ArrayBuffer,TextDecoder,TextEncoder,setTimeout,clearTimeout,setImmediate,clearImmediate,console});
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
test('extracts Word paragraphs, Unicode and retains readable paragraphs',async()=>{
 const zip=new JSZip();
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Chapter One</w:t></w:r></w:p><w:p><w:r><w:t>Talia’s journey &amp; the Current.</w:t></w:r></w:p></w:body></w:document>');
 const result=await read('story.docx',await zip.generateAsync({type:'uint8array'}));
 assert.equal(result.text,'Chapter One\n\nTalia’s journey & the Current.');
});

test('Word fonts, style inheritance, headings, colours, alignment, emphasis and lists survive import',async()=>{
 const zip=new JSZip();const wrap=body=>`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
 zip.file('word/styles.xml','<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:rFonts w:ascii="Garamond"/><w:sz w:val="28"/></w:rPr></w:style><w:style w:styleId="Heading1"><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style></w:styles>');
 zip.file('word/numbering.xml','<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>');
 zip.file('word/document.xml',wrap('<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:i/><w:u/><w:color w:val="800020"/></w:rPr><w:t>The Beginning</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Remember</w:t></w:r></w:p>'));
 const r=await read('styled.docx',await zip.generateAsync({type:'uint8array'}));assert.ok(!r.error,r.error);
 const [heading,list]=r.document.blocks;
 assert.equal(heading.style.font,'Garamond');assert.equal(heading.style.size,14);assert.equal(heading.style.bold,true);assert.equal(heading.style.align,'center');assert.equal(heading.heading,1);
 assert.equal(heading.runs[0].style.italic,true);assert.equal(heading.runs[0].style.underline,true);assert.equal(heading.runs[0].style.color,'#800020');assert.equal(list.marker,'• ');
 assert.equal(r.text,'The Beginning\n\n• Remember');
});

test('public renderer applies formatting without interpreting story text or styles as HTML',async()=>{
 const {parseHTML}=await import('linkedom');const {document}=parseHTML('<html><body></body></html>');
 const previous=globalThis.document;globalThis.document=document;
 try{
  const {renderStoryDocument}=await import('../public/assets/js/story-format.js');
  const node=renderStoryDocument({version:1,blocks:[{heading:2,marker:'',style:{font:'Garamond',align:'center'},runs:[{text:'<img src=x onerror=alert(1)>',style:{bold:true,color:'#800020',background:'url(evil)'}}]}]});
  assert.equal(node.querySelectorAll('img,script').length,0);assert.equal(node.querySelector('h2').style.textAlign,'center');assert.equal(node.querySelector('span').style.fontWeight,'700');assert.equal(node.querySelector('span').style.backgroundColor,'');assert.ok(node.textContent.includes('<img'));
 }finally{globalThis.document=previous;}
});
