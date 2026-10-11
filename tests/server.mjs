import http from 'node:http';
const colors = ['#e4bdaa', '#b9d5c9', '#afc7e7', '#e9d49d', '#cdbbdc', '#e5b8c8'];
function fixture(url) {
  if (url.pathname === '/motion') return `<!doctype html><html><head><meta charset="utf-8"><title>Sticky and reveal fixture</title><style>
*{box-sizing:border-box}body{margin:0;background:white}.spacer{height:900px}.columns{display:grid;grid-template-columns:1fr 1fr;align-items:start;height:2500px}
#panel{position:sticky;top:60px}#panel div{height:300px}.card{height:500px;background:#08f;opacity:0}.card.revealed{animation:reveal 900ms forwards}
@keyframes reveal{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}
</style></head><body><div class="spacer">Scroll down</div><main class="columns"><aside id="panel"><div style="background:#f00">Sticky heading</div><div style="background:#0f0">Code panel top</div><div style="background:#00f">Code panel middle</div><div style="background:#ff0">Code panel bottom</div></aside><section>${'<div class="card">Revealed content</div>'.repeat(5)}</section></main><footer style="height:50px;background:#234">End</footer><script>
window.scrollSteps=[];addEventListener('scroll',()=>scrollSteps.push(scrollY));
const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)e.target.classList.add('revealed')},{rootMargin:'0px 0px -'+Math.round(innerHeight*.4)+'px 0px'});for(const card of document.querySelectorAll('.card'))observer.observe(card);
</script></body></html>`;
  const count = Number(url.searchParams.get('sections') || 8);
  const infinite = url.pathname === '/infinite';
  const virtual = url.pathname === '/virtual';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Lazy capture fixture</title><style>*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:system-ui}header{position:fixed;top:0;left:0;width:100%;height:64px;background:#254d3f;color:white;z-index:10;padding:16px}section{height:500px;padding:110px 20px 20px;text-align:center}img{width:240px;height:120px;display:block;margin:0 auto;background:#ddd}h2{font-size:24px}#chat{position:fixed;bottom:16px;right:16px;background:#f00;color:white;padding:12px;z-index:15}footer{height:50px;background:#234}</style></head><body><header id="header">A sticky header · only once</header><main id="main"></main><footer id="sentinel">End of page</footer><div id="chat">CHAT</div><script>
const colors=${JSON.stringify(colors)};let count=0;
const observer=new IntersectionObserver(entries=>{for(const entry of entries){const img=entry.target;if(entry.isIntersecting&&!img.src){img.src=img.dataset.src;img.onload=()=>{img.dataset.loaded='yes'};}}});
function add(){let i=count++;let s=document.createElement('section');s.dataset.index=i;s.style.background=colors[i%colors.length];s.innerHTML='<img alt="Lazy image '+i+'" data-src="/image/'+i+'.svg${url.searchParams.has('broken') ? '?broken=1' : ''}"><h2>Section '+(i+1)+'</h2><p>Loaded when you scroll here.</p>';main.append(s);observer.observe(s.querySelector('img'));}
for(let i=0;i<${count};i++)add();
${infinite ? "new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))setTimeout(()=>{add();add()},400)}).observe(sentinel);" : ''}
${virtual ? "const nodes=[...document.querySelectorAll('section')];window.addEventListener('scroll',()=>{for(const s of nodes){const r=s.getBoundingClientRect();s.style.visibility=r.bottom<0||r.top>innerHeight?'hidden':'visible';}});" : ''}
</script></body></html>`;
}
http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/image/')) {
    if (url.searchParams.has('broken') && url.pathname.includes('/2.')) { response.writeHead(404); response.end(); return; }
    setTimeout(() => { response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#f36c38"/><circle cx="120" cy="60" r="32" fill="#f9f2d9"/></svg>'); }, 450);
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(fixture(url));
}).listen(4173, '127.0.0.1', () => console.log('Capture fixtures: http://127.0.0.1:4173'));
