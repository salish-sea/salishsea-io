import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
import { fetchArchiveMetadata, formatBytes, formatRelativeTime, type DownloadInfo } from "./download-info.ts";

@customElement('about-page')
export class AboutPage extends LitElement {
  static styles = css`
    :host {
      display: block;
      max-width: 40rem;
      margin: 0 auto;
      padding: 1rem;
    }
    a {
      color: #1976d2;
    }
    .back {
      display: inline-block;
      margin-bottom: 1rem;
    }
    .downloads {
      margin-top: 0.25rem;
      padding-left: 1.25rem;
    }
    .downloads li {
      margin-bottom: 0.25rem;
    }
    .sha-link {
      font-size: 0.75rem;
      margin-left: 0.5rem;
      opacity: 0.65;
    }
    .freshness {
      font-size: 0.85rem;
      margin-top: 0.25rem;
      opacity: 0.8;
    }
  `;

  @state()
  private downloadInfo: DownloadInfo | null = null;

  protected async firstUpdated(_changedProperties: PropertyValues): Promise<void> {
    this.downloadInfo = await fetchArchiveMetadata();
  }

  protected render(): unknown {
    const info = this.downloadInfo;

    const zipSize = info?.ok && info.zipBytes != null
      ? html` <small>${formatBytes(info.zipBytes)}</small>`
      : '';
    const parquetSize = info?.ok && info.parquetBytes != null
      ? html` <small>${formatBytes(info.parquetBytes)}</small>`
      : '';

    let freshness: string;
    if (info === null) {
      freshness = '';
    } else if (info.ok && info.lastModified != null) {
      freshness = formatRelativeTime(info.lastModified);
    } else {
      freshness = 'Updated nightly at 09:00 UTC.';
    }

    return html`
      <a class="back" href="/">&#8592; Back to the map</a>
      <h1>About SalishSea.io</h1>
      <p>Communities throughout the Salish Sea are working to monitor and protect the diversity of life it supports. This site serves as a portal into their efforts.</p>
      <p>We currently show:</p>
      <ul>
        <li><a href="https://www.inaturalist.org/">iNaturalist</a> observations of cetaceans and pinnipeds</li>
        <li>Sightings submitted to the <a href="https://www.whalealert.org/">Whale Alert</a> mobile app by the public</li>
        <li>Sightings from the <a href="https://www.orcanetwork.org/">Orca Network</a> community</li>
        <li>Observations of humpbacks within the Salish Sea from <a href="https://happywhale.com">HappyWhale</a> (open data, 2012-April,2025)</li>
      </ul>
      <h2>Data download</h2>
      <p>
        The full observation dataset is published nightly as a
        <a href="https://dwc.tdwg.org/" target="_blank" rel="noopener noreferrer">Darwin Core Archive</a>, with a GeoParquet sidecar for
        spatial tools. Native SalishSea.io observations and Maplify / Whale Alert sightings
        (including Orca Network and Cascadia) are included; iNaturalist and Happywhale are
        excluded — those are already published to GBIF by their canonical sources. Licensed
        <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener noreferrer">CC BY-NC 4.0</a>.
      </p>
      <ul class="downloads">
        <li>
          <a href="/dwca/salishsea-occurrences-v1.zip" download>salishsea-occurrences-v1.zip</a>${zipSize}
          <a href="/dwca/salishsea-occurrences-v1.zip.sha256" class="sha-link" download>sha256</a>
        </li>
        <li>
          <a href="/dwca/salishsea-occurrences-v1.parquet" download>salishsea-occurrences-v1.parquet</a>${parquetSize}
          <a href="/dwca/salishsea-occurrences-v1.parquet.sha256" class="sha-link" download>sha256</a>
        </li>
      </ul>
      <p class="freshness">${freshness}</p>
      <p>
        If you have any feedback, use the Feedback button on the map, or email <a href="mailto:rainhead@gmail.com">rainhead@gmail.com</a>.
        This free, open access, site is based on <a href="https://github.com/salish-sea/salishsea-io">open source code</a> pioneered by Peter Abrahamsen
        and is funded in 2025-26 by <a href="https://beamreach.blue/">Beam Reach</a>.
      </p>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "about-page": AboutPage;
  }
}
