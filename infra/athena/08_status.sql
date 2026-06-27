-- HTTP status-code breakdown over 30 days (all traffic). High 403/301 counts are normally bot/scanner
-- noise and HTTP->HTTPS redirects, not user-facing breakage.
SELECT status,
       count(*)                                             AS n,
       round(100.0 * count(*) / sum(count(*)) OVER (), 2)   AS pct
FROM salishsea_logs.cloudfront_logs
WHERE date >= current_date - interval '30' day
GROUP BY status
ORDER BY n DESC;
