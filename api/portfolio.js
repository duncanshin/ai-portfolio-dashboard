export default async function handler(req, res) {
  // CORS headers so your dashboard can call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  const headers = {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
  };

  try {
    // Fetch account info + positions in parallel
    const [accountRes, positionsRes] = await Promise.all([
      fetch(`${BASE_URL}/v2/account`, { headers }),
      fetch(`${BASE_URL}/v2/positions`, { headers }),
    ]);

    if (!accountRes.ok || !positionsRes.ok) {
      return res.status(500).json({ error: 'Alpaca API error' });
    }

    const account = await accountRes.json();
    const positions = await positionsRes.json();

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      account: {
        portfolio_value: parseFloat(account.portfolio_value),
        cash: parseFloat(account.cash),
        buying_power: parseFloat(account.buying_power),
        equity: parseFloat(account.equity),
        daily_pnl: parseFloat(account.equity) - parseFloat(account.last_equity),
        daily_pnl_pct: ((parseFloat(account.equity) - parseFloat(account.last_equity)) / parseFloat(account.last_equity) * 100),
      },
      positions: positions.map(p => ({
        symbol: p.symbol,
        qty: parseFloat(p.qty),
        market_value: parseFloat(p.market_value),
        avg_entry: parseFloat(p.avg_entry_price),
        current_price: parseFloat(p.current_price),
        unrealized_pnl: parseFloat(p.unrealized_pl),
        unrealized_pnl_pct: parseFloat(p.unrealized_plpc) * 100,
        change_today: parseFloat(p.change_today) * 100,
      })),
      active_positions: positions.length,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch portfolio data' });
  }
}
