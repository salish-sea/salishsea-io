import type { ReactiveController } from "lit";
import type SalishSea from "./salish-sea.ts";
import { supabase } from "./supabase.ts";
import type { Occurrence } from "../occurrence.ts";

export class SightingLoader implements ReactiveController {
  host: SalishSea;
  date: string | undefined;

  constructor(host: SalishSea) {
    (this.host = host).addController(this);
  }

  hostConnected(): void {
  }

  setDate(date: string) {
    console.debug(`Fetching presence for ${date}`);
    this.date = date;
    this.fetch(date);
  }

  private async fetch (date: string) {
    const {data, error} = await supabase.rpc('occurrences_on_date', {date});
    if (date !== this.date)
      return;
    if (error)
      return Promise.reject(error);
    if (!data)
      return Promise.reject(new Error("Got empty response from presence_on_date"));

    this.host.receiveSightings(data as Occurrence[], date);
  }
}
