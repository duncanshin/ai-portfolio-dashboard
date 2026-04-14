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
    if (!creds.key || !creds.secret) {
      return { connected: false, error: 'No API keys for benchmark' };
    }
    var headers = {
      'APCA-API-KEY-ID': creds.key,
      'APCA-API-SECRET-KEY': creds.secret,
    };
    try {
      // Get SPY snapshot: latest trade + previous daily bar
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

      // Fetch SPY price on the account start date (first bar on or after sinceDate)
      var returnPct = null;
      var startPrice = null;
      var startDateUsed = sinceDate;
      if (sinceDate && currentPrice) {
        var barsRes = await fetch(
          'https://data.alpaca.markets/v2/stocks/SPY/bars?timeframe=1Day&end=' + sinceDate + '&limit=1',
          { headers: headers }
        );
        if (barsRes.ok) {
          var barsData = await barsRes.json();
          if (barsData.bars && barsData.bars.length > 0) {
            startPrice = barsData.bars[0].c;
            startDateUsed = barsData.bars[0].t;
            if (startPrice > 0) {
              returnPct = ((currentPrice - startPrice) / startPrice) * 100;
            }
          }
        }
      }

      return {
        connected: true,
        symbol: 'SPY',
        price: currentPrice,
        prevClose: prevClose,
        todayChangePct: todayChangePct,
        returnPct: returnPct,
        startPrice: startPrice,
        startDate: startDateUsed,
      };
    } catch (err) {
      return { connected: false, error: err.message };
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
