import { Temporal } from "temporal-polyfill";
import { acartiaExtent, salishSeaExtent, srkwExtent } from "../constants.ts";
import * as inaturalist from "./inaturalist.ts";
import * as maplify from "./maplify.ts";
import * as ferries from "./ferries.ts";


export const loadRecent = async () => {
  try {
    const earliest = Temporal.Now.plainDateISO().subtract({ hours: 240 });
    const latest = Temporal.Now.plainDateISO().add({ hours: 24 });
    const sightings = await maplify.fetchSightings(earliest, latest, acartiaExtent);
    const sightingsInserted = maplify.loadSightings(sightings);
    console.info(`Loaded ${sightingsInserted} sightings from Maplify.`);

    const salishSeaObservations = await inaturalist.fetchObservations({ earliest, extent: salishSeaExtent, latest, taxon_ids: [inaturalist.cetaceaId, inaturalist.otariidaeId] });
    const salishSeaIds = salishSeaObservations.map(obs => obs.id);
    const srkwObservations = await inaturalist.fetchObservations({ earliest, extent: srkwExtent, latest, taxon_ids: [inaturalist.orcaId] });
    const observations = [
      ...salishSeaObservations,
      ...srkwObservations.filter(obs => salishSeaIds.indexOf(obs.id) === -1),
    ];
    const observationsInserted = await inaturalist.loadObservations(observations);
    console.info(`Loaded ${observationsInserted} sightings from iNaturalist.`);
  } catch (e) {
    console.error(`Error loading sightings: ${e}`);
  }
};export const loadFerries = async () => {
  try {
    const locations = await ferries.fetchCurrentLocations();
    const insertionCount = ferries.loadLocations(locations);
    console.info(`Loaded ${insertionCount} ferry locations from WSF.`);
  } catch (e) {
    console.error(`Error loading ferry locations: ${e}`);
  }
};

