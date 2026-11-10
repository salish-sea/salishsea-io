# Seeing how salishsea.io is used

How many people visit salishsea.io, how they find it, which pages they read, and who else reads its sightings: CloudFront, the AWS service in front of salishsea.io, logs the requests it answers, and a set of saved queries in the AWS console turns those logs into answers. Running one takes a few clicks and no programming. AWS delivers the logs on a best-effort basis, so an occasional request goes unrecorded: the counts are close, not exact.

## Running a saved query

The queries run in **Athena**, the AWS service that answers questions about files stored in S3. Each one is saved, so you pick it from a list and press Run.

1. Sign in to Orcasound's AWS account (648183724555) and choose the **US West (Oregon)** region, `us-west-2`, in the region menu at the top right.
2. Open **Athena**: type "Athena" in the console's search box. If it shows a welcome page, choose **Launch query editor**; otherwise choose **Query editor** in the menu on the left.
3. At the top right of the editor, set **Workgroup** to **`salishsea-monitoring`**. If Athena asks you to acknowledge the workgroup's settings, do; they say where results are kept.
4. Open the **Saved queries** tab. Click a query's name: it opens in the editor.
5. Press **Run**. The answer appears below the query within a few seconds, and **Download results** saves it as a spreadsheet (CSV).

Every query covers the 30 calendar days before today, counted in UTC, and today so far. The logs usually arrive within an hour of the requests, occasionally up to a day later, so the last few hours may be missing. Each reads about 170 MB of logs, which costs about a tenth of a cent. Running one changes nothing on the site.

You don't need to edit a query, or to run `human_pageviews_view`: that one defines the filter described below, and whoever changes the filter runs it again.

## The saved queries

| Query | What it answers |
|---|---|
| `02_summary_human` | The headline: page views and visitors over 30 days, and the average views a day. |
| `03_daily_human` | Page views and visitors for each day. A spike is usually a link shared somewhere. |
| `04_referrer_hosts` | Which sites visitors arrive from (Google, Facebook, a partner's site), by page views and visitors. A visit that typed the address or came from an app usually names no site. |
| `05_referrer_urls` | The same, by the exact page the link was on. |
| `06_top_pages` | Which pages people read: the map (`/`), an animal's page (`/individuals/…`), a matriline's, a population's, a haul-out site's, the whales page, the about page. |
| `09_hourly_human` | Visits by hour of day, in UTC: subtract 7 hours for Pacific daylight time, 8 in winter. |
| `10_day_file_clients` | Who reads the files of each day's sightings, browsers and other programs alike. See the last section. |
| `01_summary_all` | Every request, people and programs together, with the share that were errors: how much of the traffic isn't people. |
| `07_user_agents` | The programs and browsers making requests, by the name each gives. |
| `08_status` | How the site answered: served (`200`), unchanged since last time (`304`), redirected (`301`), not found (`404`). Most `404`s are scanners trying addresses that don't exist; in November 2026 they were about one request in ten. |

An example, from 9 November 2026: `02_summary_human` answered 6,632 page views from 1,169 visitors over the previous 30 days, 214 views a day on average.

## What the numbers mean

**A page view** is one page the site sent to a person's browser: the map, a profile, the about page. Using the map once it has loaded (changing the day, opening a sighting, moving around) doesn't add page views; the map is one page.

**A visitor** is one internet address. That is an approximation: someone who reads on their phone and later on their laptop counts twice, and a household or office sharing one connection counts once. Daily visitor counts don't add up to a monthly total, because someone who visits on two days counts on each.

**The figures estimate people, leaving programs out as far as they can.** Most requests to the site come from programs: search engines, uptime monitors, AI crawlers, and scanners looking for weaknesses. So `02` to `06` and `09` count only what passes a filter, `human_pageviews`, which leaves out two kinds of program:

- Programs that say what they are: anything calling itself a bot, a crawler, a monitor, a link preview, or a scripting tool.
- Programs that pass themselves off as a browser but behave like none. A browser that loads a page also fetches that page's own files: its styles and scripts, and the map's sightings. A visitor counts only if their browser did that the same day. In October 2026, scrapers posing as Chrome fetched hundreds of profile pages in a day, each from a different address and each fetching nothing else. Before this rule they made daily visitors look like 600; there were between 30 and 90.

What the filter gets wrong: someone who returns to a single profile page with that page's files already saved in their browser fetches nothing else, and isn't counted; and a program that imitates a browser completely, files and all, is counted as a person. How often either happens isn't known. On ordinary days in October 2026, about one profile-page visitor in five fetched nothing but the page, which bounds the first.

**What the logs can't tell you:** where visitors are (the logs record no country), who they are, or what they did inside the map.

## Who reads the sightings directly

The map gets each day's sightings from a file the site publishes for that day, and those files are public: anyone's program can read them without visiting a page. `10_day_file_clients` lists who did, by the name each program gives, with:

- `requests`: how many times it asked;
- `ips`: from how many internet addresses;
- `days_asked`: how many different days' files, across all its addresses;
- `most_days_one_ip`: the most any one address asked for. A few means someone watching recent sightings; a thousand or more means one program reading the whole record;
- `not_found`: asks for a day with no file, such as a day with no sightings.

In the 30 days to 9 November 2026, programs made about four of every five of these requests. The largest were Google's crawler, which renders the map and follows its date links; EarthAtlas, which names itself a "whale-sightings ingest" and fetched more than 1,000 days from one address; an unnamed program calling itself `node` that read 1,769 days from one address; a `curl` download of nearly every day on record in four days; and orcular, which describes itself as personal sighting alerts and checks the latest days every few minutes. Browsers, on people's visits to the map, made about 13,000.

The full record is published for this kind of use as a [Darwin Core archive](https://salishsea.io/datasets/occurrences-v1), with its license and how to cite it; the day files carry neither.

## For whoever maintains this

How the logs, the tables and the saved queries are set up, and how to change them: [infra/athena/README.md](../infra/athena/README.md).
