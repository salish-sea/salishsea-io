import { css, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { Temporal } from 'temporal-polyfill';
import {
  displayName, individualPath, monthlyPresence,
  type GroupMember, type OccurrenceLink,
} from './catalog.ts';

// Shared rendering for the profile pages (individual-page, matriline-page).
// Lit styles are scoped per component, so the common rules live here as a
// CSSResult both pages put first in their `static styles` arrays.

export const PRESENCE_YEARS = 4;
const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export const profileStyles = css`
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
  .back {
    display: inline-block;
    margin-bottom: 2.5rem;
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

export function renderRelative(relative: { primary_designation: string; nicknames?: { name: string; status: string | null }[] }) {
  const name = relative.nicknames ? displayName(relative.nicknames) : null;
  return html`<a href=${individualPath(relative.primary_designation)}>${relative.primary_designation}${name ? ` ${name}` : ''}</a>`;
}

export function renderDagger(lifeStatus: string) {
  return lifeStatus === 'deceased' || lifeStatus === 'presumed_deceased'
    ? html`<span class="muted" title=${lifeStatus === 'deceased' ? 'deceased' : 'presumed deceased'}>&dagger;</span>`
    : nothing;
}

// A matriline's member roster, oldest first (unknown birth years last).
// `selfId` bolds the page's own individual instead of linking it (individual
// pages only).
export function renderMemberList(members: GroupMember[], selfId?: number) {
  const sorted = [...members].sort((a, b) =>
    (a.individual?.born_earliest ?? Infinity) - (b.individual?.born_earliest ?? Infinity));
  return html`
    <ul class="people">
      ${repeat(sorted, m => m.individual!.id, m => html`
        <li class=${m.individual!.id === selfId ? 'self' : ''}>
          ${m.individual!.id === selfId
            ? html`${m.individual!.primary_designation}`
            : renderRelative(m.individual!)}${m.individual!.born_earliest ? html` <span class="muted">b.&thinsp;${m.individual!.born_earliest}</span>` : nothing}${renderDagger(m.individual!.life_status)}${!m.is_current ? html` <span class="muted">(former)</span>` : nothing}
        </li>
      `)}
    </ul>
  `;
}

// The month×year report-count grid with its honesty note.
export function renderPresenceTable(links: OccurrenceLink[]) {
  const currentYear = Temporal.Now.zonedDateTimeISO('PST8PDT').year;
  const grid = monthlyPresence(links, PRESENCE_YEARS, currentYear);
  if (grid.every(row => row.months.every(count => count === 0))) return nothing;
  return html`
    <table class="presence">
      <thead>
        <tr>
          <td></td>
          ${MONTH_INITIALS.map((initial, i) => html`<th scope="col" title=${Temporal.PlainDate.from({year: 2000, month: i + 1, day: 1}).toLocaleString('en-US', {month: 'long'})}>${initial}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${grid.map(({ year, months }) => html`
          <tr>
            <th scope="row">${year}</th>
            ${months.map((count, i) => html`
              <td class=${count >= 4 ? 'p3' : count >= 2 ? 'p2' : count === 1 ? 'p1' : ''}
                  title="${count} report${count === 1 ? '' : 's'} in ${Temporal.PlainDate.from({year, month: i + 1, day: 1}).toLocaleString('en-US', {month: 'long', year: 'numeric'})}">${count || nothing}</td>
            `)}
          </tr>
        `)}
      </tbody>
    </table>
    <p class="presence-note">Reports per month. Most are unverified mentions in sighting text, not confirmed identifications.</p>
  `;
}
