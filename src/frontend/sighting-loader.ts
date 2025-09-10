import type { ReactiveController } from "lit";
import type SalishSea from "./salish-sea.ts";
import { supabase } from "../database.ts";

export class SightingLoader implements ReactiveController {
  host: SalishSea;
  #abortController = new AbortController();

  constructor(host: SalishSea) {
    (this.host = host).addController(this);
  }

  hostConnected(): void {
  }

  setDate(date: string) {
    this.#abortController.abort();
    this.fetch(date);
  }

  private async fetch (date: string) {
    const {data, error} = await supabase.rpc('presence_on_date', {date}).abortSignal(this.#abortController.signal);
    if (error)
      return Promise.reject(error);
    if (!data)
      return Promise.reject(new Error("Got empty response from presence_on_date"));

    this.host.receiveSightings(data, date);
  }
}
