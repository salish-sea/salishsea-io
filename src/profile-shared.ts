import { css, html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import { Temporal } from 'temporal-polyfill';
import {
  displayName, groupChain, individualPath, mapUrl, matrilinePath, monthlyPresence, observedDate,
  type CatalogGroup, type GroupMember, type OccurrenceLink,
} from './catalog.ts';
import { formatDate } from './date-format.ts';
import { renderSiteNav, siteNavStyles, type NavPage } from './site-nav.ts';

// Shared rendering for the profile pages (individual-page, matriline-page).
// Lit styles are scoped per component, so the common rules live here as a
// CSSResult both pages put first in their `static styles` arrays.

export const PRESENCE_YEARS = 4;
const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

const profileOwnStyles = css`
  :host {
    display: block;
  }
  main {
    margin: 0 auto;
    max-width: 44rem;
    padding: 1rem 1rem 4rem;
  }
  a {
    color: #1976d2;
    font-weight: 500;
    text-decoration: none;
  }
  a:hover {
    color: #1565c0;
  }
  header.masthead {
    margin-bottom: 2.5rem;
  }
  .designation-kicker {
    color: #64748b;
    font-size: 0.9375rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  h1 {
    font-size: clamp(2.25rem, 6vw, 3.25rem);
    font-weight: 600;
    line-height: 1.1;
    margin: 0.25rem 0 0.5rem;
  }
  .vitals {
    color: #475569;
    font-size: 1.0625rem;
    margin: 0;
  }
  .lineage {
    color: #64748b;
    font-size: 0.9375rem;
    margin: 0.5rem 0 0;
  }
  .lineage b {
    color: #475569;
    font-weight: 600;
  }
  section {
    margin-top: 2.5rem;
  }
  h2 {
    border-bottom: 1px solid #e2e8f0;
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    margin: 0 0 1rem;
    padding-bottom: 0.375rem;
    text-transform: uppercase;
  }
  dl.sub-lineages {
    display: grid;
    gap: 0.375rem 1.5rem;
    grid-template-columns: max-content 1fr;
    margin: 0.75rem 0 0;
  }
  dl.sub-lineages:first-child {
    margin-top: 0;
  }
  dl.sub-lineages dd {
    margin: 0;
  }
  ul.people {
    display: inline;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  ul.people li {
    display: inline;
  }
  ul.people li:not(:last-child)::after {
    content: " · ";
    color: #94a3b8;
  }
  .muted {
    color: #64748b;
  }
  .self {
    font-weight: 600;
  }
  article.nickname {
    margin-bottom: 1.25rem;
  }
  article.nickname:last-child {
    margin-bottom: 0;
  }
  .nickname-line {
    margin: 0;
  }
  .nickname-line b {
    font-weight: 600;
  }
  table.presence {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  table.presence th {
    color: #94a3b8;
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.125rem;
    text-align: center;
  }
  table.presence th[scope="row"] {
    color: #64748b;
    padding-right: 0.625rem;
    text-align: right;
  }
  table.presence td {
    border: 1px solid #f1f5f9;
    color: #1e3a5f;
    font-size: 0.8125rem;
    height: 1.75rem;
    min-width: 1.75rem;
    padding: 0;
    text-align: center;
  }
  table.presence td.p1 { background: #e3f2fd; }
  table.presence td.p2 { background: #bbdefb; }
  table.presence td.p3 { background: #90caf9; }
  .presence-note, .sightings-note {
    color: #64748b;
    font-size: 0.875rem;
    margin: 0.75rem 0 0;
  }
  individual-map {
    display: block;
    margin-top: 1.5rem;
  }
  .placeholder {
    color: #64748b;
  }
  .error {
    color: #b71c1c;
  }
`;

/** The profile pages' common rules, the nav's among them. */
export const profileStyles = css`${siteNavStyles}${profileOwnStyles}`;

export function renderRelative(relative: { entity_id: string | null; primary_designation: string; nicknames?: { name: string; status: string | null }[] }) {
  const name = relative.nicknames ? displayName(relative.nicknames) : null;
  return html`<a href=${individualPath(relative)}>${relative.primary_designation}${name ? ` ${name}` : ''}</a>`;
}

// Settle the page on its canonical address (decision 034). The edge handler
// 301s designation paths and bare identifiers before the page loads, but it
// fails open to the shell when its lookup is slow, and a slug is never read —
// so the address a visitor arrived on may be a legacy one, a stale slug, or
// the bare identifier. Rewrite it in place, and declare the canonical URL for
// crawlers that execute scripts; the edge's og:url covers the ones that don't.
export function canonicalize(path: string) {
  const { pathname, search, hash, origin } = window.location;
  if (pathname !== path) {
    history.replaceState(history.state, '', `${path}${search}${hash}`);
  }
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.append(link);
  }
  link.href = new URL(path, origin).href;
}

export function renderDagger(lifeStatus: string) {
  return lifeStatus === 'deceased' || lifeStatus === 'presumed_deceased'
    ? html`<span class="muted" title=${lifeStatus === 'deceased' ? 'deceased' : 'presumed deceased'}>&dagger;</span>`
    : nothing;
}

// The sub-lineage of `groupId` a member belongs to: the step on her chain of
// matrilines just below it. null when she is in no sub-lineage of it — the
// matriarch, and any descendant with no narrower matriline of her own.
function subLineageOf(member: GroupMember, groupId: number, groups: Map<number, CatalogGroup>): CatalogGroup | null {
  if (member.innermost_group_id === null || member.innermost_group_id === groupId) return null;
  return groupChain(member.innermost_group_id, groups).find(g => g.parent_group_id === groupId) ?? null;
}

