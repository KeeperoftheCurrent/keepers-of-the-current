import{renderProfile,emblem}from'./member-view.js?v=chapters';
const $=s=>document.querySelector(s),form=$('#character-form'),status=$('#editor-status');let revision=0,portrait='',portraitData='',cropImage,dirty=false,busy=false;
async function api(body){const r=await fetch('/api/members/editor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok){const e=new Error(d.error||'Please sign in again.');e.status=r.status;throw e;}return d;}
function values(){return Object.fromEntries(['name','introduction','story','current_role','hynafol_title','honours','affiliations','source'].map(k=>[k,form.elements[k].value.trim()]).concat([['portrait',portrait]]));}
try{const{member:m}=await api({action:'load'});revision=m.revision;portrait=m.draft.portrait||'';for(const[k,v]of Object.entries(m.draft))if(form.elements[k])form.elements[k].value=v;$('#portrait-preview').src=m.portrait_data||portrait||emblem;form.hidden=false;status.textContent=(m.submitted?'Your latest draft is awaiting the Keeper’s review.':m.has_published?'Your approved profile is public. You can prepare changes here.':'Your page is private until the Keeper approves it.')+(m.review_note?'\nFrom the Keeper: '+m.review_note:'');}catch(e){status.textContent=e.status===401?'Sign in to tend your character’s story.':e.message;if(e.status===401||e.status===403)$('#member-sign-in').hidden=false;}
form.addEventListener('input',()=>{dirty=true;});window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
function drawCrop(){if(!cropImage)return;const c=$('#crop-canvas'),ctx=c.getContext('2d');const zoom=Number($('#crop-zoom').value),scale=Math.max(c.width/cropImage.width,c.height/cropImage.height)*zoom;const w=cropImage.width*scale,h=cropImage.height*scale;ctx.fillStyle='#240b0c';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(cropImage,(c.width-w)*Number($('#crop-x').value)/100,(c.height-h)*Number($('#crop-y').value)/100,w,h);}
for(const id of ['crop-zoom','crop-x','crop-y'])$('#'+id).addEventListener('input',drawCrop);
$('#portrait-file').addEventListener('change',async()=>{const f=$('#portrait-file').files[0];if(!f)return;if(f.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(f.type)){status.textContent='Choose a JPEG, PNG or WebP photo under 10 MB.';return;}try{cropImage=await createImageBitmap(f);$('#crop-zoom').value='1';$('#crop-x').value='50';$('#crop-y').value='50';$('#crop-controls').hidden=false;drawCrop();status.textContent='Adjust your portrait, then choose “Use this crop”.';}catch{status.textContent='This photo could not be opened. Try a JPEG or PNG.';}});
$('#use-crop').addEventListener('click',()=>{let q=.86;do{portraitData=$('#crop-canvas').toDataURL('image/jpeg',q);q-=.1;}while(portraitData.length>260000&&q>.2);if(portraitData.length>260000){status.textContent='This portrait is too detailed to save. Try a smaller image.';return;}$('#portrait-preview').src=portraitData;$('#crop-controls').hidden=true;dirty=true;status.textContent='Portrait ready. Save your draft or submit it with your story.';});
$('#remove-portrait').addEventListener('click',()=>{portrait='';portraitData='';$('#portrait-preview').src=emblem;$('#crop-controls').hidden=true;dirty=true;});
$('#preview-profile').addEventListener('click',()=>{$('#preview-content').replaceChildren(renderProfile({...values(),portrait:$('#portrait-preview').src},true));$('#profile-preview').hidden=false;$('#profile-preview').scrollIntoView({behavior:'auto'});});
async function save(action){if(busy)return;if(!$('#crop-controls').hidden){status.textContent='Choose “Use this crop” before saving.';return;}if(action==='submit'&&!form.reportValidity())return;busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);try{const d=await api({action,revision,profile:values(),portrait_data:portraitData||undefined,consent:$('#publish-consent').checked});revision=d.revision;portrait=d.portrait;portraitData='';dirty=false;status.textContent=action==='submit'?'Your story is with the Keeper for approval. Your current published page is unchanged.':'Draft saved. Only you and the Keeper can see these changes.';status.scrollIntoView({behavior:'auto'});}catch(e){status.textContent=e.message;}finally{busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);}}
$('#save-profile').addEventListener('click',()=>save('save'));form.addEventListener('submit',e=>{e.preventDefault();save('submit');});
$('#withdraw-profile').addEventListener('click',async()=>{if(!confirm('Hide your published profile and cancel any pending review? Your saved draft will remain.'))return;try{await api({action:'withdraw'});status.textContent='Your profile is no longer public. You can submit it again when ready.';}catch(e){status.textContent=e.message;}});

// Documents are read locally, off the main thread. Only reviewed story text is saved.
let importWorker, importTimer, importedStory = '';
const importStatus = $('#story-import-status');
function stopImport() { clearTimeout(importTimer); importWorker?.terminate(); importWorker = undefined; }
function clearImport() { stopImport(); importedStory = ''; $('#story-import-review').hidden = true; $('#story-import-preview').value = ''; $('#story-file').value = ''; }
$('#story-file').addEventListener('change', () => {
 const file = $('#story-file').files[0];
 clearImport();
 if (!file) return;
 importStatus.textContent = 'Opening your document… Your current story is unchanged.';
 try {
  importWorker = new Worker('/assets/js/story-import-worker.js?v=1');
  const fail = message => { stopImport(); importStatus.textContent = message; };
  importWorker.onerror = () => fail('This document could not be opened. Try a Word (.docx) or text (.txt) copy, or paste your story below.');
  importWorker.onmessage = ({data}) => {
   stopImport();
   if (data.error) { importStatus.textContent = data.error; return; }
   importedStory = data.text;
   $('#story-import-preview').value = importedStory;
   $('#story-import-review').hidden = false;
   importStatus.textContent = `Your document is ready: ${importedStory.length.toLocaleString()} characters. Review it below, then choose “Use this text”.`;
  };
  importTimer = setTimeout(() => fail('This document took too long to open. Try a text (.txt) copy or paste your story below.'), 20000);
  importWorker.postMessage(file);
 } catch { stopImport(); importStatus.textContent = 'Document import is unavailable in this browser. You can still paste your story below.'; }
});
$('#cancel-story-import').addEventListener('click', () => { clearImport(); importStatus.textContent = 'Import cancelled. Your story is unchanged.'; });
$('#use-story-import').addEventListener('click', () => {
 if (!importedStory || busy) return;
 if (form.elements.story.value.trim() && !confirm('Replace the text currently in your backstory editor with this imported story? Your saved draft stays unchanged until you save.')) return;
 form.elements.story.value = importedStory;
 dirty = true;
 clearImport();
 importStatus.textContent = 'Your text is in the editor. Review it, add chapter headings if you wish, then save your draft or submit for approval.';
 form.elements.story.focus();
});
