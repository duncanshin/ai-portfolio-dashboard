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
      var accountPromise = fetch(BASE_URL + '/v2/account', { headers: headers });
      var positionsPromise = fetch(BASE_URL + '/v2/positions', { headers: headers });
      var ordersPromise = fetch(BASE_URL + '/v2/orders?status=closed&limit=50&direction=desc', { headers: headers });
      var accountRes = await accountPromise;
      var positionsRes = await positionsPromise;
      var ordersRes = await ordersPromise;
      if (!accountRes.ok) {
        var errBody = await accountRes.text();
        return { name: name, error: 'Alpaca API error', status: accountRes.status, detail: errBody, connected: false };
      }

      var account = await accountRes.json();
      var positions = await positionsRes.json();
      var orders = [];
      if (ordersRes && ordersRes.ok) {
        try { orders = await ordersRes.json(); } catch (e) { orders = []; }
        if (!Array.isArray(orders)) orders = [];
      }
      var trades = orders
        .filter(function(o) { return o.filled_at || o.submitted_at; })
        .map(function(o) {
          return {
            order_id: o.id,
            ticker: o.symbol,
            side: o.side,
            shares: parseFloat(o.filled_qty || o.qty || 0),
            price: o.filled_avg_price ? parseFloat(o.filled_avg_price) : null,
            filled_at: o.filled_at,
            submitted_at: o.filled_at || o.submitted_at,
            status: o.status,
            profile: name,
          };
        });
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
        trades: trades,
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

      // Anchor price = CLOSE of first bar on/after inception day. Using close (not
      // open) matches Alpaca's end-of-day portfolio-history equity, so SPY(inception)
      // = $100K exactly and all 4 lines (3 portfolios + SPY) start on the same level.
      var startPrice = null;
      for (var i = 0; i < timestamps.length; i++) {
        if (timestamps[i] >= inceptionTs && closes[i] != null) {
          startPrice = closes[i];
          break;
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

    // S&P 500 benchmark inception: the day the 3 paper accounts start trading.
    // Always derived dynamically via ?anchor_date=YYYY-MM-DD from the caller, which
    // derives it from Alpaca portfolio history (first date with equity data). Both
    // App.jsx effects pass this; direct consumers must pass it too. Omitting it
    // degrades to notStarted so we never silently rebase to a stale/wrong date.
    var benchmarkStartDate = req.query.anchor_date || null;
    var benchmark = benchmarkStartDate
      ? await fetchBenchmark(benchmarkStartDate)
      : { connected: true, notStarted: true, symbol: 'SPY', portfolioValue: 100000, totalPnl: 0, totalPnlPct: 0, dailyPnl: 0, dailyPnlPct: 0, activePositions: 0, message: 'Awaiting anchor date' };

    var connected = profileResults.filter(function(p) { return p.connected; });

    // Flat trades array (each tagged with profile) — most recent first. Used by
    // "Recent Trades by Profile" section which filters by t.profile.
    var allTrades = [];
    connected.forEach(function(p) {
      if (Array.isArray(p.trades)) allTrades = allTrades.concat(p.trades);
    });
    allTrades.sort(function(a, b) {
      var ta = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
      var tb = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
      return tb - ta;
    });
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
      trades: allTrades,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch', message: err.message });
  }
}
