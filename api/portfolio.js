export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

  const profiles = {
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

  async function fetchProfile(name, creds) {
    if (!creds.key || !creds.secret) {
      return { name, error: 'Missing API keys', connected: false };
    }
    const headers = {
      'APCA-API-KEY-ID': creds.key,
      'APCA-API-SECRET-KEY': creds.secret,
    };
    try {
      const [accountRes, positionsRes] = await Promise.all([
        fetch(`${BASE_URL}/v2/account`, { headers }),
        fetch(`${BASE_URL}/v2/positions`, { headers }),
      ]);
      if (!accountRes.ok) {
        const errBody = await accountRes.text();
        return { name, error: 'Alpaca API error', status: accountRes.status, detail: errBody, connected: false };
      }
      const account = await accountRes.json();
      const positions = await positionsRes.json();
      return {
        name,
        connected: true,
        account: {
          portfolio_value: parseFloat(account.portfolio_value),
          cash: parseFloat(account.cash),
          buying_power: parseFloat(account.buying_power),
          equity: parseFloat(account.equity),
          daily_pnl: parseFloat(account.equity) - parseFloat(account.last_equity),
          daily_pnl_pct: ((parseFloat(account.equity) - parseFloat(account.last_equity)) / parseFloat(account.last_equity)) * 100,
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
      };
    } catch (err) {
      return { name, error: 'Failed to fetch', message: err.message, connected: false };
    }
  }

  try {
    const [aggressive, growth, conservative] = await Promise.all([
      fetchProfile('aggressive', profiles.aggressive),
      fetchProfile('growth', profiles.growth),
      fetchProfile('conservative', profiles.conservative),
    ]);

    const connectedProfiles = [aggressive, growth, conservative].filter(p => p.connected);
    const totalValue = connectedProfiles.reduce((sum, p) => sum + (p.account?.portfolio_value || 0), 0);
    const totalPnl = connectedProfiles.reduce((sum, p) => sum + (p.account?.daily_pnl || 0), 0);
    const totalPositions = connectedProfiles.reduce((sum, p) => sum + (p.active_positions || 0), 0);

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      summary: {
        total_value: totalValue,
        total_daily_pnl: totalPnl,
        total_positions: totalPositions,
        connected_accounts: connectedProfiles.length,
      },
      profiles: { aggressive, growth, conservative },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch', message: err.message });
  }
}
