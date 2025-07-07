import type { ReactiveController } from "lit";
import { queryStringAppend } from "./util.ts";
import { Temporal } from "temporal-polyfill";
import type { FeatureProperties, TemporalFeaturesResponse } from "../types.ts";
import type { Feature, Geometry } from "geojson";
import type SalishSea from "./salish-sea.ts";

const REFRESH_INTERVAL = Temporal.Duration.from({seconds: 30}).total('milliseconds');

export class SightingLoader implements ReactiveController {
  host: SalishSea;

  private date: string
  private lastResponseGeneratedAt = new Temporal.Instant(0n)
  private refreshTimer?: NodeJS.Timeout | undefined
  public features: Feature<Geometry, FeatureProperties>[] = []

  constructor(host: SalishSea, date: string) {
    (this.host = host).addController(this);
    this.date = date;
  }

  dateChanged(date: string) {
    this.date = date;
    this.lastResponseGeneratedAt = new Temporal.Instant(0n);
    this.fetch();
  }

  hostConnected(): void {
    this.fetch();
    this.startPeriodicFetch();
  }

  hostDisconnected(): void {
    this.stopPeriodicFetch();
  }

  private startPeriodicFetch() {
    this.refreshTimer = setInterval(() => {
      this.fetch();
    }, REFRESH_INTERVAL);
  }

  private stopPeriodicFetch() {
    clearInterval(this.refreshTimer);
  }

  async fetch() {
    this.stopPeriodicFetch();
    // TODO: use Cache API to improve offline experience, and to ensure up to date info
    const endpoint = queryStringAppend('/api/temporal-features', {d: this.date});
    try {
      const response = await fetch(endpoint, {headers: {Accept: 'application/json'}});
      if (!response.ok)
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const dateHeader = response.headers.get('Date');
      if (!dateHeader)
        throw new Error('Response missing Date header');
      const responseGeneratedAt = Temporal.Instant.fromEpochMilliseconds(Date.parse(dateHeader));
      const {params: {date}, ...collection}: TemporalFeaturesResponse = await response.json();
      if (date === this.date && Temporal.Instant.compare(this.lastResponseGeneratedAt, responseGeneratedAt) === -1) {
        this.features = collection.features;
        this.lastResponseGeneratedAt = responseGeneratedAt;
        this.host.setFeatures(collection);
        this.host.requestUpdate();
      }
    } catch (err) {
      console.debug(`Failed to request sightings: ${err}`);
    } finally {
      this.startPeriodicFetch();
    }
  }
}
