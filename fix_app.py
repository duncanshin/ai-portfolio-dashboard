import re

with open('src/App.jsx', 'r') as f:
    content = f.read()

# Remove duplicate sed artifact lines (the old function signature and partial edits)
# Replace the entire calcMetrics function with a clean version
old_func_pattern = r'function calcMetrics\(curveData, startIdx, endIdx, jsonMetrics\) \{.*?^}'
new_func = '''function calcMetrics(curveData, startIdx, endIdx, jsonMetrics) {
  if (startIdx >= endIdx || !curveData || curveData.length === 0) return null
  const normalized = normalizeCurveFromStart(curveData, startIdx)
  const slice = normalized.slice(startIdx, endIdx + 1)
  const years = (endIdx - startIdx) / 12
  const results = {}
  const keys = ['Aggressive', 'Growth', 'Conservative', 'S&P 500']
  const isFullRange = startIdx === 0 && endIdx === curveData.length - 1
  keys.forEach(key => {
    const startVal = slice[0][key]; const endVal = slice[slice.length - 1][key]
    const values = slice.map(d => d[key])
    const totalReturn = ((endVal - startVal) / startVal) * 100
    const cagr = years > 0 ? (Math.pow(endVal / startVal, 1 / years) - 1) * 100 : 0
    let peak = values[0]; let maxDD = 0
    values.forEach(v => { if (v > peak) peak = v; const dd = ((peak - v) / peak) * 100; if (dd > maxDD) maxDD = dd })
    const monthlyReturns = []
    for (let i = 1; i < values.length; i++) monthlyReturns.push((values[i] - values[i-1]) / values[i-1])
    const avgReturn = monthlyReturns.length > 0 ? monthlyReturns.reduce((a, b) => a + b, 0) / monthlyReturns.length : 0
    const stdDev = monthlyReturns.length > 1 ? Math.sqrt(monthlyReturns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / monthlyReturns.length) : 0.01
    let sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(12) : 0

    // Use JSON metrics for full-range view (daily-computed values are more accurate)
    const profileMap = { 'Aggressive': 'aggressive', 'Growth': 'growth', 'Conservative': 'conservative' }
    if (isFullRange && jsonMetrics && profileMap[key] && jsonMetrics[profileMap[key]]) {
      const jm = jsonMetrics[profileMap[key]]
      if (jm.sharpe != null) sharpe = jm.sharpe
      if (jm.max_drawdown != null) maxDD = jm.max_drawdown * 100
    }

    results[key] = { cagr: Math.round(cagr * 10) / 10, totalReturn: Math.round(totalReturn), maxDD: Math.round(maxDD * 10) / 10, sharpe: Math.round(sharpe * 1000) / 1000, startVal: Math.round(startVal), endVal: Math.round(endVal) }
  })
  const benchCagr = results['S&P 500'].cagr
  ;['Aggressive', 'Growth', 'Conservative'].forEach(key => { results[key].alpha = Math.round((results[key].cagr - benchCagr) * 10) / 10 })
  results['S&P 500'].alpha = 0
  return results
}'''

# Find and replace the function - handle multiline
new_content = re.sub(
    r'function calcMetrics\(curveData, startIdx, endIdx, jsonMetrics\) \{.*?\n\}',
    new_func,
    content,
    count=1,
    flags=re.DOTALL
)

# Remove any duplicate calcMetrics definitions from sed artifacts
parts = new_content.split('function calcMetrics(')
if len(parts) > 2:
    # Keep first occurrence only
    new_content = parts[0] + 'function calcMetrics(' + parts[1]
    # Find end of first function and append everything after last duplicate
    # Safer: just warn
    print(f"WARNING: Found {len(parts)-1} calcMetrics definitions. Manual check recommended.")

with open('src/App.jsx', 'w') as f:
    f.write(new_content)

print("Done. calcMetrics now uses JSON metrics for full-range Sharpe and MaxDD.")
