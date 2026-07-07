import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Task } from '@lit/task';
import { when } from 'lit/directives/when.js';
import { repeat } from 'lit/directives/repeat.js';
import { Temporal } from 'temporal-polyfill';
import {
  displayName, fetchAllGroups, fetchGroupMembers, fetchIndividual, fetchOccurrenceLinks,
  fetchOccurrencesByIds, fetchOffspring, fetchParents, groupChain, individualPath, monthlyPresence,
  parseIndividualPath,
  type GroupMember, type IndividualProfile, type OccurrenceLink, type Offspring, type Parent, type SocialGroup,
} from './catalog.ts';
import { loadCatalogCodes } from './individual-links.ts';
import type { Occurrence } from './types.ts';
import { sentryClient } from './sentry.ts';
import './obs-summary.ts';

sentryClient.init();

const RECENT_LIMIT = 10;
const PRESENCE_YEARS = 4;
const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

// iNaturalist taxon ids the catalog actually uses (all rows are 41521 today).
const TAXON_LABELS: Record<number, string> = {
  41521: 'Killer whale',
};

const SCHEME_LABELS: Record<string, string> = {
  bc_wa: 'BC/WA',
  alaska: 'Alaska',
  california: 'California',
  other: '',
};

const STATUS_LABELS: Record<OccurrenceLink['status'], string> = {
  candidate: 'unverified mention',
  validated: 'verified',
  rejected: 'rejected', // filtered out upstream; label kept for exhaustiveness
};

interface Sightings {
  links: OccurrenceLink[];
  linksByOccurrence: Map<string, OccurrenceLink>;
  recent: Occurrence[];
}

interface Profile {
  profile: IndividualProfile;
  mother: Parent | null;
  father: Parent | null;
  offspring: Offspring[];
  groups: Map<number, SocialGroup>;
  matriline: SocialGroup | null;
  members: GroupMember[];
  name: string | null;
}

function bornPhrase(earliest: number | null, latest: number | null): string | null {
  if (earliest !== null && latest !== null)
    return earliest === latest ? `born ${earliest}` : `born ${earliest}–${latest}`;
  if (latest !== null)
    return `born by ${latest}`;
  if (earliest !== null)
    return `born after ${earliest}`;
  return null;
}

function lifeStatusPhrase(status: IndividualProfile['life_status']): string | null {
  switch (status) {
    case 'deceased': return 'deceased';
    case 'presumed_deceased': return 'presumed deceased';
    default: return null; // 'alive' is the unremarkable case; 'unknown' says nothing
  }
}

function observedDate(observedAt: string): Temporal.PlainDate {
  return Temporal.Instant.from(observedAt).toZonedDateTimeISO('PST8PDT').toPlainDate();
}

function mapUrl(link: OccurrenceLink): string {
  return `/?d=${observedDate(link.observed_at).toString()}&o=${encodeURIComponent(link.occurrence_id)}`;
}

@customElement('individual-page')
export class IndividualPage extends LitElement {
  @state() private designation = parseIndividualPath(window.location.pathname);

