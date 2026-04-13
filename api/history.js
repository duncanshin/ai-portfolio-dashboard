const PROFILE_KEYS = {
  aggressive: { key: process.env.ALPACA_API_KEY_AGGRESSIVE, secret: process.env.ALPACA_SECRET_KEY_AGGRESSIVE },
  growth:     { key: process.env.ALPACA_API_KEY_GROWTH,     secret: process.env.ALPACA_SECRET_KEY_GROWTH },
  conservative: { key: process.env.ALPACA_API_KEY_CONSERVATIVE, secret: process.env.ALPACA_SECRET_KEY_CONSERVATIVE },
}
const BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets'
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')
  if (req.method === 'OPTIONS') return res.status(200).end()
  const { profile, period, timeframe, start, end } = req.query
  if (!profile || !PROFILE_KEYS[profile]) return res.status(400).json({ error: 'Invalid profile' })
  const creds = PROFILE_KEYS[profile]
  if (!creds.key || !creds.secret) return res.status(500).json({ error: 'Missing API keys for ' + profile })
  try {
    const params = new URLSearchParams()
    if (start && end) { params.set('date_start', start); params.set('date_end', end) }
    else { params.set('period', period || '1M') }
    params.set('timeframe', timeframe || '1D')
    const url = BASE_URL + '/v2/account/portfolio/history?' + params.toString()
    const response = await fetch(url, { headers: { 'APCA-API-KEY-ID': creds.key, 'APCA-API-SECRET-KEY': creds.secret } })
    if (!response.ok) { const t = await response.text(); return res.status(response.status).json({ error: t }) }
    const data = await response.json()
    const points = []
    if (data.timestamp && data.equity) {
      for (let i = 0; i < data.timestamp.length; i++) {
        const d = new Date(data.timestamp[i] * 1000)
        const date = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
        points.push({ date, equity: Math.round(data.equity[i] * 100) / 100 })
      }
    }
    return res.status(200).json({ profile, points })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}
ENDOFFILEcat > ~/ai-portfolio-dashboard/api/history.js << 'ENDOFFILE'
const PROFILE_KEYS = {
  aggressive: { key: process.env.ALPACA_API_KEY_AGGRESSIVE, secret: process.env.ALPACA_SECRET_KEY_AGGRESSIVE },
  growth:     { key: process.env.ALPACA_API_KEY_GROWTH,     secret: process.env.ALPACA_SECRET_KEY_GROWTH },
  conservative: { key: process.env.ALPACA_API_KEY_CONSERVATIVE, secret: process.env.ALPACA_SECRET_KEY_CONSERVATIVE },
}
const BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets'
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')
  if (req.method === 'OPTIONS') return res.status(200).end()
  const { profile, period, timeframe, start, end } = req.query
  if (!profile || !PROFILE_KEYS[profile]) return res.status(400).json({ error: 'Invalid profile' })
  const creds = PROFILE_KEYS[profile]
  if (!creds.key || !creds.secret) return res.status(500).json({ error: 'Missing API keys for ' + profile })
  try {
    const params = new URLSearchParams()
    if (start && end) { params.set('date_start', start); params.set('date_end', end) }
    else { params.set('period', period || '1M') }
    params.set('timeframe', timeframe || '1D')
    const url = BASE_URL + '/v2/account/portfolio/history?' + params.toString()
    const response = await fetch(url, { headers: { 'APCA-API-KEY-ID': creds.key, 'APCA-API-SECRET-KEY': creds.secret } })
    if (!response.ok) { const t = await response.text(); return res.status(response.status).json({ error: t }) }
    const data = await response.json()
    const points = []
    if (data.timestamp && data.equity) {
      for (let i = 0; i < data.timestamp.length; i++) {
        const d = new Date(data.timestamp[i] * 1000)
        const date = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
        points.push({ date, equity: Math.round(data.equity[i] * 100) / 100 })
      }
    }
    return res.status(200).json({ profile, points })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}
