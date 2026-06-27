-- 30-day human usage summary: the headline "are people using this" numbers.
SELECT count(*)                                       AS human_page_views,
       count(DISTINCT request_ip)                     AS human_visitors,
       count(DISTINCT date)                           AS active_days,
       round(1.0 * count(*) / count(DISTINCT date), 1) AS avg_views_per_day
FROM salishsea_logs.human_pageviews
WHERE date >= current_date - interval '30' day;
