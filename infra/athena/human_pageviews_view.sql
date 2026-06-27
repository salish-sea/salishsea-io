-- View: human page views to salishsea.io, with bots/monitors/scanners and non-HTML assets filtered out.
-- Run this once after the Glue table exists (it is also saved as an Athena named query by the CDK stack).
-- "Page view" = a GET that returned an HTML document (200/304); CloudFront cannot see client-side SPA routes.
CREATE OR REPLACE VIEW salishsea_logs.human_pageviews AS
SELECT date, time, request_ip, uri, query_string, referrer, user_agent, status
FROM salishsea_logs.cloudfront_logs
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
