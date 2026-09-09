import re, sys

def section_pages(pdf_path):
    d = open(pdf_path, 'rb').read()

    # --- objects ---
    objs = {}
    for m in re.finditer(rb'(\d+)\s+0\s+obj\b', d):
        objs[int(m.group(1))] = m.end()

    def body(num, limit=4000):
        s = objs[num]
        e = d.find(b'endobj', s)
        return d[s:e if 0 < e < s + limit else s + limit]

    # --- catalog -> root Pages ---
    cat = re.search(rb'/Type\s*/Catalog\s*/Pages\s+(\d+)\s+0\s+R', d)
    root = int(cat.group(1))

    # --- walk the page tree in order ---
    order = []
    def walk(num):
        b = body(num, 8000)
        if b'/Type /Page\n' in b or re.search(rb'/Type\s*/Page[^s]', b):
            order.append(num); return
        kids = re.search(rb'/Kids\s*\[(.*?)\]', b, re.S)
        if not kids:
            order.append(num); return
        for k in re.findall(rb'(\d+)\s+0\s+R', kids.group(1)):
            walk(int(k))
    walk(root)
    index = {p: i + 1 for i, p in enumerate(order)}

    # --- named destinations ---
    dm = re.search(rb'/Dests\s+(\d+)\s+0\s+R', d)
    dests_body = body(int(dm.group(1)), 20000)
    out = {}
    for m in re.finditer(rb'/sec-(\d+)\s*\[\s*(\d+)\s+0\s+R', dests_body):
        out[int(m.group(1))] = index[int(m.group(2))]
    return len(order), out

if __name__ == '__main__':
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    total, pages = section_pages(
        os.path.join(here, '..', '..', 'EverEcho-Chief-of-Staff-Briefing.pdf')
    )
    print('total pages:', total)
    for k in sorted(pages):
        print(f'  section {k:2d} -> page {pages[k]}')
