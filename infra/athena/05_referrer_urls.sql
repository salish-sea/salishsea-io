-- Top external referrer URLs (full path) over 30 days. Finer-grained than hosts. Self-referrals excluded.
SELECT url_decode(referrer)        AS referrer,
       count(*)                    AS hits,
       count(DISTINCT request_ip)  AS visitors
FROM salishsea_logs.human_pageviews
WHERE date >= current_date - interval '30' day
  AND referrer <> '-'
  AND lower(coalesce(url_extract_host(url_decode(referrer)), ''))
      NOT IN ('salishsea.io', 'www.salishsea.io', 'dev.salishsea.io')
GROUP BY 1
ORDER BY hits DESC
LIMIT 30;
