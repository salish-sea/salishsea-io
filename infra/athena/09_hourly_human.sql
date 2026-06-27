-- Human activity by hour of day (UTC) over 30 days. Pacific time = UTC - 7 (PDT) / - 8 (PST).
SELECT substr(time, 1, 2)         AS hour_utc,
       count(*)                   AS page_views,
       count(DISTINCT request_ip) AS visitors
FROM salishsea_logs.human_pageviews
WHERE date >= current_date - interval '30' day
GROUP BY 1
ORDER BY 1;
