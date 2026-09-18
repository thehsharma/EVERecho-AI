export type KeepsakeStory = {
  id: string;
  title: string;
  body: string;
  date: string | null;
  place: string | null;
  sources: string[];
};
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function renderKeepsake(title: string, dedication: string, stories: KeepsakeStory[]) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; style-src &apos;unsafe-inline&apos;"><title>' +
    escape(title) +
    '</title><style>body{font:18px/1.7 Georgia,serif;color:#292724;max-width:780px;margin:60px auto;padding:24px}h1{font-size:40px;line-height:1.2}h2{font-size:28px}article{margin:48px 0;border-top:1px solid #bbb;padding-top:24px;break-inside:avoid}.story{white-space:pre-wrap}.note{font:14px/1.6 sans-serif;color:#555}@media print{body{margin:0;padding:0;font-size:12pt}h1{font-size:28pt}article{break-before:auto}}@page{margin:20mm}</style></head><body><h1>' +
    escape(title) +
    '</h1><p class="story">' +
    escape(dedication) +
    '</p><p class="note">A private collection of approved archive stories. These are recorded accounts, not independently verified facts. No imagined memorial dialogue is included. Keep and share this copy in accordance with the storyteller’s permission.</p>' +
    stories
      .map(
        (s) =>
          '<article><h2>' +
          escape(s.title) +
          '</h2><p class="note">' +
          escape([s.date, s.place].filter(Boolean).join(' · ')) +
          '</p><div class="story">' +
          escape(s.body) +
          '</div><p class="note">Sources: ' +
          escape(
            s.sources.length
              ? s.sources.join('; ')
              : 'Storyteller-approved account; no attached original file.',
          ) +
          '</p><p class="note">Archive story reference: ' +
          escape(s.id) +
          '</p></article>',
      )
      .join('') +
    '<p class="note">This readable keepsake contains text and source references. It does not include original audio or replace a full archive backup. Use your browser’s Print command to save a PDF.</p></body></html>'
  );
}