  #profile = new Task(this, {
    args: () => [this.designation] as const,
    task: async ([designation]): Promise<Profile | null> => {
      if (!designation) return null;
      const profile = await fetchIndividual(designation);
      if (!profile) return null;
      const [{ mother, father }, offspring, groups] = await Promise.all([
        fetchParents(profile),
        fetchOffspring(profile.id),
        fetchAllGroups(),
      ]);
      const matrilineMembership = profile.memberships.find(m => m.is_current && m.group?.kind === 'matriline');
      const matriline = matrilineMembership?.group ?? null;
      const members = matriline ? await fetchGroupMembers(matriline.id) : [];
      const name = displayName(profile.nicknames);
      document.title = `${name ? `${name} (${profile.primary_designation})` : profile.primary_designation} · SalishSea.io`;
      return { profile, mother, father, offspring, groups, matriline, members, name };
    },
  });

  // The slow half: identification links resolve live against sighting text
  // server-side (~2s). Runs after the profile so the masthead paints first.
  #sightings = new Task(this, {
    args: () => [this.#profile.value?.profile.id] as const,
    task: async ([individualId]): Promise<Sightings | null> => {
      if (!individualId) return null;
      const links = await fetchOccurrenceLinks(individualId);
      const recent = await fetchOccurrencesByIds(links.slice(0, RECENT_LIMIT).map(l => l.occurrence_id));
      return {
        links,
        linksByOccurrence: new Map(links.map(l => [l.occurrence_id, l])),
        recent,
      };
    },
  });

  connectedCallback(): void {
    super.connectedCallback();
    void loadCatalogCodes().catch(() => { /* links in sighting text just stay plain */ });
    this.addEventListener('focus-occurrence', evt => {
      const occurrence = (evt as CustomEvent<Occurrence>).detail;
      const link = this.#sightings.value?.linksByOccurrence.get(occurrence.id);
      if (link) window.location.href = mapUrl(link);
    });
  }

  static styles = css`
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
    dl.family {
      display: grid;
      gap: 0.375rem 1.5rem;
      grid-template-columns: max-content 1fr;
      margin: 0;
    }
    dl.family dt {
      color: #64748b;
    }
    dl.family dd {
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
    article.sighting {
      margin-top: 1.5rem;
    }
    .sighting-context {
      color: #64748b;
      font-size: 0.8125rem;
      margin-bottom: 0.125rem;
    }
    .status {
      background: #f1f5f9;
      border-radius: 3px;
      padding: 0.0625rem 0.375rem;
    }
    .status.validated {
      background: #e8f5e9;
      color: #2e7d32;
    }
    .placeholder {
      color: #64748b;
    }
    .error {
      color: #b71c1c;
    }
  `;

  render() {
    return html`
      <main>
        <a class="back" href="/">&#8592; Back to the map</a>
        ${this.#profile.render({
          pending: () => html`<p class="placeholder">Looking up ${this.designation}&hellip;</p>`,
          error: () => html`<p class="error">Something went wrong loading this page. Please try again.</p>`,
          complete: value => value ? this.renderProfile(value) : this.renderNotFound(),
        })}
      </main>
    `;
  }

  private renderNotFound() {
    return html`
      <h1>${this.designation ?? 'Not found'}</h1>
      <p>We don't have ${this.designation ? html`<b>${this.designation}</b>` : 'that individual'} in our catalog.
      So far it covers Bigg's (transient) killer whales of the Salish Sea; other populations are on the way.</p>
      <p><a href="/">Explore the sightings map</a> or <a href="/about.html">read about this site</a>.</p>
    `;
  }

  private renderProfile({ profile, mother, father, offspring, groups, matriline, members, name }: Profile) {
    const vitals = [
      profile.sex === 'female' ? 'Female' : profile.sex === 'male' ? 'Male' : null,
      bornPhrase(profile.born_earliest, profile.born_latest),
      lifeStatusPhrase(profile.life_status),
    ].filter(Boolean).join(' · ');
    const chain = matriline ? groupChain(matriline.id, groups) : [];
    // Prefer the ecotype proven by the group chain; fall back to the taxon.
    const species = chain.some(g => g.kind === 'ecotype' && g.designation === 'Biggs')
      ? "Bigg's killer whale"
      : TAXON_LABELS[profile.taxon_id] ?? null;

    return html`
      <header class="masthead">
        <div class="designation-kicker">${name ? profile.primary_designation : species ?? nothing}</div>
        <h1>${name ?? profile.primary_designation}</h1>
        ${vitals || (name && species) ? html`<p class="vitals">${when(name && species, () => html`${species} · `)}${vitals}</p>` : nothing}
        ${chain.length ? html`<p class="lineage">${this.renderChain(chain, profile.primary_designation)}</p>` : nothing}
      </header>
      ${this.renderNaming(profile)}
      ${this.renderFamily(profile, mother, father, offspring)}
      ${when(matriline && members.length > 1, () => this.renderMatriline(matriline!, members, profile.id))}
      ${this.renderSightings(profile.primary_designation)}
    `;
  }

  // "T065A matriline — within T065 · Bigg's killer whales"
  private renderChain(chain: SocialGroup[], selfDesignation: string): TemplateResult {
    const [first, ...rest] = chain;
    const parents = rest.filter(g => g.kind !== 'ecotype');
    const ecotype = rest.find(g => g.kind === 'ecotype');
    return html`
      <b>${first!.designation} ${first!.kind === 'matriline' ? 'matriline' : first!.kind}</b>${
        parents.map(g => html` · within ${g.anchor_individual_id && g.designation !== selfDesignation
          ? html`<a href=${individualPath(g.designation)}>${g.designation}</a>`
          : g.designation}${g.kind === 'matriline' ? "'s matriline" : ` ${g.kind}`}`)
      }${ecotype ? html` · ${ecotype.designation === 'Biggs' ? "Bigg's (transient) killer whales" : ecotype.designation}` : nothing}
    `;
  }

  private renderNaming(profile: IndividualProfile) {
    const aliases = profile.designations.filter(d => d.code !== profile.primary_designation);
    const nicknames = profile.nicknames.filter(n => n.status !== 'deprecated');
    if (!aliases.length && !nicknames.length) return nothing;
    return html`
      <section>
        <h2>Names</h2>
        ${repeat(nicknames, n => n.name, n => html`
          <article class="nickname">
            <p class="nickname-line">
              <b>${n.name}</b>
              ${n.status !== 'official' ? html`<span class="muted">(${n.status.replace('_', ' ')})</span>` : nothing}
              ${n.named_year || n.namer ? html`<span class="muted"> — named${n.named_year ? ` in ${n.named_year}` : ''}${n.namer ? html` by ${n.namer.url ? html`<a target="_blank" rel="noopener noreferrer" href=${n.namer.url}>${n.namer.name}</a>` : n.namer.name}` : ''}</span>` : nothing}
            </p>
          </article>
        `)}
        ${when(aliases.length, () => html`
          <p class="muted">Also cataloged as ${aliases.map((d, i) => html`${i ? ', ' : ''}<b>${d.code}</b>${SCHEME_LABELS[d.scheme] ? ` (${SCHEME_LABELS[d.scheme]})` : ''}${d.status === 'superseded' ? ' — superseded' : ''}`)}.</p>
        `)}
      </section>
    `;
  }

  private renderFamily(profile: IndividualProfile, mother: Parent | null, father: Parent | null, offspring: Offspring[]) {
    if (!mother && !father && !offspring.length) return nothing;
    const certainty = profile.maternity_certainty;
    return html`
      <section>
        <h2>Family</h2>
        <dl class="family">
          ${when(mother, () => html`
            <dt>Mother</dt>
            <dd>${this.renderRelative(mother!)}${certainty !== 'confirmed' ? html` <span class="muted">(${certainty})</span>` : nothing}</dd>
          `)}
          ${when(father, () => html`
            <dt>Father</dt>
            <dd>${this.renderRelative(father!)}${profile.paternity_certainty && profile.paternity_certainty !== 'confirmed' ? html` <span class="muted">(${profile.paternity_certainty})</span>` : nothing}</dd>
          `)}
          ${when(offspring.length, () => html`
            <dt>Offspring</dt>
            <dd>
              <ul class="people">
                ${repeat(offspring, calf => calf.id, calf => html`
                  <li>${this.renderRelative(calf)}${calf.born_earliest ? html` <span class="muted">b.&thinsp;${calf.born_earliest}</span>` : nothing}${this.renderDagger(calf.life_status)}</li>
                `)}
              </ul>
            </dd>
          `)}
        </dl>
      </section>
    `;
  }

  private renderRelative(relative: { primary_designation: string; nicknames?: { name: string; status: string | null }[] }) {
    const name = relative.nicknames ? displayName(relative.nicknames) : null;
    return html`<a href=${individualPath(relative.primary_designation)}>${relative.primary_designation}${name ? ` ${name}` : ''}</a>`;
  }

  private renderDagger(lifeStatus: string) {
    return lifeStatus === 'deceased' || lifeStatus === 'presumed_deceased'
      ? html`<span class="muted" title=${lifeStatus === 'deceased' ? 'deceased' : 'presumed deceased'}>&dagger;</span>`
      : nothing;
  }

  private renderMatriline(matriline: SocialGroup, members: GroupMember[], selfId: number) {
    const sorted = [...members].sort((a, b) =>
      (a.individual?.born_earliest ?? -Infinity) - (b.individual?.born_earliest ?? -Infinity));
    return html`
      <section>
        <h2>${matriline.designation} matriline</h2>
        <ul class="people">
          ${repeat(sorted, m => m.individual!.id, m => html`
            <li class=${m.individual!.id === selfId ? 'self' : ''}>
              ${m.individual!.id === selfId
                ? html`${m.individual!.primary_designation}`
                : this.renderRelative(m.individual!)}${m.individual!.born_earliest ? html` <span class="muted">b.&thinsp;${m.individual!.born_earliest}</span>` : nothing}${this.renderDagger(m.individual!.life_status)}${!m.is_current ? html` <span class="muted">(former)</span>` : nothing}
            </li>
          `)}
        </ul>
      </section>
    `;
  }

  private renderSightings(designation: string) {
    return html`
      <section>
        <h2>Sightings</h2>
        ${this.#sightings.render({
          pending: () => html`<p class="placeholder">Searching sighting reports&hellip; this takes a few seconds.</p>`,
          error: () => html`<p class="error">Couldn't load sightings just now.</p>`,
          complete: sightings => {
            if (!sightings || !sightings.links.length)
              return html`<p class="placeholder">No sighting reports mention ${designation} yet.</p>`;
            return html`
              ${this.renderPresence(sightings.links)}
              ${repeat(sightings.recent, occ => occ.id, occ => this.renderSighting(occ, sightings.linksByOccurrence.get(occ.id)))}
              ${when(sightings.links.length > sightings.recent.length, () => html`
                <p class="sightings-note">Showing the ${sightings.recent.length} most recent of ${sightings.links.length} reports.</p>
              `)}
            `;
          },
        })}
      </section>
    `;
  }

  private renderPresence(links: OccurrenceLink[]) {
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

  private renderSighting(occurrence: Occurrence, link: OccurrenceLink | undefined) {
    const date = observedDate(occurrence.observed_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return html`
      <article class="sighting">
        <div class="sighting-context">
          ${link ? html`<a href=${mapUrl(link)}>${date}</a>` : date}
          ${link?.via_group ? html` · mentioned as ${link.via_group}` : nothing}
          ${link ? html` · <span class="status ${link.status}">${STATUS_LABELS[link.status]}</span>` : nothing}
        </div>
        <obs-summary .sighting=${occurrence}></obs-summary>
      </article>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'individual-page': IndividualPage;
  }
}
