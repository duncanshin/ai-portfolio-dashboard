export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  const headers = {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
  };

  const period = req.query.period || '1M';
  const timeframe = req.query.timeframe || '1D';

  try {
    const url = `${BASE_URL}/v2/account/portfolio/history?period=${period}&timeframe=${timeframe}&extended_hours=false`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(500).json({ error: 'Alpaca history error', status: response.status, detail: errBody });
    }

    const data = await response.json();

    const points = data.timestamp.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      equity: data.equity[i],
      profit_loss: data.profit_loss[i],
      profit_loss_pct: data.profit_loss_pct[i],
      baseline: data.base_value,
    }));

    return res.status(200).json({
      points,
      base_value: data.base_value,
      timeframe,
      period,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch history', message: err.message });
  }
}
