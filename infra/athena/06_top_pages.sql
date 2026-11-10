-- Most-requested paths among human page views (30 days).
-- The map is one page, "/", whatever day or sighting it shows; each profile page, the whales page and
-- the about page has its own path.
SELECT uri,
       count(*)                   AS page_views,
       count(DISTINCT request_ip) AS visitors
FROM salishsea_logs.human_pageviews
WHERE date >= current_date - interval '30' day
GROUP BY uri
ORDER BY page_views DESC
LIMIT 30;
