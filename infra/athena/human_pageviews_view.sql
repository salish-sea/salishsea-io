-- View: human page views to salishsea.io, with bots/monitors/scanners and non-HTML assets filtered out.
-- Run this once after the Glue table exists (it is also saved as an Athena named query by the CDK stack).
-- "Page view" = a GET that returned an HTML document (200/304); CloudFront cannot see client-side SPA routes.
--
-- A page view counts only from a visitor (an IP, that day) whose browser also asked for one
-- of the page's own files and got it: its scripts and styles (/assets/), the build's data
-- (/read-path/), /release.json or the write API (/api/). Scrapers that pass as Chrome don't: on 2026-10-09,
-- -10, -14 and -30 hundreds of IPs each fetched one profile page and nothing else, and on
-- 2026-10-11 and -12 about 530 IPs a day fetched / without loading the map. Measured over
-- 2026-10-16..29, 79% of profile visitors and 65% of others asked for one of those files.
-- What it misses: a returning visitor who opens one profile page with /assets/ cached (a
-- year, immutable) and nothing else to fetch.
CREATE OR REPLACE VIEW salishsea_logs.human_pageviews AS
WITH page_loaders AS (
  SELECT DISTINCT date, request_ip
  FROM salishsea_logs.cloudfront_logs
  WHERE (uri LIKE '/assets/%' OR uri LIKE '/read-path/%' OR uri = '/release.json' OR uri LIKE '/api/%')
    -- answered with the file, so a probe of a path that isn't there (a 404) or a HEAD earns nothing
    AND (status BETWEEN 200 AND 299 OR status = 304)
    AND method IN ('GET', 'POST', 'PUT')
)
SELECT p.date, p.time, p.request_ip, p.uri, p.query_string, p.referrer, p.user_agent, p.status
FROM salishsea_logs.cloudfront_logs p
JOIN page_loaders l ON l.date = p.date AND l.request_ip = p.request_ip
WHERE sc_content_type LIKE 'text/html%'
  AND method = 'GET'
  AND status IN (200, 304)
  AND user_agent <> '-'
  AND lower(user_agent) NOT LIKE '%bot%'
  AND lower(user_agent) NOT LIKE '%spider%'
  AND lower(user_agent) NOT LIKE '%crawl%'
  AND lower(user_agent) NOT LIKE '%uptime%'
  AND lower(user_agent) NOT LIKE '%monitor%'
  AND lower(user_agent) NOT LIKE '%headless%'
  AND lower(user_agent) NOT LIKE '%slurp%'
  AND lower(user_agent) NOT LIKE '%python%'
  AND lower(user_agent) NOT LIKE '%curl%'
  AND lower(user_agent) NOT LIKE '%wget%'
  AND lower(user_agent) NOT LIKE '%go-http%'
  AND lower(user_agent) NOT LIKE '%java/%'
  AND lower(user_agent) NOT LIKE '%okhttp%'
  AND lower(user_agent) NOT LIKE '%scrapy%'
  AND lower(user_agent) NOT LIKE '%facebookexternalhit%'
  AND lower(user_agent) NOT LIKE '%preview%';
