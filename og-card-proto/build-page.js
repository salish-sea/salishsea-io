// PROTOTYPE — builds the comparison page with images inlined as data URIs
// (artifact CSP blocks external hosts).
const fs = require('fs');
const sharp = require('sharp');

const CASES = [
  {
    id: 'haro-strait', z: 9, title: 'Haro Strait / San Juans', zoom: 'zoom 9 · ~245 km wide',
    note: 'Dense island geography — the case the Salish Sea is actually about.',
  },
  {
    id: 'haro-strait', z: 11, title: 'Haro Strait / San Juans', zoom: 'zoom 11 · ~61 km wide',
    note: 'Same spot, closer in. This is where the two approaches separate.',
  },
  {
    id: 'juan-de-fuca', z: 9, title: 'Strait of Juan de Fuca', zoom: 'zoom 9 · ~245 km wide',
    note: 'Open water with shore on two sides.',
  },
  {
    id: 'juan-de-fuca', z: 11, title: 'Strait of Juan de Fuca', zoom: 'zoom 11 · ~61 km wide',
    note: 'Open water, close in — the hardest case for a drawn map.',
  },
  {
    id: 'monterey-outlier', z: 9, title: 'Monterey Bay', zoom: 'zoom 9 · ~245 km wide',
    note: 'A real sighting from yesterday, 1,300 km outside the Salish Sea.',
  },
];

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

