/**
 * A haul-out site's page, as templates that render anywhere (decision 057).
 *
 * As src/individual-profile.ts is for an individual: the client-rendered page
 * (src/haulout-page.ts) fills these from Supabase, and the read-path build
 * (scripts/read-path/profiles.ts) from the snapshot. Nothing here touches the
 * window, the document, or the network. The site's story is markdown, rendered
 * by `marked` in either place.
 */

import { css, html, nothing, type TemplateResult } from 'lit';
import { when } from 'lit/directives/when.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { marked } from 'marked';
import { Temporal } from 'temporal-polyfill';
import {
  ATLAS_SPECIES, distanceKm, hauloutPath, mapUrl, mediumPhotoUrl, observedDate,
  type Haulout, type HauloutReport,
} from './catalog.ts';
import { renderPresenceTable } from './profile-shared.ts';

// How many years of presence grid a site draws: its own history, not a constant.
//
// This was `MIRROR_SINCE_YEAR = 2025`, measured on 2026-09-11 when the mirror
// began there. Decision 041's backfill moved it to 1978 a week later, and 11,438
// of the 17,376 pinniped reports we now hold — two thirds — fell below the line,
// which would have drawn every grid over the two most recent years and silently
// dropped the rest. A measured fact about the corpus does not belong in a
// constant; the reports are already in hand, so each site's grid spans the
// reports that site actually has.
//
// Capped because the tail is thin and one row per year: a site whose only early
// report is from 1978 would otherwise draw forty-odd blank rows to reach it. The
// cap is named in the coverage note rather than left to be noticed.
const MAX_PRESENCE_YEARS = 12;

/** Years of grid for a group: earliest report to now, at least 2, at most {@link MAX_PRESENCE_YEARS}. */
export function presenceYearsFor(
  reports: readonly { observed_at: string }[],
  currentYear: number,
): number {
  if (!reports.length) return 2;
  const earliest = Math.min(...reports.map(r => observedDate(r.observed_at).year));
  return Math.min(Math.max(currentYear - earliest + 1, 2), MAX_PRESENCE_YEARS);
}

/**
 * Whether the grid is hiding anything — asked of the reports, not inferred from
 * the year count.
 *
 * `years === MAX_PRESENCE_YEARS` is not the same question. A group whose
 * earliest report is exactly twelve years back fills the grid to its last row
 * with nothing beyond it, and a note promising earlier reports would be a
 * fabrication in the one place the page is explaining its own limits.
 */
export function hasReportsBefore(
  reports: readonly { observed_at: string }[],
  year: number,
): boolean {
  return reports.some(r => observedDate(r.observed_at).year < year);
}

// How far afield a site counts as a neighbour, and how many to list.
const NEIGHBOUR_KM = 8;
const NEIGHBOUR_LIMIT = 6;

const REPORT_LIST_LIMIT = 40;
const PHOTO_STRIP_LIMIT = 12;

const ATLAS_URL = 'https://github.com/user-attachments/files/31973228/Jeffries%2B2000.pdf';

const COUNT_CLASS: Record<string, string> = {
  '<10': 'fewer than 10 animals',
  '<100': 'fewer than 100 animals',
  '100-500': '100 to 500 animals',
  '500>': 'more than 500 animals',
};

const TIDAL_USE: Record<string, string> = {
  LOW: 'used mainly at low tide',
  HIGH: 'used mainly at high tide',
  ALL: 'used at all tidal states',
};

export interface HauloutProfileData {
  site: Haulout;
  // The atlas maps some sites at more than one point; these share its code.
  siblings: Haulout[];
  // Other sites within NEIGHBOUR_KM, nearest first.
  neighbours: { site: Haulout; km: number }[];
}

// Reports grouped by what they were filed as, most-reported species first.
interface SpeciesGroup {
  label: string;
  reports: HauloutReport[];
}

