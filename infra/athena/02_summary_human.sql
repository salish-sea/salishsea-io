-- 30-day human usage summary: the headline "are people using this" numbers.
SELECT count(*)                                       AS human_page_views,
       count(DISTINCT request_ip)                     AS human_visitors,
       count(DISTINCT date)                           AS active_days,
       round(1.0 * count(*) / nullif(count(DISTINCT date), 0), 1) AS avg_views_per_active_day
FROM salishsea_logs.human_pageviews
WHERE date >= current_date - interval '30' day;
