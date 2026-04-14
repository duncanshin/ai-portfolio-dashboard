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
        createdAt: account.created_at,
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

  async function fetchBenchmark(creds, sinceDate) {
  // Fetch actual S&P 500 index (^GSPC) from Yahoo Finance
  // Use 5d range to get reliable previous trading day close from bar data
  try {
    var yahooRes = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5d&interval=1d',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!yahooRes.ok) {
      return { connected: false, error: 'Yahoo Finance request failed: ' + yahooRes.status };
    }
    var yahooData = await yahooRes.json();
    var meta = yahooData.chart.result[0].meta;
    var currentPrice = meta.regularMarketPrice;

    // Get actual daily closes from bar data — more reliable than meta.chartPreviousClose
    var closes = yahooData.chart.result[0].indicators.quote[0].close;
    // Filter out nulls and get the last valid closes
    var validCloses = closes.filter(function(c) { return c !== null && c !== undefined; });
    // Previous trading day close is second-to-last valid close
    var prevClose = validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null;

    // If market is still open, last close is yesterday's — currentPrice is live
    // If market is closed, last close IS today's final close
    var todayChangePct = (currentPrice && prevClose && prevClose > 0)
      ? ((currentPrice - prevClose) / prevClose) * 100
      : null;

    // $100K equivalent values
    var initialCapital = 100000;
    var portfolioValue = (todayChangePct !== null) ? initialCapital * (1 + todayChangePct / 100) : initialCapital;
    var totalPnl = (todayChangePct !== null) ? portfolioValue - initialCapital : 0;
    var dailyPnl = totalPnl;
    var dailyPnlPct = todayChangePct || 0;

    return {
      connected: true,
      symbol: '^GSPC',
      price: currentPrice,
      prevClose: prevClose,
      todayChangePct: todayChangePct,
      returnPct: todayChangePct,
      portfolioValue: portfolioValue,
      totalPnl: totalPnl,
      dailyPnl: dailyPnl,
      dailyPnlPct: dailyPnlPct,
    };
  } catch (err) {
    return { connected: false, error: 'Benchmark fetch failed: ' + err.message };
  }
}

  try {
    // Fetch all 3 profiles first
    var profileResults = await Promise.all([
      fetchProfile('aggressive', profileCreds.aggressive),
      fetchProfile('growth', profileCreds.growth),
      fetchProfile('conservative', profileCreds.conservative),
    ]);
    var aggressive = profileResults[0];
    var growth = profileResults[1];
    var conservative = profileResults[2];

    // Use Growth account creation date as benchmark start
    var benchmarkStartDate = '2026-04-13'; // Inception date: all profiles started trading this date

    var benchmark = await fetchBenchmark(profileCreds.growth, benchmarkStartDate);

    var connected = profileResults.filter(function(p) { return p.connected; });
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
