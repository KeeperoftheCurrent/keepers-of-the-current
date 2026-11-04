// Structured formatting only: no submitted HTML, CSS, links, or executable content.
export type Style = {font?:string;size?:number;color?:string;background?:string;bold?:boolean;italic?:boolean;underline?:boolean;strike?:boolean;align?:string;before?:number;after?:number;line?:number;indent?:number};
export type StoryDocument = {version:1;blocks:{heading:number;marker:string;style:Style;runs:{text:string;style:Style}[]}[]};
export function cleanStoryDocument(input:unknown):StoryDocument {
 const doc=input as StoryDocument;
 if(!doc||doc.version!==1||!Array.isArray(doc.blocks)||doc.blocks.length>20000)throw new Error('Invalid formatted story.');
 let total=0,runs=0;
 function style(input:Style):Style {
  const s:Style={};if(!input||typeof input!=='object')return s;
  if(typeof input.font==='string'&&/^[\p{L}\p{N} _-]{1,80}$/u.test(input.font))s.font=input.font;
  for(const key of ['color','background'] as const)if(typeof input[key]==='string'&&/^#[a-fA-F0-9]{6}$/.test(input[key]!))s[key]=input[key];
  for(const key of ['bold','italic','underline','strike'] as const)if(typeof input[key]==='boolean')s[key]=input[key];
  for(const [key,min,max] of [['size',6,96],['before',0,100],['after',0,100],['line',.8,4],['indent',0,120]] as const){const n=input[key];if(typeof n==='number'&&Number.isFinite(n))s[key]=Math.max(min,Math.min(max,n));}
  if(['left','right','center','justify'].includes(input.align||''))s.align=input.align;
  return s;
 }
 const blocks=doc.blocks.map(b=>{
  if(!b||!Array.isArray(b.runs))throw new Error('Invalid story paragraph.');
  const out=b.runs.map(r=>{if(!r||typeof r.text!=='string'||(total+=r.text.length)>500000||++runs>100000)throw new Error('Formatted story is too long.');return {text:r.text,style:style(r.style)};});
  return {heading:Number.isInteger(b.heading)&&b.heading>=1&&b.heading<=6?b.heading:0,marker:typeof b.marker==='string'?b.marker.slice(0,40):'',style:style(b.style),runs:out};
 });
 return {version:1,blocks};
}
export function storyText(doc:StoryDocument):string {return doc.blocks.map(b=>b.marker+b.runs.map(r=>r.text).join('')).join('\n\n').trim();}
