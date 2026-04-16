import React, { useState, useMemo, useEffect } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, ReferenceArea } from 'recharts'
import { Activity, TrendingUp, Shield, Zap, BarChart3, GitBranch, ChevronRight, Clock, CheckCircle, ToggleLeft, ToggleRight, Calendar, Database, FlaskConical, LineChart, ShieldCheck, Brain, SearchCheck, BookOpen, Lightbulb, UserCheck, SlidersHorizontal, Timer, Scale, Globe, Lock, ShieldAlert, ListOrdered, Undo2, XCircle, HelpCircle, PauseCircle, PlayCircle, Bot, Settings, Monitor } from 'lucide-react'

// Human-readable relative time for the "Updated …" line.
const relativeTime = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s} sec ago`
  if (s < 3600) { const m = Math.floor(s/60); return `${m} min ago` }
  if (s < 86400) { const h = Math.floor(s/3600); return `${h} hr${h>1?'s':''} ago` }
  const days = Math.floor(s/86400); return `${days} day${days>1?'s':''} ago`
}

const INFLATION_RATE = 0.03
const INITIAL_CAPITAL = 100000

const BASE_PROFILES = {
  aggressive: { name: 'Aggressive', color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.25)', winRate: 60.3, positions: 10, rebalance: '7d', trailingStop: '10%', strategy: 'Pure momentum', icon: Zap },
  growth: { name: 'Growth', label: "Duncan's Profile", color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)', winRate: 67.5, positions: 8, rebalance: '14d', trailingStop: '11%', strategy: 'Momentum + Quality', icon: TrendingUp },
  conservative: { name: 'Conservative', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.25)', winRate: 71.0, positions: 12, rebalance: '14d', trailingStop: '11%', strategy: 'Momentum + Quality', icon: Shield },
  benchmark: { name: 'S&P 500', color: '#cbd5e1', winRate: null }
}

// Equity curves are loaded from /backtest_output.json at runtime (see App).
// JSON shape: { equity_curves: { dates: [YYYY-MM], aggressive: [$], growth, conservative, benchmark }, metrics: {...} }
function buildMergedFromJson(json) {
  const ec = json.equity_curves
  const points = ec.dates.map((date, i) => ({
    date, idx: i,
    Aggressive: ec.aggressive[i],
    Growth: ec.growth[i],
    Conservative: ec.conservative[i],
    'S&P 500': ec.benchmark[i],
  }))
  // Extend to current month if data ends before today
  const now = new Date()
  const currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
  if (points.length > 0 && points[points.length - 1].date < currentMonth) {
    const last = points[points.length - 1]
    points.push({ date: currentMonth, idx: points.length, Aggressive: last.Aggressive, Growth: last.Growth, Conservative: last.Conservative, 'S&P 500': last['S&P 500'] })
  }
  return points
}

const dateToLabel = (d) => { const [y, m] = d.split('-'); const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${months[parseInt(m)-1]} ${y}` }

// Unified dollar formatter: auto-scale to K / M / B / T.
// <$1K → "$750" · <$1M → "$285.12K" · <$1B → "$11.55M" · <$1T → "$11.55B" · else "$1.15T".
// Whole-K values drop decimals ($100K, not $100.00K); larger units always show 2 decimals.
const formatDollar = (v) => {
  if (v == null || isNaN(v)) return '—'
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (a < 1000) return `${sign}$${a.toFixed(0)}`
  if (a < 1e6)  { const n = a / 1e3;  return `${sign}$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}K` }
  if (a < 1e9)  return `${sign}$${(a / 1e6).toFixed(2)}M`
  if (a < 1e12) return `${sign}$${(a / 1e9).toFixed(2)}B`
  return `${sign}$${(a / 1e12).toFixed(2)}T`
}

// ═══════════════════════════════════════════════════════════════
// FIX: Normalize all curves so the selected start date = $100K.
// This way changing the start date always shows growth from $100K,
// not from whatever the accumulated value was at that point.
// ═══════════════════════════════════════════════════════════════
function normalizeCurveFromStart(data, startIdx, capital = INITIAL_CAPITAL) {
  const keys = ['Aggressive', 'Growth', 'Conservative', 'S&P 500']
  const startVals = {}
  keys.forEach(k => { startVals[k] = data[startIdx][k] })
  return data.map(d => {
    const normalized = { ...d }
    keys.forEach(k => {
      normalized[k] = Math.round((d[k] / startVals[k]) * capital)
    })
    return normalized
  })
}

function calcMetrics(curveData, startIdx, endIdx, jsonMetrics, jsonTrades, dates, capital = INITIAL_CAPITAL) {
  if (startIdx >= endIdx || !curveData || curveData.length === 0) return null
  const normalized = normalizeCurveFromStart(curveData, startIdx, capital)
  const slice = normalized.slice(startIdx, endIdx + 1)
  const years = (endIdx - startIdx) / 12
  const results = {}
  const keys = ['Aggressive', 'Growth', 'Conservative', 'S&P 500']
  const isFullRange = startIdx === 0 && endIdx === curveData.length - 1
  keys.forEach(key => {
    const startVal = slice[0][key]; const endVal = slice[slice.length - 1][key]
    const values = slice.map(d => d[key])
    const totalReturn = ((endVal - startVal) / startVal) * 100
    const cagr = years > 0 ? (Math.pow(endVal / startVal, 1 / years) - 1) * 100 : 0
    let peak = values[0]; let maxDD = 0
    values.forEach(v => { if (v > peak) peak = v; const dd = ((peak - v) / peak) * 100; if (dd > maxDD) maxDD = dd })
    const monthlyReturns = []
    for (let i = 1; i < values.length; i++) monthlyReturns.push((values[i] - values[i-1]) / values[i-1])
    const avgReturn = monthlyReturns.length > 0 ? monthlyReturns.reduce((a, b) => a + b, 0) / monthlyReturns.length : 0
    const stdDev = monthlyReturns.length > 1 ? Math.sqrt(monthlyReturns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / monthlyReturns.length) : 0.01
    let sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(12) : 0

    // Use JSON metrics for full-range view (daily-computed values are more accurate)
    const profileMap = { 'Aggressive': 'aggressive', 'Growth': 'growth', 'Conservative': 'conservative' }
    if (isFullRange && jsonMetrics && profileMap[key] && jsonMetrics[profileMap[key]]) {
      const jm = jsonMetrics[profileMap[key]]
      if (jm.sharpe_ratio != null) sharpe = jm.sharpe_ratio
      if (jm.max_drawdown != null) maxDD = jm.max_drawdown * 100
    }

    let annualVol = Math.round(stdDev * Math.sqrt(12) * 1000) / 10
    if (isFullRange && jsonMetrics) {
      const profileMap2 = { 'Aggressive': 'aggressive', 'Growth': 'growth', 'Conservative': 'conservative' }
      if (profileMap2[key] && jsonMetrics[profileMap2[key]] && jsonMetrics[profileMap2[key]].annual_volatility != null) {
        annualVol = Math.round(jsonMetrics[profileMap2[key]].annual_volatility * 1000) / 10
      }
    }
    results[key] = { cagr: Math.round(cagr * 10) / 10, totalReturn: Math.round(totalReturn), maxDD: Math.round(maxDD * 10) / 10, sharpe: Math.round(sharpe * 1000) / 1000, annualVol, startVal: Math.round(startVal), endVal: Math.round(endVal) }
  })
  const benchCagr = results['S&P 500'].cagr
  ;['Aggressive', 'Growth', 'Conservative'].forEach(key => { results[key].alpha = Math.round((results[key].cagr - benchCagr) * 10) / 10 })
  results['S&P 500'].alpha = 0

  // For the full backtest range, prefer the engine's daily-computed alpha
  // and override the benchmark's Sharpe / Max DD with the confirmed values
  // (the monthly-resampled approximation diverges from the daily source-of-truth).
  if (isFullRange && jsonMetrics) {
    const profileMap = { 'Aggressive': 'aggressive', 'Growth': 'growth', 'Conservative': 'conservative' }
    ;['Aggressive', 'Growth', 'Conservative'].forEach(key => {
      const jm = jsonMetrics[profileMap[key]]
      if (jm && jm.alpha != null) results[key].alpha = Math.round(jm.alpha * 1000) / 10
    })
    results['S&P 500'].sharpe = 0.45
    results['S&P 500'].maxDD = 55.0
  }

  // Trade-based metrics (Win Rate, Profit Factor)
  const profileTradeMap = { 'Aggressive': 'aggressive', 'Growth': 'growth', 'Conservative': 'conservative' }
  const startDate = dates ? dates[startIdx] : null
  const endDate = dates ? dates[endIdx] + '-31' : null
  keys.forEach(key => {
    if (!profileTradeMap[key] || !jsonTrades || !jsonTrades[profileTradeMap[key]] || !startDate) {
      results[key].winRate = null; results[key].profitFactor = null; return
    }
    const trades = jsonTrades[profileTradeMap[key]].filter(t => t.exit_date >= startDate && t.exit_date <= endDate)
    if (trades.length === 0) { results[key].winRate = null; results[key].profitFactor = null; return }
    const winners = trades.filter(t => t.pnl > 0)
    const losers = trades.filter(t => t.pnl <= 0)
    results[key].winRate = Math.round(winners.length / trades.length * 1000) / 10
    const winSum = winners.reduce((s, t) => s + t.pnl, 0)
    const loseSum = Math.abs(losers.reduce((s, t) => s + t.pnl, 0))
    results[key].profitFactor = loseSum > 0 ? Math.round(winSum / loseSum * 1000) / 1000 : null
  })
  results['S&P 500'].winRate = null; results['S&P 500'].profitFactor = null

  // Full-range override with confirmed JSON win_rate and profit_factor
  if (isFullRange && jsonMetrics) {
    ;['Aggressive', 'Growth', 'Conservative'].forEach(key => {
      const jm = jsonMetrics[profileTradeMap[key]]
      if (jm && jm.win_rate != null) results[key].winRate = Math.round(jm.win_rate * 1000) / 10
      if (jm && jm.profit_factor != null) results[key].profitFactor = Math.round(jm.profit_factor * 1000) / 1000
    })
  }
  return results
}

