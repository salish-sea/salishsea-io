import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Task } from '@lit/task';
import { when } from 'lit/directives/when.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { marked } from 'marked';
import { Temporal } from 'temporal-polyfill';
import {
  ATLAS_SPECIES, distanceKm, fetchAllHaulouts, fetchHaulout, fetchHauloutReports, hauloutPath, mapUrl,
  mediumPhotoUrl, observedDate, parseHauloutPath, type Haulout, type HauloutReport,
} from './catalog.ts';
import { canonicalize, profileStyles, renderPresenceTable } from './profile-shared.ts';
import { initSentry } from './sentry.ts';
import './individual-map.ts';

initSentry();

// The iNaturalist mirror, which carries essentially every pinniped report we
// hold, begins with 2025 (measured in production 2026-09-11: nothing earlier
// for any pinniped taxon). The presence grid runs from there rather than the
// four years the other profile pages draw, most of which would be blank here.
const MIRROR_SINCE_YEAR = 2025;

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

interface Profile {
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
    const label = report.taxon?.vernacular_name ?? report.taxon?.scientific_name ?? 'Unidentified pinniped';
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

@customElement('haulout-page')
export class HauloutPage extends LitElement {
  @state() private siteId = parseHauloutPath(window.location.pathname);

  #profile = new Task(this, {
    args: () => [this.siteId] as const,
    task: async ([id]): Promise<Profile | null> => {
      if (id === null) return null;
      const [site, all] = await Promise.all([fetchHaulout(id), fetchAllHaulouts()]);
      if (!site) return null;
      canonicalize(hauloutPath(site));
      document.title = `${site.name} haul-out · SalishSea.io`;
      const here = { lon: site.location.lon!, lat: site.location.lat! };
      const siblings = all.filter(s => s.id !== site.id && s.atlas_code && s.atlas_code === site.atlas_code);
      const neighbours = all
        .filter(s => s.id !== site.id && !siblings.includes(s) && s.location.lon != null && s.location.lat != null)
        .map(s => ({ site: s, km: distanceKm(here, { lon: s.location.lon!, lat: s.location.lat! }) }))
        .filter(n => n.km <= NEIGHBOUR_KM)
        .sort((a, b) => a.km - b.km)
        .slice(0, NEIGHBOUR_LIMIT);
      return { site, siblings, neighbours };
    },
  });

  // The slow half (a spatial join over every pinniped report) runs after the
  // profile so the masthead paints first.
  #reports = new Task(this, {
    args: () => [this.#profile.value?.site.id] as const,
    task: async ([id]): Promise<HauloutReport[] | null> => id === undefined ? null : fetchHauloutReports(id),
  });

  static styles = [profileStyles, css`
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
  `];

  render() {
    return html`
      <main>
        <a class="back" href="/">&#8592; Back to the map</a>
        ${this.#profile.render({
          pending: () => html`<p class="placeholder">Looking up this haul-out site&hellip;</p>`,
          error: () => html`<p class="error">Something went wrong loading this page. Please try again.</p>`,
          complete: value => value ? this.renderProfile(value) : this.renderNotFound(),
        })}
      </main>
    `;
  }

  private renderNotFound() {
    return html`
      <h1>Not found</h1>
      <p>No haul-out site answers to this address.</p>
    `;
  }

  private renderProfile({ site, siblings, neighbours }: Profile) {
    const reports = this.#reports.value ?? [];
    const dots = reports.filter(r => r.location);
    return html`
      <header class="masthead">
        <div class="designation-kicker">Haul-out site${site.region ? html` · ${site.region}` : nothing}</div>
        <h1>${site.name}</h1>
        ${this.renderVitals(site)}
      </header>
      <individual-map .links=${dots} .site=${{ lon: site.location.lon!, lat: site.location.lat!, radius_m: site.radius_m }}></individual-map>
      ${this.renderAtlas(site, siblings)}
      ${this.renderReports(site)}
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

  // Species seen, report and observer counts, the span of reports — from the
  // reports task, so it fills in once that lands.
  private renderVitals(site: Haulout) {
    return this.#reports.render({
      pending: () => html`<p class="vitals muted">Counting reports within ${site.radius_m} m&hellip;</p>`,
      error: () => nothing,
      complete: reports => {
        if (!reports?.length) return html`<p class="vitals">No pinniped reports within ${site.radius_m} m since ${MIRROR_SINCE_YEAR}.</p>`;
        const species = speciesGroups(reports).map(g => g.label);
        const observers = new Set(reports.map(r => r.observer ?? r.attribution)).size;
        const first = reports[reports.length - 1]!;
        const last = reports[0]!;
        return html`<p class="vitals">${species.join(', ')} · ${plural(reports.length, 'report')} from ${plural(observers, 'observer')}, ${monthYear(first.observed_at)}${first.observed_at !== last.observed_at ? ` to ${monthYear(last.observed_at)}` : ''}</p>`;
      },
    });
  }

  private renderAtlas(site: Haulout, siblings: Haulout[]) {
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

  private renderReports(site: Haulout) {
    return html`
      <section>
        <h2>Reports</h2>
        <p class="sightings-note">Pinniped sightings reported within ${site.radius_m} m of this point, nearly all from iNaturalist. A report here says someone saw seals or sea lions near a known site; it does not say which animals, or how many.</p>
        ${this.#reports.render({
          pending: () => html`<p class="placeholder">Searching sighting reports&hellip;</p>`,
          error: () => html`<p class="error">Couldn't load reports just now.</p>`,
          complete: reports => {
            if (!reports?.length)
              return html`<p class="placeholder">No pinniped reports within ${site.radius_m} m of this point since ${MIRROR_SINCE_YEAR}. The atlas listed it; nobody on iNaturalist has reported animals here since we began keeping their reports.</p>`;
            const years = Temporal.Now.zonedDateTimeISO('PST8PDT').year - MIRROR_SINCE_YEAR + 1;
            const groups = speciesGroups(reports);
            const photos = reports.flatMap(r => r.photos.filter(p => p.src).slice(0, 1).map(p => ({ report: r, photo: p }))).slice(0, PHOTO_STRIP_LIMIT);
            return html`
              ${groups.map(g => html`
                <h3>${g.label} <span class="muted">· ${plural(g.reports.length, 'report')}</span></h3>
                ${renderPresenceTable(g.reports, years)}
              `)}
              ${when(photos.length, () => html`
                <div class="strip">
                  ${photos.map(({ report, photo }) => html`
                    <a href=${mapUrl(report)} title="${report.taxon?.vernacular_name ?? ''} · ${observedDate(report.observed_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · ${photo.attribution ?? report.attribution ?? ''}">
                      <img src=${mediumPhotoUrl(photo.src!)} alt=${report.taxon?.vernacular_name ?? 'pinniped'} loading="lazy">
                    </a>
                  `)}
                </div>
              `)}
              <ul class="reports">
                ${reports.slice(0, REPORT_LIST_LIMIT).map(r => this.renderReport(r, site))}
              </ul>
              ${when(reports.length > REPORT_LIST_LIMIT, () => html`<p class="muted">and ${reports.length - REPORT_LIST_LIMIT} earlier reports.</p>`)}
              ${this.renderCoverage(reports, site)}
            `;
          },
        })}
      </section>
    `;
  }

  private renderReport(r: HauloutReport, site: Haulout): TemplateResult {
    const approx = r.accuracy !== null && r.accuracy > site.radius_m;
    return html`
      <li>
        <a href=${mapUrl(r)}>${observedDate(r.observed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</a>
        · ${r.taxon?.vernacular_name ?? r.taxon?.scientific_name ?? 'pinniped'}
        ${r.attribution ? html`· <span class="muted">${r.attribution}</span>` : nothing}
        · <span class="muted">${r.distance_m} m away</span>
        ${approx ? html`· <span class="approx">location approximate (±${r.accuracy} m)</span>` : nothing}
        ${r.url ? html`· <a target="_blank" rel="noopener noreferrer" href=${r.url}>source</a>` : nothing}
      </li>
    `;
  }

  // What the reports can and cannot say — so a count of reports is not read as
  // a count of animals, and a report is not read as more precise than it is.
  private renderCoverage(reports: HauloutReport[], site: Haulout) {
    const precise = reports.filter(r => r.accuracy !== null && r.accuracy <= site.radius_m).length;
    const unknown = reports.filter(r => r.accuracy === null).length;
    const withPhoto = reports.filter(r => r.photos.length).length;
    return html`
      <p class="presence-note">
        Of ${plural(reports.length, 'report')}, ${precise} state a location accurate to within ${site.radius_m} m${unknown ? `, ${unknown} state no accuracy` : ''}, and ${withPhoto} carry a photo. Reports rarely say how many animals were present, so no counts are shown.
      </p>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'haulout-page': HauloutPage;
  }
}