// A matriline's roster: its own members first, then each sub-lineage under its
// name, each oldest first (unknown birth years last). The register counts a
// sub-lineage's animals as members of every matriline above it, so T065s lists
// the T065As too — grouped, so the page still reads as a family.
// `selfId` bolds the page's own individual instead of linking it (individual
// pages only).
export function renderMemberList(members: GroupMember[], groupId: number, groups: Map<number, CatalogGroup>, selfId?: number) {
  const byLineage = new Map<CatalogGroup | null, GroupMember[]>();
  for (const member of members) {
    const lineage = subLineageOf(member, groupId, groups);
    byLineage.set(lineage, [...byLineage.get(lineage) ?? [], member]);
  }
  const own = byLineage.get(null) ?? [];
  const subLineages = [...byLineage.entries()]
    .filter((entry): entry is [CatalogGroup, GroupMember[]] => entry[0] !== null)
    .sort(([a], [b]) => a.designation.localeCompare(b.designation));
  return html`
    ${own.length ? renderPeople(own, selfId) : nothing}
    ${subLineages.length ? html`
      <dl class="sub-lineages">
        ${repeat(subLineages, ([lineage]) => lineage.id, ([lineage, lineageMembers]) => html`
          <dt><a href=${matrilinePath(lineage)}>${lineage.designation}s</a></dt>
          <dd>${renderPeople(lineageMembers, selfId)}</dd>
        `)}
      </dl>
    ` : nothing}
  `;
}

function renderPeople(members: GroupMember[], selfId?: number) {
  // Birth year, then designation: two calves born the same year would otherwise fall in
  // whatever order the rows arrived, which is no order at all (decision 057).
  const sorted = [...members].sort((a, b) =>
    (a.individual?.born_earliest ?? Infinity) - (b.individual?.born_earliest ?? Infinity)
    || (a.individual?.primary_designation ?? '').localeCompare(b.individual?.primary_designation ?? ''));
  return html`
    <ul class="people">
      ${repeat(sorted, m => m.individual!.id, m => html`
        <li class=${m.individual!.id === selfId ? 'self' : ''}>
          ${m.individual!.id === selfId
            ? html`${m.individual!.primary_designation}`
            : renderRelative(m.individual!)}${m.individual!.born_earliest ? html` <span class="muted">b.&thinsp;${m.individual!.born_earliest}</span>` : nothing}${renderDagger(m.individual!.life_status)}
        </li>
      `)}
    </ul>
  `;
}

// The month×year report-count grid with its honesty note.
// `currentYear` is the table's newest row: this year by default, the snapshot's year
// when the build prerenders a page (decision 057), so the same snapshot always
// renders the same table.
export function renderPresenceTable(
  links: Pick<OccurrenceLink, 'observed_at'>[],
  years = PRESENCE_YEARS,
  note = 'Reports per month. Most are unverified mentions in sighting text, not confirmed identifications.',
  currentYear = Temporal.Now.zonedDateTimeISO('PST8PDT').year,
) {
  const grid = monthlyPresence(links, years, currentYear);
  if (grid.every(row => row.months.every(count => count === 0))) return nothing;
  return html`
    <table class="presence">
      <thead>
        <tr>
          <td></td>
          ${MONTH_INITIALS.map((initial, i) => html`<th scope="col" title=${formatDate(Temporal.PlainDate.from({year: 2000, month: i + 1, day: 1}), {month: 'long'})}>${initial}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${grid.map(({ year, months }) => html`
          <tr>
            <th scope="row">${year}</th>
            ${months.map((count, i) => html`
              <td class=${count >= 4 ? 'p3' : count >= 2 ? 'p2' : count === 1 ? 'p1' : ''}
                  title="${count} report${count === 1 ? '' : 's'} in ${formatDate(Temporal.PlainDate.from({year, month: i + 1, day: 1}), {month: 'long', year: 'numeric'})}">${count || nothing}</td>
            `)}
          </tr>
        `)}
      </tbody>
    </table>
    <p class="presence-note">${note}</p>
  `;
}

/**
 * A profile page around its content, whatever state the content is in. The whales page
 * shares the frame, and is the one page in it the nav names.
 */
export function renderProfileFrame(content: unknown, current: NavPage | null = null) {
  return html`
      <main>
        ${renderSiteNav(current)}
        ${content}
      </main>
    `;
}

/**
 * Where a prerendered page's map loads its points from, and the year its presence
 * table ends on (decision 057). A client-rendered page passes neither: it hands the
 * map its links, and the table ends on this year.
 */
export interface SightingsOptions {
  mapSrc?: string;
  currentYear?: number;
}

/**
 * A profile's Sightings section once its links are known: the presence table, the
 * map, and the last-reported line; `empty` when there are none. Every profile kind
 * shows the same summary of its own links.
 */
export function renderSightingsSummary(
  links: OccurrenceLink[] | null,
  empty: TemplateResult,
  { mapSrc, currentYear }: SightingsOptions = {},
) {
  if (!links?.length)
    return empty;
  const latest = links[0]!;
  const located = links.filter(l => l.location).length;
  return html`
    ${renderPresenceTable(links, undefined, undefined, currentYear)}
    ${when(located, () => html`<individual-map .links=${links} src=${mapSrc ?? nothing}></individual-map>`)}
    <p class="sightings-note">
      Last reported <a href=${mapUrl(latest)}>${formatDate(observedDate(latest.observed_at), { month: 'long', day: 'numeric', year: 'numeric' })}</a>${latest.via_group ? html` (as ${latest.via_group})` : nothing}
      · ${links.length} report${links.length === 1 ? '' : 's'} in all${when(located, () => html` — ${located === links.length ? 'each' : `${located} of them`} a dot above; the newest located report is solid. Click one to see that day on the map.`)}
    </p>
  `;
}
