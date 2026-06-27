-- Top user agents among HTML requests (30 days), bots INCLUDED. Use this to see the human/bot split
-- and to discover new bots that should be added to the human_pageviews filter.
SELECT url_decode(user_agent)     AS user_agent,
       count(*)                   AS requests,
       count(DISTINCT request_ip) AS ips
FROM salishsea_logs.cloudfront_logs
WHERE date >= current_date - interval '30' day
  AND sc_content_type LIKE 'text/html%'
GROUP BY 1
ORDER BY requests DESC
LIMIT 30;
