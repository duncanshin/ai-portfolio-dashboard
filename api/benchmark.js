export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { period = '1M', timeframe = '1D', start, end } = req.query;
  const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  const dataUrl = process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets';

  const apiKey = process.env.ALPACA_API_KEY_AGGRESSIVE;
  const apiSecret = process.env.ALPACA_SECRET_KEY_AGGRESSIVE;

  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Missing Alpaca API keys' });
  }

  const headers = {
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': apiSecret,
  };

  try {
    // Build date range from period if start/end not provided
    let startDate = start;
    let endDate = end || new Date().toISOString().split('T')[0];

    if (!startDate) {
      const now = new Date();
      const periodMap = {
        '1D': 1, '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1A': 365, 'all': 365 * 2,
      };
      const days = periodMap[period] || 30;
      const s = new Date(now);
      s.setDate(s.getDate() - days);
      startDate = s.toISOString().split('T')[0];
    }

    // Fetch SPY bars from Alpaca market data API
    const tf = timeframe === '15Min' ? '15Min' : '1Day';
    const feed = process.env.ALPACA_DATA_FEED || 'iex';
    const url = `${dataUrl}/v2/stocks/SPY/bars?timeframe=${tf}&start=${startDate}&end=${endDate}&limit=10000&adjustment=split&feed=${feed}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(response.status).json({ error: `Alpaca bars API ${response.status}`, detail: errBody });
    }

    const data = await response.json();
    const bars = data.bars || [];

    if (bars.length === 0) {
      return res.status(200).json({ points: [], period, timeframe });
    }

    // Normalize to $100,000 starting value
    const firstClose = bars[0].c;
    const INITIAL = 100000;

    const points = bars.map(bar => ({
      date: bar.t.split('T')[0],
      spy: Math.round((bar.c / firstClose) * INITIAL),
    }));

    res.status(200).json({
      points,
      period,
      timeframe,
      startDate,
      endDate,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
