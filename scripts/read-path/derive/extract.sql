-- The two text extractions the occurrence views call, as the build runs them (decision
-- 061, salish-xv35.17): twins of Postgres's extract_travel_direction and
-- extract_identifiers, which read a sighting's free text for a travel direction and for
-- the designations it names. Temp macros, created by derive-occurrences.ts and dwca.ts
-- after derive/sources.sql; a view calls them where the Postgres view calls the function.
--
-- Postgres's patterns use its word boundaries \m and \M, which DuckDB's RE2 lacks. RE2
-- has \b, which is the same boundary over ASCII word characters [0-9A-Za-z_]; Postgres's
-- word characters are Unicode letters and digits plus _. The two differ only where a
-- non-ASCII letter or digit touches a match: Postgres sees "éT65A" as one word and finds
-- no identifier, RE2 sees a boundary after é and finds T65A. Over every production text
-- on 2026-10-04 (52,988, of which 911 hold a non-ASCII character) the two answered the
-- same on all; derive/extract.test.ts pins the corpus strings where they do not.
-- Until then these ran as JavaScript, which could spell the boundaries out, at the cost of
-- streaming every text out of DuckDB and back and leaving the process 65 MB larger.
--
-- Twins, not improvements: what Postgres would answer, quirks included. Postgres's
-- case-insensitive flag adds only each letter's own upper and lower case, where RE2's (?i)
-- folds Unicode (ſ matches s, the Kelvin sign k), so the patterns spell the cases out; its
-- \d is Unicode digits, so \p{Nd} here; its \W is a non-word character in the Unicode
-- sense, spelled [^\p{L}\p{Nd}_].

-- Postgres: `substring(body FROM '(?i)\m(north(\W*(east|west)|)|(south(\W*(east|west)|))|west|east)(\W*bound)?\M')`,
-- lowered, with every non-word character removed, cast to travel_direction. substring()
-- answers with the first match's first parenthesized group, so a trailing "bound" is
-- matched but not kept: "south-westbound" is "southwest". NULL for no match, as a STRICT
-- function over substring()'s NULL is.
CREATE OR REPLACE TEMP MACRO extract_travel_direction(body) AS (
  SELECT CASE WHEN m = '' THEN NULL ELSE lower(regexp_replace(m, '[^\p{L}\p{Nd}_]', '', 'g')) END
  FROM (SELECT regexp_extract(body,
    '\b([nN][oO][rR][tT][hH]([^\p{L}\p{Nd}_]*([eE][aA][sS][tT]|[wW][eE][sS][tT])|)|([sS][oO][uU][tT][hH]([^\p{L}\p{Nd}_]*([eE][aA][sS][tT]|[wW][eE][sS][tT])|))|[wW][eE][sS][tT]|[eE][aA][sS][tT])([^\p{L}\p{Nd}_]*[bB][oO][uU][nN][dD])?\b',
    1) AS m));

-- Postgres: every match of `\m(j|k|l|t|crc)[- ]?0*(\d[\da-f]+)(s?)\M`, case-insensitively,
-- in order, each as upper(pod) || digits as written || lower(s). NULL when there are none,
-- as array_agg over no rows is; the views COALESCE that to an empty array. Three extractions
-- of the same pattern, zipped: regexp_extract_all gives one group at a time, and the
-- matches line up by position.
CREATE OR REPLACE TEMP MACRO extract_identifiers(body) AS (
  SELECT CASE WHEN len(ids) = 0 THEN NULL ELSE ids END
  FROM (SELECT list_transform(
    list_zip(regexp_extract_all(body, '\b([jJ]|[kK]|[lL]|[tT]|[cC][rR][cC])[- ]?0*(\p{Nd}[\p{Nd}a-fA-F]+)([sS]?)\b', 1),
             regexp_extract_all(body, '\b([jJ]|[kK]|[lL]|[tT]|[cC][rR][cC])[- ]?0*(\p{Nd}[\p{Nd}a-fA-F]+)([sS]?)\b', 2),
             regexp_extract_all(body, '\b([jJ]|[kK]|[lL]|[tT]|[cC][rR][cC])[- ]?0*(\p{Nd}[\p{Nd}a-fA-F]+)([sS]?)\b', 3)),
    x -> upper(x[1]) || x[2] || lower(x[3])) AS ids));
