import glob, os

BUILD = os.path.dirname(os.path.abspath(__file__))

css = open(os.path.join(BUILD, 'style.css')).read()
body = '\n'.join(
    open(f).read() for f in sorted(glob.glob(os.path.join(BUILD, 'parts', '*.html')))
)

html = f"<title>EverEcho \u2014 Chief of Staff Briefing</title>\n<style>\n{css}\n</style>\n{body}\n"
out = os.path.join(BUILD, 'document.html')
open(out, 'w').write(html)
print(f'wrote {out} ({len(html) / 1024:.0f} KB)')
