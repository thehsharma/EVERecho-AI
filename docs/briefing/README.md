# The chief-of-staff briefing

`docs/EverEcho-Chief-of-Staff-Briefing.pdf` — 59 pages, A4, linked contents and
PDF bookmarks. The companion to the pitch-and-manual document: that one describes
the product, this one describes the path from a working build to a company.

## What is in it

| Part | Sections | What it covers |
|---|---|---|
| I — Where you actually are | 1–4 | The honest position, the arithmetic a $1B outcome requires, the five structural problems in this category, and the three assets that offset them |
| II — Getting online safely | 5–8 | The decisions only the founder can make, the eight-week engineering plan against the readiness blockers, the launch gate, and the first ten paying families |
| III — Building the business | 9–13 | Pricing, the channel question, growth within the product's own privacy constraints, the metrics that matter, and hiring order |
| IV — Money | 14–16 | Bootstrap versus raise, the fundraising narrative, and the staged path |
| V — Governance and risk | 17–19 | Binding the prohibitions so they survive a change of control, the risk register, and kill criteria |
| VI — Operating system | 20–22 | Weekly/monthly/quarterly cadence, the first thirty days, and every open decision |

## Evidence discipline

Every consequential claim carries a label — VERIFIED, INFERENCE, ASSUMPTION or
UNKNOWN — matching the discipline the build itself used. There are **no market
size figures, competitor funding amounts, growth statistics or customer
references** anywhere in the document, because none were verified; where such
research is needed, it appears as a named task with the question stated.

## Rebuilding it

```bash
python3 src/assemble.py     # concatenates src/parts/*.html -> document.html
node src/render.mjs         # document.html -> the PDF
python3 src/pagemap.py      # resolve real page numbers from the PDF's own
                            # named destinations, to correct the contents page
```

`src/parts/*.html` are concatenated in filename order. Section headings carry
`id="sec-N"` and the contents page links to them, which is what lets `pagemap.py`
read true page numbers back out of the rendered PDF rather than estimating them.
