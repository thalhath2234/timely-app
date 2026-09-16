"""Build a portable, searchable screenshot gallery from the capture manifest."""
import html
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
items = sorted(json.loads((ROOT / 'manifest.json').read_text()), key=lambda x: x['id'])
cards = []
for item in items:
    title = item['id'].replace('-', ' ')
    path = item['file']
    if not (ROOT / path).is_file():
        raise SystemExit(f'Missing screenshot: {path}')
    data = (ROOT / path).read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit(f'Invalid PNG: {path}')
    width, height = struct.unpack('>II', data[16:24])
    item['imageDimensions'] = {'width': width, 'height': height}
    item['sha256'] = hashlib.sha256(data).hexdigest()
    cards.append(f'''<article data-search="{html.escape(title + ' ' + item['url'])}"><a href="{html.escape(path)}" target="_blank"><img loading="lazy" src="{html.escape(path)}" alt="{html.escape(title)}"></a><h2>{html.escape(title)}</h2><p>{html.escape(item['url'])}</p><a href="{html.escape(path)}" download>Download PNG</a></article>''')
page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Timely screenshot audit</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f6fa;color:#172033;font:15px system-ui,sans-serif}header{padding:24px 32px;background:white;border-bottom:1px solid #d9deea;position:sticky;top:0;z-index:1}h1{margin:0 0 8px;font-size:25px}header p{margin:6px 0 12px;color:#566079}input{width:min(650px,100%);padding:12px;border:1px solid #aab4c8;border-radius:8px;font:inherit}main{padding:24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:20px}article{background:white;border:1px solid #d9deea;border-radius:10px;overflow:hidden;padding-bottom:14px}img{width:100%;height:240px;object-fit:contain;background:#e8eaf0;border-bottom:1px solid #d9deea}h2{font-size:14px;margin:12px 14px 6px}article p{font-size:12px;color:#647087;word-break:break-all;margin:0 14px 10px}a{color:#493bca}article>a:last-child{margin:14px;font-size:13px}[hidden]{display:none}nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}button{border:1px solid #c9cfe0;border-radius:6px;background:white;padding:5px 9px;cursor:pointer}#count{margin-left:12px;color:#566079}</style><header><h1>Timely — screenshot audit</h1><p>Real app captures · September 15, 2026 · Web and Electron. Click any image for the full-resolution PNG. <a href="../Audit.Md">Read the audit</a>.</p><label for="search">Filter screenshots </label><input id="search" type="search" placeholder="Try task, dark, desktop min, editor, settings, component…"><span id="count"></span><nav>''' + ''.join(f'<button data-filter="{x}">{x or "All"}</button>' for x in ['', 'task', 'calendar', 'project', 'document', 'sheet', 'settings', 'dark', 'desktop min', 'electron', 'component', 'error']) + '</nav></header><main>' + '\n'.join(cards) + '''</main><script>const input=document.querySelector('#search');function filter(){let n=0;document.querySelectorAll('article').forEach(a=>{a.hidden=!a.dataset.search.toLowerCase().includes(input.value.toLowerCase());if(!a.hidden)n++});document.querySelector('#count').textContent=n+' screenshots'}input.addEventListener('input',filter);document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{input.value=b.dataset.filter;filter()});filter();</script></html>'''
(ROOT / 'index.html').write_text(page)
(ROOT / 'manifest.json').write_text(json.dumps(items, indent=2) + '\n')
print(f'Indexed {len(items)} screenshots')