function speciesGroups(reports: HauloutReport[]): SpeciesGroup[] {
  const groups = new Map<string, HauloutReport[]>();
  for (const report of reports) {
    const label = report.species_name ?? 'Unidentified pinniped';
    groups.set(label, [...(groups.get(label) ?? []), report]);
  }
  return [...groups.entries()]
    .map(([label, reports]) => ({ label, reports }))
    .sort((a, b) => b.reports.length - a.reports.length);
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function monthYear(observedAt: string): string {
  return observedDate(observedAt).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * A site's page data, given every site: the atlas's other points for the same site,
 * and the other sites within {@link NEIGHBOUR_KM}, nearest first.
 */
export function hauloutProfile(site: Haulout, all: Haulout[]): HauloutProfileData {
  const here = { lon: site.location.lon!, lat: site.location.lat! };
  const siblings = all.filter(s => s.id !== site.id && s.atlas_code && s.atlas_code === site.atlas_code);
  const neighbours = all
    .filter(s => s.id !== site.id && !siblings.includes(s) && s.location.lon != null && s.location.lat != null)
    .map(s => ({ site: s, km: distanceKm(here, { lon: s.location.lon!, lat: s.location.lat! }) }))
    .filter(n => n.km <= NEIGHBOUR_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, NEIGHBOUR_LIMIT);
  return { site, siblings, neighbours };
}

export const hauloutStyles = css`
    .strip {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 1rem 0;
    }
    .strip a {
      display: block;
      width: 8rem;
      height: 8rem;
      overflow: hidden;
      border-radius: 4px;
      background: #eef2f7;
    }
    .strip img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .reports {
      list-style: none;
      padding: 0;
      margin: 0.5rem 0;
    }
    .reports li {
      padding: 0.35rem 0;
      border-bottom: 1px solid #eef2f7;
    }
    .approx {
      color: #b45309;
    }
    blockquote {
      margin: 0.5rem 0;
      padding-left: 1rem;
      border-left: 3px solid #e2e8f0;
      color: #475569;
    }
    .caveat {
      background: #fff7ed;
      border-left: 3px solid #f59e0b;
      padding: 0.5rem 0.75rem;
      margin: 0.75rem 0;
    }
    individual-map {
      margin: 1rem 0;
    }
    h3 {
      margin: 1rem 0 0.25rem;
      font-size: 1rem;
    }
    .neighbours {
      padding-left: 1.25rem;
    }
  `;

/** What the page is called, in the tab and in a link preview. */
export function hauloutTitle(site: Pick<Haulout, 'name'>): string {
  return `${site.name} haul-out`;
}

/** What a link preview says about the page, as the Lambda@Edge function says it. */
export function hauloutPreview({ site }: Pick<HauloutProfileData, 'site'>) {
  const species = (site.atlas_species ?? []).map(c => ATLAS_SPECIES[c] ?? c);
  return {
    title: hauloutTitle(site),
    description: `${species.length ? `${species.join(', ').replace(/^./, c => c.toUpperCase())} haul-out site` : 'Pinniped haul-out site'}${site.region ? ` in the ${site.region}` : ''}: what the 1999 WDFW atlas recorded, and what people report there now.`,
    path: hauloutPath(site),
  };
}

/**
 * The parts of the page that come from the site's reports: the masthead's vitals
 * line, the map's dots, and the Reports section's content. The client page fills
 * them as its reports load; the build, with the reports in hand. `mapSrc` is where
 * a prerendered page's map loads its dots from.
 */
export interface HauloutReportParts {
  vitals: unknown;
  dots: HauloutReport[];
  reports: unknown;
  mapSrc?: string;
}

/** The page's content. */
export function renderHauloutProfile({ site, siblings, neighbours }: HauloutProfileData, { vitals, dots, reports, mapSrc }: HauloutReportParts) {
  const mapSite = { lon: site.location.lon!, lat: site.location.lat!, radius_m: site.radius_m };
  return html`
    <header class="masthead">
      <div class="designation-kicker">Haul-out site${site.region ? html` · ${site.region}` : nothing}</div>
      <h1>${site.name}</h1>
      ${vitals}
    </header>
    <individual-map .links=${dots} .site=${mapSite} src=${mapSrc ?? nothing} site=${mapSrc ? JSON.stringify(mapSite) : nothing}></individual-map>
    ${renderAtlas(site, siblings)}
    <section>
      <h2>Reports</h2>
      <p class="sightings-note">Pinniped sightings reported within ${site.radius_m} m of this point, nearly all from iNaturalist. A report here says someone saw seals or sea lions near a known site; it does not say which animals, or how many.</p>
      ${reports}
    </section>
    ${when(site.story, () => html`
      <section>
        <h2>About this site</h2>
        ${unsafeHTML(marked.parse(site.story!, { async: false }))}
      </section>
    `)}
    ${when(neighbours.length, () => html`
      <section>
        <h2>Nearby sites</h2>
        <ul class="neighbours">
          ${neighbours.map(({ site: n, km }) => html`
            <li><a href=${hauloutPath(n)}>${n.name}</a> <span class="muted">· ${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}${n.atlas_species?.length ? ` · ${n.atlas_species.map(c => ATLAS_SPECIES[c] ?? c).join(', ')}` : ''}</span></li>
          `)}
        </ul>
      </section>
    `)}
  `;
}

// Species seen, report and observer counts, the span of reports.
export function renderHauloutVitals(site: Haulout, reports: HauloutReport[] | null) {
  if (!reports?.length) return html`<p class="vitals">No pinniped reports within ${site.radius_m} m.</p>`;
  const species = speciesGroups(reports).map(g => g.label);
  const observers = new Set(reports.map(r => r.observer ?? r.attribution).filter((v): v is string => v !== null)).size;
  const first = reports[reports.length - 1]!;
  const last = reports[0]!;
  return html`<p class="vitals">${species.join(', ')} · ${plural(reports.length, 'report')} from ${plural(observers, 'observer')}, ${monthYear(first.observed_at)}${first.observed_at !== last.observed_at ? ` to ${monthYear(last.observed_at)}` : ''}</p>`;
}

/**
 * The Reports section's content once the reports are known. `currentYear` pins the
 * grids' newest year, so a build renders the year of its snapshot, not of the clock.
 */
export function renderHauloutReports(
  site: Haulout,
  reports: HauloutReport[] | null,
  currentYear = Temporal.Now.zonedDateTimeISO('PST8PDT').year,
) {
  if (!reports?.length)
    return html`<p class="placeholder">No pinniped reports within ${site.radius_m} m of this point. The atlas listed it; nobody on iNaturalist has reported animals here in anything we hold.</p>`;
  const groups = speciesGroups(reports);
  const photos = reports.flatMap(r => r.photos.filter(p => p.src).slice(0, 1).map(p => ({ report: r, photo: p }))).slice(0, PHOTO_STRIP_LIMIT);
  return html`
    ${groups.map(g => {
      // Per SPECIES, not per site: a site whose sea lions go back to
      // 2015 and whose one eared seal was seen last month should not
      // draw twelve near-empty rows for the seal. Each grid spans the
      // history of the animal it is about.
      const years = presenceYearsFor(g.reports, currentYear);
      const hidden = hasReportsBefore(g.reports, currentYear - years + 1);
      return html`
      <h3>${g.label} <span class="muted">· ${plural(g.reports.length, 'report')}</span></h3>
      ${renderPresenceTable(g.reports, years, `Reports per month, as identified on iNaturalist by the people who filed them${hidden ? `; the grid shows the last ${years} years, and there are earlier reports` : ''}.`, currentYear)}
    `;})}
    ${when(photos.length, () => html`
      <p class="muted">Photos from the reports. Each links to its source; the attribution is in the tooltip.</p>
      <div class="strip">
        ${photos.map(({ report, photo }) => html`
          <a href=${report.url ?? mapUrl(report)} target="_blank" rel="noopener noreferrer" title="${report.species_name ?? ''} · ${observedDate(report.observed_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · ${photo.attribution ?? report.attribution ?? ''}">
            <img src=${mediumPhotoUrl(photo.src!)} alt=${photo.attribution ?? report.attribution ?? 'photo of the report'} loading="lazy">
          </a>
        `)}
      </div>
    `)}
    <ul class="reports">
      ${reports.slice(0, REPORT_LIST_LIMIT).map(r => renderReport(r, site))}
    </ul>
    ${when(reports.length > REPORT_LIST_LIMIT, () => html`<p class="muted">and ${reports.length - REPORT_LIST_LIMIT} earlier reports.</p>`)}
    ${renderCoverage(reports, site)}
  `;
}

function renderAtlas(site: Haulout, siblings: Haulout[]) {
  if (!site.atlas_code) return nothing;
  const species = (site.atlas_species ?? []).map(c => ATLAS_SPECIES[c] ?? c);
  const facts = [
    species.length ? species.join(', ') : null,
    site.atlas_count ? COUNT_CLASS[site.atlas_count] ?? site.atlas_count : null,
    site.atlas_tidal_use ? TIDAL_USE[site.atlas_tidal_use] ?? site.atlas_tidal_use : null,
  ].filter(Boolean);
  return html`
    <section>
      <h2>In the atlas</h2>
      <p>Site ${site.atlas_code} in the WDFW <a target="_blank" rel="noopener noreferrer" href=${ATLAS_URL}>Atlas of Seal and Sea Lion Haulout Sites in Washington</a> (Jeffries et al., 2000), surveyed in the late 1990s${facts.length ? html`: ${facts.join(' · ')}` : ''}.</p>
      ${when(site.atlas_description, () => html`<blockquote>${site.atlas_description}</blockquote>`)}
      ${when(siblings.length, () => html`
        <p class="muted">The atlas maps this site at ${siblings.length + 1} points. The others: ${siblings.map((s, i) => html`${i ? ', ' : ''}<a href=${hauloutPath(s)}>${s.atlas_description ?? s.name}</a>`)}.</p>
      `)}
      ${when(!site.verified, () => html`
        <p class="caveat">This entry was extracted from the atlas's tables by machine and has not yet been checked against the printed page. Its coordinates are the atlas's, in a 1927 datum, and may sit up to 200 m from where a modern map puts them.</p>
      `)}
    </section>
  `;
}

function renderReport(r: HauloutReport, site: Haulout): TemplateResult {
  const approx = r.accuracy !== null && r.accuracy > site.radius_m;
  return html`
    <li>
      <a href=${mapUrl(r)}>${observedDate(r.observed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</a>
      · ${r.species_name ?? 'pinniped'}
      ${r.attribution ? html`· <span class="muted">${r.attribution}</span>` : nothing}
      · <span class="muted">${r.distance_m} m away</span>
      ${approx ? html`· <span class="approx">location approximate (±${r.accuracy} m)</span>` : nothing}
      ${r.url ? html`· <a target="_blank" rel="noopener noreferrer" href=${r.url}>source</a>` : nothing}
    </li>
  `;
}

// What the reports can and cannot say — so a count of reports is not read as
// a count of animals, and a report is not read as more precise than it is.
function renderCoverage(reports: HauloutReport[], site: Haulout) {
  const precise = reports.filter(r => r.accuracy !== null && r.accuracy <= site.radius_m).length;
  const unknown = reports.filter(r => r.accuracy === null).length;
  const withPhoto = reports.filter(r => r.photos.length).length;
  return html`
    <p class="presence-note">
      Of ${plural(reports.length, 'report')}, ${precise} state a location accurate to within ${site.radius_m} m${unknown ? `, ${unknown} state no accuracy` : ''}, and ${withPhoto} carry a photo. Reports rarely say how many animals were present, so no counts are shown.
    </p>
  `;
}
