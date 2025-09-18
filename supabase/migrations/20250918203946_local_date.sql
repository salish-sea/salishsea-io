CREATE FUNCTION local_date (occurrence occurrences)
  RETURNS date
  LANGUAGE SQL
  STABLE STRICT
  AS $$
  SELECT
    date($1.observed_at at time zone 'PST8PDT')
$$;
DROP FUNCTION occurrences_on_date;