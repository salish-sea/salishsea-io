// The Send to SalishSea bookmarklet (README.md): what it does in Facebook's page, and the
// javascript: address a sender drags to the bookmarks bar.
import { EXPANDERS } from './read.mjs';

// The bookmarklet runs in Facebook's page. It asks for all comments where Facebook shows
// only the most relevant, opens what Facebook hides (more comments, replies, the rest of a
// long comment) until nothing is left and the comments stop changing (90 seconds at most),
// and then offers a button in the page that sends the open post (a dialog over the feed,
// or the post's own page; never the whole page, which carries the sender's chats).
//
// Why that second click: a window may open only within a few seconds of a click, and
// opening the comments takes longer. Why the post travels in the window's address (117):
// signed in, Facebook's Cross-Origin-Opener-Policy cuts a window off from the tab that
// opened it, and its Content Security Policy allows no request to any other server, so
// nothing can pass between the two afterwards (found 2026-11-16). For the same reason the
// code in a bookmark can't be updated from here: a change means installing it again.
//
// Stop, Cancel or Close ends a run: it checks after every wait, and does nothing more. A
// click on the bookmark while its box shows does nothing; a click after the page lost the
// box ends that run and starts another. A blocked window leaves Send in the box, to retry.
// No comments inside this function: the bookmarklet joins its lines into one, so a line
// comment would swallow the rest (demo.test.mjs checks).
export async function sendPost(expanders, receive) {
  if (window.__salishseaBox?.isConnected) return;
  window.__salishseaStop?.();
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'fixed', top: '72px', left: '50%', transform: 'translateX(-50%)', zIndex: 2147483647, background: '#1d3c78', color: '#fff', padding: '12px 18px', borderRadius: '8px', font: '15px system-ui,sans-serif', maxWidth: '34em', boxShadow: '0 2px 12px rgba(0,0,0,.3)' });
  document.body.append(box);
  const say = (text, ...more) => { box.replaceChildren(text, ...more); };
  const button = (label, onclick) => {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, { display: 'block', marginTop: '10px', font: 'inherit', fontWeight: '600', padding: '6px 12px', borderRadius: '6px', border: '0', background: '#fff', color: '#1d3c78', cursor: 'pointer' });
    b.onclick = onclick;
    return b;
  };
  let stopped = false;
  const close = () => { stopped = true; box.remove(); };
  window.__salishseaBox = box;
  window.__salishseaStop = close;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const find = () => [...document.querySelectorAll('[role=dialog]')].filter((d) => d.querySelector('[role=article]')).pop()
      ?? document.querySelector('[role=main]');
    if (!find()) { say('SalishSea: open the day’s post first.', button('Close', close)); return; }
    const re = new RegExp(expanders, 'i');
    const buttons = (el) => [...el.querySelectorAll('[role=button]')];
    const text = (b) => (b.textContent ?? '').trim();

    const sort = buttons(find()).find((b) => /^(most relevant|newest)$/i.test(text(b)));
    if (sort) {
      say('SalishSea: asking Facebook for all comments…', button('Stop', close));
      sort.click();
      await sleep(1000);
      if (stopped) return;
      const all = [...document.querySelectorAll('[role=menuitem]')].find((m) => /^all comments/i.test(text(m)));
      if (all) { all.click(); await sleep(2000); if (stopped) return; } else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }

    const clicked = new WeakMap();
    const deadline = Date.now() + 90_000;
    let last = -1, quiet = 0;
    while (Date.now() < deadline) {
      if (stopped) return;
      const el = find();
      const hidden = buttons(el).filter((b) => re.test(text(b)) && !(Date.now() - (clicked.get(b) ?? 0) < 5000));
      for (const b of hidden) { clicked.set(b, Date.now()); b.click(); }
      const n = el.querySelectorAll('[role=article]').length;
      const waiting = buttons(el).some((b) => re.test(text(b)));
      quiet = !hidden.length && !waiting && n === last ? quiet + 1 : 0;
      if (quiet >= 2) break;
      last = n;
      say(`SalishSea: opening hidden comments, ${n} so far…`, button('Stop', close));
      await sleep(1500);
    }
    if (stopped) return;

    const el = find();
    const n = el.querySelectorAll('[role=article]').length;
    const msg = JSON.stringify({ html: el.outerHTML, url: location.href, title: document.title, sent_at: new Date().toISOString() });
    const gz = new Uint8Array(await new Response(new Blob([msg]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    let bin = '';
    for (let i = 0; i < gz.length; i += 32768) bin += String.fromCharCode.apply(null, gz.subarray(i, i + 32768));
    const data = btoa(bin).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, '');
    if (stopped) return;
    const send = () => {
      const w = window.open(receive + '&d=' + data, '_blank', 'popup,width=1000,height=760');
      if (w) close(); else say('SalishSea: the window was blocked. Allow pop-ups for facebook.com, then click Send again.', button('Send them to SalishSea', send), button('Close', close));
    };
    say(`SalishSea: ${n} comments and replies are open.`, button('Send them to SalishSea', send), button('Cancel', close));
  } catch (x) {
    say('SalishSea: something went wrong: ' + x, button('Close', close));
  }
}

/** The bookmarklet that sends to `receive`, the window's address with the sender's secret after '#'. */
export const bookmarkletFor = (receive) =>
  'javascript:' + encodeURIComponent(`void (${sendPost})(${JSON.stringify(EXPANDERS.source)},${JSON.stringify(receive)})`.replace(/\s*\n\s*/g, ' '));
