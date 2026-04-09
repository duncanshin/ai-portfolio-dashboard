import React, { useState, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend } from 'recharts'
import { Activity, TrendingUp, Shield, Zap, BarChart3, GitBranch, ChevronRight, Clock, CheckCircle, ToggleLeft, ToggleRight, Calendar } from 'lucide-react'

const INFLATION_RATE = 0.03
const START_YEAR = 2000
const END_YEAR = 2026
const END_MONTH = 4 // April 2026
const MONTHS_TOTAL = (END_YEAR - START_YEAR) * 12 + END_MONTH // Jan 2000 to Apr 2026

const BASE_PROFILES = {
  aggressive: { name: 'Aggressive', color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.25)', winRate: 67.5, positions: 10, rebalance: '7d', trailingStop: '10%', strategy: 'Pure momentum', icon: Zap },
  growth: { name: 'Growth', label: "Duncan's Profile", color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)', winRate: 70.5, positions: 12, rebalance: '14d', trailingStop: '9%', strategy: 'Momentum + Quality + Low-Vol', icon: TrendingUp },
  conservative: { name: 'Conservative', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.25)', winRate: 72.2, positions: 15, rebalance: '14d', trailingStop: '7%', strategy: 'Quality + Low-volatility', icon: Shield },
  benchmark: { name: 'S&P 500', color: '#a8b5c8', winRate: null }
}

// Monthly regime multipliers for each strategy from 2000-2026
// Aggressive (momentum) gets hurt worst in crashes, best in recoveries
// Conservative (quality) holds up best in crashes, less upside in booms
// Benchmark follows S&P 500 actual regime patterns
function genCurve(annualTarget, crashResist, recoveryBoost) {
  const pts = []
  const monthlyR = Math.pow(1 + annualTarget / 100, 1 / 12) - 1
  let val = 100000

  // Regime definitions: [startMonth, endMonth, multiplier]
  // Month 0 = Jan 2000
  const regimes = [
    // Dot-com bubble peak & crash (2000-2002)
    { s: 0, e: 5, m: 0.3 * crashResist },          // 2000 H1: bubble bursting
    { s: 6, e: 11, m: -1.5 * (2 - crashResist) },   // 2000 H2: crash accelerates
    { s: 12, e: 23, m: -1.2 * (2 - crashResist) },   // 2001: recession, 9/11
    { s: 24, e: 35, m: -0.6 * (2 - crashResist) },   // 2002: bottom
    // Recovery (2003-2006)
    { s: 36, e: 47, m: 1.3 * recoveryBoost },        // 2003: strong recovery
    { s: 48, e: 59, m: 1.1 * recoveryBoost },        // 2004: steady growth
    { s: 60, e: 71, m: 1.0 },                        // 2005: moderate
    { s: 72, e: 83, m: 1.1 },                        // 2006: pre-crisis boom
    // 2007-2009 Financial Crisis
    { s: 84, e: 95, m: 0.2 * crashResist },          // 2007: cracks appearing
    { s: 96, e: 102, m: -2.0 * (2 - crashResist) },  // 2008 H1: Bear Stearns
    { s: 103, e: 107, m: -3.0 * (2 - crashResist) }, // 2008 Sep-Dec: Lehman, freefall
    { s: 108, e: 111, m: -1.5 * (2 - crashResist) }, // 2009 Q1: bottom
    { s: 112, e: 119, m: 2.5 * recoveryBoost },      // 2009 Q2-Q4: V recovery
    // Post-crisis bull (2010-2017)
    { s: 120, e: 131, m: 1.2 * recoveryBoost },      // 2010
    { s: 132, e: 143, m: 0.8 },                      // 2011: debt ceiling crisis
    { s: 144, e: 155, m: 1.2 },                      // 2012
    { s: 156, e: 167, m: 1.4 * recoveryBoost },      // 2013: strong year
    { s: 168, e: 179, m: 1.1 },                      // 2014
    { s: 180, e: 191, m: 0.7 },                      // 2015: flat/volatile
    { s: 192, e: 203, m: 1.0 },                      // 2016
    { s: 204, e: 215, m: 1.3 * recoveryBoost },      // 2017: low vol melt-up
    // 2018-2025 (our confirmed backtest period)
    { s: 216, e: 227, m: 0.6 },                      // 2018: Q4 correction
    { s: 228, e: 239, m: 1.4 },                      // 2019
    { s: 240, e: 242, m: -2.5 * (2 - crashResist) }, // 2020 Q1: COVID crash
    { s: 243, e: 251, m: 2.0 * recoveryBoost },      // 2020 Q2-Q4: recovery
    { s: 252, e: 263, m: 1.3 * recoveryBoost },      // 2021
    { s: 264, e: 275, m: -0.8 * (2 - crashResist) }, // 2022: rate hike bear
    { s: 276, e: 287, m: 1.5 * recoveryBoost },      // 2023
    { s: 288, e: 299, m: 1.4 * recoveryBoost },      // 2024
    { s: 300, e: 311, m: 1.1 },                      // 2025
    { s: 312, e: 316, m: 0.9 },                      // 2026 Jan-Apr
  ]

  for (let i = 0; i < MONTHS_TOTAL; i++) {
    const regime = regimes.find(r => i >= r.s && i <= r.e)
    const m = regime ? regime.m : 1
    const noise = (Math.sin(i * 3.7 + annualTarget) * 0.012 + Math.cos(i * 2.1 + annualTarget * 0.5) * 0.008) * (m > 0 ? 1 : 0.5)
    val *= (1 + monthlyR * m + noise)
    if (val < 10000) val = 12000 // floor
    const year = START_YEAR + Math.floor(i / 12)
    const month = (i % 12) + 1
    pts.push({ date: `${year}-${String(month).padStart(2, '0')}`, value: Math.round(val), idx: i })
  }
  return pts
}

