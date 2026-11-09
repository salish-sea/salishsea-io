-- Who reads the day files (/read-path/days/<date>.json) over the last 30 days, by user agent:
-- people's browsers, search engines rendering the map, other sites ingesting the sightings,
-- people's scripts. `days_asked` is how many different days a client asked for: a few is
-- someone watching recent sightings, a thousand or more is the archive. `not_found` counts
-- the asks for a day with no file: a quiet day, or one no build has reached.
SELECT substr(url_decode(user_agent), 1, 120) AS user_agent,
       count(*)                   AS requests,
       count(*) FILTER (WHERE status = 404) AS not_found,
       count(DISTINCT request_ip) AS ips,
       count(DISTINCT uri)        AS days_asked,
       count(DISTINCT date)       AS active_days
FROM salishsea_logs.cloudfront_logs
WHERE date >= current_date - interval '30' day
  AND uri LIKE '/read-path/days/%'
GROUP BY 1
ORDER BY requests DESC
LIMIT 40;
