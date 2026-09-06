/**
 * The archive, browsable with EverEcho switched off forever.
 *
 * One file, no server, no build, no network. Double-click it and it opens: the
 * memories, the claims made from them, and for every claim the exact place in
 * the original recording it came from, with a play button that seeks there.
 *
 * Three constraints shaped it, and each is the reason for something that looks
 * odd otherwise.
 *
 * The data is embedded rather than fetched, because a browser opening a file://
 * page refuses to read the JSON sitting next to it. Fetching would have been
 * tidier and would have failed on the one machine that matters — a family
 * member's, years from now, with no idea what a local server is.
 *
 * Audio is a range of the original file, never a cut of it: the player seeks to
 * the start and stops at the end. This is the same rule the product enforces in
 * its own type system, and it has to survive the export, or the export quietly
 * relaxes the guarantee the archive was built on.
 *
 * And nothing here can produce a sentence the person did not say. There is no
 * text field in this file that is not either the interface's own words or a
 * verbatim quotation, because a browser is exactly where somebody would be
 * tempted to add a summary.
 */

export interface IndexData {
  subject: string;
  archiveName: string;
  exportedAt: string;
  producedBy: string;
  originalsIncluded: boolean;
  memories: {
    id: string;
    title: string;
    body: string;
    occurredOn: string | null;
    topics: string[];
    claims: {
      id: string;
      text: string;
      evidence: {
        sourceId: string | null;
        quotedText: string | null;
        locator: Record<string, unknown> | null;
      }[];
    }[];
  }[];
  sources: Record<string, { filename: string; mime: string; kind: string; path: string | null }>;
  segments: Record<
    string,
    { sourceId: string; idx: number; startMs: number | null; endMs: number | null; text: string }
  >;
}

/**
 * `</script>` inside a memory would end the block early, so `<` is escaped.
 * `<` is valid JSON, so the parser is unaffected.
 */
function embed(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function buildIndexHtml(data: IndexData): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.subject)} — archive</title>
<style>
  :root { color-scheme: light dark; --ink: #1c1917; --muted: #57534e; --line: #e7e5e4;
          --paper: #fafaf9; --card: #fff; --accent: #7c2d12; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #f5f5f4; --muted: #a8a29e; --line: #292524;
            --paper: #1c1917; --card: #262322; --accent: #fdba74; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); line-height: 1.55;
         font-family: ui-serif, Georgia, "Times New Roman", serif; }
  header { padding: 2rem 1.5rem 1.25rem; border-bottom: 1px solid var(--line); }
  h1 { margin: 0 0 .25rem; font-size: 1.55rem; }
  .layout { display: grid; grid-template-columns: minmax(200px, 300px) 1fr; gap: 0;
            align-items: start; }
  @media (max-width: 780px) { .layout { grid-template-columns: 1fr; } nav { border-right: 0; } }
  nav { border-right: 1px solid var(--line); padding: 1rem .75rem 3rem; position: sticky; top: 0;
        max-height: 100vh; overflow-y: auto; }
  nav button { display: block; width: 100%; text-align: left; background: none; border: 0;
               padding: .55rem .7rem; border-radius: 6px; cursor: pointer; color: inherit;
               font: inherit; font-size: .95rem; }
  nav button:hover { background: var(--line); }
  nav button[aria-current="true"] { background: var(--line); font-weight: 700; }
  main { padding: 1.75rem 1.75rem 5rem; max-width: 46rem; }
  .muted { color: var(--muted); }
  .small { font-size: .85rem; }
  blockquote { margin: .5rem 0; padding-left: .9rem; border-left: 3px solid var(--accent);
               font-style: italic; }
  .claim { border-top: 1px solid var(--line); padding: .9rem 0; }
  details > summary { cursor: pointer; color: var(--accent); font-size: .85rem;
                      font-family: ui-sans-serif, system-ui, sans-serif; }
  .cite { margin-top: .6rem; padding: .75rem; background: var(--card);
          border: 1px solid var(--line); border-radius: 8px; }
  .row { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; margin-top: .5rem; }
  button.play { font: inherit; font-family: ui-sans-serif, system-ui, sans-serif; font-size: .85rem;
                padding: .35rem .8rem; border-radius: 999px; border: 1px solid var(--accent);
                background: none; color: var(--accent); cursor: pointer; }
  footer { border-top: 1px solid var(--line); padding: 1.5rem 1.75rem 3rem; max-width: 46rem;
           font-family: ui-sans-serif, system-ui, sans-serif; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(data.archiveName)}</h1>
  <p class="muted small" style="margin:0">
    ${escapeHtml(data.subject)}'s own recordings and documents. Exported
    ${escapeHtml(new Date(data.exportedAt).toDateString())} from ${escapeHtml(data.producedBy)}.
    This page needs nothing but the browser you are reading it in.
  </p>
</header>

<div class="layout">
  <nav id="nav" aria-label="Memories"></nav>
  <main id="main"></main>
</div>

