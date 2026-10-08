const fallback={contractAddress:null,chainId:1,links:{},tokenomics:{},siteUrl:null};
let config=fallback;
try {const r=await fetch('./site-config.json');if(r.ok)config={...fallback,...await r.json()}}catch{console.warn('Using pending launch configuration.')}
const validAddress=config.chainId===1 && /^0x[0-9a-fA-F]{40}$/.test(config.contractAddress||'') && !/^0x0{40}$/i.test(config.contractAddress||'');
const https=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:null}catch{return null}};
for(const node of document.querySelectorAll('[data-token-name]'))node.textContent=config.name||node.textContent;
for(const node of document.querySelectorAll('[data-token-ticker]'))node.textContent='$'+(config.ticker||node.textContent.replace('$',''));
for(const node of document.querySelectorAll('[data-contract]'))node.textContent=validAddress?config.contractAddress:'Contract coming soon';
for(const node of document.querySelectorAll('[data-tokenomics]'))node.textContent=String(config.tokenomics?.[node.dataset.tokenomics]??'To be announced');
const links={...(config.links||{}),explorer:validAddress?'https://etherscan.io/token/'+config.contractAddress:null};
for(const node of document.querySelectorAll('[data-link]')){
  const key=node.dataset.link;
  const url=https(links[key]);
  const ready=url && (key!=='buy'||validAddress);
  if(ready){node.href=url;node.target='_blank';node.rel='noopener noreferrer';node.removeAttribute('aria-disabled');node.removeAttribute('tabindex');if(node.dataset.readyLabel)node.textContent=node.dataset.readyLabel;}
  else{node.removeAttribute('href');node.setAttribute('aria-disabled','true');node.setAttribute('tabindex','-1');if(node.dataset.pendingLabel)node.textContent=node.dataset.pendingLabel;}
}
const copy=document.querySelector('[data-copy]');
if(copy){copy.disabled=!validAddress;copy.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(config.contractAddress);document.querySelector('[data-copy-status]').textContent='Contract address copied.';copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy address',1800)}
  catch{document.querySelector('[data-copy-status]').textContent='Select the address above to copy it.'}
})}
const toggle=document.querySelector('[data-menu-toggle]');const nav=document.querySelector('[data-navigation]');
const closeMenu=()=>{if(toggle&&nav){toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open navigation');nav.classList.remove('is-open')}};
toggle?.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');nav.classList.toggle('is-open',open)});
nav?.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});
const refresh=document.querySelector('[data-caption-button]');const caption=document.querySelector('[data-caption]');
let captionIndex=0;const captions=JSON.parse(document.querySelector('[data-captions]')?.textContent||'[]');
refresh?.addEventListener('click',()=>{captionIndex=(captionIndex+1)%captions.length;if(caption)caption.textContent=captions[captionIndex]||''});
if(config.siteUrl && https(config.siteUrl)){
  const base=https(config.siteUrl);const canonical=document.createElement('link');canonical.rel='canonical';canonical.href=base;document.head.append(canonical);
  for(const node of document.querySelectorAll('meta[property="og:image"]'))node.content=new URL('assets/banner.png',base).href;
}