(async () => {
  const img = async (id, z, v) => {
    const b = await sharp(`${__dirname}/out/${id}-z${z}-${v}.jpg`)
      .resize({ width: 880 }).jpeg({ quality: 76 }).toBuffer();
    return `data:image/jpeg;base64,${b.toString('base64')}`;
  };

  const sections = [];
  for (const c of CASES) {
    const [a, d] = await Promise.all([img(c.id, c.z, 'A'), img(c.id, c.z, 'D')]);
    sections.push(`
      <section class="case">
        <header class="case-head">
          <h2>${esc(c.title)}</h2>
          <p class="meta">${esc(c.zoom)}</p>
          <p class="note">${esc(c.note)}</p>
        </header>
        <div class="pair">
          <figure>
            <img src="${a}" alt="Card for ${esc(c.title)} rendered from Esri tiles" width="880" height="462">
            <figcaption><span class="tag tag-a">A</span> Esri World Ocean Base tiles</figcaption>
          </figure>
          <figure>
            <img src="${d}" alt="Card for ${esc(c.title)} rendered from a drawn coastline" width="880" height="462">
            <figcaption><span class="tag tag-d">D</span> Drawn coastline (Natural Earth 10m)</figcaption>
          </figure>
        </div>
      </section>`);
  }

  const html = `<title>Sighting card renderers: real tiles vs. drawn coastline</title>
<style>
  :root {
    --ground: #f2f5f4;
    --panel: #ffffff;
    --ink: #14222b;
    --muted: #5b6f79;
    --accent: #1565c0;
    --sand: #c9bfa8;
    --rule: #d3dcdd;
    --shadow: 0 1px 2px rgba(20,34,43,.07), 0 8px 24px rgba(20,34,43,.06);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #0f191e;
      --panel: #16232a;
      --ink: #e7eef1;
      --muted: #9bb0ba;
      --accent: #6aa9e9;
      --sand: #6b6250;
      --rule: #26363e;
      --shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.3);
    }
  }
  :root[data-theme="dark"] {
    --ground: #0f191e; --panel: #16232a; --ink: #e7eef1; --muted: #9bb0ba;
    --accent: #6aa9e9; --sand: #6b6250; --rule: #26363e;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.3);
  }
  :root[data-theme="light"] {
    --ground: #f2f5f4; --panel: #ffffff; --ink: #14222b; --muted: #5b6f79;
    --accent: #1565c0; --sand: #c9bfa8; --rule: #d3dcdd;
    --shadow: 0 1px 2px rgba(20,34,43,.07), 0 8px 24px rgba(20,34,43,.06);
  }

  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 56px 24px 96px; }

  .eyebrow {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
    color: var(--muted); margin: 0 0 14px;
  }
  h1 {
    font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
    font-weight: 400; font-size: clamp(30px, 4.4vw, 46px); line-height: 1.15;
    text-wrap: balance; margin: 0 0 18px; letter-spacing: -.01em;
  }
  .lede { font-size: 18px; color: var(--muted); max-width: 62ch; margin: 0 0 40px; }

  .verdict {
    background: var(--panel); border: 1px solid var(--rule);
    border-left: 3px solid var(--accent);
    border-radius: 2px; padding: 22px 26px; margin: 0 0 56px; box-shadow: var(--shadow);
  }
  .verdict h2 {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
    color: var(--muted); margin: 0 0 10px; font-weight: 500;
  }
  .verdict p { margin: 0 0 12px; max-width: 68ch; }
  .verdict p:last-child { margin-bottom: 0; }
  .verdict strong { font-weight: 600; }

  .case { margin: 0 0 56px; }
  .case-head { margin: 0 0 18px; padding-bottom: 12px; border-bottom: 1px solid var(--rule); }
  .case-head h2 {
    font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
    font-weight: 400; font-size: 24px; margin: 0 0 4px; letter-spacing: -.01em;
  }
  .meta {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px; color: var(--muted); margin: 0 0 8px;
    font-variant-numeric: tabular-nums;
  }
  .note { margin: 0; color: var(--muted); font-size: 15px; max-width: 62ch; }

  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
  @media (max-width: 860px) { .pair { grid-template-columns: 1fr; } }

  figure { margin: 0; }
  figure img {
    display: block; width: 100%; height: auto;
    border: 1px solid var(--rule); border-radius: 2px; box-shadow: var(--shadow);
  }
  figcaption {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px; color: var(--muted); margin-top: 10px;
    display: flex; align-items: center; gap: 8px;
  }
  .tag {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 2px;
    font-size: 11px; font-weight: 700; color: #fff; flex: none;
  }
  .tag-a { background: var(--accent); }
  .tag-d { background: var(--sand); color: #2a2418; }

  .closing { border-top: 1px solid var(--rule); padding-top: 28px; }
  .closing h2 {
    font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
    font-weight: 400; font-size: 24px; margin: 0 0 14px;
  }
  .closing p { max-width: 68ch; margin: 0 0 14px; }
  .closing ul { max-width: 68ch; padding-left: 20px; margin: 0 0 14px; }
  .closing li { margin-bottom: 8px; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: .9em; background: var(--panel); border: 1px solid var(--rule);
    border-radius: 2px; padding: 1px 5px;
  }
</style>

<div class="wrap">
  <p class="eyebrow">Prototype · issue #38 · link previews</p>
  <h1>Two ways to draw a sighting card</h1>
  <p class="lede">
    Every card below is 1200&times;630, rendered from a real sighting in the database,
    with both variants sharing the identical view window. The only variable is how the
    map underneath gets drawn.
  </p>

  <div class="verdict">
    <h2>Verdict</h2>
    <p>
      <strong>A wins, and my prediction was wrong.</strong> I argued a real basemap would
      turn to &ldquo;mush&rdquo; at card size and that a drawn coastline would read better.
      It doesn&rsquo;t. Esri&rsquo;s ocean basemap is already muted and low-contrast &mdash;
      it behaves like a chart, not a road map &mdash; so the marker sits on top cleanly
      while bathymetry gives the water texture and depth.
    </p>
    <p>
      The gap widens as you zoom in. At zoom 11 the drawn coastline shows Natural Earth&rsquo;s
      10m resolution for what it is: faceted, polygonal islands. And over open water it has
      nothing left to draw &mdash; the Strait of Juan de Fuca becomes an empty blue rectangle,
      where the tiles still show the channel.
    </p>
  </div>

  ${sections.join('\n')}

  <section class="closing">
    <h2>What this changes</h2>
    <p>
      Picking A moves the open question from <em>&ldquo;how do we draw a map?&rdquo;</em> to
      <em>&ldquo;are we allowed to cache these tiles?&rdquo;</em> &mdash; Esri&rsquo;s terms
      for server-side compositing and storage of ArcGIS Online basemap tiles need an answer
      before this ships. That&rsquo;s now the gating question, not a footnote.
    </p>
    <ul>
      <li>
        Rendering is not the bottleneck: 18&ndash;20 tiles fetched and composited per card,
        five cards in <strong>5.1 s</strong> total, cold, on a laptop &mdash; and every card is
        cacheable forever, since a past sighting never moves.
      </li>
      <li>
        Zoom 9 reads as &ldquo;the Salish Sea, and the sighting was here.&rdquo; Zoom 11 reads
        as &ldquo;this specific channel.&rdquo; Worth choosing deliberately; zoom 9 gives a
        sharer more recognizable context.
      </li>
      <li>
        <strong>54.4% of the last 90 days&rsquo; sightings sit outside the Salish Sea</strong>
        &mdash; 3,620 of 6,656, against a generous bounding box (46.9&ndash;50.9&nbsp;N,
        121.9&ndash;125.6&nbsp;W). The Monterey harbor seal above is real, from yesterday.
        A card renderer has to work anywhere on the coast, which on its own rules out
        baking in one region&rsquo;s coastline.
      </li>
    </ul>
    <p>
      The caption treatment (species, date, gradient scrim, attribution) is shared by both
      variants here and is independent of this decision &mdash; it can be tuned separately.
    </p>
  </section>
</div>
`;

  fs.writeFileSync(`${__dirname}/card-compare.html`, html);
  console.log(`wrote card-compare.html (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
})();
