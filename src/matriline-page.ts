import { html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Task } from '@lit/task';
import { when } from 'lit/directives/when.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  displayName, fetchAllGroups, fetchGroupMembers, fetchGroupOccurrenceLinks, fetchMatriline,
  ecotypePath, groupChain, mapUrl, matrilinePath, observedDate, parseMatrilinePath,
  type GroupMember, type MatrilineProfile, type OccurrenceLink, type SocialGroup,
} from './catalog.ts';
import { profileStyles, renderDagger, renderMemberList, renderPresenceTable, renderRelative } from './profile-shared.ts';
import { sentryClient } from './sentry.ts';
import './individual-map.ts';

sentryClient.init();

interface Profile {
  group: MatrilineProfile;
  groups: Map<number, SocialGroup>;
  members: GroupMember[];
  name: string | null;
}

@customElement('matriline-page')
export class MatrilinePage extends LitElement {
  @state() private designation = parseMatrilinePath(window.location.pathname);

  #profile = new Task(this, {
    args: () => [this.designation] as const,
    task: async ([designation]): Promise<Profile | null> => {
      if (!designation) return null;
      const group = await fetchMatriline(designation);
      if (!group) return null;
      const [members, groups] = await Promise.all([
        fetchGroupMembers(group.id),
        fetchAllGroups(),
      ]);
      const name = displayName(group.nicknames);
      document.title = `${name ? `${name} (${group.designation} matriline)` : `The ${group.designation} matriline`} · SalishSea.io`;
      return { group, groups, members, name };
    },
  });

  // The slow half runs after the profile so the masthead paints first
  // (individual-page precedent).
  #sightings = new Task(this, {
    args: () => [this.#profile.value?.group.id] as const,
    task: async ([groupId]): Promise<OccurrenceLink[] | null> =>
      groupId ? fetchGroupOccurrenceLinks(groupId) : null,
  });

  static styles = profileStyles;

  render() {
    return html`
      <main>
        <a class="back" href="/">&#8592; Back to the map</a>
        ${this.#profile.render({
          pending: () => html`<p class="placeholder">Looking up the ${this.designation} matriline&hellip;</p>`,
          error: () => html`<p class="error">Something went wrong loading this page. Please try again.</p>`,
          complete: value => value ? this.renderProfile(value) : this.renderNotFound(),
        })}
      </main>
    `;
  }

  private renderNotFound() {
    return html`
      <h1>${this.designation ?? 'Not found'}</h1>
      <p>We don't have ${this.designation ? html`a <b>${this.designation}</b> matriline` : 'that matriline'} in our catalog.
      So far it covers Bigg's (transient) killer whales of the Salish Sea; other populations are on the way.</p>
      <p><a href="/">Explore the sightings map</a> or <a href="/about.html">read about this site</a>.</p>
    `;
  }

  private renderProfile({ group, groups, members, name }: Profile) {
    const chain = groupChain(group.id, groups);
    const biggs = chain.some(g => g.kind === 'ecotype' && g.designation === 'Biggs');
    const anchor = group.anchor;
    const current = members.filter(m => m.is_current);
    return html`
      <header class="masthead">
        <div class="designation-kicker">${name ? `${group.designation} matriline` : biggs ? "Bigg's killer whale matriline" : 'Matriline'}</div>
        <h1>${name ?? `The ${group.designation} matriline`}</h1>
        <p class="vitals">
          ${anchor ? html`Matriline of ${renderRelative(anchor)}${renderDagger(anchor.life_status)}` : nothing}${anchor && current.length ? ' · ' : nothing}${current.length ? `${current.length} current member${current.length === 1 ? '' : 's'}` : nothing}
        </p>
        ${when(this.renderChain(chain) !== nothing, () => html`<p class="lineage">${this.renderChain(chain)}</p>`)}
      </header>
      ${this.renderNaming(group)}
      ${this.renderMembers(members)}
      ${this.renderSightings(group.designation)}
    `;
  }

  // "Within T065's matriline · Bigg's (transient) killer whales" — ancestors
  // only; the masthead already names the group itself.
  private renderChain(chain: SocialGroup[]): TemplateResult | typeof nothing {
    const ancestors = chain.slice(1);
    const parents = ancestors.filter(g => g.kind !== 'ecotype');
    const ecotype = ancestors.find(g => g.kind === 'ecotype');
    if (!parents.length && !ecotype) return nothing;
    return html`${parents.map((g, i) => html`${i ? ' · ' : ''}Within ${g.kind === 'matriline'
        ? html`<a href=${matrilinePath(g.designation)}>${g.designation}</a>`
        : g.designation}${g.kind === 'matriline' ? "'s matriline" : ` ${g.kind}`}`)
      }${ecotype ? html`${parents.length ? ' · ' : ''}<a href=${ecotypePath(ecotype.designation)}>${ecotype.designation === 'Biggs' ? "Bigg's (transient) killer whales" : ecotype.designation}</a>` : nothing}`;
  }

  // Naming facts only (name, status, year, namer) — no story prose (D-21).
  private renderNaming(group: MatrilineProfile) {
    const nicknames = group.nicknames.filter(n => n.status !== 'deprecated');
    if (!nicknames.length) return nothing;
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
      </section>
    `;
  }

  private renderMembers(members: GroupMember[]) {
    return html`
      <section>
        <h2>Members</h2>
        ${members.length
          ? renderMemberList(members)
          : html`<p class="placeholder">No cataloged members yet.</p>`}
      </section>
    `;
  }

  private renderSightings(designation: string) {
    return html`
      <section>
        <h2>Sightings</h2>
        <p class="sightings-note">Reports that mention the ${designation}s as a group. Sightings reported
        against individual members appear on their own pages instead.</p>
        ${this.#sightings.render({
          pending: () => html`<p class="placeholder">Searching sighting reports&hellip;</p>`,
          error: () => html`<p class="error">Couldn't load sightings just now.</p>`,
          complete: links => {
            if (!links?.length)
              return html`<p class="placeholder">No sighting reports mention the ${designation}s as a group yet.</p>`;
            const latest = links[0]!;
            const located = links.filter(l => l.location).length;
            return html`
              ${renderPresenceTable(links)}
              ${when(located, () => html`<individual-map .links=${links}></individual-map>`)}
              <p class="sightings-note">
                Last reported <a href=${mapUrl(latest)}>${observedDate(latest.observed_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</a>
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
    'matriline-page': MatrilinePage;
  }
}
