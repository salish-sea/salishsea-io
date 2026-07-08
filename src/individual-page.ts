import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Task } from '@lit/task';
import { when } from 'lit/directives/when.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  displayName, fetchAllGroups, fetchGroupMembers, fetchIndividual, fetchOccurrenceLinks,
  ecotypePath, fetchOffspring, fetchParents, groupChain, individualPath, mapUrl, matrilinePath,
  observedDate, parseIndividualPath,
  type GroupMember, type IndividualProfile, type OccurrenceLink, type Offspring, type Parent, type SocialGroup,
} from './catalog.ts';
import { profileStyles, renderDagger, renderMemberList, renderPresenceTable, renderRelative } from './profile-shared.ts';
import { sentryClient } from './sentry.ts';
import './individual-map.ts';

sentryClient.init();

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
    task: async ([individualId]): Promise<OccurrenceLink[] | null> =>
      individualId ? fetchOccurrenceLinks(individualId) : null,
  });

  static styles = [profileStyles, css`
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
    h2 a {
      color: inherit;
    }
    h2 a:hover {
      color: #1976d2;
    }
  `];

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
      }${ecotype ? html` · <a href=${ecotypePath(ecotype.designation)}>${ecotype.designation === 'Biggs' ? "Bigg's (transient) killer whales" : ecotype.designation}</a>` : nothing}
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
            <dd>${renderRelative(mother!)}${certainty !== 'confirmed' ? html` <span class="muted">(${certainty})</span>` : nothing}</dd>
          `)}
          ${when(father, () => html`
            <dt>Father</dt>
            <dd>${renderRelative(father!)}${profile.paternity_certainty && profile.paternity_certainty !== 'confirmed' ? html` <span class="muted">(${profile.paternity_certainty})</span>` : nothing}</dd>
          `)}
          ${when(offspring.length, () => html`
            <dt>Offspring</dt>
            <dd>
              <ul class="people">
                ${repeat(offspring, calf => calf.id, calf => html`
                  <li>${renderRelative(calf)}${calf.born_earliest ? html` <span class="muted">b.&thinsp;${calf.born_earliest}</span>` : nothing}${renderDagger(calf.life_status)}</li>
                `)}
              </ul>
            </dd>
          `)}
        </dl>
      </section>
    `;
  }

  private renderMatriline(matriline: SocialGroup, members: GroupMember[], selfId: number) {
    return html`
      <section>
        <h2><a href=${matrilinePath(matriline.designation)}>${matriline.designation} matriline</a></h2>
        ${renderMemberList(members, selfId)}
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
          complete: links => {
            if (!links?.length)
              return html`<p class="placeholder">No sighting reports mention ${designation} yet.</p>`;
            const latest = links[0]!;
            const located = links.filter(l => l.location).length;
            return html`
              ${renderPresenceTable(links)}
              ${when(located, () => html`<individual-map .links=${links}></individual-map>`)}
              <p class="sightings-note">
                Last reported <a href=${mapUrl(latest)}>${observedDate(latest.observed_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</a>${latest.via_group ? html` (as ${latest.via_group})` : nothing}
                · ${links.length} report${links.length === 1 ? '' : 's'} in all${when(located, () => html` — ${located === links.length ? 'each' : `${located} of them`} a dot above; the newest located report is solid. Click one to see that day on the map.`)}
              </p>
            `;
          },
        })}
      </section>
    `;
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'individual-page': IndividualPage;
  }
}
