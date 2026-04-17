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

  var profile = req.query.profile;
  var period = req.query.period || '1M';
  var timeframe = req.query.timeframe || '1D';
  var start = req.query.start;
  var end = req.query.end;

  if (!profile || !profileCreds[profile]) {
    return res.status(400).json({ error: 'Invalid profile' });
  }

  var creds = profileCreds[profile];
  if (!creds.key || !creds.secret) {
    return res.status(500).json({ error: 'Missing API keys for ' + profile });
  }

  var headers = {
    'APCA-API-KEY-ID': creds.key,
    'APCA-API-SECRET-KEY': creds.secret,
  };

  try {
    var url = BASE_URL + '/v2/account/portfolio/history?timeframe=' + timeframe;
    if (start && end) {
      url += '&date_start=' + start + '&date_end=' + end;
    } else {
      url += '&period=' + period;
    }

    var response = await fetch(url, { headers: headers });
    if (!response.ok) {
      var errBody = await response.text();
      return res.status(response.status).json({ error: 'Alpaca API error', detail: errBody });
    }

    var data = await response.json();
    var points = [];
    if (data.timestamp && data.equity) {
      // Find the first real trading day. Alpaca pads portfolio/history with:
      //   (a) zero-equity rows for every calendar day before the account was funded
      //   (b) a seed-equity row on the day the account was journal-funded (equity
      //       = seed amount, profit_loss = 0, no actual trading yet)
      // Both patterns, if returned to the frontend, cause SPY to be anchored to
      // a non-trading date. We skip the LEADING run of zero-equity-or-zero-PnL
      // rows, then emit the remainder verbatim.
      var pl = data.profit_loss || [];
      var firstIdx = 0;
      while (firstIdx < data.timestamp.length) {
        var eq = data.equity[firstIdx];
        var p = pl[firstIdx];
        var isPreTrading = !(eq > 0) || (p === 0 || p === '0');
        if (!isPreTrading) break;
        firstIdx++;
      }
      for (var i = firstIdx; i < data.timestamp.length; i++) {
        if (!(data.equity[i] > 0)) continue;
        var d = new Date(data.timestamp[i] * 1000);
        var year = d.getFullYear();
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        points.push({
          date: year + '-' + month + '-' + day,
          equity: Math.round(data.equity[i] * 100) / 100,
        });
      }
    }

    return res.status(200).json({ profile: profile, points: points });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch', message: err.message });
  }
}