function getAdjustedCurve(data, startIdx, inflationAdj, capital = INITIAL_CAPITAL) {
  const normalized = normalizeCurveFromStart(data, startIdx, capital)
  if (!inflationAdj) return normalized
  return normalized.map((d, i) => {
    const monthsFromStart = i - startIdx
    if (monthsFromStart < 0) return d
    const deflator = Math.pow(1 + INFLATION_RATE, monthsFromStart / 12)
    return { ...d, Aggressive: Math.round(d.Aggressive / deflator), Growth: Math.round(d.Growth / deflator), Conservative: Math.round(d.Conservative / deflator), 'S&P 500': Math.round(d['S&P 500'] / deflator) }
  })
}

const TABS = [
  { id: 'overview', label: 'Dashboard', icon: Activity },
  { id: 'backtest', label: 'Backtest Results', icon: BarChart3 },
  { id: 'profiles', label: 'Profile Comparison', icon: GitBranch },
  { id: 'trades', label: 'Live Trades', icon: TrendingUp },
  { id: 'evolution', label: 'System', icon: Settings },
]

function Card({ children, className = '', glow }) {
  return <div className={`rounded-xl border border-white/[0.06] bg-[#0f1420] p-5 ${className}`} style={glow ? { boxShadow: `0 0 40px -12px ${glow}` } : {}}>{children}</div>
}
function StatusPill({ status, text, onClick }) {
  const colors = { live: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', waiting: 'bg-amber-500/10 text-amber-400 border-amber-500/20', paused: 'bg-red-500/10 text-red-400 border-red-500/20' }
  const dotColors = { live: 'bg-emerald-400 animate-pulse', waiting: 'bg-amber-400', paused: 'bg-red-400' }
  return <span onClick={onClick} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colors[status]} ${onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}><span className={`w-1.5 h-1.5 rounded-full ${dotColors[status]}`} />{text}</span>
}
function InflationToggle({ inflationAdj, setInflationAdj, disabled }) {
  return <button onClick={() => !disabled && setInflationAdj(!inflationAdj)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${disabled ? 'opacity-40 cursor-not-allowed bg-white/[0.02] text-slate-500 border-white/[0.05]' : inflationAdj ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' : 'bg-white/[0.03] text-slate-400 border-white/[0.08] hover:border-white/[0.15]'}`}>{inflationAdj ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}{inflationAdj ? 'Real' : 'Nominal'}</button>
}
function NormalizeToggle({ normalized, setNormalized }) {
  return (
    <div className="flex rounded-lg border border-white/[0.08] overflow-hidden">
      <button onClick={() => setNormalized(false)} className={`px-3 py-1.5 text-xs font-medium transition-all ${!normalized ? 'bg-emerald-500/15 text-emerald-300 border-r border-emerald-500/30' : 'bg-white/[0.03] text-slate-400 border-r border-white/[0.08] hover:text-slate-300'}`}>$ Dollar</button>
      <button onClick={() => setNormalized(true)} className={`px-3 py-1.5 text-xs font-medium transition-all ${normalized ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.03] text-slate-400 hover:text-slate-300'}`}>% Normalized</button>
    </div>
  )
}

function DateRangeSelector({ startIdx, endIdx, setStartIdx, setEndIdx, dates, onCrisisShade }) {
  const total = dates.length
  // Anchor named regimes by date so they survive any future re-extension of the dataset.
  const findIdx = (label) => Math.max(0, dates.indexOf(label))
  // Relative-period start: N years before TODAY's month, then snap to the first
  // available data month at or after that target. End is always the latest data point.
  const yearsAgoIdx = (years) => {
    const now = new Date()
    const targetYear = now.getFullYear() - years
    const targetMonth = String(now.getMonth() + 1).padStart(2, '0')
    const target = targetYear + '-' + targetMonth
    let idx = dates.findIndex(d => d >= target)
    if (idx < 0) idx = 0
    return idx
  }
  const ranges = [
    { label: 'All', s: 0, e: total - 1 },
    { label: '10Y', s: yearsAgoIdx(10), e: total - 1 },
    { label: '5Y', s: yearsAgoIdx(5), e: total - 1 },
    { label: '3Y', s: yearsAgoIdx(3), e: total - 1 },
    { label: '1Y', s: yearsAgoIdx(1), e: total - 1 },
    { label: 'Dot-Com Crash', s: findIdx('2000-02'), e: findIdx('2007-06'), shade: ['2000-03', '2002-10'] },
    { label: 'Lost Decade', s: findIdx('2000-01'), e: findIdx('2009-12') },
    { label: '2008 Crisis', s: findIdx('2007-09'), e: findIdx('2013-04'), shade: ['2007-10', '2009-03'] },
    { label: 'COVID', s: findIdx('2020-01'), e: findIdx('2020-09'), shade: ['2020-02', '2020-03'] },
    { label: '2022 Bear', s: findIdx('2021-12'), e: findIdx('2024-02'), shade: ['2022-01', '2022-10'] },
  ]
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5">
        <Calendar size={12} className="text-slate-500" />
        <select value={startIdx} onChange={e => { setStartIdx(Number(e.target.value)); if (onCrisisShade) onCrisisShade(null) }} className="bg-white/[0.04] border border-white/[0.08] rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/40">
          {dates.map((d, i) => <option key={`s-${i}`} value={i} style={{ background: '#0f1420' }}>{dateToLabel(d)}</option>)}
        </select>
        <span className="text-slate-600 text-xs">to</span>
        <select value={endIdx} onChange={e => { setEndIdx(Number(e.target.value)); if (onCrisisShade) onCrisisShade(null) }} className="bg-white/[0.04] border border-white/[0.08] rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/40">
          {dates.map((d, i) => <option key={`e-${i}`} value={i} style={{ background: '#0f1420' }}>{dateToLabel(d)}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-1">
        {ranges.map(r => {
          const active = startIdx === r.s && endIdx === r.e
          return <button key={r.label} onClick={() => { setStartIdx(Math.max(0, r.s)); setEndIdx(Math.min(total - 1, r.e)); if (onCrisisShade) onCrisisShade(r.shade || null) }}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all whitespace-nowrap ${active ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/[0.03] text-slate-500 border border-white/[0.05] hover:text-slate-300'}`}>{r.label}</button>
        })}
      </div>
    </div>
  )
}

function EquityCurveChart({ data, startIdx, endIdx, height = 340, crisisShade, normalized = false }) {
  const slicedData = useMemo(() => {
    const raw = data.slice(startIdx, endIdx + 1)
    if (!normalized || raw.length === 0) return raw
    const keys = ['Aggressive', 'Growth', 'Conservative', 'S&P 500']
    const base = {}
    keys.forEach(k => { base[k] = raw[0][k] })
    return raw.map(d => {
      const n = { ...d }
      keys.forEach(k => { n[k] = base[k] > 0 ? Math.round((d[k] / base[k]) * 1000) / 10 : 0 })
      return n
    })
  }, [data, startIdx, endIdx, normalized])

  const allVals = slicedData.flatMap(d => [d.Aggressive, d.Growth, d.Conservative, d['S&P 500']].filter(v => v > 0))
  const minVal = normalized ? Math.max(1, Math.min(...allVals) * 0.9) : Math.max(1000, Math.min(...allVals) * 0.8)
  const formatNorm = (v) => v == null || isNaN(v) ? '—' : v >= 1000 ? `${(v / 100).toFixed(0)}x` : v.toFixed(0)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={slicedData}>
        <defs>
          {['aggressive', 'growth', 'conservative'].map(k => (
            <linearGradient key={k} id={`grad-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BASE_PROFILES[k].color} stopOpacity={0.15} />
              <stop offset="100%" stopColor={BASE_PROFILES[k].color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} interval={Math.max(1, Math.floor(slicedData.length / 10))} tickFormatter={v => v.split('-')[0]} />
        {normalized
          ? <YAxis scale="log" domain={[minVal, 'auto']} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={formatNorm} allowDataOverflow={true} />
          : <YAxis scale="log" domain={[minVal, 'auto']} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => formatDollar(v)} allowDataOverflow={true} />
        }
        <Tooltip content={props => {
          if (!props.active || !props.payload || !props.payload.length) return null
          const sorted = props.payload.slice().filter(p => p.value != null).sort((a, b) => (b.value || 0) - (a.value || 0))
          return (
            <div style={{ background: '#1a1f2e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12, padding: '8px 12px' }}>
              <div style={{ color: '#94a3b8', marginBottom: 4 }}>{dateToLabel(props.label)}</div>
              {sorted.map(p => (
                <div key={p.dataKey} style={{ color: p.color, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                  <span>{p.name}</span><span style={{ fontFamily: 'monospace' }}>{normalized ? formatNorm(p.value) : formatDollar(p.value)}</span>
                </div>
              ))}
            </div>
          )
        }} />
        {crisisShade && <ReferenceArea x1={crisisShade[0]} x2={crisisShade[1]} fill="#ef4444" fillOpacity={0.08} stroke="#ef4444" strokeOpacity={0.2} strokeDasharray="3 3" label={{ value: 'Crisis Period', position: 'insideTop', fill: '#ef4444', fontSize: 10, opacity: 0.6 }} />}
        <Area type="monotone" dataKey="Aggressive" stroke="#f97316" strokeWidth={2} fill="url(#grad-aggressive)" dot={false} />
        <Area type="monotone" dataKey="Growth" stroke="#10b981" strokeWidth={2} fill="url(#grad-growth)" dot={false} />
        <Area type="monotone" dataKey="Conservative" stroke="#3b82f6" strokeWidth={2} fill="url(#grad-conservative)" dot={false} />
        <Area type="monotone" dataKey="S&P 500" stroke={BASE_PROFILES.benchmark.color} strokeWidth={2.5} fill="none" strokeDasharray="5 3" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function OverviewTab({ metrics, inflationAdj, curvData, startIdx, endIdx, setStartIdx, setEndIdx, dates, liveData }) {
  const [historyPeriod, setHistoryPeriod] = useState('1M')
  const [historyData, setHistoryData] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [isCustomRange, setIsCustomRange] = useState(false)
  const [customStart, setCustomStart] = useState('2026-04-15')
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().split('T')[0])

  const HISTORY_PERIODS = [
    { label: '1W', value: '1W' },
    { label: '1M', value: '1M' },
    { label: '3M', value: '3M' },
    { label: '6M', value: '6M' },
    { label: '1Y', value: '1A' },
    { label: 'All', value: 'all' },
  ]

  const PROFILE_CONFIG = [
    { key: 'aggressive', name: 'Aggressive', color: '#f97316', textColor: 'text-orange-500', bgBadge: 'text-orange-500 bg-orange-500/10', icon: Zap },
    { key: 'growth', name: 'Growth', color: '#10b981', textColor: 'text-emerald-400', bgBadge: 'text-emerald-400 bg-emerald-400/10', icon: TrendingUp },
    { key: 'conservative', name: 'Conservative', color: '#3b82f6', textColor: 'text-blue-400', bgBadge: 'text-blue-400 bg-blue-400/10', icon: Shield },
  ]

  const DEFAULT_START_DATE = '2026-04-15'
  const chartData = historyData ? historyData.filter(function(d) {
    var startFilter = isCustomRange ? customStart : DEFAULT_START_DATE
    var endFilter = isCustomRange ? customEnd : '9999-12-31'
    return d.date >= startFilter && d.date <= endFilter
  }) : null

  useEffect(() => {
    setHistoryLoading(true)
    var dateParams = isCustomRange ? '&start=' + customStart + '&end=' + customEnd : ''
    var periodParam = isCustomRange ? 'all' : historyPeriod
    var safeFetch = function(url) { return fetch(url).then(function(r) { return r.ok ? r.json() : null }).catch(function() { return null }) }
    Promise.all([
      safeFetch('/api/history?profile=aggressive&period=' + periodParam + '&timeframe=1D' + dateParams),
      safeFetch('/api/history?profile=growth&period=' + periodParam + '&timeframe=1D' + dateParams),
      safeFetch('/api/history?profile=conservative&period=' + periodParam + '&timeframe=1D' + dateParams),
      safeFetch('/api/benchmark?period=' + periodParam + '&timeframe=1D' + dateParams),
      safeFetch('/api/portfolio'),
    ])
      .then(function(results) {
        var agg = results[0], gro = results[1], con = results[2], bench = results[3], live = results[4]
        var dateMap = {}
        function addPoints(data, key, field) {
          if (!data || !data.points) return
          data.points.forEach(function(p) {
            if (!dateMap[p.date]) dateMap[p.date] = { date: p.date }
            dateMap[p.date][key] = Math.max(0, p[field] || 0)
          })
        }
        addPoints(agg, 'aggressive', 'equity')
        addPoints(gro, 'growth', 'equity')
        addPoints(con, 'conservative', 'equity')
        addPoints(bench, 'spy', 'spy')
        // Override today's point with live portfolio values so chart matches profile cards.
        var today = new Date().toISOString().split('T')[0]
        if (live && live.profiles) {
          if (!dateMap[today]) dateMap[today] = { date: today }
          ;['aggressive', 'growth', 'conservative'].forEach(function(k) {
            var p = live.profiles[k]
            if (p && p.connected) {
              var v = p.portfolioValue || p.equity
              if (v != null && v > 0) dateMap[today][k] = v
            }
          })
          if (live.benchmark && !live.benchmark.notStarted && live.benchmark.portfolioValue) {
            dateMap[today].spy = live.benchmark.portfolioValue
          }
        }
        // Pad series with every trading day from start → period-forward end so X-axis
        // spans the full selected range. Today's point then anchors at the left edge.
        var periodDays = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1A': 365, 'all': 90 }
        var forward = new Date('2026-04-15T00:00:00Z')
        forward.setUTCDate(forward.getUTCDate() + (periodDays[historyPeriod] || 30))
        var periodEnd = forward.toISOString().split('T')[0]
        var rangeStart = isCustomRange ? customStart : '2026-04-15'
        var rangeEnd = isCustomRange ? customEnd : periodEnd
        if (rangeStart < '2026-04-15') rangeStart = '2026-04-15'
        var cursor = new Date(rangeStart + 'T00:00:00Z')
        var endD = new Date(rangeEnd + 'T00:00:00Z')
        while (cursor <= endD) {
          var dow = cursor.getUTCDay()
          if (dow !== 0 && dow !== 6) {
            var ds = cursor.toISOString().split('T')[0]
            if (!dateMap[ds]) dateMap[ds] = { date: ds }
          }
          cursor.setUTCDate(cursor.getUTCDate() + 1)
        }
        var merged = Object.values(dateMap).sort(function(a, b) { return a.date.localeCompare(b.date) })
        merged = merged.filter(function(d) { return d.date >= '2026-04-15' && d.date <= rangeEnd })
        setHistoryData(merged)
        setHistoryLoading(false)
      })
      .catch(function() { setHistoryLoading(false) })
  }, [historyPeriod, isCustomRange, customStart, customEnd])

  var profiles = liveData && liveData.profiles ? liveData.profiles : null
  var summary = liveData && liveData.summary ? liveData.summary : null

  // Derive dashboard fields from actual JSON structure
  var totalPositions = 0
  var connectedProfiles = 0
  if (profiles) {
    Object.values(profiles).forEach(function(prof) {
      if (prof && prof.connected) { connectedProfiles++ }
      if (prof && prof.positions) { totalPositions += prof.positions.length }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold">System Performance</h2><p className="text-sm text-slate-500">AI Portfolio Management System v4.0 · {liveData && liveData.mode === 'Live' ? 'Live Trading' : 'Live Paper Trading'}</p></div>
        <div className="flex gap-3"><StatusPill status={connectedProfiles === 3 ? 'live' : 'waiting'} text={connectedProfiles + '/3 Connected'} /><StatusPill status="live" text="Phase 7 In Progress" /></div>
      </div>

      <Card>
        <div className="flex justify-between items-center py-1">
          <div><div className="text-[10px] text-slate-500 uppercase mb-1">Total Portfolio Value</div><div className="font-mono text-lg font-bold text-emerald-400">{formatDollar(summary ? (summary.totalValue || 0) : 300000)}</div></div>
          <div><div className="text-[10px] text-slate-500 uppercase mb-1">Unrealized P&L</div><div className={'font-mono text-sm font-semibold ' + (summary && (summary.totalPnl||0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>{summary ? ((summary.totalPnl||0) >= 0 ? '+' : '') + formatDollar(summary.totalPnl||0) : '+$0'}</div></div>
          {(function() {
            var totalPnlForPct = summary ? (summary.totalPnl || 0) : 0
            var pnlPct = (totalPnlForPct / 300000) * 100
            return (
              <div><div className="text-[10px] text-slate-500 uppercase mb-1">P&L %</div><div className={'font-mono text-sm font-semibold ' + (pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>{(pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%'}</div></div>
            )
          })()}
          <div><div className="text-[10px] text-slate-500 uppercase mb-1">Total Positions</div><div className="font-mono text-sm font-semibold">{totalPositions}</div></div>
          <div><div className="text-[10px] text-slate-500 uppercase mb-1">Accounts</div><div className="font-mono text-sm font-semibold">{connectedProfiles}/3</div></div>
        </div>
      </Card>

      <div className="grid grid-cols-4 gap-4">
        {PROFILE_CONFIG.map(function(cfg) {
          var p = profiles ? profiles[cfg.key] : null
          var connected = p && p.connected
          var portfolioValue = connected ? (p.portfolioValue || p.equity || 0) : 0
          var totalPnl = 0
          var totalPnlPct = 0
          var activePositions = 0
          if (connected && p.positions) {
            activePositions = p.positions.length
            p.positions.forEach(function(pos) { totalPnl += (pos.unrealizedPnl || 0) })
            totalPnlPct = portfolioValue > 0 ? (totalPnl / (portfolioValue - totalPnl)) * 100 : 0
          }
          return (
            <Card key={cfg.key}>
              <div className="flex items-center gap-2 mb-4"><div className="p-1.5 rounded-lg" style={{ background: cfg.color + '14' }}><cfg.icon size={14} style={{ color: cfg.color }} /></div><span className={'font-semibold text-base ' + cfg.textColor}>{cfg.name}</span></div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] text-slate-500 uppercase mb-1">Portfolio Value</div><div className="font-mono text-sm font-semibold">{formatDollar(connected ? portfolioValue : 100000)}</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase mb-1">Unrealized P&L</div><div className={'font-mono text-sm font-semibold ' + (connected && totalPnl >= 0 ? 'text-emerald-400' : connected ? 'text-red-400' : 'text-slate-500')}>{connected ? (totalPnl >= 0 ? '+' : '') + formatDollar(totalPnl) : '+$0'}</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase mb-1">P&L %</div><div className={'font-mono text-sm font-semibold ' + (connected && totalPnlPct >= 0 ? 'text-emerald-400' : connected ? 'text-red-400' : 'text-slate-500')}>{connected ? (totalPnlPct >= 0 ? '+' : '') + totalPnlPct.toFixed(2) + '%' : '0.00%'}</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase mb-1">Positions</div><div className="font-mono text-sm font-semibold">{connected ? activePositions : 0}</div></div>
              </div>
            </Card>
          )
        })}
        {(function() {
          var b = liveData && liveData.benchmark ? liveData.benchmark : null
          var preOpen = !b || b.notStarted
          var value = preOpen ? 100000 : (b.portfolioValue != null ? b.portfolioValue : 100000)
          var pnl = preOpen ? 0 : (b.totalPnl != null ? b.totalPnl : 0)
          var pnlPct = preOpen ? 0 : (b.totalPnlPct != null ? b.totalPnlPct : (b.dailyPnlPct != null ? b.dailyPnlPct : 0))
          var positions = preOpen ? 0 : 1
          return (
            <Card>
              <div className="flex items-center gap-2 mb-4"><div className="p-1.5 rounded-lg" style={{ background: 'rgba(148,163,184,0.08)' }}><BarChart3 size={14} style={{ color: '#94a3b8' }} /></div><span className="font-semibold text-base text-slate-400">S&P 500</span>{preOpen && <span className="ml-auto text-[9px] text-amber-400 uppercase tracking-wide">Starts at market open</span>}</div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] text-slate-500 uppercase mb-1">Portfolio Value</div><div className="font-mono text-sm font-semibold text-slate-300">{formatDollar(value)}</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase mb-1">Unrealized P&L</div><div className={"font-mono text-sm font-semibold " + (preOpen ? "text-slate-500" : (pnl >= 0 ? "text-emerald-400" : "text-red-400"))}>{(pnl >= 0 ? "+" : "") + formatDollar(pnl)}</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase mb-1">P&L %</div><div className={"font-mono text-sm font-semibold " + (preOpen ? "text-slate-500" : (pnlPct >= 0 ? "text-emerald-400" : "text-red-400"))}>{(pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(2) + "%"}</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase mb-1">Benchmark</div><div className="font-mono text-sm font-semibold text-slate-300">SPY</div></div>
              </div>
            </Card>
          )
        })()}
      </div>

      <div>
        <h2 className="text-lg font-semibold">Paper Trading Performance</h2><p className="text-sm text-slate-500 mb-3">Live equity curves from Alpaca paper trading accounts</p>
        <Card>
          {/* Single-row header: title + date inputs · centered legend · period buttons */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-2.5">
              <h3 className="font-semibold text-sm whitespace-nowrap">Equity Curves</h3>
              <div className="flex items-center gap-1.5">
                <input type="date" value={customStart} onChange={function(e) { setCustomStart(e.target.value); setIsCustomRange(true) }}
                  className="bg-[#161b2b] border border-white/[0.06] rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 font-mono focus:outline-none focus:border-emerald-500/40" />
                <span className="text-slate-600 text-[10px]">to</span>
                <input type="date" value={customEnd} onChange={function(e) { setCustomEnd(e.target.value); setIsCustomRange(true) }}
                  className="bg-[#161b2b] border border-white/[0.06] rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 font-mono focus:outline-none focus:border-emerald-500/40" />
              </div>
            </div>
            <div className="flex-1 flex justify-center">
              <div className="flex items-center gap-5 px-3 py-1.5 rounded-md border border-white/[0.05] bg-[#0c1019]">
                {[
                  { label: 'Aggressive', color: '#f97316' },
                  { label: 'Growth', color: '#10b981' },
                  { label: 'Conservative', color: '#3b82f6' },
                  { label: 'S&P 500', color: '#94a3b8', dashed: true },
                ].map(function(item) { return (
                  <div key={item.label} className="flex items-center gap-2">
                    <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke={item.color} strokeWidth="3" strokeDasharray={item.dashed ? '5 3' : 'none'} /></svg>
                    <span className="text-[12px] text-slate-400 whitespace-nowrap">{item.label}</span>
                  </div>
                )})}
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              {HISTORY_PERIODS.map(function(p) { return (
                <button key={p.value} onClick={function() { setIsCustomRange(false); setHistoryPeriod(p.value); setCustomStart('2026-04-15'); setCustomEnd(new Date().toISOString().split('T')[0]) }}
                  className={'px-2 py-0.5 rounded text-[10px] font-medium transition-all ' + (!isCustomRange && historyPeriod === p.value ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-500 hover:text-slate-300')}>{p.label}</button>
              )})}
            </div>
          </div>
          {historyLoading ? (
            <div className="h-64 flex items-center justify-center text-slate-500">Loading...</div>
          ) : chartData && chartData.length > 0 ? (function() {
            // Auto-scale Y-axis tightly around the data so sub-percent moves on day 1 are visible.
            var allVals = [];
            chartData.forEach(function(d) { ['aggressive','growth','conservative','spy'].forEach(function(k) { if (d[k] != null && d[k] > 0) allVals.push(d[k]) }) });
            var yMin = 100000, yMax = 100000;
            if (allVals.length) { yMin = Math.min.apply(null, allVals); yMax = Math.max.apply(null, allVals); }
            var range = Math.max(yMax - yMin, yMax * 0.01); // min 1% spread so flat day 1 still renders a band
            var pad = range * 0.2;
            var yDomain = [Math.floor((yMin - pad) / 100) * 100, Math.ceil((yMax + pad) / 100) * 100];
            // X-axis tick interval: for short series show every point, otherwise thin to ~10 labels.
            var tickInterval = chartData.length <= 7 ? 0 : Math.max(1, Math.floor(chartData.length / 10));
            var xFmt = function(v) {
              var parts = v.split('-');
              return chartData.length <= 31
                ? parseInt(parts[1]) + '/' + parseInt(parts[2])
                : parts[0].slice(2) + '-' + parts[1];
            };
            // Day-1 single point → need dots so something renders. Otherwise lines only.
            var realPointCount = chartData.filter(function(d) { return d.aggressive != null || d.growth != null || d.conservative != null || d.spy != null }).length;
            var showDots = realPointCount <= 5;
            return (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                  <defs>
                    <linearGradient id="grad-agg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f97316" stopOpacity={0.15} /><stop offset="100%" stopColor="#f97316" stopOpacity={0} /></linearGradient>
                    <linearGradient id="grad-gro" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.15} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                    <linearGradient id="grad-con" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={0.15} /><stop offset="100%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} interval={tickInterval} tickFormatter={xFmt} padding={{ left: 0, right: 0 }} />
                  <YAxis type="number" domain={yDomain} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={function(v) { return formatDollar(v) }} allowDataOverflow={false} />
                  <Tooltip content={function(props) {
                    if (!props.active || !props.payload || !props.payload.length) return null;
                    var sorted = props.payload.slice().filter(function(p) { return p.value != null }).sort(function(a, b) { return (b.value || 0) - (a.value || 0) });
                    return (
                      <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, padding: '8px 12px' }}>
                        <div style={{ color: '#94a3b8', marginBottom: 4 }}>{props.label}</div>
                        {sorted.map(function(p) { return (
                          <div key={p.dataKey} style={{ color: p.color, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                            <span>{p.name}</span><span style={{ fontFamily: 'monospace' }}>{formatDollar(p.value)}</span>
                          </div>
                        )})}
                      </div>
                    );
                  }} />
                  <Area type="monotone" dataKey="aggressive"   stroke="#f97316" strokeWidth={2} fill="url(#grad-agg)" dot={showDots ? { r: 3, fill: '#f97316' } : false} name="Aggressive" connectNulls />
                  <Area type="monotone" dataKey="growth"       stroke="#10b981" strokeWidth={2} fill="url(#grad-gro)" dot={showDots ? { r: 3, fill: '#10b981' } : false} name="Growth" connectNulls />
                  <Area type="monotone" dataKey="conservative" stroke="#3b82f6" strokeWidth={2} fill="url(#grad-con)" dot={showDots ? { r: 3, fill: '#3b82f6' } : false} name="Conservative" connectNulls />
                  <Area type="monotone" dataKey="spy"          stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 3" fill="none" dot={showDots ? { r: 3, fill: '#94a3b8' } : false} name="S&P 500" connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            );
          })() : (
            <div className="h-[300px] rounded-lg bg-slate-800/50 flex items-center justify-center">
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-full bg-slate-700/50 flex items-center justify-center mb-3"><Clock size={20} className="text-slate-400" /></div>
                <div className="font-semibold text-lg">Awaiting First Trade</div>
                <div className="text-xs text-slate-500">Equity curves will appear once trading begins</div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function CapitalSlider({ capital, setCapital, metrics }) {
  const presets = [2000, 10000, 100000, 1000000]
  const fmt = formatDollar
  const MIN_CAPITAL = 100
  const MAX_CAPITAL = 10000000
  const [capitalInput, setCapitalInput] = useState('$' + capital.toLocaleString())
  useEffect(() => {
    setCapitalInput('$' + capital.toLocaleString())
  }, [capital])
  function commitCapitalInput() {
    const cleaned = capitalInput.replace(/[^0-9.]/g, '')
    const parsed = parseFloat(cleaned)
    if (!isFinite(parsed) || isNaN(parsed)) {
      setCapitalInput('$' + capital.toLocaleString())
      return
    }
    const clamped = Math.max(MIN_CAPITAL, Math.min(MAX_CAPITAL, Math.round(parsed)))
    setCapital(clamped)
    setCapitalInput('$' + clamped.toLocaleString())
  }
  const endVals = metrics ? [
    { k: 'Aggressive', color: '#f97316', v: metrics.Aggressive?.endVal },
    { k: 'Growth', color: '#10b981', v: metrics.Growth?.endVal },
    { k: 'Conservative', color: '#3b82f6', v: metrics.Conservative?.endVal },
    { k: 'S&P 500', color: '#94a3b8', v: metrics['S&P 500']?.endVal },
  ] : []
  return (
    <div className="mb-3 rounded-lg border border-white/[0.05] bg-[#0c1019] p-3">
      <div className="flex items-center justify-between mb-2 gap-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase">Starting Capital</span>
          <input
            type="text"
            value={capitalInput}
            onChange={e => setCapitalInput(e.target.value)}
            onBlur={commitCapitalInput}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.currentTarget.blur() }
              else if (e.key === 'Escape') { setCapitalInput('$' + capital.toLocaleString()); e.currentTarget.blur() }
            }}
            spellCheck={false}
            className="w-28 px-2 py-0.5 rounded bg-transparent border border-white/[0.08] focus:border-emerald-500/50 focus:outline-none font-mono text-sm font-bold text-emerald-400 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1">
          {presets.map(p => (
            <button key={p} onClick={() => setCapital(p)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${capital === p ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/[0.03] text-slate-500 border border-white/[0.05] hover:text-slate-300'}`}>
              {fmt(p)}
            </button>
          ))}
        </div>
      </div>
      <input type="range" min={1000} max={10000000} step={1000} value={capital}
        onChange={e => setCapital(Number(e.target.value))}
        className="w-full accent-emerald-500" />
      {metrics && (
        <div className="grid grid-cols-4 gap-3 mt-3 pt-2 border-t border-white/[0.04]">
          {endVals.map(ev => (
            <div key={ev.k}>
              <div className="text-[10px] text-slate-500 uppercase">{ev.k} End Value</div>
              <div className="font-mono text-sm font-semibold" style={{ color: ev.color }}>
                {formatDollar(ev.v)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BacktestTab({ metrics, inflationAdj, setInflationAdj, normalized, setNormalized, curveData, startIdx, endIdx, setStartIdx, setEndIdx, dates, capital, setCapital }) {
  const [crisisShade, setCrisisShade] = useState(null)
  const m = metrics; const years = ((endIdx - startIdx) / 12).toFixed(1)
  const fmtVal = formatDollar
  const rows = m ? [
    { key: 'CAGR', a: `${m.Aggressive.cagr}%`, g: `${m.Growth.cagr}%`, c: `${m.Conservative.cagr}%`, b: `${m['S&P 500'].cagr}%`, d: 'Compound annual growth rate' },
    { key: 'Sharpe Ratio', a: (m.Aggressive.sharpe||0).toFixed(3), g: (m.Growth.sharpe||0).toFixed(3), c: (m.Conservative.sharpe||0).toFixed(3), b: (m['S&P 500'].sharpe||0).toFixed(3), d: 'Risk-adjusted return' },
    { key: 'Annualized Volatility', a: `${m.Aggressive.annualVol}%`, g: `${m.Growth.annualVol}%`, c: `${m.Conservative.annualVol}%`, b: `${m['S&P 500'].annualVol}%`, d: 'Portfolio return variability' },
    { key: 'Max Drawdown', a: `${m.Aggressive.maxDD}%`, g: `${m.Growth.maxDD}%`, c: `${m.Conservative.maxDD}%`, b: `${m['S&P 500'].maxDD}%`, d: 'Largest peak-to-trough decline' },
    { key: 'Alpha vs S&P 500 (SPY)', a: `${m.Aggressive.alpha}%`, g: `${m.Growth.alpha}%`, c: `${m.Conservative.alpha}%`, b: '0%', d: 'Excess return over benchmark' },
    { key: 'Win Rate', a: m.Aggressive.winRate != null ? `${m.Aggressive.winRate}%` : '—', g: m.Growth.winRate != null ? `${m.Growth.winRate}%` : '—', c: m.Conservative.winRate != null ? `${m.Conservative.winRate}%` : '—', b: '—', d: 'Profitable trade percentage' },
    { key: 'Profit Factor', a: m.Aggressive.profitFactor != null ? m.Aggressive.profitFactor.toFixed(3) : '—', g: m.Growth.profitFactor != null ? m.Growth.profitFactor.toFixed(3) : '—', c: m.Conservative.profitFactor != null ? m.Conservative.profitFactor.toFixed(3) : '—', b: '—', d: 'Gross profit / gross loss' },
    { key: 'Total Return', a: `${m.Aggressive.totalReturn.toLocaleString()}%`, g: `${m.Growth.totalReturn.toLocaleString()}%`, c: `${m.Conservative.totalReturn.toLocaleString()}%`, b: `${m['S&P 500'].totalReturn.toLocaleString()}%`, d: `$100K over ${years} yrs` },
    { key: 'End Value', a: fmtVal(m.Aggressive.endVal), g: fmtVal(m.Growth.endVal), c: fmtVal(m.Conservative.endVal), b: fmtVal(m['S&P 500'].endVal), d: "Final Value (Today's Dollars)" },
    { key: 'Positions', a: '10', g: '8', c: '12', b: '500', d: 'Concurrent holdings' },
    { key: 'Rebalance', a: 'Weekly', g: 'Bi-weekly', c: 'Bi-weekly', b: '—', d: 'Rotation frequency' },
    { key: 'Trailing Stop', a: '10%', g: '11%', c: '11%', b: '—', d: 'Downside protection' },
  ] : []
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">Backtest Results — {dateToLabel(dates[startIdx])} to {endIdx === dates.length - 1 ? 'Present' : dateToLabel(dates[endIdx])}{inflationAdj && !normalized ? <span className="text-purple-400 text-sm ml-2">(Inflation-Adjusted)</span> : ''}{normalized ? <span className="text-emerald-400 text-sm ml-2">(Normalized)</span> : ''}</h2><p className="text-sm text-slate-500">{years} years · Backtested across dot-com, 2008, COVID, and 2022 regimes.</p></div><InflationToggle inflationAdj={inflationAdj} setInflationAdj={setInflationAdj} disabled={normalized} /></div>
      <div className="grid grid-cols-4 gap-4">
        {['aggressive', 'growth', 'conservative'].map(key => {
          const p = BASE_PROFILES[key]; const pm = m ? m[p.name] : null; const Icon = p.icon
          return (
            <Card key={key} glow={p.border}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg" style={{ background: p.bg }}><Icon size={16} style={{ color: p.color }} /></div>
                  <div><div className="font-semibold text-sm">{p.name}</div>{p.label && <div className="text-[10px] text-slate-500">{p.label}</div>}</div>
                </div>
                <div className="text-right"><div className="text-xs text-slate-500">End Value</div><div className="font-mono text-sm font-semibold" style={{ color: p.color }}>{pm ? fmtVal(pm.endVal) : '—'}</div></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] text-slate-500 uppercase">CAGR</div><div className="font-mono text-sm font-semibold" style={{ color: p.color }}>{pm ? pm.cagr : '—'}%</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase">Sharpe</div><div className="font-mono text-sm font-semibold">{pm ? (pm.sharpe||0).toFixed(3) : '—'}</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase">Max DD</div><div className="font-mono text-sm font-semibold text-slate-300">{pm ? pm.maxDD : '—'}%</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase">Win Rate</div><div className="font-mono text-sm font-semibold">{pm && pm.winRate != null ? pm.winRate + '%' : '—'}</div></div>
              </div>
            </Card>
          )
        })}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg" style={{ background: 'rgba(148,163,184,0.08)' }}><BarChart3 size={16} style={{ color: '#94a3b8' }} /></div>
              <div><div className="font-semibold text-sm" style={{ color: '#94a3b8' }}>S&P 500</div><div className="text-[10px] text-slate-500">Benchmark</div></div>
            </div>
            <div className="text-right"><div className="text-xs text-slate-500">End Value</div><div className="font-mono text-sm font-semibold" style={{ color: '#94a3b8' }}>{m ? fmtVal(m['S&P 500'].endVal) : '—'}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-[10px] text-slate-500 uppercase">CAGR</div><div className="font-mono text-sm font-semibold" style={{ color: '#94a3b8' }}>{m ? m['S&P 500'].cagr : '—'}%</div></div>
            <div><div className="text-[10px] text-slate-500 uppercase">Sharpe</div><div className="font-mono text-sm font-semibold">{m ? (m['S&P 500'].sharpe||0).toFixed(3) : '—'}</div></div>
            <div><div className="text-[10px] text-slate-500 uppercase">Max DD</div><div className="font-mono text-sm font-semibold text-slate-300">{m ? m['S&P 500'].maxDD : '—'}%</div></div>
            <div><div className="text-[10px] text-slate-500 uppercase">Win Rate</div><div className="font-mono text-sm font-semibold">—</div></div>
          </div>
        </Card>
      </div>
      <Card>
        <CapitalSlider capital={capital} setCapital={setCapital} metrics={metrics} />
        <div className="mb-3"><h3 className="font-semibold text-sm mb-2">Select Time Period</h3></div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex-1"><DateRangeSelector startIdx={startIdx} endIdx={endIdx} setStartIdx={setStartIdx} setEndIdx={setEndIdx} dates={dates} onCrisisShade={setCrisisShade} /></div>
          <div className="flex items-center gap-3 ml-3 shrink-0">
            <NormalizeToggle normalized={normalized} setNormalized={setNormalized} />
            <div className="flex items-center gap-5 px-3.5 py-2 rounded-lg border border-white/[0.06] bg-[#0c1019]">
              {[
                { label: 'Aggressive', color: '#f97316' },
                { label: 'Growth', color: '#10b981' },
                { label: 'Conservative', color: '#3b82f6' },
                { label: 'S&P 500', color: '#94a3b8', dashed: true },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke={item.color} strokeWidth="3" strokeDasharray={item.dashed ? '5 3' : 'none'} /></svg>
                  <span className="text-[12px] text-slate-400">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <EquityCurveChart data={curveData} startIdx={startIdx} endIdx={endIdx} height={360} crisisShade={crisisShade} normalized={normalized} />
      </Card>
      <Card><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-white/[0.06]"><th className="text-left py-3 px-3 text-xs text-slate-500 uppercase font-medium">Metric</th><th className="text-right py-3 px-3 text-xs uppercase font-medium" style={{ color: '#f97316' }}>Aggressive</th><th className="text-right py-3 px-3 text-xs uppercase font-medium" style={{ color: '#10b981' }}>Growth</th><th className="text-right py-3 px-3 text-xs uppercase font-medium" style={{ color: '#3b82f6' }}>Conservative</th><th className="text-right py-3 px-3 text-xs uppercase font-medium" style={{ color: BASE_PROFILES.benchmark.color }}>S&P 500</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.key} className={`border-b border-white/[0.03] ${i % 2 === 0 ? 'bg-white/[0.01]' : ''}`}><td className="py-2.5 px-3"><div className="font-medium">{r.key}{inflationAdj && <span className="text-purple-400 ml-1.5 text-xs font-normal">{r.realLabel || '(Real)'}</span>}</div><div className="text-[10px] text-slate-500">{r.d}</div></td><td className="py-2.5 px-3 text-right font-mono font-semibold" style={{ color: '#f97316' }}>{r.a}</td><td className="py-2.5 px-3 text-right font-mono font-semibold" style={{ color: '#10b981' }}>{r.g}</td><td className="py-2.5 px-3 text-right font-mono font-semibold" style={{ color: '#3b82f6' }}>{r.c}</td><td className="py-2.5 px-3 text-right font-mono font-semibold" style={{ color: BASE_PROFILES.benchmark.color }}>{r.b}</td></tr>)}</tbody></table></div></Card>
    </div>
  )
}

function ProfilesTab({ metrics, inflationAdj }) {
  const m = metrics
  const radarData = m ? [
    { metric: 'CAGR', Aggressive: m.Aggressive.cagr, Growth: m.Growth.cagr, Conservative: m.Conservative.cagr, max: Math.max(m.Aggressive.cagr, 45) },
    { metric: 'Sharpe', Aggressive: m.Aggressive.sharpe * 20, Growth: m.Growth.sharpe * 20, Conservative: m.Conservative.sharpe * 20, max: 30 },
    { metric: 'Win Rate', Aggressive: m.Aggressive.winRate || 0, Growth: m.Growth.winRate || 0, Conservative: m.Conservative.winRate || 0, max: 80 },
    { metric: 'Alpha', Aggressive: Math.max(0, m.Aggressive.alpha), Growth: Math.max(0, m.Growth.alpha), Conservative: Math.max(0, m.Conservative.alpha), max: Math.max(m.Aggressive.alpha || 1, 40) },
    { metric: 'DD Control', Aggressive: (100 - m.Aggressive.maxDD), Growth: (100 - m.Growth.maxDD), Conservative: (100 - m.Conservative.maxDD), max: 100 },
  ].map(d => ({ ...d, Aggressive: (d.Aggressive / d.max) * 100, Growth: (d.Growth / d.max) * 100, Conservative: (d.Conservative / d.max) * 100 })) : []
  const params = [
    { l: 'Strategy', a: 'Pure momentum', g: 'Momentum + Quality', c: 'Momentum + Quality' },
    { l: 'Positions', a: '10', g: '8', c: '12' },{ l: 'Max Position Size', a: '15%', g: '10%', c: '6%' },
    { l: 'Trailing Stop', a: '10%', g: '11%', c: '11%' },{ l: 'Weekly DD → 50% Cash', a: '8%', g: '6%', c: '6%' },
    { l: 'Critical DD → 100% Cash', a: '15%', g: '10%', c: '10%' },{ l: 'Max Sector', a: '40%', g: '40%', c: '40%' },
    { l: 'VIX Caution (30+)', a: 'Max 3 pos', g: 'Max 2 pos', c: 'Max 5 pos' },
    { l: 'VIX Danger (40+)', a: 'Max 2 pos', g: 'Max 1 pos', c: '100% defensive' },
    { l: 'Rebalance', a: 'Weekly', g: 'Bi-weekly', c: 'Bi-weekly' },
  ]
  return (
    <div className="space-y-6">
      <div><h2 className="text-lg font-semibold">Profile Comparison{inflationAdj ? <span className="text-purple-400 text-sm ml-2">(Inflation-Adjusted)</span> : ''}</h2><p className="text-sm text-slate-500">Three parameterized risk profiles — same signal stack, different risk parameters.</p></div>
      <Card><h3 className="font-semibold mb-4">Performance Radar</h3><ResponsiveContainer width="100%" height={320}><RadarChart data={radarData}><PolarGrid stroke="#1e293b" /><PolarAngleAxis dataKey="metric" tick={{ fill: '#94a3b8', fontSize: 11 }} /><Radar name="Aggressive" dataKey="Aggressive" stroke="#f97316" fill="#f97316" fillOpacity={0.1} strokeWidth={2} /><Radar name="Growth" dataKey="Growth" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} /><Radar name="Conservative" dataKey="Conservative" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2} /><Legend wrapperStyle={{ fontSize: 11 }} /></RadarChart></ResponsiveContainer></Card>
      <Card><h3 className="font-semibold mb-3">Risk Parameters</h3><table className="w-full text-sm"><thead><tr className="border-b border-white/[0.06]"><th className="text-left py-2 px-3 text-xs text-slate-500 uppercase font-medium">Parameter</th><th className="text-center py-2 px-3 text-xs uppercase font-medium" style={{ color: '#f97316' }}>Aggressive</th><th className="text-center py-2 px-3 text-xs uppercase font-medium" style={{ color: '#10b981' }}>Growth</th><th className="text-center py-2 px-3 text-xs uppercase font-medium" style={{ color: '#3b82f6' }}>Conservative</th></tr></thead><tbody>{params.map((p, i) => <tr key={p.l} className={`border-b border-white/[0.03] ${i % 2 === 0 ? 'bg-white/[0.01]' : ''}`}><td className="py-2 px-3 font-medium text-slate-300">{p.l}</td><td className="py-2 px-3 text-center font-mono text-sm">{p.a}</td><td className="py-2 px-3 text-center font-mono text-sm">{p.g}</td><td className="py-2 px-3 text-center font-mono text-sm">{p.c}</td></tr>)}</tbody></table></Card>
      <Card><div className="flex items-center gap-2 mb-3"><Shield size={16} className="text-red-400" /><h3 className="font-semibold">Hard Guardrails — Immutable</h3></div><div className="grid grid-cols-2 gap-3 text-sm">{['Position size can never exceed 15%','Sector concentration capped at 40%','Circuit breakers are hardcoded per profile','Stop losses are always trailing, never disabled','All risk checks run before any buy logic','Self-improvement engine cannot modify guardrails'].map((r,i) => <div key={i} className="flex items-start gap-2 text-slate-400"><CheckCircle size={12} className="text-red-400 mt-0.5 shrink-0" /><span>{r}</span></div>)}</div></Card>
    </div>
  )
}

function TradesTab({ liveData, lastUpdated }) {
  const profileColors = {
    aggressive: { color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.25)' },
    growth: { color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)' },
    conservative: { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.25)' },
  }

  if (!liveData || !liveData.profiles) {
    return (
      <div className="space-y-6">
        <div><h2 className="text-lg font-semibold">Live Trade Log</h2><p className="text-sm text-slate-500">Loading live data from Alpaca...</p></div>
        <Card><div className="flex flex-col items-center justify-center py-16 text-center"><div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-4"><Clock size={20} className="text-amber-400" /></div><div className="font-semibold text-lg mb-1">Awaiting Data</div><div className="text-sm text-slate-500 max-w-md">Paper trading with $100K per profile. Positions will appear after the export runs.</div></div></Card>
      </div>
    )
  }

  const summary = liveData.summary || {}
  const profiles = liveData.profiles || {}
  const trades = liveData.trades || []
  // Always read timestamp from the shared top-level lastUpdated state so every
  // tab reflects the same poll cycle. Fall back to the API's own timestamp.
  const tsSource = lastUpdated || liveData.timestamp || liveData.updated_at
  const relTime = relativeTime(tsSource)
  const updatedLabel = relTime ? `Updated ${relTime}` : 'Updated: awaiting data'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{liveData.mode === 'Live' ? 'Live Trading' : 'Live Paper Trading'}</h2>
        <p className="text-sm text-slate-500">Positions from Alpaca {liveData.mode === 'Live' ? 'live' : 'paper'} accounts · {updatedLabel}</p>
      </div>

      <Card>
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-xs text-slate-500 mb-1">Total Equity</div>
            <div className="font-mono text-lg font-bold text-emerald-400">{formatDollar(summary.totalValue || 0)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Unrealized P&L</div>
            <div className={`font-mono text-lg font-bold ${(summary.totalPnl||0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{(summary.totalPnl||0) >= 0 ? '+' : ''}{formatDollar(summary.totalPnl||0)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">P&L %</div>
            <div className={`font-mono text-lg font-bold ${(summary.totalPnlPct||0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{(summary.totalPnlPct||0) >= 0 ? '+' : ''}{(summary.totalPnlPct||0).toFixed(2)}%</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Mode</div>
            <div className={`font-mono text-lg font-bold ${liveData.mode === 'Live' ? 'text-emerald-400' : 'text-amber-400'}`}>{liveData.mode || 'Paper Trading'}</div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        {['aggressive', 'growth', 'conservative'].map(name => {
          const data = profiles[name] || {}
          const colors = profileColors[name] || profileColors.growth
          const connected = data.connected
          const equity = connected ? (data.portfolioValue || data.equity || 0) : 100000
          const cash = connected ? (data.cash || 0) : 100000
          const positions = data.positions || []
          // Total P&L since $100K inception = equity − 100000 (positions field uses Alpaca's own key names).
          const INITIAL = 100000
          const pnl = connected ? equity - INITIAL : 0
          const pnlPct = INITIAL > 0 ? (pnl / INITIAL) * 100 : 0
          return (
            <Card key={name}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{backgroundColor: colors.color}}></div>
                  <span className="font-semibold capitalize">{name}</span>
                </div>
                <span className="text-xs text-slate-500">{positions.length} position{positions.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-xs text-slate-500">Equity</div><div className="font-mono font-bold" style={{color: colors.color}}>{formatDollar(equity)}</div></div>
                <div><div className="text-xs text-slate-500">Cash</div><div className="font-mono text-slate-300">{formatDollar(cash)}</div></div>
                <div><div className="text-xs text-slate-500">P&L</div><div className={`font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}{formatDollar(pnl)}</div></div>
                <div><div className="text-xs text-slate-500">P&L %</div><div className={`font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</div></div>
              </div>
              <div className="mt-4 pt-3 border-t border-white/10">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Current Holdings</div>
                {positions.length === 0 ? (
                  <div className="text-xs text-slate-500 italic py-2">No positions yet — buys at next market open</div>
                ) : (function() {
                  // Normalize each position to a consistent camelCase shape.
                  // Alpaca raw returns snake_case; our /api/portfolio normalizes to camelCase — handle both.
                  var norm = positions.map(function(p) {
                    return {
                      ticker:    p.symbol || p.ticker,
                      qty:       Number(p.qty != null ? p.qty : (p.shares || 0)),
                      avgEntry:  Number(p.avgEntry != null ? p.avgEntry : (p.avg_entry_price || 0)),
                      current:   Number(p.currentPrice != null ? p.currentPrice : (p.current_price || 0)),
                      changeToday: (p.changeToday != null ? Number(p.changeToday) : (p.change_today != null ? Number(p.change_today) : null)),
                      pl:        Number(p.unrealizedPnl != null ? p.unrealizedPnl : (p.unrealized_pl || 0)),
                      plpct:     Number(p.unrealizedPnlPct != null ? p.unrealizedPnlPct : (p.unrealized_plpc != null ? p.unrealized_plpc : (p.unrealizedPnl_pct || 0))),
                      marketValue: Number(p.marketValue != null ? p.marketValue : (p.market_value || 0)),
                    }
                  }).sort(function(a, b) { return b.plpct - a.plpct })
                  // Totals.
                  var totShares = norm.reduce(function(s, r) { return s + r.qty }, 0)
                  var totPl     = norm.reduce(function(s, r) { return s + r.pl }, 0)
                  var totMv     = norm.reduce(function(s, r) { return s + r.marketValue }, 0)
                  var totCost   = totMv - totPl                             // cost basis
                  var totPlPct  = totCost > 0 ? (totPl / totCost) * 100 : 0
                  var totWeight = equity > 0 ? (totMv / equity) * 100 : 0
                  // Portfolio-weighted daily change (by market value).
                  var dayMv = 0, dayMvWithChange = 0
                  norm.forEach(function(r) { dayMv += r.marketValue; if (r.changeToday != null) dayMvWithChange += r.marketValue * r.changeToday })
                  var portDayPct = dayMv > 0 ? (dayMvWithChange / dayMv) : null
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-[10px] text-slate-500 border-b border-white/5">
                            <th className="text-left font-medium py-1 pr-2">Ticker</th>
                            <th className="text-right font-medium py-1 pr-2">Shares</th>
                            <th className="text-right font-medium py-1 pr-2">Avg Entry</th>
                            <th className="text-right font-medium py-1 pr-2">Current</th>
                            <th className="text-right font-medium py-1 pr-2">Today</th>
                            <th className="text-right font-medium py-1 pr-2">P&L $</th>
                            <th className="text-right font-medium py-1 pr-2">P&L %</th>
                            <th className="text-right font-medium py-1 pr-2">Mkt Value</th>
                            <th className="text-right font-medium py-1">Weight</th>
                          </tr>
                        </thead>
                        <tbody>
                          {norm.map(function(r, i) {
                            var plColor  = r.pl >= 0 ? 'text-emerald-400' : 'text-red-400'
                            var dayColor = r.changeToday == null ? 'text-slate-500' : (r.changeToday >= 0 ? 'text-emerald-400' : 'text-red-400')
                            var weight = equity > 0 ? (r.marketValue / equity) * 100 : 0
                            var zebra = i % 2 === 1 ? 'bg-white/[0.02]' : ''
                            return (
                              <tr key={i} className={'border-b border-white/[0.03] last:border-0 hover:bg-white/[0.04] ' + zebra}>
                                <td className="py-1 pr-2 font-mono font-semibold">{r.ticker}</td>
                                <td className="py-1 pr-2 text-right font-mono text-slate-300">{r.qty}</td>
                                <td className="py-1 pr-2 text-right font-mono text-slate-400">${r.avgEntry.toFixed(2)}</td>
                                <td className="py-1 pr-2 text-right font-mono text-slate-300">${r.current.toFixed(2)}</td>
                                <td className={'py-1 pr-2 text-right font-mono ' + dayColor}>{r.changeToday == null ? '—' : ((r.changeToday >= 0 ? '+' : '') + r.changeToday.toFixed(2) + '%')}</td>
                                <td className={'py-1 pr-2 text-right font-mono ' + plColor}>{(r.pl >= 0 ? '+$' : '-$') + Math.abs(r.pl).toFixed(2)}</td>
                                <td className={'py-1 pr-2 text-right font-mono ' + plColor}>{(r.plpct >= 0 ? '+' : '') + r.plpct.toFixed(2) + '%'}</td>
                                <td className="py-1 pr-2 text-right font-mono text-slate-300">${r.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                <td className="py-1 text-right font-mono text-slate-400">{weight.toFixed(1)}%</td>
                              </tr>
                            )
                          })}
                          <tr className="border-t border-white/10 bg-slate-800/30 font-semibold">
                            <td className="py-1.5 pr-2 text-[10px] uppercase text-slate-400">Total</td>
                            <td className="py-1.5 pr-2 text-right font-mono text-slate-300">{totShares}</td>
                            <td className="py-1.5 pr-2"></td>
                            <td className="py-1.5 pr-2"></td>
                            <td className={'py-1.5 pr-2 text-right font-mono ' + (portDayPct == null ? 'text-slate-500' : portDayPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>{portDayPct == null ? '—' : ((portDayPct >= 0 ? '+' : '') + portDayPct.toFixed(2) + '%')}</td>
                            <td className={'py-1.5 pr-2 text-right font-mono ' + (totPl >= 0 ? 'text-emerald-400' : 'text-red-400')}>{(totPl >= 0 ? '+$' : '-$') + Math.abs(totPl).toFixed(2)}</td>
                            <td className={'py-1.5 pr-2 text-right font-mono ' + (totPl >= 0 ? 'text-emerald-400' : 'text-red-400')}>{(totPlPct >= 0 ? '+' : '') + totPlPct.toFixed(2) + '%'}</td>
                            <td className="py-1.5 pr-2 text-right font-mono text-slate-200">${totMv.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                            <td className="py-1.5 text-right font-mono text-slate-200">{totWeight.toFixed(1)}%</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )
                })()}
              </div>
            </Card>
          )
        })}
      </div>

      <Card>
        <h3 className="font-semibold mb-4">Recent Trades by Profile</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {['aggressive', 'growth', 'conservative'].map(function(pname) {
            var colors = profileColors[pname]
            var pTrades = trades.filter(function(t) { return t.profile === pname }).slice(0, 10)
            return (
              <div key={pname}>
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b" style={{ borderColor: colors.border }}>
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.color }} />
                  <span className="font-semibold text-sm capitalize" style={{ color: colors.color }}>{pname}</span>
                  <span className="text-[10px] text-slate-500 ml-auto">{pTrades.length} trade{pTrades.length !== 1 ? 's' : ''}</span>
                </div>
                {pTrades.length === 0 ? (
                  <div className="text-xs text-slate-500 italic py-3">No trades recorded yet</div>
                ) : (
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-[10px] text-slate-500 border-b border-white/5">
                        <th className="text-left font-medium py-1 pr-2">Time</th>
                        <th className="text-left font-medium py-1 pr-2">Side</th>
                        <th className="text-left font-medium py-1 pr-2">Ticker</th>
                        <th className="text-right font-medium py-1 pr-2">Shares</th>
                        <th className="text-right font-medium py-1">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pTrades.map(function(trade, i) {
                        var time = trade.submitted_at ? new Date(trade.submitted_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
                        var isBuy = trade.side === 'buy'
                        var rowTint = isBuy ? 'bg-sky-500/[0.04] hover:bg-sky-500/[0.08]' : 'bg-amber-500/[0.04] hover:bg-amber-500/[0.08]'
                        var badgeClass = isBuy ? 'bg-sky-500/15 text-sky-300' : 'bg-amber-500/15 text-amber-300'
                        var priceStr = (trade.price != null) ? ('$' + Number(trade.price).toFixed(2)) : '—'
                        return (
                          <tr key={trade.order_id || i} className={'border-b border-white/[0.03] last:border-0 ' + rowTint}>
                            <td className="py-1 pr-2 text-[10px] text-slate-400 whitespace-nowrap">{time}</td>
                            <td className="py-1 pr-2"><span className={'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ' + badgeClass}>{trade.side}</span></td>
                            <td className="py-1 pr-2 font-mono font-semibold">{trade.ticker}</td>
                            <td className="py-1 pr-2 text-right font-mono text-slate-300">{trade.shares}</td>
                            <td className="py-1 text-right font-mono text-slate-300">{priceStr}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

function EvolutionTab() {
  return (
    <div className="space-y-6">
      <div><h2 className="text-lg font-semibold">System Architecture</h2><p className="text-sm text-slate-500">Six-layer pipeline powering the AI portfolio system.</p></div>
      <Card>
        <div className="grid grid-cols-6 gap-3">
          {[
            [Database, 'Data Pipeline', 'Daily equity data ingestion and storage'],
            [FlaskConical, 'Backtest Engine', 'Multi-regime historical validation (2000–present)'],
            [LineChart, 'Paper Trading', 'Live broker integration with 3 independent accounts'],
            [ShieldCheck, 'Risk Manager', 'Multi-layer protection: position, portfolio, and market-level'],
            [Brain, 'Self-Improvement', 'AI-powered weekly parameter optimization with human approval'],
            [Monitor, 'Dashboard', 'Real-time monitoring and performance visualization'],
          ].map(([Icon, l, d], i) => (
            <div key={i} className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-3"><div className="text-emerald-400 mb-1"><Icon size={20} /></div><div className="text-sm font-medium mb-0.5">{l}</div><div className="text-[10px] text-slate-500 leading-tight">{d}</div></div>
          ))}
        </div>
      </Card>
      <div><h2 className="text-lg font-semibold">Self-Improvement Engine</h2><p className="text-sm text-slate-500">Opus-powered weekly evolution. Analyzes, proposes, backtests, surfaces validated changes.</p></div>
      <Card><h3 className="font-semibold mb-4">Weekly Cycle</h3><div className="flex items-center gap-2">{[[SearchCheck,'1','Analyze',"Review trades"],[BookOpen,'2','Research','Scan approaches'],[Lightbulb,'3','Propose','1-3 improvements'],[FlaskConical,'4','Backtest','Validate proposals'],[UserCheck,'5','Approve','Duncan via Telegram']].map(([Icon,s,l,d],i) => <React.Fragment key={s}><div className="flex-1 rounded-lg border border-white/[0.04] bg-white/[0.02] p-3 text-center"><div className="text-xs font-mono text-emerald-400 mb-1">Step {s}</div><div className="flex justify-center text-emerald-400 mt-2 mb-1"><Icon size={20} /></div><div className="text-sm font-semibold mb-0.5">{l}</div><div className="text-[10px] text-slate-500">{d}</div></div>{i < 4 && <ChevronRight size={14} className="text-slate-600 shrink-0" />}</React.Fragment>)}</div></Card>
      <Card><div className="flex flex-col items-center justify-center py-12 text-center"><div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center mb-4"><GitBranch size={20} className="text-purple-400" /></div><div className="font-semibold text-lg mb-1">No Proposals Yet</div><div className="text-sm text-slate-500 max-w-md">First evolution cycle runs Sunday 7 PM after one week of trading data.</div></div></Card>
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <h3 className="font-semibold text-lg text-center mb-3 text-emerald-400">Tunable Parameters</h3>
          <div className="text-sm text-slate-400">
            {[[SlidersHorizontal,'Trailing stop percentages'],[Timer,'Rebalance frequency'],[TrendingUp,'Take-profit levels'],[Activity,'VIX regime thresholds'],[Scale,'Signal weight ratios'],[Globe,'Universe expansion']].map(([Icon,label],i,arr) => (
              <div key={label} className="flex items-center justify-center gap-2 py-2"><Icon size={14} className="text-slate-500 shrink-0" /><span>{label}</span></div>
            ))}
          </div>
        </Card>
        <Card>
          <h3 className="font-semibold text-lg text-center mb-3 text-red-400">Never Modified</h3>
          <div className="text-sm text-slate-400">
            {[[Zap,'Circuit breakers'],[Lock,'Max position size (15%)'],[Lock,'Max sector concentration (40%)'],[ShieldAlert,'Hard drawdown limits'],[ListOrdered,'Risk check execution order'],[UserCheck,"Duncan's final approval"]].map(([Icon,label],i,arr) => (
              <div key={label} className="flex items-center justify-center gap-2 py-2"><Icon size={14} className="text-slate-500 shrink-0" /><span>{label}</span></div>
            ))}
          </div>
        </Card>
      </div>
      <Card><h3 className="font-semibold text-lg text-center mb-3">Telegram Commands</h3><div className="grid grid-cols-[1fr_auto_1fr] gap-x-8 text-center max-w-2xl mx-auto"><div className="flex flex-col gap-3">{[[Activity,'STATUS','Portfolio overview'],[Undo2,'ROLLBACK','Undo last change'],[XCircle,'NONE','Reject all'],[PauseCircle,'PAUSE','Pause trading']].map(([Icon,c,d]) => <div key={c} className="flex items-center justify-center gap-2"><Icon size={14} className="text-slate-500" /><code className="text-emerald-400 font-mono text-xs font-bold tracking-wide">{c}</code><span className="text-slate-400 text-sm">{d}</span></div>)}</div><div className="flex flex-col items-center justify-center"><Bot size={44} className="text-emerald-400" /><div className="text-emerald-400 font-mono text-sm tracking-widest font-bold mt-2">JARVIS</div></div><div className="flex flex-col gap-3">{[[Clock,'HISTORY','Evolution log'],[CheckCircle,'1/2/3','Approve proposal'],[HelpCircle,'HELP','Show commands'],[PlayCircle,'RESUME','Resume trading']].map(([Icon,c,d]) => <div key={c} className="flex items-center justify-center gap-2"><Icon size={14} className="text-slate-500" /><code className="text-emerald-400 font-mono text-xs font-bold tracking-wide">{c}</code><span className="text-slate-400 text-sm">{d}</span></div>)}</div></div></Card>
    </div>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState('overview')
  const [systemActive, setSystemActive] = useState(true)
  const [inflationAdj, setInflationAdj] = useState(false)
  const [normalized, setNormalized] = useState(false)
  const [startIdx, setStartIdx] = useState(0)
  const [endIdx, setEndIdx] = useState(0)
  const [fullMergedCurve, setFullMergedCurve] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [jsonMetrics, setJsonMetrics] = useState(null)
  const [jsonTrades, setJsonTrades] = useState(null)
  const [liveData, setLiveData] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [capital, setCapital] = useState(INITIAL_CAPITAL)

  useEffect(() => {
    fetch('/backtest_output.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(json => {
        const merged = buildMergedFromJson(json)
        setFullMergedCurve(merged)
        setEndIdx(merged.length - 1)
            setJsonMetrics(json.metrics)
            if (json.trades) setJsonTrades(json.trades)
      })
      .catch(err => setLoadError(err.message))
  }, [])

  // Single source of truth for Alpaca/benchmark live state.
  // Polls every 60s; every child tab reads from this via props — no duplicate fetches.
  useEffect(() => {
    let cancelled = false
    const pull = () => {
      fetch('/api/portfolio')
        .then(r => { if (!r.ok) throw new Error('API error'); return r.json() })
        .then(data => { if (!cancelled) { setLiveData(data); setLastUpdated(new Date().toISOString()) } })
        .catch(err => console.error('Portfolio fetch failed:', err))
    }
    pull()
    const id = setInterval(pull, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const dates = useMemo(() => fullMergedCurve ? fullMergedCurve.map(d => d.date) : [], [fullMergedCurve])
  const curveData = useMemo(() => fullMergedCurve ? getAdjustedCurve(fullMergedCurve, startIdx, inflationAdj, capital) : null, [fullMergedCurve, inflationAdj, startIdx, capital])
  const metrics = useMemo(() => fullMergedCurve ? calcMetrics(fullMergedCurve, startIdx, endIdx, jsonMetrics, jsonTrades, dates, capital) : null, [fullMergedCurve, startIdx, endIdx, jsonMetrics, jsonTrades, dates, capital])
  const inflMetrics = useMemo(() => (inflationAdj && curveData) ? calcMetrics(curveData, startIdx, endIdx, null, jsonTrades, dates, capital) : metrics, [curveData, inflationAdj, startIdx, endIdx, metrics, jsonTrades, dates, capital])
  const tabProps = { metrics: inflMetrics, inflationAdj, setInflationAdj, normalized, setNormalized, curveData, startIdx, endIdx, setStartIdx, setEndIdx, dates, capital, setCapital }
  const TabContent = { overview: () => <OverviewTab {...tabProps} liveData={liveData} lastUpdated={lastUpdated} />, backtest: () => <BacktestTab {...tabProps} />, profiles: () => <ProfilesTab metrics={inflMetrics} inflationAdj={inflationAdj} />, trades: () => <TradesTab liveData={liveData} lastUpdated={lastUpdated} />, evolution: () => <EvolutionTab /> }
  return (
    <div className="min-h-screen bg-[#0a0e17]">
      <header className="border-b border-white/[0.06] bg-[#0a0e17]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center"><TrendingUp size={16} className="text-white" /></div><div><div className="font-bold text-sm tracking-tight">AI Portfolio System</div><div className="text-[10px] text-slate-500">Duncan Shin — Quantitative Strategy</div></div></div>
          <div className="flex items-center gap-4"><div className="text-right mr-2"><div className="text-xs text-slate-500">Duncan's Wealth Portfolio</div><div className="font-mono text-sm font-bold text-emerald-400">{liveData && liveData.summary ? formatDollar(liveData.summary.totalValue||0) : "..."}</div></div><StatusPill status={systemActive ? 'live' : 'paused'} text={systemActive ? 'System Active' : 'System Paused'} onClick={function() { setSystemActive(!systemActive) }} /></div>
        </div>
      </header>
      <nav className="border-b border-white/[0.06]"><div className="max-w-7xl mx-auto px-6 flex gap-1">{TABS.map(tab => { const Icon = tab.icon; const active = activeTab === tab.id; return <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${active ? 'border-emerald-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}><Icon size={14} />{tab.label}</button> })}</div></nav>
      <main className="max-w-7xl mx-auto px-6 py-6">{loadError ? <div className="text-sm text-red-400">Failed to load /backtest_output.json: {loadError}</div> : !fullMergedCurve ? <div className="text-sm text-slate-500">Loading backtest data…</div> : TabContent[activeTab]()}</main>
      <footer className="border-t border-white/[0.06] mt-12"><div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between text-xs text-slate-600"><span>AI Portfolio Management System v4.0 · Jan 2000 – Present</span><span>Python · Alpaca · Claude Opus 4.6 · React</span></div></footer>
    </div>
  )
}
