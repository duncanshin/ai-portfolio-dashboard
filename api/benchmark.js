module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const apiKey = process.env.ALPACA_API_KEY_GROWTH || process.env.ALPACA_API_KEY_AGGRESSIVE
  const apiSecret = process.env.ALPACA_SECRET_KEY_GROWTH || process.env.ALPACA_SECRET_KEY_AGGRESSIVE
  if (!apiKey || !apiSecret) return res.status(500).json({ error: 'Missing Alpaca keys' })
  const { period, start, end } = req.query
  try {
    const now = new Date()
    let startDate = start
    if (!startDate) {
      const days = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1A': 365, 'all': 730 }
      const d = new Date(now); d.setDate(d.getDate() - (days[period] || 30))
      startDate = d.toISOString().split('T')[0]
    }
    const endDate = end || now.toISOString().split('T')[0]
    const params = new URLSearchParams({ timeframe: '1Day', start: startDate+'T00:00:00Z', end: endDate+'T23:59:59Z', limit: '10000', adjustment: 'split', feed: 'sip' })
    const r = await fetch('https://data.alpaca.markets/v2/stocks/SPY/bars?' + params.toString(), {
      headers: { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': apiSecret }
    })
    if (!r.ok) return res.status(r.status).json({ error: await r.text() })
    const data = await r.json()
    const points = (data.bars || []).map(function(bar) { return { date: bar.t.split('T')[0], spy: Math.round(bar.c*100)/100 } })
    return res.status(200).json({ symbol: 'SPY', points })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}
