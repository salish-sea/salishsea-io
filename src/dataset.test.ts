// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { BOUNDING_BOX } from '../scripts/dwca/eml.ts';

// dataset.html is typed by hand: its text, its citation and the schema.org Dataset block
// that search engines read (salish-rine). The archive's own values come from the dataset
// row the build writes (scripts/read-path/derive/dwc.sql) and from scripts/dwca/eml.ts.
// These tests keep the page from saying something the archive doesn't.

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf-8');

const sql = read('scripts/read-path/derive/dwc.sql');
const row = sql.slice(sql.indexOf('CREATE OR REPLACE TABLE pgdb.dwc.datasets'));
const fromRow = (column: string) => row.match(new RegExp(`'([^']+)' AS ${column}\\b`))?.[1];
const title = fromRow('title');
const datasetId = fromRow('dataset_id');
const rights = fromRow('intellectual_rights');

const page = new DOMParser().parseFromString(read('dataset.html'), 'text/html');
const text = (selector: string) => page.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
const blocks = page.querySelectorAll('script[type="application/ld+json"]');
const dataset = JSON.parse(blocks[0]?.textContent ?? 'null');

test('the dataset row has the values the page is checked against', () => {
  expect(title).toBeTruthy();
  expect(datasetId).toBeTruthy();
  expect(rights).toBeTruthy();
});

test('the citation names the dataset as the build does', () => {
  const citation = text('.citation');
  expect(citation).toContain(`. ${title}. `);
  expect(citation).toContain(datasetId);
});

test('the page has one Dataset block, at the datasetID, its canonical address', () => {
  expect(blocks).toHaveLength(1);
  expect(dataset['@type']).toBe('Dataset');
  expect(dataset['@id']).toBe(datasetId);
  expect(dataset.url).toBe(datasetId);
  expect(dataset.identifier).toBe(datasetId);
  expect(page.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(datasetId);
});

test("the block's name, version and description are the archive's and the page's", () => {
  expect(dataset.name).toBe(title);
  expect(title).toContain(`(v${dataset.version})`);
  expect(dataset.description).toBe(text('.description'));
  // Google's limits for a Dataset's description.
  expect(dataset.description.length).toBeGreaterThanOrEqual(50);
  expect(dataset.description.length).toBeLessThanOrEqual(5000);
});

test("the block's license is the archive's", () => {
  // The archive names the legal code; the block names the licence's page, which links it.
  expect(rights).toBe(`${dataset.license}legalcode`);
});

test("the block's box is the archive's geographic coverage", () => {
  const {south, west, north, east} = BOUNDING_BOX;
  // schema.org's box is "south west north east".
  expect(dataset.spatialCoverage.geo.box).toBe(`${south} ${west} ${north} ${east}`);
});

test("the block's downloads are the page's", () => {
  const links = [...page.querySelectorAll('.downloads a[download]:not(.sha-link)')]
    .map(a => new URL(a.getAttribute('href')!, 'https://salishsea.io/').href);
  expect(dataset.distribution.map((d: {contentUrl: string}) => d.contentUrl)).toEqual(links);
});

test("the block's temporal coverage runs from a day to the present", () => {
  expect(dataset.temporalCoverage).toMatch(/^\d{4}-\d{2}-\d{2}\/\.\.$/);
});
