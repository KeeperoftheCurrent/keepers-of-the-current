import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {cleanStoryDocument,storyText} from '../shared/story-document.ts';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const children=n=>Array.from(n?.childNodes||[]).filter(x=>x.nodeType===1);
const child=(n,k)=>children(n).find(x=>x.localName===k);
const all=(n,k)=>Array.from(n?.getElementsByTagNameNS(W,k)||[]);
const attr=(n,k='val')=>n?.getAttributeNS(W,k)||'';
const val=(n,k)=>attr(child(n,k));
export async function formattedDocx(buffer){
 const zip=await JSZip.loadAsync(buffer);let expanded=0;
 async function xml(path){const file=zip.file(path);if(!file)return null;if(file._data?.uncompressedSize>8000000)throw new Error('This document is too complex. Try a smaller copy.');const text=await file.async('string');expanded+=text.length;if(expanded>12000000||/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('This document cannot be safely imported.');return new DOMParser().parseFromString(text,'application/xml');}
 const document=await xml('word/document.xml');if(!document)throw new Error('This is not a readable Word document.');
 const styles=await xml('word/styles.xml'),numbering=await xml('word/numbering.xml'),theme=await xml('word/theme/theme1.xml');
 const themeFonts={};if(theme){for(const kind of ['major','minor']){const n=Array.from(theme.getElementsByTagName('*')).find(n=>n.localName===kind+'Font');themeFonts[kind]=children(n).find(n=>n.localName==='latin')?.getAttribute('typeface');}}
 function runStyle(n){const out={};if(!n)return out;for(const[k,key]of[['b','bold'],['i','italic'],['strike','strike']])if(child(n,k))out[key]=!['0','false','off'].includes(val(n,k));if(child(n,'u'))out.underline=!['none','0','false'].includes(val(n,'u'));const font=child(n,'rFonts');const themeName=attr(font,'asciiTheme');const family=attr(font,'ascii')||attr(font,'hAnsi')||(themeName?themeFonts[themeName.startsWith('major')?'major':'minor']:null);if(family)out.font=family;if(val(n,'sz'))out.size=Number(val(n,'sz'))/2;for(const[k,key,a]of[['color','color','val'],['shd','background','fill']]){const c=attr(child(n,k),a);if(/^[0-9a-f]{6}$/i.test(c))out[key]='#'+c;}return out;}
 function paragraphStyle(n){const out={...runStyle(child(n,'rPr'))};const align=val(n,'jc');if(align)out.align=align==='both'?'justify':align;const spacing=child(n,'spacing');for(const k of ['before','after'])if(attr(spacing,k))out[k]=Number(attr(spacing,k))/20;if(attr(spacing,'line')&&(!attr(spacing,'lineRule')||attr(spacing,'lineRule')==='auto'))out.line=Number(attr(spacing,'line'))/240;const ind=child(n,'ind');if(attr(ind,'left'))out.indent=Number(attr(ind,'left'))/20;return out;}
 const map=new Map(all(styles,'style').map(n=>[attr(n,'styleId'),n]));
 function inherited(id,seen=new Set()){if(!id||seen.has(id))return {};seen.add(id);const n=map.get(id);return {...inherited(val(n,'basedOn'),seen),...paragraphStyle(child(n,'pPr')),...runStyle(child(n,'rPr'))};}
 const defaults={...runStyle(child(all(styles,'rPrDefault')[0],'rPr')),...paragraphStyle(child(all(styles,'pPrDefault')[0],'pPr'))};
 const normal=all(styles,'style').find(n=>attr(n,'type')==='paragraph'&&attr(n,'default')==='1');
 const counters=new Map();const warnings=new Set();
 if(all(document,'tbl').length)warnings.add('Tables are shown as paragraphs.');
 if(all(document,'drawing').length||all(document,'pict').length)warnings.add('Embedded pictures are not imported; upload your portrait separately.');
 const blocks=all(document,'p').filter(p=>!all(p,'p').length).map(p=>{
  const props=child(p,'pPr'),styleId=val(props,'pStyle');
  const style={...defaults,...inherited(attr(normal,'styleId')),...inherited(styleId),...paragraphStyle(props)};
  const headingName=val(map.get(styleId),'name');const heading=Number((styleId+' '+headingName).match(/heading\s*([1-6])/i)?.[1]||0);
  let marker='';const num=child(props,'numPr')||child(child(map.get(styleId),'pPr'),'numPr');
  if(num){const id=val(num,'numId'),level=Number(val(num,'ilvl')||0);const instance=all(numbering,'num').find(n=>attr(n,'numId')===id);const abstract=all(numbering,'abstractNum').find(n=>attr(n,'abstractNumId')===val(instance,'abstractNumId'));const lvl=children(abstract).find(n=>n.localName==='lvl'&&Number(attr(n,'ilvl'))===level);const key=id+':'+level;const count=(counters.get(key)??(Number(val(lvl,'start')||1)-1))+1;counters.set(key,count);for(let deeper=level+1;deeper<9;deeper++)counters.delete(id+':'+deeper);marker=val(lvl,'numFmt')==='bullet'?'• ':count+'. ';style.indent=Math.max(style.indent||0,level*18);if(!['bullet','decimal',''].includes(val(lvl,'numFmt')))warnings.add('Special list numbering is shown as standard numbers.');}
  const runs=all(p,'r').filter(r=>!r.parentNode?.localName?.includes('del')).map(r=>{
   const rp=child(r,'rPr');const rs={...inherited(val(rp,'rStyle')),...runStyle(rp)};
   const text=children(r).map(n=>n.localName==='t'?n.textContent:n.localName==='tab'?'\t':['br','cr'].includes(n.localName)?'\n':'').join('');return {text,style:rs};
  }).filter(r=>r.text);
  return {heading,marker,style,runs};
 });
 const result=cleanStoryDocument({version:1,blocks});return {document:result,text:storyText(result),warnings:[...warnings]};
}
