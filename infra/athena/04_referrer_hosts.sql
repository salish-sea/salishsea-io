-- Top external referrer HOSTS over 30 days (where human visitors come from). Self-referrals excluded.
SELECT url_extract_host(url_decode(referrer)) AS referrer_host,
       count(*)                               AS page_views,
       count(DISTINCT request_ip)             AS visitors
FROM salishsea_logs.human_pageviews
WHERE date >= current_date - interval '30' day
  AND referrer <> '-'
  AND lower(coalesce(url_extract_host(url_decode(referrer)), ''))
      NOT IN ('salishsea.io', 'www.salishsea.io', 'dev.salishsea.io')
GROUP BY 1
ORDER BY page_views DESC
LIMIT 30;