<footer class="muted small">
  <p><strong>What this is, and what it is not.</strong></p>
  <p>
    Every quotation on this page is something ${escapeHtml(data.subject)} actually said or wrote,
    and every one names the recording or document it came from. Nothing here was generated,
    summarised or inferred, and nothing on this page can speak as ${escapeHtml(data.subject)} —
    there is no code in this file capable of it.
  </p>
  <p>
    Audio plays a range of the original file. Nothing was cut, joined or re-encoded, so what you
    hear is one continuous piece of a real recording rather than an assembly of several.
  </p>
  <p>
    To check that nothing has been altered since this was exported, run
    <code>node verify.mjs</code> in this folder.
  </p>
</footer>

<script type="application/json" id="data">${embed(data)}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('data').textContent);
  var nav = document.getElementById('nav');
  var main = document.getElementById('main');
  var current = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clock(ms) {
    var total = Math.floor(ms / 1000);
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  /**
   * One span, seeked and stopped. The element is created per citation and
   * never reused across two, which is what keeps a click on one citation from
   * being able to run into the next.
   */
  function player(source, startMs, endMs) {
    var wrap = el('div', 'row');
    var audio = document.createElement('audio');
    audio.src = source.path;
    audio.preload = 'metadata';
    var button = el('button', 'play', 'Play this bit');
    button.type = 'button';
    button.addEventListener('click', function () {
      if (!audio.paused) { audio.pause(); button.textContent = 'Play this bit'; return; }
      audio.currentTime = startMs / 1000;
      audio.play();
      button.textContent = 'Pause';
    });
    audio.addEventListener('timeupdate', function () {
      if (endMs !== null && audio.currentTime * 1000 >= endMs) {
        audio.pause();
        button.textContent = 'Play this bit';
      }
    });
    audio.addEventListener('ended', function () { button.textContent = 'Play this bit'; });
    wrap.appendChild(button);
    wrap.appendChild(el('span', 'muted small',
      source.filename + (startMs !== null ? ', at ' + clock(startMs) : '')));
    wrap.appendChild(audio);
    return wrap;
  }

  function citation(evidence) {
    var box = el('div', 'cite');
    var source = evidence.sourceId ? data.sources[evidence.sourceId] : null;
    if (!source) {
      box.appendChild(el('p', 'muted small', 'The source of this is not in this export.'));
      return box;
    }

    if (evidence.quotedText) {
      box.appendChild(el('p', 'muted small', 'Their words, exactly:'));
      box.appendChild(el('blockquote', null, evidence.quotedText));
    }

    var locator = evidence.locator || {};
    var segment = locator.segmentId ? data.segments[locator.segmentId] : null;
    var startMs = segment && segment.startMs !== null ? segment.startMs
      : (typeof locator.startMs === 'number' ? locator.startMs : null);
    var endMs = segment && segment.endMs !== null ? segment.endMs
      : (typeof locator.endMs === 'number' ? locator.endMs : null);

    if (source.path && source.kind === 'audio' && startMs !== null) {
      box.appendChild(player(source, startMs, endMs));
    } else {
      var where = source.filename;
      if (typeof locator.page === 'number') where += ', page ' + locator.page;
      else if (startMs !== null) where += ', at ' + clock(startMs);
      box.appendChild(el('p', 'muted small', 'From ' + where +
        (source.path ? '' : ' (the file itself was not included in this export)')));
    }
    return box;
  }

  function render(memory) {
    current = memory.id;
    main.replaceChildren();
    main.appendChild(el('h2', null, memory.title));
    if (memory.occurredOn || memory.topics.length) {
      main.appendChild(el('p', 'muted small',
        [memory.occurredOn, memory.topics.join(', ')].filter(Boolean).join(' · ')));
    }
    main.appendChild(el('p', null, memory.body));

    if (memory.claims.length === 0) return;
    main.appendChild(el('p', 'muted small', 'Where each part of this came from'));

    memory.claims.forEach(function (claim) {
      var block = el('div', 'claim');
      block.appendChild(el('p', null, claim.text));
      if (claim.evidence.length === 0) {
        block.appendChild(el('p', 'muted small', 'No source recorded for this.'));
      } else {
        var details = el('details');
        details.appendChild(el('summary', null,
          claim.evidence.length === 1 ? 'Where this came from'
            : 'Where this came from (' + claim.evidence.length + ' places)'));
        claim.evidence.forEach(function (evidence) {
          details.appendChild(citation(evidence));
        });
        block.appendChild(details);
      }
      main.appendChild(block);
    });

    Array.prototype.forEach.call(nav.children, function (button) {
      button.setAttribute('aria-current', button.dataset.id === current ? 'true' : 'false');
    });
    main.scrollIntoView({ block: 'start' });
  }

  if (data.memories.length === 0) {
    main.appendChild(el('p', 'muted', 'This archive has no approved memories in it yet.'));
  } else {
    data.memories.forEach(function (memory) {
      var button = el('button', null, memory.title);
      button.type = 'button';
      button.dataset.id = memory.id;
      button.addEventListener('click', function () { render(memory); });
      nav.appendChild(button);
    });
    render(data.memories[0]);
  }
})();
</script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
