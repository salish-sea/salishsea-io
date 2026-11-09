-- Who reads the day files (/read-path/days/<date>.json) over the last 30 days, by user agent:
-- people's browsers, search engines rendering the map, other sites ingesting the sightings,
-- people's scripts. A user agent names software, not a client, so `days_asked` adds up every
-- address that sent it; `most_days_one_ip` is the most any one address asked for: a few is
-- someone watching recent sightings, a thousand or more is one client reading the archive.
-- `not_found` counts the asks for a day with no file: a quiet day, or one no build has reached.
WITH asks AS (
  SELECT url_decode(replace(user_agent, '+', '%2B')) AS user_agent, request_ip, uri, status  -- a literal + survives decoding
  FROM salishsea_logs.cloudfront_logs
  WHERE date >= current_date - interval '30' day
    AND uri LIKE '/read-path/days/%'
),
per_ip AS (
  SELECT user_agent, request_ip, count(DISTINCT uri) AS days
  FROM asks GROUP BY 1, 2
)
SELECT a.user_agent,
       count(*)                             AS requests,
       count(*) FILTER (WHERE a.status = 404) AS not_found,
       count(DISTINCT a.request_ip)         AS ips,
       count(DISTINCT a.uri)                AS days_asked,
       max(p.days)                          AS most_days_one_ip
FROM asks a
JOIN per_ip p ON p.user_agent = a.user_agent AND p.request_ip = a.request_ip
GROUP BY 1
ORDER BY requests DESC
LIMIT 40;
