-- Daily human page views and visitors over the last 30 days. Spot spikes (e.g. a social post landing).
SELECT date,
       count(*)                   AS page_views,
       count(DISTINCT request_ip) AS visitors
FROM salishsea_logs.human_pageviews
WHERE date >= current_date - interval '30' day
GROUP BY date
ORDER BY date;
