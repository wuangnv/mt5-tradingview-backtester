WITH filtered AS NOT MATERIALIZED (
  SELECT id,symbol,pnl_cents FROM trades
  WHERE workspace='tenant-a' AND symbol='EURUSD' AND id<={rows}
)
SELECT page.id,page.symbol,page.pnl_cents,totals.total
FROM (SELECT count(*) AS total FROM filtered) totals
LEFT JOIN LATERAL (
  SELECT * FROM filtered ORDER BY pnl_cents DESC,id ASC LIMIT 25 OFFSET {offset}
) page ON true
