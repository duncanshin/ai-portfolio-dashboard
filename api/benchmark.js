export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  var apiKey = process.env.ALPACA_API_KEY_GROWTH || process.env.ALPACA_API_KEY_AGGRESSIVE;
  var apiSecret = process.env.ALPACA_SECRET_KEY_GROWTH || process.env.ALPACA_SECRET_KEY_AGGRESSIVE;

  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Missing Alpaca keys' });
  }

  var headers = {
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': apiSecret,
  };

  var period = req.query.period;
  var start = req.query.start;
  var end = req.query.end;

  try {
    var now = new Date();
    var startDate = start;
    if (!startDate) {
      var days = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1A': 365, 'all': 730 };
      var d = new Date(now);
      d.setDate(d.getDate() - (days[period] || 30));
      startDate = d.toISOString().split('T')[0];
    }
    var endDate = end || now.toISOString().split('T')[0];

    var url = 'https://data.alpaca.markets/v2/stocks/SPY/bars?timeframe=1Day'
      + '&start=' + startDate + 'T00:00:00Z'
      + '&end=' + endDate + 'T23:59:59Z'
      + '&limit=10000&adjustment=split&feed=sip';

    var response = await fetch(url, { headers: headers });
    if (!response.ok) {
      var errBody = await response.text();
      return res.status(response.status).json({ error: 'Alpaca API error', detail: errBody });
    }

    var data = await response.json();
    var points = [];
    if (data.bars) {
      for (var i = 0; i < data.bars.length; i++) {
        points.push({
          date: data.bars[i].t.split('T')[0],
          spy: Math.round(data.bars[i].c * 100) / 100,
        });
      }
    }

    return res.status(200).json({ symbol: 'SPY', points: points });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch', message: err.message });
  }
}
