import { html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Task } from '@lit/task';
import {
  fetchAllHaulouts, fetchHaulout, fetchHauloutReports, hauloutPath, parseHauloutPath, type HauloutReport,
} from './catalog.ts';
import { canonicalize, profileStyles, renderProfileFrame } from './profile-shared.ts';
import {
  hauloutProfile, hauloutStyles, hauloutTitle, renderHauloutProfile, renderHauloutReports, renderHauloutVitals,
  type HauloutProfileData,
} from './haulout-profile.ts';
import { initSentry } from './sentry.ts';
import './individual-map.ts';

initSentry();

@customElement('haulout-page')
export class HauloutPage extends LitElement {
  @state() private siteId = parseHauloutPath(window.location.pathname);

  #profile = new Task(this, {
    args: () => [this.siteId] as const,
    task: async ([id]): Promise<HauloutProfileData | null> => {
      if (id === null) return null;
      const [site, all] = await Promise.all([fetchHaulout(id), fetchAllHaulouts()]);
      if (!site) return null;
      canonicalize(hauloutPath(site));
      document.title = `${hauloutTitle(site)} · SalishSea.io`;
      return hauloutProfile(site, all);
    },
  });

  // The slow half (a spatial join over every pinniped report) runs after the
  // profile so the masthead paints first.
  #reports = new Task(this, {
    args: () => [this.#profile.value?.site.id] as const,
    task: async ([id]): Promise<HauloutReport[] | null> => id === undefined ? null : fetchHauloutReports(id),
  });

  static styles = [profileStyles, hauloutStyles];

  render() {
    return renderProfileFrame(html`
        ${this.#profile.render({
          pending: () => html`<p class="placeholder">Looking up this haul-out site&hellip;</p>`,
          error: () => html`<p class="error">Something went wrong loading this page. Please try again.</p>`,
          complete: value => value ? this.renderProfile(value) : this.renderNotFound(),
        })}
    `);
  }

  private renderNotFound() {
    return html`
      <h1>Not found</h1>
      <p>No haul-out site answers to this address.</p>
    `;
  }

  // The shared template, with the parts that wait on the reports. Pending and error
  // are the live page's alone — a prerendered page has its reports in hand.
  private renderProfile(profile: HauloutProfileData) {
    const { site } = profile;
    return renderHauloutProfile(profile, {
      vitals: this.#reports.render({
        pending: () => html`<p class="vitals muted">Counting reports within ${site.radius_m} m&hellip;</p>`,
        error: () => nothing,
        complete: reports => renderHauloutVitals(site, reports),
      }),
      dots: (this.#reports.value ?? []).filter(r => r.location),
      reports: this.#reports.render({
        pending: () => html`<p class="placeholder">Searching sighting reports&hellip;</p>`,
        error: () => html`<p class="error">Couldn't load reports just now.</p>`,
        complete: reports => renderHauloutReports(site, reports),
      }),
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'haulout-page': HauloutPage;
  }
}
