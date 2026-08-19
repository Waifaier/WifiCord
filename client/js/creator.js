(function(){
'use strict';
const $=id=>document.getElementById(id);
async function activate(){
  const input=$('creator-code-input'),status=$('creator-code-status'),btn=$('creator-code-submit');
  if(!input)return;
  const code=input.value.trim();
  if(!code){status.textContent='Digite um código.';return;}
  btn.disabled=true;status.textContent='Verificando…';
  try{
    const r=await fetch('/api/auth/creator-code',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(d.error||'Criador inválido.');
    status.textContent='Benefício ativado com sucesso.';
    window.App?.handleProfileUpdate?.({user:d.user});
    input.value='';
    window.App?.toast?.('Benefício ativado.','success');
  }catch(e){status.textContent=e.message||'Criador inválido.';window.App?.toast?.(status.textContent,'error');}
  finally{btn.disabled=false;}
}
function bind(){
  $('creator-code-submit')?.addEventListener('click',activate);
  $('creator-code-input')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();activate();}});
}
document.addEventListener('DOMContentLoaded',bind);
})();
