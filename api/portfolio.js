export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  var BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  var MODE = BASE_URL.indexOf('paper') !== -1 ? 'Paper Trading' : 'Live';

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

  // Compute S&P 500 benchmark tracked as if $100K was invested at `inceptionDate`.
  // Uses SPY (via Yahoo) — not a separate Alpaca account. Pre-inception → notStarted state.
  async function fetchBenchmark(inceptionDate) {
    var INITIAL_CAPITAL = 100000;
    try {
      var inceptionTs = Math.floor(new Date(inceptionDate + 'T00:00:00Z').getTime() / 1000);
      var nowTs = Math.floor(Date.now() / 1000);
      // If inception date has not been reached yet → pre-open state
      if (nowTs < inceptionTs) {
        return { connected: true, notStarted: true, symbol: 'SPY', portfolioValue: INITIAL_CAPITAL, totalPnl: 0, totalPnlPct: 0, dailyPnl: 0, dailyPnlPct: 0, activePositions: 0, message: 'Starts at market open' };
      }
      var yahooRes = await fetch(
        'https://query1.finance.yahoo.com/v8/finance/chart/SPY?period1=' + (inceptionTs - 7 * 86400) + '&period2=' + (nowTs + 86400) + '&interval=1d',
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (!yahooRes.ok) {
        return { connected: false, error: 'Yahoo Finance request failed: ' + yahooRes.status };
      }
      var yahooData = await yahooRes.json();
      var result = yahooData.chart.result[0];
      var meta = result.meta;
      var timestamps = result.timestamp || [];
      var quote = result.indicators.quote[0] || {};
      var opens = quote.open || [];
      var closes = quote.close || [];
      var currentPrice = meta.regularMarketPrice;
      var prevClose = meta.chartPreviousClose;

      // Anchor price = first OPEN on/after inception day — same anchor as the 3 paper accounts
      // (which start trading at market open on inception day). Fall back to close if open missing.
      // Live SPY value is then rebased: portfolioValue = 100000 * (currentPrice / startPrice),
      // so day-1 open = exactly $100,000 and all 4 equity curves begin at the same level.
      var startPrice = null;
      for (var i = 0; i < timestamps.length; i++) {
        if (timestamps[i] >= inceptionTs) {
          if (opens[i] != null) { startPrice = opens[i]; break; }
          if (closes[i] != null) { startPrice = closes[i]; break; }
        }
      }
      if (startPrice == null) {
        return { connected: true, notStarted: true, symbol: 'SPY', portfolioValue: INITIAL_CAPITAL, totalPnl: 0, totalPnlPct: 0, dailyPnl: 0, dailyPnlPct: 0, activePositions: 0, message: 'Starts at market open' };
      }

      // Rebase: SPY price series → $100K-anchored equity curve.
      var portfolioValue = INITIAL_CAPITAL * (currentPrice / startPrice);
      var totalPnl = portfolioValue - INITIAL_CAPITAL;
      var totalPnlPct = ((currentPrice - startPrice) / startPrice) * 100;
      var dailyPnlPct = (prevClose && prevClose > 0) ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
      var dailyPnl = (dailyPnlPct / 100) * (INITIAL_CAPITAL * (prevClose / startPrice));

      return {
        connected: true,
        notStarted: false,
        symbol: 'SPY',
        price: currentPrice,
        startPrice: startPrice,
        prevClose: prevClose,
        inceptionDate: inceptionDate,
        portfolioValue: portfolioValue,
        totalPnl: totalPnl,
        totalPnlPct: totalPnlPct,
        dailyPnl: dailyPnl,
        dailyPnlPct: dailyPnlPct,
        activePositions: 1,
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

    // S&P 500 benchmark inception: same day the 3 paper accounts start trading.
    // Pre-inception → fetchBenchmark returns notStarted=true ($100K / $0 / 0 positions).
    var benchmarkStartDate = '2026-04-15';

    var benchmark = await fetchBenchmark(benchmarkStartDate);

    var connected = profileResults.filter(function(p) { return p.connected; });
    var totalValue = connected.reduce(function(sum, p) { return sum + (p.portfolioValue || 0); }, 0);
    var totalPnl = connected.reduce(function(sum, p) { return sum + (p.todayReturn || 0); }, 0);
    var totalPositions = connected.reduce(function(sum, p) { return sum + (p.activePositions || 0); }, 0);
    // Note: benchmark (S&P 500) is excluded from portfolio totals — it's a comparison, not a holding.
    var baseCapital = connected.reduce(function(sum, p) { return sum + (parseFloat(p.lastEquity) || 100000); }, 0);
    var totalPnlPct = baseCapital > 0 ? (totalPnl / baseCapital) * 100 : 0;

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      mode: MODE,
      summary: {
        totalValue: totalValue,
        totalPnl: totalPnl,
        totalPnlPct: totalPnlPct,
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