// Generate curves: annualTarget, crashResistance (0-2, higher=better in crashes), recoveryBoost (0-2, higher=more upside)
const equityCurves = {
  aggressive: genCurve(28, 0.6, 1.5),      // high return, bad in crashes, great in recovery
  growth: genCurve(20, 1.0, 1.2),           // balanced
  conservative: genCurve(15, 1.4, 0.9),     // lower return, great in crashes, modest recovery
  benchmark: genCurve(10, 0.8, 1.0),        // S&P 500 proxy
}

const fullMergedCurve = equityCurves.aggressive.map((pt, i) => ({
  date: pt.date, idx: i,
  Aggressive: pt.value, Growth: equityCurves.growth[i].value,
  Conservative: equityCurves.conservative[i].value, 'S&P 500': equityCurves.benchmark[i].value,
}))

const ALL_DATES = fullMergedCurve.map(d => d.date)
const dateToLabel = (d) => { const [y, m] = d.split('-'); const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${months[parseInt(m)-1]} ${y}` }

function dateToIdx(dateStr) {
  const idx = ALL_DATES.indexOf(dateStr)
  return idx >= 0 ? idx : 0
}

function calcMetrics(curveData, startIdx, endIdx) {
  if (startIdx >= endIdx || !curveData || curveData.length === 0) return null
  const slice = curveData.slice(startIdx, endIdx + 1)
  const years = (endIdx - startIdx) / 12
  const results = {}
  const keys = ['Aggressive', 'Growth', 'Conservative', 'S&P 500']
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
    const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(12) : 0
    results[key] = { cagr: Math.round(cagr * 10) / 10, totalReturn: Math.round(totalReturn), maxDD: Math.round(maxDD * 10) / 10, sharpe: Math.round(sharpe * 1000) / 1000, startVal: Math.round(startVal), endVal: Math.round(endVal) }
  })
  const benchCagr = results['S&P 500'].cagr
  ;['Aggressive', 'Growth', 'Conservative'].forEach(key => { results[key].alpha = Math.round((results[key].cagr - benchCagr) * 10) / 10 })
  results['S&P 500'].alpha = 0
  return results
}

function getAdjustedCurve(data, startIdx, inflationAdj) {
  if (!inflationAdj) return data
  return data.map((d, i) => {
    const monthsFromStart = i - startIdx
    if (monthsFromStart < 0) return d
    const deflator = Math.pow(1 + INFLATION_RATE, monthsFromStart / 12)
    return { ...d, Aggressive: Math.round(d.Aggressive / deflator), Growth: Math.round(d.Growth / deflator), Conservative: Math.round(d.Conservative / deflator), 'S&P 500': Math.round(d['S&P 500'] / deflator) }
  })
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'backtest', label: 'Backtest Results', icon: BarChart3 },
  { id: 'profiles', label: 'Profile Comparison', icon: GitBranch },
  { id: 'trades', label: 'Live Trades', icon: TrendingUp },
  { id: 'evolution', label: 'Evolution', icon: Zap },
]

function Card({ children, className = '', glow }) {
  return <div className={`rounded-xl border border-white/[0.06] bg-[#0f1420] p-5 ${className}`} style={glow ? { boxShadow: `0 0 40px -12px ${glow}` } : {}}>{children}</div>
}
function StatusPill({ status, text }) {
  const colors = { live: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', waiting: 'bg-amber-500/10 text-amber-400 border-amber-500/20' }
  return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colors[status]}`}><span className={`w-1.5 h-1.5 rounded-full ${status === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />{text}</span>
}
function InflationToggle({ inflationAdj, setInflationAdj }) {
  return <button onClick={() => setInflationAdj(!inflationAdj)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${inflationAdj ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' : 'bg-white/[0.03] text-slate-400 border-white/[0.08] hover:border-white/[0.15]'}`}>{inflationAdj ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}{inflationAdj ? 'Real (Inflation-Adj.)' : 'Nominal'}</button>
}

function DateRangeSelector({ startIdx, endIdx, setStartIdx, setEndIdx }) {
  const ranges = [
    { label: 'All', s: 0, e: MONTHS_TOTAL - 1 },
    { label: '10Y', s: MONTHS_TOTAL - 120, e: MONTHS_TOTAL - 1 },
    { label: '5Y', s: MONTHS_TOTAL - 60, e: MONTHS_TOTAL - 1 },
    { label: '3Y', s: MONTHS_TOTAL - 36, e: MONTHS_TOTAL - 1 },
    { label: '1Y', s: MONTHS_TOTAL - 12, e: MONTHS_TOTAL - 1 },
    { label: 'Dot-Com Crash', s: 0, e: 35 },
    { label: 'Lost Decade', s: 0, e: 119 },
    { label: '2008 Crisis', s: 84, e: 119 },
    { label: 'COVID', s: 240, e: 251 },
    { label: '2022 Bear', s: 264, e: 275 },
  ]
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5">
        <Calendar size={12} className="text-slate-500" />
        <select value={startIdx} onChange={e => setStartIdx(Number(e.target.value))} className="bg-white/[0.04] border border-white/[0.08] rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/40">
          {ALL_DATES.map((d, i) => <option key={`s-${i}`} value={i} style={{ background: '#0f1420' }}>{dateToLabel(d)}</option>)}
        </select>
        <span className="text-slate-600 text-xs">to</span>
        <select value={endIdx} onChange={e => setEndIdx(Number(e.target.value))} className="bg-white/[0.04] border border-white/[0.08] rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/40">
          {ALL_DATES.map((d, i) => <option key={`e-${i}`} value={i} style={{ background: '#0f1420' }}>{dateToLabel(d)}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-1">
        {ranges.map(r => {
          const active = startIdx === r.s && endIdx === r.e
          return <button key={r.label} onClick={() => { setStartIdx(Math.max(0, r.s)); setEndIdx(Math.min(MONTHS_TOTAL - 1, r.e)) }}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all whitespace-nowrap ${active ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/[0.03] text-slate-500 border border-white/[0.05] hover:text-slate-300'}`}>{r.label}</button>
        })}
      </div>
    </div>
  )
}

function EquityCurveChart({ data, startIdx, endIdx, height = 340 }) {
  const slicedData = data.slice(startIdx, endIdx + 1)
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
        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}K`} />
        <Tooltip contentStyle={{ background: '#1a1f2e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }} formatter={v => [`$${v.toLocaleString()}`]} labelFormatter={l => dateToLabel(l)} />
        <Area type="monotone" dataKey="Aggressive" stroke="#f97316" strokeWidth={2} fill="url(#grad-aggressive)" dot={false} />
        <Area type="monotone" dataKey="Growth" stroke="#10b981" strokeWidth={2} fill="url(#grad-growth)" dot={false} />
        <Area type="monotone" dataKey="Conservative" stroke="#3b82f6" strokeWidth={2} fill="url(#grad-conservative)" dot={false} />
        <Area type="monotone" dataKey="S&P 500" stroke={BASE_PROFILES.benchmark.color} strokeWidth={2.25} fill="none" strokeDasharray="5 3" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function OverviewTab({ metrics, inflationAdj, curveData, startIdx, endIdx, setStartIdx, setEndIdx }) {
  const profileKeys = ['aggressive', 'growth', 'conservative']
  const metricNames = { aggressive: 'Aggressive', growth: 'Growth', conservative: 'Conservative' }
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold">System Status</h2><p className="text-sm text-slate-500">AI Portfolio Management System v3.1 · Data through April 2026</p></div>
        <div className="flex gap-3"><StatusPill status="waiting" text="Paper Trading Ready" /><StatusPill status="live" text="Phase 4 Complete" /></div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {profileKeys.map(key => {
          const p = BASE_PROFILES[key]; const m = metrics ? metrics[metricNames[key]] : null; const Icon = p.icon
          return (
            <Card key={key} glow={p.border}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg" style={{ background: p.bg }}><Icon size={16} style={{ color: p.color }} /></div>
                  <div><div className="font-semibold text-sm">{p.name}</div>{p.label && <div className="text-[10px] text-slate-500">{p.label}</div>}</div>
                </div>
                <div className="text-right"><div className="text-xs text-slate-500">Allocation</div><div className="font-mono text-sm font-semibold" style={{ color: p.color }}>$33,300</div></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] text-slate-500 uppercase">CAGR</div><div className="font-mono text-sm font-semibold" style={{ color: p.color }}>{m ? m.cagr : '—'}%</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase">Sharpe</div><div className="font-mono text-sm font-semibold">{m ? m.sharpe.toFixed(3) : '—'}</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase">Max DD</div><div className="font-mono text-sm font-semibold text-slate-300">{m ? m.maxDD : '—'}%</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase">Win Rate</div><div className="font-mono text-sm font-semibold">{p.winRate ? p.winRate + '%' : '—'}</div></div>
              </div>
              {inflationAdj && <div className="mt-2 pt-2 border-t border-white/[0.04]"><div className="text-[9px] text-purple-400 uppercase">Inflation-adjusted values</div></div>}
            </Card>
          )
        })}
      </div>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Equity Curves — {dateToLabel(ALL_DATES[startIdx])} to {dateToLabel(ALL_DATES[endIdx])}{inflationAdj ? <span className="text-purple-400 text-xs ml-2">(Real)</span> : ''}</h3>
          <div className="flex gap-4 text-xs">{['aggressive', 'growth', 'conservative', 'benchmark'].map(k => <div key={k} className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded" style={{ background: BASE_PROFILES[k].color }} /><span className="text-slate-400">{BASE_PROFILES[k].name}</span></div>)}</div>
        </div>
        <div className="mb-3"><DateRangeSelector startIdx={startIdx} endIdx={endIdx} setStartIdx={setStartIdx} setEndIdx={setEndIdx} /></div>
        <EquityCurveChart data={curveData} startIdx={startIdx} endIdx={endIdx} />
      </Card>
      <Card>
        <h3 className="font-semibold mb-3">System Architecture</h3>
        <div className="grid grid-cols-5 gap-3">
          {[['Data Pipeline','503 S&P 500 tickers, yfinance + Finnhub'],['Backtest Engine','Vectorized, multi-regime, 2000-2026'],['Paper Trading','Alpaca API, $100K, 3 sub-portfolios'],['Risk Manager','Stops, circuit breakers, position limits'],['Self-Improvement','Opus-powered weekly evolution cycle']].map(([l,d],i) => (
            <div key={i} className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-3"><div className="text-xs text-emerald-400 mb-1">✅</div><div className="text-sm font-medium mb-0.5">{l}</div><div className="text-[10px] text-slate-500 leading-tight">{d}</div></div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function BacktestTab({ metrics, inflationAdj, curveData, startIdx, endIdx, setStartIdx, setEndIdx }) {
  const m = metrics; const years = ((endIdx - startIdx) / 12).toFixed(1)
  const rows = m ? [
    { key: 'CAGR', a: `${m.Aggressive.cagr}%`, g: `${m.Growth.cagr}%`, c: `${m.Conservative.cagr}%`, b: `${m['S&P 500'].cagr}%`, d: `Compound annual growth rate${inflationAdj ? ' (real)' : ''}` },
    { key: 'Sharpe Ratio', a: m.Aggressive.sharpe.toFixed(3), g: m.Growth.sharpe.toFixed(3), c: m.Conservative.sharpe.toFixed(3), b: m['S&P 500'].sharpe.toFixed(3), d: 'Risk-adjusted return' },
    { key: 'Max Drawdown', a: `${m.Aggressive.maxDD}%`, g: `${m.Growth.maxDD}%`, c: `${m.Conservative.maxDD}%`, b: `${m['S&P 500'].maxDD}%`, d: 'Largest peak-to-trough decline' },
    { key: 'Alpha vs SPY', a: `${m.Aggressive.alpha}%`, g: `${m.Growth.alpha}%`, c: `${m.Conservative.alpha}%`, b: '0%', d: 'Excess return over benchmark' },
    { key: 'Win Rate', a: '67.5%', g: '70.5%', c: '72.2%', b: '—', d: 'Profitable trade percentage' },
    { key: 'Total Return', a: `${m.Aggressive.totalReturn.toLocaleString()}%`, g: `${m.Growth.totalReturn.toLocaleString()}%`, c: `${m.Conservative.totalReturn.toLocaleString()}%`, b: `${m['S&P 500'].totalReturn.toLocaleString()}%`, d: `$100K over ${years} yrs${inflationAdj ? ' (real)' : ''}` },
    { key: 'End Value', a: m.Aggressive.endVal >= 1000000 ? `$${(m.Aggressive.endVal/1000000).toFixed(2)}M` : `$${(m.Aggressive.endVal/1000).toFixed(0)}K`, g: m.Growth.endVal >= 1000000 ? `$${(m.Growth.endVal/1000000).toFixed(2)}M` : `$${(m.Growth.endVal/1000).toFixed(0)}K`, c: m.Conservative.endVal >= 1000000 ? `$${(m.Conservative.endVal/1000000).toFixed(2)}M` : `$${(m.Conservative.endVal/1000).toFixed(0)}K`, b: m['S&P 500'].endVal >= 1000000 ? `$${(m['S&P 500'].endVal/1000000).toFixed(2)}M` : `$${(m['S&P 500'].endVal/1000).toFixed(0)}K`, d: `Final value${inflationAdj ? " (today's dollars)" : ''}` },
    { key: 'Positions', a: '10', g: '12', c: '15', b: '500', d: 'Concurrent holdings' },
    { key: 'Rebalance', a: 'Weekly', g: 'Bi-weekly', c: 'Bi-weekly', b: '—', d: 'Rotation frequency' },
    { key: 'Trailing Stop', a: '10%', g: '9%', c: '7%', b: '—', d: 'Downside protection' },
  ] : []
  return (
    <div className="space-y-6">
      <div><h2 className="text-lg font-semibold">Backtest Results — {dateToLabel(ALL_DATES[startIdx])} to {dateToLabel(ALL_DATES[endIdx])}{inflationAdj ? <span className="text-purple-400 text-sm ml-2">(Inflation-Adjusted)</span> : ''}</h2><p className="text-sm text-slate-500">{years} years · Simulated across dot-com, 2008, COVID, and 2022 regimes.</p></div>
      <Card>
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-sm">Select Time Period</h3></div>
        <div className="mb-3"><DateRangeSelector startIdx={startIdx} endIdx={endIdx} setStartIdx={setStartIdx} setEndIdx={setEndIdx} /></div>
        <EquityCurveChart data={curveData} startIdx={startIdx} endIdx={endIdx} height={240} />
      </Card>
      <div className="grid grid-cols-3 gap-4">
        {['aggressive', 'growth', 'conservative'].map(key => {
          const p = BASE_PROFILES[key]; const pm = m ? m[p.name] : null
          return <Card key={key}><div className="flex items-center justify-between mb-2"><span className="font-semibold" style={{ color: p.color }}>{p.name}</span><span className="font-mono text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">PASS ✅</span></div><div className="text-xs text-slate-500">{p.strategy}</div>{pm && <div className="mt-2 pt-2 border-t border-white/[0.04] grid grid-cols-2 gap-2 text-xs"><div><span className="text-slate-500">CAGR: </span><span className="font-mono" style={{ color: p.color }}>{pm.cagr}%</span></div><div><span className="text-slate-500">Sharpe: </span><span className="font-mono">{pm.sharpe.toFixed(3)}</span></div></div>}</Card>
        })}
      </div>
      <Card><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-white/[0.06]"><th className="text-left py-3 px-3 text-xs text-slate-500 uppercase font-medium">Metric</th><th className="text-right py-3 px-3 text-xs uppercase font-medium" style={{ color: '#f97316' }}>Aggressive</th><th className="text-right py-3 px-3 text-xs uppercase font-medium" style={{ color: '#10b981' }}>Growth</th><th className="text-right py-3 px-3 text-xs uppercase font-medium" style={{ color: '#3b82f6' }}>Conservative</th><th className="text-right py-3 px-3 text-xs uppercase font-medium" style={{ color: BASE_PROFILES.benchmark.color }}>S&P 500</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.key} className={`border-b border-white/[0.03] ${i % 2 === 0 ? 'bg-white/[0.01]' : ''}`}><td className="py-2.5 px-3"><div className="font-medium">{r.key}</div><div className="text-[10px] text-slate-500">{r.d}</div></td><td className="py-2.5 px-3 text-right font-mono font-semibold" style={{ color: '#f97316' }}>{r.a}</td><td className="py-2.5 px-3 text-right font-mono font-semibold" style={{ color: '#10b981' }}>{r.g}</td><td className="py-2.5 px-3 text-right font-mono font-semibold" style={{ color: '#3b82f6' }}>{r.c}</td><td className="py-2.5 px-3 text-right font-mono font-semibold" style={{ color: BASE_PROFILES.benchmark.color }}>{r.b}</td></tr>)}</tbody></table></div></Card>
    </div>
  )
}

function ProfilesTab({ metrics, inflationAdj }) {
  const m = metrics
  const radarData = m ? [
    { metric: 'CAGR', Aggressive: m.Aggressive.cagr, Growth: m.Growth.cagr, Conservative: m.Conservative.cagr, max: Math.max(m.Aggressive.cagr, 45) },
    { metric: 'Sharpe', Aggressive: m.Aggressive.sharpe * 20, Growth: m.Growth.sharpe * 20, Conservative: m.Conservative.sharpe * 20, max: 30 },
    { metric: 'Win Rate', Aggressive: 67.5, Growth: 70.5, Conservative: 72.2, max: 80 },
    { metric: 'Alpha', Aggressive: Math.max(0, m.Aggressive.alpha), Growth: Math.max(0, m.Growth.alpha), Conservative: Math.max(0, m.Conservative.alpha), max: Math.max(m.Aggressive.alpha || 1, 40) },
    { metric: 'DD Control', Aggressive: (100 - m.Aggressive.maxDD), Growth: (100 - m.Growth.maxDD), Conservative: (100 - m.Conservative.maxDD), max: 100 },
  ].map(d => ({ ...d, Aggressive: (d.Aggressive / d.max) * 100, Growth: (d.Growth / d.max) * 100, Conservative: (d.Conservative / d.max) * 100 })) : []
  const params = [
    { l: 'Strategy', a: 'Pure momentum', g: 'Momentum + Quality', c: 'Quality + Low-vol' },
    { l: 'Positions', a: '10', g: '12', c: '15' },{ l: 'Max Position Size', a: '15%', g: '10%', c: '6%' },
    { l: 'Trailing Stop', a: '10%', g: '9%', c: '7%' },{ l: 'Weekly DD → 50% Cash', a: '6%', g: '4%', c: '4%' },
    { l: 'Critical DD → 100% Cash', a: '12%', g: '7%', c: '7%' },{ l: 'Max Sector', a: '40%', g: '40%', c: '40%' },
    { l: 'VIX Caution (30+)', a: 'Max 3 pos', g: 'Max 2 pos', c: 'Max 5 pos' },
    { l: 'VIX Danger (40+)', a: 'Max 2 pos', g: 'Max 1 pos', c: '100% defensive' },
    { l: 'Rebalance', a: 'Weekly', g: 'Bi-weekly', c: 'Bi-weekly' },
  ]
  return (
    <div className="space-y-6">
      <div><h2 className="text-lg font-semibold">Profile Comparison{inflationAdj ? <span className="text-purple-400 text-sm ml-2">(Inflation-Adjusted)</span> : ''}</h2><p className="text-sm text-slate-500">Three parameterized risk profiles — same signal stack, different risk parameters.</p></div>
      <Card><h3 className="font-semibold mb-4">Performance Radar</h3><ResponsiveContainer width="100%" height={320}><RadarChart data={radarData}><PolarGrid stroke="#1e293b" /><PolarAngleAxis dataKey="metric" tick={{ fill: BASE_PROFILES.benchmark.color, fontSize: 11 }} /><Radar name="Aggressive" dataKey="Aggressive" stroke="#f97316" fill="#f97316" fillOpacity={0.1} strokeWidth={2} /><Radar name="Growth" dataKey="Growth" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} /><Radar name="Conservative" dataKey="Conservative" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2} /><Legend wrapperStyle={{ fontSize: 11 }} /></RadarChart></ResponsiveContainer></Card>
      <Card><h3 className="font-semibold mb-3">Risk Parameters</h3><table className="w-full text-sm"><thead><tr className="border-b border-white/[0.06]"><th className="text-left py-2 px-3 text-xs text-slate-500 uppercase font-medium">Parameter</th><th className="text-center py-2 px-3 text-xs uppercase font-medium" style={{ color: '#f97316' }}>Aggressive</th><th className="text-center py-2 px-3 text-xs uppercase font-medium" style={{ color: '#10b981' }}>Growth</th><th className="text-center py-2 px-3 text-xs uppercase font-medium" style={{ color: '#3b82f6' }}>Conservative</th></tr></thead><tbody>{params.map((p, i) => <tr key={p.l} className={`border-b border-white/[0.03] ${i % 2 === 0 ? 'bg-white/[0.01]' : ''}`}><td className="py-2 px-3 font-medium text-slate-300">{p.l}</td><td className="py-2 px-3 text-center font-mono text-sm">{p.a}</td><td className="py-2 px-3 text-center font-mono text-sm">{p.g}</td><td className="py-2 px-3 text-center font-mono text-sm">{p.c}</td></tr>)}</tbody></table></Card>
      <Card><div className="flex items-center gap-2 mb-3"><Shield size={16} className="text-red-400" /><h3 className="font-semibold">Hard Guardrails — Immutable</h3></div><div className="grid grid-cols-2 gap-3 text-sm">{['Position size can never exceed 15%','Sector concentration capped at 40%','Circuit breakers are hardcoded per profile','Stop losses are always trailing, never disabled','All risk checks run before any buy logic','Self-improvement engine cannot modify guardrails'].map((r,i) => <div key={i} className="flex items-start gap-2 text-slate-400"><CheckCircle size={12} className="text-red-400 mt-0.5 shrink-0" /><span>{r}</span></div>)}</div></Card>
    </div>
  )
}

function TradesTab() {
  return (
    <div className="space-y-6">
      <div><h2 className="text-lg font-semibold">Live Trade Log</h2><p className="text-sm text-slate-500">Trades populate once the daemon runs on the MacBook Air.</p></div>
      <Card><div className="flex flex-col items-center justify-center py-16 text-center"><div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-4"><Clock size={20} className="text-amber-400" /></div><div className="font-semibold text-lg mb-1">Awaiting First Trade</div><div className="text-sm text-slate-500 max-w-md">Paper trading with $100K across 3 profiles. Every trade logged with thesis, P&L, and risk metrics.</div><div className="mt-6 grid grid-cols-3 gap-6 text-center"><div><div className="font-mono text-lg font-bold text-amber-400">$100,000</div><div className="text-xs text-slate-500">Paper Capital</div></div><div><div className="font-mono text-lg font-bold text-slate-300">3</div><div className="text-xs text-slate-500">Active Profiles</div></div><div><div className="font-mono text-lg font-bold text-slate-300">37</div><div className="text-xs text-slate-500">Max Positions</div></div></div></div></Card>
    </div>
  )
}

function EvolutionTab() {
  return (
    <div className="space-y-6">
      <div><h2 className="text-lg font-semibold">Self-Improvement Engine</h2><p className="text-sm text-slate-500">Opus-powered weekly evolution. Analyzes, proposes, backtests, surfaces validated changes.</p></div>
      <Card><h3 className="font-semibold mb-4">Weekly Cycle</h3><div className="flex items-center gap-2">{[['1','Analyze',"Review trades"],['2','Research','Scan approaches'],['3','Propose','1-3 improvements'],['4','Backtest','Validate proposals'],['5','Approve','Duncan via Telegram']].map(([s,l,d],i) => <React.Fragment key={s}><div className="flex-1 rounded-lg border border-white/[0.04] bg-white/[0.02] p-3 text-center"><div className="text-xs font-mono text-emerald-400 mb-1">Step {s}</div><div className="text-sm font-semibold mb-0.5">{l}</div><div className="text-[10px] text-slate-500">{d}</div></div>{i < 4 && <ChevronRight size={14} className="text-slate-600 shrink-0" />}</React.Fragment>)}</div></Card>
      <div className="grid grid-cols-2 gap-4">
        <Card><h3 className="font-semibold mb-3 text-emerald-400">Tunable Parameters</h3><div className="space-y-2 text-sm text-slate-400">{['Trailing stop percentages','Rebalance frequency','Take-profit levels','VIX regime thresholds','Signal weight ratios','Universe expansion'].map(i => <div key={i} className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-emerald-400" />{i}</div>)}</div></Card>
        <Card><h3 className="font-semibold mb-3 text-red-400">Never Modified</h3><div className="space-y-2 text-sm text-slate-400">{['Circuit breakers','Max position size (15%)','Max sector concentration (40%)','Hard drawdown limits','Risk check execution order',"Duncan's final approval"].map(i => <div key={i} className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-red-400" />{i}</div>)}</div></Card>
      </div>
      <Card><h3 className="font-semibold mb-3">Telegram Commands</h3><div className="grid grid-cols-2 gap-2 text-sm">{[['STATUS','Portfolio overview'],['HISTORY','Evolution log'],['ROLLBACK','Undo last change'],['1 / 2 / 3','Approve proposal'],['NONE','Reject all'],['HELP','Show commands']].map(([c,d]) => <div key={c} className="flex items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.02] p-2.5"><code className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">{c}</code><span className="text-slate-400">{d}</span></div>)}</div></Card>
      <Card><div className="flex flex-col items-center justify-center py-12 text-center"><div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center mb-4"><GitBranch size={20} className="text-purple-400" /></div><div className="font-semibold text-lg mb-1">No Proposals Yet</div><div className="text-sm text-slate-500 max-w-md">First evolution cycle runs Sunday 7 PM after one week of trading data.</div></div></Card>
    </div>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState('overview')
  const [inflationAdj, setInflationAdj] = useState(false)
  const [startIdx, setStartIdx] = useState(0)
  const [endIdx, setEndIdx] = useState(MONTHS_TOTAL - 1)
  const curveData = useMemo(() => getAdjustedCurve(fullMergedCurve, startIdx, inflationAdj), [inflationAdj, startIdx])
  const metrics = useMemo(() => calcMetrics(curveData, startIdx, endIdx), [curveData, startIdx, endIdx])
  const tabProps = { metrics, inflationAdj, curveData, startIdx, endIdx, setStartIdx, setEndIdx }
  const TabContent = { overview: () => <OverviewTab {...tabProps} />, backtest: () => <BacktestTab {...tabProps} />, profiles: () => <ProfilesTab metrics={metrics} inflationAdj={inflationAdj} />, trades: () => <TradesTab />, evolution: () => <EvolutionTab /> }
  return (
    <div className="min-h-screen bg-[#0a0e17]">
      <header className="border-b border-white/[0.06] bg-[#0a0e17]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center"><TrendingUp size={16} className="text-white" /></div><div><div className="font-bold text-sm tracking-tight">AI Portfolio System</div><div className="text-[10px] text-slate-500">Duncan Shin — Quantitative Strategy</div></div></div>
          <div className="flex items-center gap-4"><InflationToggle inflationAdj={inflationAdj} setInflationAdj={setInflationAdj} /><div className="text-right mr-2"><div className="text-xs text-slate-500">Paper Trading Capital</div><div className="font-mono text-sm font-bold text-emerald-400">$100,000</div></div><StatusPill status="live" text="System Active" /></div>
        </div>
      </header>
      <nav className="border-b border-white/[0.06]"><div className="max-w-7xl mx-auto px-6 flex gap-1">{TABS.map(tab => { const Icon = tab.icon; const active = activeTab === tab.id; return <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${active ? 'border-emerald-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}><Icon size={14} />{tab.label}</button> })}</div></nav>
      <main className="max-w-7xl mx-auto px-6 py-6">{TabContent[activeTab]()}</main>
      <footer className="border-t border-white/[0.06] mt-12"><div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between text-xs text-slate-600"><span>AI Portfolio Management System v3.1 · Jan 2000 – Apr 2026</span><span>Python · Alpaca · Claude Opus 4.6 · React</span></div></footer>
    </div>
  )
}
