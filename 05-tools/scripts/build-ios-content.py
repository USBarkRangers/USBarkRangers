#!/usr/bin/env python3
"""Rebuild bundled legal text from retained web documents; never rewrites policy terms."""
from html.parser import HTMLParser
from pathlib import Path
import re
ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / '01-code/ios/BarkRanger/Resources'
class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.body = False; self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag == 'body': self.body = True
        if self.body and tag in ('p','h1','h2','li','div','br'): self.parts.append('\n\n')
        if self.body and tag == 'a':
            url = dict(attrs).get('href','')
            if url.startswith(('https://','mailto:')): self.parts.append(url+' ')
    def handle_data(self, data):
        if self.body: self.parts.append(data)
    def handle_endtag(self, tag):
        if tag == 'body': self.body = False
for name in ('privacy','terms'):
    parser = Text(); parser.feed((ROOT / f'01-code/app/pages/{name}.html').read_text())
    text = re.sub(r'[ \t]+',' ', ''.join(parser.parts))
    text = re.sub(r'\n\s*\n', '\n\n',text).strip()
    prefix = 'Retained web-service document. Native privacy disclosures will be reviewed before release.\n\n'
    (DEST / f'{name}.txt').write_text(prefix+text+'\n')

# A solid, opaque tile is generated locally. No map-provider imagery is downloaded.
import struct, zlib
w = h = 256
def chunk(kind, data):
    return struct.pack('>I',len(data)) + kind + data + struct.pack('>I',zlib.crc32(kind+data))
pixels = b''.join(b'\0' + bytes((214,232,240))*w for _ in range(h))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR',struct.pack('>2I5B',w,h,8,2,0,0,0)) + chunk(b'IDAT',zlib.compress(pixels)) + chunk(b'IEND',b'')
(DEST / 'offline-tile.png').write_bytes(png)

import json
class Links(HTMLParser):
    def __init__(self):
        super().__init__(); self.items=[]; self.link=None; self.title=[]
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if tag=='a' and attrs.get('href','').startswith('https://'):
            self.link=attrs['href']; self.title=[attrs.get('aria-label','')]
    def handle_data(self,data):
        if self.link: self.title.append(data)
    def handle_endtag(self,tag):
        if tag=='a' and self.link:
            title=' '.join(' '.join(self.title).split())
            if title: self.items.append({'title':title,'url':self.link})
            self.link=None
html=(ROOT / '01-code/app/index.v145.html').read_text()
section=html[html.index('<h3>Official B.A.R.K. Swag</h3>'):html.index('<h3>Official B.A.R.K. Swag</h3>')+7000]
links=Links(); links.feed(section)
approved=('ebay.com','usbarkrangers.com','alltrails.com','facebook.com','instagram.com','youtube.com')
from urllib.parse import urlparse
items=[item for item in links.items if any(urlparse(item['url']).hostname in (host,'www.'+host) for host in approved)]
(DEST / 'community-links.json').write_text(json.dumps(items,indent=2)+'\n')
