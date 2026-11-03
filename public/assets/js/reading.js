// Optional preferences never affect trial eligibility, bookings, or progress.
for (const [id, attr] of [['larger-text','data-large-text'],['light-background','data-light']]) {
 const input=document.getElementById(id);
 let enabled=false;try{enabled=localStorage.getItem('keeper-'+id)==='true';}catch{}
 document.documentElement.toggleAttribute(attr,enabled);
 if(input){input.checked=enabled;input.addEventListener('change',()=>{document.documentElement.toggleAttribute(attr,input.checked);try{localStorage.setItem('keeper-'+id,String(input.checked));}catch{}});}
}
function revealTarget(){
 let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}if(!id)return;
 const target=document.getElementById(id);if(!target)return;
 let node=target;while(node){if(node.tagName==='DETAILS')node.open=true;node=node.parentElement;}
 target.scrollIntoView({block:'start'});
}
window.addEventListener('hashchange',revealTarget);revealTarget();
