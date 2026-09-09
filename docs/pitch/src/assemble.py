import base64, glob, os, re, sys

BUILD = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.environ.get('EVERECHO_SHOTS', './screenshots')

css = open(os.path.join(BUILD, 'style.css')).read()

body = []
for p in sorted(glob.glob(os.path.join(BUILD, 'parts', '*.html'))):
    body.append(open(p).read())
body = '\n'.join(body)

# Replace {{IMG:name}} with base64 data URIs
missing = []
def sub(m):
    name = m.group(1)
    path = os.path.join(SHOTS, name)
    if not os.path.exists(path):
        missing.append(name)
        return f'<!-- MISSING {name} -->'
    data = base64.b64encode(open(path, 'rb').read()).decode()
    return f'<img src="data:image/png;base64,{data}" alt="{name}">'

body, n = re.subn(r'\{\{IMG:([^}]+)\}\}', sub, body)
if missing:
    print('MISSING IMAGES:', missing); sys.exit(1)

html = f"""<title>EverEcho v0.1 — Pitch and Manual</title>
<style>
{css}
</style>
{body}
"""

out = os.path.join(BUILD, 'document.html')
open(out, 'w').write(html)
print(f'embedded {n} images; wrote {out} ({len(html)/1024/1024:.1f} MB)')
