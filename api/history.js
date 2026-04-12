export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { profile = 'growth', period = '1M', timeframe = '1D' } = req.query;
  const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

  const keyMap = {
    aggressive: {
      key: process.env.ALPACA_API_KEY_AGGRESSIVE,
      secret: process.env.ALPACA_SECRET_KEY_AGGRESSIVE,
    },
    growth: {
      key: process.env.ALPACA_API_KEY_GROWTH,
      secret: process.env.ALPACA_SECRET_KEY_GROWTH,
    },
    conservative: {
      key: process.env.ALPACA_API_KEY_CONSERVATIVE,
      secret: process.env.ALPACA_SECRET_KEY_CONSERVATIVE,
    },
  };

  const creds = keyMap[profile.toLowerCase()];
  if (!creds || !creds.key || !creds.secret) {
    return res.status(400).json({ error: `Invalid or unconfigured profile: ${profile}` });
  }

  const headers = {
    'APCA-API-KEY-ID': creds.key,
    'APCA-API-SECRET-KEY': creds.secret,
  };

  try {
    const url = `${baseUrl}/v2/account/portfolio/history?period=${period}&timeframe=${timeframe}&extended_hours=false`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Alpaca API ${response.status}` });
    }

    const data = await response.json();

    const points = data.timestamp.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      equity: data.equity[i],
      profitLoss: data.profit_loss[i],
      profitLossPct: data.profit_loss_pct[i] ? data.profit_loss_pct[i] * 100 : 0,
    }));

    res.status(200).json({
      profile,
      period,
      timeframe,
      points,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
