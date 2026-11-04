/**
 * A matriline's profile page, as templates that render anywhere (decision 057).
 *
 * As src/individual-profile.ts is for an individual: the read-path build fills these
 * from the snapshot (scripts/read-path/profiles.ts). Nothing here touches the window,
 * the document, or the network.
 */

import { html, nothing, type TemplateResult } from 'lit';
import { when } from 'lit/directives/when.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  isPopulation, podLabel, podPath, populationLabel, populationNoun, populationPath, groupChain, matrilinePath,
  type CatalogGroup, type GroupMember, type MatrilineProfile, type OccurrenceLink,
} from './catalog.ts';
import {
  renderDagger, renderMemberList, renderRelative, renderSightingsSummary, type SightingsOptions,
} from './profile-shared.ts';
import { matrilineDot, type MapLegend } from './profile-map.ts';

/**
 * What the page shows of the group itself, named column by column: a group's
 * `notes` is never rendered (D-21), and this type says the page doesn't need it.
 */
export type ProfileMatriline = Pick<MatrilineProfile, 'id' | 'entity_id' | 'designation' | 'nicknames' | 'anchor'>;

export interface MatrilineProfileData {
  group: ProfileMatriline;
  groups: Map<number, CatalogGroup>;
  members: GroupMember[];
  name: string | null;
}

/** The page's title, as the tab and the link preview both show it. */
export function matrilineTitle({ group, name }: Pick<MatrilineProfileData, 'group' | 'name'>): string {
  return name ? `${name} (${group.designation} matriline)` : `The ${group.designation} matriline`;
}

/** What a link preview says about the page, as the Lambda@Edge function says it. */
export function matrilinePreview({ group, groups, name }: Pick<MatrilineProfileData, 'group' | 'groups' | 'name'>) {
  const population = groupChain(group.id, groups).find(isPopulation);
  return {
    title: matrilineTitle({ group, name }),
    description: `Members, naming, and sighting history of the ${group.designation} matriline of ${population ? `${populationNoun(population)}s` : 'killer whales'} in the Salish Sea.`,
    path: matrilinePath(group),
  };
}

/** The page's content, given its Sightings section's content. */
export function renderMatrilineProfile({ group, groups, members, name }: MatrilineProfileData, sightings: unknown) {
  const chain = groupChain(group.id, groups);
  const population = chain.find(isPopulation);
  const anchor = group.anchor;
  // Members not known to be dead: a status nobody recorded says nothing either way
  // (the same rule individual_occurrences uses for a group mention).
  const current = members.filter(m =>
    m.individual?.life_status !== 'deceased' && m.individual?.life_status !== 'presumed_deceased');
  return html`
    <header class="masthead">
      <div class="designation-kicker">${name ? `${group.designation} matriline` : population ? `${populationNoun(population)} matriline` : 'Matriline'}</div>
      <h1>${name ?? `The ${group.designation} matriline`}</h1>
      <p class="vitals">
        ${anchor ? html`Matriline of ${renderRelative(anchor)}${renderDagger(anchor.life_status, anchor.died)}` : nothing}${anchor && current.length ? ' · ' : nothing}${current.length ? `${current.length} current member${current.length === 1 ? '' : 's'}` : nothing}
      </p>
      ${when(renderChain(chain) !== nothing, () => html`<p class="lineage">${renderChain(chain)}</p>`)}
    </header>
    ${renderNaming(group)}
    ${renderMembers(group.id, members, groups)}
    <section>
      <h2>Sightings</h2>
      <p class="sightings-note">Reports that name the ${group.designation}s, a sub-lineage within the matriline,
      or only some of its members.</p>
      ${sightings}
    </section>
  `;
}

/**
 * The Sightings section's content once the links are known: its reports drawn apart by
 * whether they name the matriline, a sub-lineage within it, or only members (salish-fwyt.7).
 */
export function renderMatrilineSightings(designation: string, links: OccurrenceLink[] | null, options: SightingsOptions = {}) {
  return renderSightingsSummary(links,
    html`<p class="placeholder">No sighting reports name the ${designation}s or any of its members yet.</p>`,
    links ? {...options, mapDots: links.map(matrilineDot), legend: matrilineLegend(designation, links)} : options);
}

/** "T065As or T065Bs", "T065As, T065Bs or T065Cs". */
const either = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;

/**
 * What the legend under a matriline's map calls each kind of report, with how many there
 * are: "Reports naming T065s (6)", "Reports naming a sub-lineage, T065As or T065Bs
 * (1,418)", "Reports naming only members, such as T065A5 (822)". Not "lone": a report that
 * names T065A5 and no group says nothing about whether the animal was alone.
 */
export function matrilineLegend(designation: string, links: readonly OccurrenceLink[]): MapLegend {
  const count = (n: number) => n.toLocaleString('en-US');
  // Each name a kind's reports give, most often first; ties by name.
  const names = (list: (string | null | undefined)[]) => {
    const n = new Map<string, number>();
    for (const name of list) if (name) n.set(name, (n.get(name) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  };
  const own = links.filter(l => !l.via_group && !l.via_member);
  const subs = links.filter(l => l.via_group && !l.via_member);
  const members = links.filter(l => l.via_member);
  const subNames = names(subs.map(l => l.via_group)).map(d => `${d}s`);
  const memberNames = names(members.map(l => l.via_member));
  return {
    ...(own.length ? {own: `Reports naming ${designation}s (${count(own.length)})`} : {}),
    ...(subs.length ? {sub_lineage: `Reports naming a sub-lineage, ${
      subNames.length > 3 ? `such as ${either(subNames.slice(0, 2))}` : either(subNames)} (${count(subs.length)})`} : {}),
    ...(members.length ? {members: `Reports naming only ${
      memberNames.length > 1 ? `members, such as ${memberNames[0]}` : `a member, ${memberNames[0]}`} (${count(members.length)})`} : {}),
  };
}

// "Within T065's matriline · Bigg's (transient) killer whales", or "Within J pod ·
// Southern Resident killer whales" — ancestors only; the masthead already names the group itself.
function renderChain(chain: CatalogGroup[]): TemplateResult | typeof nothing {
  const ancestors = chain.slice(1);
  const parents = ancestors.filter(g => !isPopulation(g));
  const population = ancestors.find(isPopulation);
  if (!parents.length && !population) return nothing;
  return html`${parents.map((g, i) => html`${i ? ' · ' : ''}Within ${g.kind === 'pod'
      ? html`<a href=${podPath(g)}>${podLabel(g)}</a>`
      : html`${g.kind === 'matriline'
        ? html`<a href=${matrilinePath(g)}>${g.designation}</a>`
        : g.designation}${g.kind === 'matriline' ? "'s matriline" : ` ${g.kind}`}`}`)
    }${population ? html`${parents.length ? ' · ' : ''}<a href=${populationPath(population)}>${populationLabel(population)}</a>` : nothing}`;
}

// Naming facts only (name, status, year, namer) — no story prose (D-21).
function renderNaming(group: ProfileMatriline) {
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

function renderMembers(groupId: number, members: GroupMember[], groups: Map<number, CatalogGroup>) {
  return html`
    <section>
      <h2>Members</h2>
      ${members.length
        ? renderMemberList(members, groupId, groups)
        : html`<p class="placeholder">No cataloged members yet.</p>`}
    </section>
  `;
}
