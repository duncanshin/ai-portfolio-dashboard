export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  var BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

  var profileCreds = {
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
      return { name: name, error: 'Missing API keys', connected: false };
    }
    var headers = {
      'APCA-API-KEY-ID': creds.key,
      'APCA-API-SECRET-KEY': creds.secret,
    };
    try {
      var accountRes = await fetch(BASE_URL + '/v2/account', { headers: headers });
      var positionsRes = await fetch(BASE_URL + '/v2/positions', { headers: headers });
      if (!accountRes.ok) {
        var errBody = await accountRes.text();
        return { name: name, error: 'Alpaca API error', status: accountRes.status, detail: errBody, connected: false };
      }

      var account = await accountRes.json();
      var positions = await positionsRes.json();
      var equity = parseFloat(account.equity);
      var lastEquity = parseFloat(account.last_equity);
      var dailyPnl = equity - lastEquity;
      var dailyPnlPct = lastEquity > 0 ? (dailyPnl / lastEquity) * 100 : 0;

      return {
        name: name,
        connected: true,
        portfolioValue: parseFloat(account.portfolio_value),
        cash: parseFloat(account.cash),
        buyingPower: parseFloat(account.buying_power),
        equity: equity,
        todayReturn: dailyPnl,
        totalReturnPct: dailyPnlPct,
        activePositions: positions.length,
        positions: positions.map(function(p) {
          return {
            symbol: p.symbol,
            qty: parseFloat(p.qty),
            marketValue: parseFloat(p.market_value),
            avgEntry: parseFloat(p.avg_entry_price),
            currentPrice: parseFloat(p.current_price),
            unrealizedPnl: parseFloat(p.unrealized_pl),
            unrealizedPnlPct: parseFloat(p.unrealized_plpc) * 100,
            changeToday: parseFloat(p.change_today) * 100,
          };
        }),
      };
    } catch (err) {
      return { name: name, error: 'Failed to fetch', message: err.message, connected: false };
    }
  }

  async function fetchBenchmark(creds) {
    // Uses Alpaca market data API to get live SPY price + returns
    if (!creds.key || !creds.secret) {
      return { connected: false, error: 'No API keys for benchmark' };
    }
    var headers = {
      'APCA-API-KEY-ID': creds.key,
      'APCA-API-SECRET-KEY': creds.secret,
    };
    try {
      // Fetch SPY snapshot: latest trade, daily bar, previous daily bar
      var snapshotRes = await fetch('https://data.alpaca.markets/v2/stocks/SPY/snapshot', { headers: headers });
      if (!snapshotRes.ok) {
        var errText = await snapshotRes.text();
        return { connected: false, error: 'Snapshot failed: ' + errText };
      }
      var snapshot = await snapshotRes.json();

      var currentPrice = snapshot.latestTrade ? snapshot.latestTrade.p : null;
      var prevClose = snapshot.prevDailyBar ? snapshot.prevDailyBar.c : null;
      var todayChangePct = (currentPrice && prevClose && prevClose > 0)
        ? ((currentPrice - prevClose) / prevClose) * 100
        : null;

      // Fetch first trading day of current year for YTD calc
      var year = new Date().getFullYear();
      var ytdRes = await fetch(
        'https://data.alpaca.markets/v2/stocks/SPY/bars?timeframe=1Day&start=' + year + '-01-02&limit=1',
        { headers: headers }
      );
      var ytdReturnPct = null;
      if (ytdRes.ok) {
        var ytdData = await ytdRes.json();
        if (ytdData.bars && ytdData.bars.length > 0) {
          var yearStartPrice = ytdData.bars[0].o;
          if (currentPrice && yearStartPrice > 0) {
            ytdReturnPct = ((currentPrice - yearStartPrice) / yearStartPrice) * 100;
          }
        }
      }

      return {
        connected: true,
        symbol: 'SPY',
        price: currentPrice,
        prevClose: prevClose,
        todayChangePct: todayChangePct,
        ytdReturnPct: ytdReturnPct,
      };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }

  try {
    // Fetch all 3 profiles + benchmark in parallel
    var results = await Promise.all([
      fetchProfile('aggressive', profileCreds.aggressive),
      fetchProfile('growth', profileCreds.growth),
      fetchProfile('conservative', profileCreds.conservative),
      fetchBenchmark(profileCreds.growth),
    ]);
    var aggressive = results[0];
    var growth = results[1];
    var conservative = results[2];
    var benchmark = results[3];
    var connected = [aggressive, growth, conservative].filter(function(p) { return p.connected; });
    var totalValue = connected.reduce(function(sum, p) { return sum + (p.portfolioValue || 0); }, 0);
    var totalPnl = connected.reduce(function(sum, p) { return sum + (p.todayReturn || 0); }, 0);
    var totalPositions = connected.reduce(function(sum, p) { return sum + (p.activePositions || 0); }, 0);

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      summary: {
        totalValue: totalValue,
        totalTodayReturn: totalPnl,
        totalPositions: totalPositions,
        connectedProfiles: connected.length,
      },
      profiles: {
        aggressive: aggressive,
        growth: growth,
        conservative: conservative,
      },
      benchmark: benchmark,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch', message: err.message });
  }
}
