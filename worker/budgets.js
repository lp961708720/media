// One atomic ledger for text, connection checks and image generation, per account/currency.
export function budgetSum(length){return `(SELECT COALESCE(SUM(COALESCE(json_extract(data,'$.estimated_cost'),0)),0) FROM (SELECT data FROM ai_runs WHERE owner_id=? AND account_id IS ? AND substr(created_at,1,${length})=? UNION ALL SELECT data FROM usage_events WHERE owner_id=? AND account_id IS ? AND substr(created_at,1,${length})=?) WHERE json_extract(data,'$.currency')=?)`}
export function budgetArgs(owner,aid,date,currency){return [owner,aid,date,owner,aid,date,currency]}
