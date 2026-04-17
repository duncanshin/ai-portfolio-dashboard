export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  var INITIAL_CAPITAL = 100000;

  var period = req.query.period;
  var start = req.query.start;
  var end = req.query.end;
  // Anchor SPY to the close of `anchor_date` so all 4 lines (3 portfolios + SPY)
  // start at $100K on the same trading day. Caller (App.jsx) derives this from
  // the first date present in Alpaca portfolio history — fully dynamic.
  var anchorDate = req.query.anchor_date;

  try {
    var now = new Date();
    var startDate = start;
    if (!startDate) {
      var days = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1A': 365, 'all': 730 };
      var d = new Date(now);
      d.setDate(d.getDate() - (days[period] || 30));
      startDate = d.toISOString().split('T')[0];
    }
    // If no anchor supplied, fall back to the requested start so the first
    // emitted point still equals $100K. Belt-and-suspenders; frontend always
    // passes anchor_date in practice.
    if (!anchorDate) anchorDate = startDate;
    if (startDate < anchorDate) startDate = anchorDate;
    var endDate = end || now.toISOString().split('T')[0];

    // Fetch Yahoo daily bars from ~7 days before anchor through end so we can
    // always locate the anchor-day bar for rebasing.
    var anchorTs = Math.floor(new Date(anchorDate + 'T00:00:00Z').getTime() / 1000);
    var endTs = Math.floor(new Date(endDate + 'T23:59:59Z').getTime() / 1000);
    var nowTs = Math.floor(Date.now() / 1000);
    var period2 = Math.min(endTs, nowTs) + 86400;

    var yahooRes = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/SPY?period1=' + (anchorTs - 7 * 86400) + '&period2=' + period2 + '&interval=1d',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!yahooRes.ok) {
      return res.status(yahooRes.status).json({ error: 'Yahoo Finance request failed: ' + yahooRes.status });
    }
    var yahooData = await yahooRes.json();
    var result = yahooData.chart.result[0];
    var meta = result.meta;
    var timestamps = result.timestamp || [];
    var quote = result.indicators.quote[0] || {};
    var closes = quote.close || [];
    var currentPrice = meta.regularMarketPrice;

    // Anchor price = CLOSE of first bar on/after anchor_date. Using close (not
    // open) guarantees SPY(anchor_date) = $100K exactly, matching Alpaca's
    // end-of-day equity snapshot for the portfolio series on the same date.
    var startPrice = null;
    for (var i = 0; i < timestamps.length; i++) {
      if (timestamps[i] >= anchorTs && closes[i] != null) {
        startPrice = closes[i];
        break;
      }
    }

    var points = [];
    if (startPrice != null) {
      var startFilterTs = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000);
      var endFilterTs = Math.floor(new Date(endDate + 'T23:59:59Z').getTime() / 1000);
      var lastDate = null;
      for (var j = 0; j < timestamps.length; j++) {
        var ts = timestamps[j];
        if (ts < startFilterTs || ts > endFilterTs) continue;
        var px = closes[j];
        if (px == null) continue;
        var dateStr = new Date(ts * 1000).toISOString().split('T')[0];
        points.push({ date: dateStr, spy: Math.round(INITIAL_CAPITAL * (px / startPrice) * 100) / 100 });
        lastDate = dateStr;
      }
      // Ensure today's point uses the live price (matches S&P 500 profile card).
      var todayStr = new Date().toISOString().split('T')[0];
      if (todayStr >= startDate && todayStr <= endDate && todayStr >= anchorDate) {
        var liveSpy = Math.round(INITIAL_CAPITAL * (currentPrice / startPrice) * 100) / 100;
        if (lastDate === todayStr) {
          points[points.length - 1].spy = liveSpy;
        } else {
          points.push({ date: todayStr, spy: liveSpy });
        }
      }
    }
    // Edge case: no portfolio data yet → anchor_date may be empty/invalid.
    // startPrice stays null, points stays empty, response is a clean empty series.

    return res.status(200).json({ symbol: 'SPY', points: points });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch', message: err.message });
  }
}
