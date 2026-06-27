-- Most-requested paths among human page views (30 days).
-- NOTE: salishsea.io is a single-page app, so CloudFront sees nearly every page view as "/".
-- Per-view/feature usage needs client-side analytics (Sentry, or a tool like Plausible), not edge logs.
SELECT uri,
       count(*)                   AS page_views,
       count(DISTINCT request_ip) AS visitors
FROM salishsea_logs.human_pageviews
WHERE date >= current_date - interval '30' day
GROUP BY uri
ORDER BY page_views DESC
LIMIT 30;
