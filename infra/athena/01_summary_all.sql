-- 30-day totals across ALL traffic (humans + bots + scanners). Shows how bot-dominated the raw logs are.
SELECT count(*)                                              AS all_requests,
       count_if(sc_content_type LIKE 'text/html%')           AS html_requests,
       count(DISTINCT request_ip)                            AS distinct_ips,
       count_if(status >= 400)                               AS error_responses,
       coalesce(round(100.0 * count_if(status >= 400) / nullif(count(*), 0), 2), 0.0) AS error_pct
FROM salishsea_logs.cloudfront_logs
WHERE date >= current_date - interval '30' day;
