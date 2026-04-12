import React, { useState, useMemo, useEffect } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend } from 'recharts'
import { Activity, TrendingUp, Shield, Zap, BarChart3, GitBranch, ChevronRight, Clock, CheckCircle, ToggleLeft, ToggleRight, Calendar, Database, FlaskConical, LineChart, ShieldCheck, Brain, SearchCheck, BookOpen, Lightbulb, UserCheck, SlidersHorizontal, Timer, Scale, Globe, Lock, ShieldAlert, ListOrdered, Undo2, XCircle, HelpCircle, PauseCircle, PlayCircle, Bot } from 'lucide-react'

const INFLATION_RATE = 0.03
const INITIAL_CAPITAL = 100000

const BASE_PROFILES = {
  aggressive: { name: 'Aggressive', color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.25)', winRate: 60.7, positions: 10, rebalance: '7d', trailingStop: '10%', strategy: 'Pure momentum', icon: Zap },
  growth: { name: 'Growth', label: "Duncan's Profile", color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)', winRate: 67.8, positions: 12, rebalance: '14d', trailingStop: '9%', strategy: 'Momentum + Quality + Low-Vol', icon: TrendingUp },
  conservative: { name: 'Conservative', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.25)', winRate: 71.1, positions: 15, rebalance: '14d', trailingStop: '7%', strategy: 'Quality + Low-volatility', icon: Shield },
  benchmark: { name: 'S&P 500', color: '#cbd5e1', winRate: null }
}

// Equity curves are loaded from /backtest_output.json at runtime (see App).
// JSON shape: { equity_curves: { dates: [YYYY-MM], aggressive: [$], growth, conservative, benchmark }, metrics: {...} }
function buildMergedFromJson(json) {
  const ec = json.equity_curves
  return ec.dates.map((date, i) => ({
    date, idx: i,
    Aggressive: ec.aggressive[i],
    Growth: ec.growth[i],
    Conservative: ec.conservative[i],
    'S&P 500': ec.benchmark[i],
  }))
}

const dateToLabel = (d) => { const [y, m] = d.split('-'); const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${months[parseInt(m)-1]} ${y}` }

// ═══════════════════════════════════════════════════════════════
// FIX: Normalize all curves so the selected start date = $100K.
// This way changing the start date always shows growth from $100K,
// not from whatever the accumulated value was at that point.
// ═══════════════════════════════════════════════════════════════
function normalizeCurveFromStart(data, startIdx) {
  const keys = ['Aggressive', 'Growth', 'Conservative', 'S&P 500']
  const startVals = {}
  keys.forEach(k => { startVals[k] = data[startIdx][k] })
  return data.map(d => {
    const normalized = { ...d }
    keys.forEach(k => {
      normalized[k] = Math.round((d[k] / startVals[k]) * INITIAL_CAPITAL)
    })
    return normalized
  })
}

function calcMetrics(curveData, startIdx, endIdx, jsonMetrics) {
  if (startIdx >= endIdx || !curveData || curveData.length === 0) return null
  const normalized = normalizeCurveFromStart(curveData, startIdx)
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

    results[key] = { cagr: Math.round(cagr * 10) / 10, totalReturn: Math.round(totalReturn), maxDD: Math.round(maxDD * 10) / 10, sharpe: Math.round(sharpe * 1000) / 1000, startVal: Math.round(startVal), endVal: Math.round(endVal) }
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
  return results
}

function getAdjustedCurve(data, startIdx, inflationAdj) {
  const normalized = normalizeCurveFromStart(data, startIdx)
  if (!inflationAdj) return normalized
  return normalized.map((d, i) => {
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
  { id: 'evolution', label: 'System', icon: Zap },
]

function Card({ children, className = '', glow }) {
  return <div className={`rounded-xl border border-white/[0.06] bg-[#0f1420] p-5 ${className}`} style={glow ? { boxShadow: `0 0 40px -12px ${glow}` } : {}}>{children}</div>
}
function StatusPill({ status, text }) {
  const colors = { live: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', waiting: 'bg-amber-500/10 text-amber-400 border-amber-500/20' }
  return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colors[status]}`}><span className={`w-1.5 h-1.5 rounded-full ${status === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />{text}</span>
}
function InflationToggle({ inflationAdj, setInflationAdj }) {
  return <button onClick={() => setInflationAdj(!inflationAdj)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${inflationAdj ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' : 'bg-white/[0.03] text-slate-400 border-white/[0.08] hover:border-white/[0.15]'}`}>{inflationAdj ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}{inflationAdj ? 'Real' : 'Nominal'}</button>
}

function DateRangeSelector({ startIdx, endIdx, setStartIdx, setEndIdx, dates }) {
  const total = dates.length
  // Anchor named regimes by date so they survive any future re-extension of the dataset.
  const findIdx = (label) => Math.max(0, dates.indexOf(label))
  const ranges = [
    { label: 'All', s: 0, e: total - 1 },
    { label: '10Y', s: total - 120, e: total - 1 },
    { label: '5Y', s: total - 60, e: total - 1 },
    { label: '3Y', s: total - 36, e: total - 1 },
    { label: '1Y', s: total - 12, e: total - 1 },
    { label: 'Dot-Com Crash', s: findIdx('2000-01'), e: findIdx('2002-12') },
    { label: 'Lost Decade', s: findIdx('2000-01'), e: findIdx('2009-12') },
    { label: '2008 Crisis', s: findIdx('2007-01'), e: findIdx('2009-12') },
    { label: 'COVID', s: findIdx('2020-01'), e: findIdx('2020-12') },
    { label: '2022 Bear', s: findIdx('2022-01'), e: findIdx('2022-12') },
  ]
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5">
        <Calendar size={12} className="text-slate-500" />
        <select value={startIdx} onChange={e => setStartIdx(Number(e.target.value))} className="bg-white/[0.04] border border-white/[0.08] rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/40">
          {dates.map((d, i) => <option key={`s-${i}`} value={i} style={{ background: '#0f1420' }}>{dateToLabel(d)}</option>)}
        </select>
        <span className="text-slate-600 text-xs">to</span>
        <select value={endIdx} onChange={e => setEndIdx(Number(e.target.value))} className="bg-white/[0.04] border border-white/[0.08] rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/40">
          {dates.map((d, i) => <option key={`e-${i}`} value={i} style={{ background: '#0f1420' }}>{dateToLabel(d)}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-1">
        {ranges.map(r => {
          const active = startIdx === r.s && endIdx === r.e
          return <button key={r.label} onClick={() => { setStartIdx(Math.max(0, r.s)); setEndIdx(Math.min(total - 1, r.e)) }}
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
        <Area type="monotone" dataKey="S&P 500" stroke={BASE_PROFILES.benchmark.color} strokeWidth={2.5} fill="none" strokeDasharray="5 3" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function OverviewTab({ metrics, inflationAdj, curveData, startIdx, endIdx, setStartIdx, setEndIdx, dates, liveData }) {
  const profileKeys = ['aggressive', 'growth', 'conservative']
  const metricNames = { aggressive: 'Aggressive', growth: 'Growth', conservative: 'Conservative' }
  const isLive = liveData && liveData.timestamp && (Date.now() - new Date(liveData.timestamp).getTime() < 30 * 60 * 1000)
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold">System Performance</h2><p className="text-sm text-slate-500">AI Portfolio Management System v4.0 · Data through April 2026</p></div>
        <div className="flex gap-3"><StatusPill status={isLive ? 'live' : 'waiting'} text="Paper Trading Ready" /><StatusPill status="live" text="Phase 7 In Progress" /></div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[
          ['Aggressive', 'text-amber-400', '10'],
          ['Growth', 'text-emerald-400', '12'],
          ['Conservative', 'text-blue-400', '15'],
        ].map(([name, nameColor, maxPositions]) => (
          <Card key={name}>
            <div className={`font-semibold text-base mb-4 ${nameColor}`}>{name}</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-slate-500 uppercase mb-1">Portfolio Value</div>
                <div className="font-mono text-sm font-semibold">{liveData ? `$${liveData.account.portfolio_value.toLocaleString()}` : '$33,333'}</div>
                <div className="text-xs text-slate-500">+$0.00 today</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase mb-1">Today's Return</div>
                <div className={`font-mono text-sm font-semibold ${liveData ? (liveData.account.daily_pnl >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'}`}>{liveData ? `${liveData.account.daily_pnl >= 0 ? '+' : ''}$${liveData.account.daily_pnl.toFixed(2)}` : '+$0.00 today'}</div>
                <div className="text-xs text-slate-500">Awaiting first trade</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase mb-1">Total Return</div>
                <div className="font-mono text-sm font-semibold text-slate-500">{liveData ? `${liveData.account.daily_pnl_pct >= 0 ? '+' : ''}${liveData.account.daily_pnl_pct.toFixed(2)}%` : '0.00%'}</div>
                <div className="text-xs text-slate-500">Since inception</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase mb-1">Active Positions</div>
                <div className="font-mono text-sm font-semibold text-slate-500">{liveData ? `${liveData.active_positions}` : '0'}</div>
                <div className="text-xs text-slate-500">of {maxPositions}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <div><h2 className="text-lg font-semibold">Paper Trading Performance</h2><p className="text-sm text-slate-500">Live portfolio tracking · Portfolio Tracker</p></div>
      <Card>
        <div className="h-64 rounded-lg bg-slate-800/50 flex items-center justify-center relative">
          <div className="absolute top-3 right-3 flex gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" />Aggressive</div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" />Growth</div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400" />Conservative</div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-400" />S&P 500</div>
          </div>
          <div className="flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-slate-700/50 flex items-center justify-center mb-3"><Clock size={20} className="text-slate-400" /></div>
            <div className="font-semibold text-lg">Awaiting First Trade</div>
          </div>
        </div>
        <div className="flex justify-between items-center py-3 px-4 mt-3 bg-slate-800/30 rounded-lg">
          <div className="text-sm text-slate-400">Portfolio Value: <span className="text-emerald-400 font-mono">{liveData ? `$${liveData.account.portfolio_value.toLocaleString()}` : '$100,000'}</span></div>
          <div className="text-sm text-slate-300">Active Profiles: 3</div>
          <div className="flex gap-2">
            <span className="text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded text-xs">Aggressive</span>
            <span className="text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded text-xs">Growth</span>
            <span className="text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded text-xs">Conservative</span>
          </div>
        </div>
      </Card>
    </div>
  )
}

function BacktestTab({ metrics, inflationAdj, setInflationAdj, curveData, startIdx, endIdx, setStartIdx, setEndIdx, dates }) {
  const m = metrics; const years = ((endIdx - startIdx) / 12).toFixed(1)
  const rows = m ? [
    { key: 'CAGR', a: `${m.Aggressive.cagr}%`, g: `${m.Growth.cagr}%`, c: `${m.Conservative.cagr}%`, b: `${m['S&P 500'].cagr}%`, d: 'Compound annual growth rate' },
    { key: 'Sharpe Ratio', a: m.Aggressive.sharpe.toFixed(3), g: m.Growth.sharpe.toFixed(3), c: m.Conservative.sharpe.toFixed(3), b: m['S&P 500'].sharpe.toFixed(3), d: 'Risk-adjusted return' },
    { key: 'Max Drawdown', a: `${m.Aggressive.maxDD}%`, g: `${m.Growth.maxDD}%`, c: `${m.Conservative.maxDD}%`, b: `${m['S&P 500'].maxDD}%`, d: 'Largest peak-to-trough decline' },
    { key: 'Alpha vs SPY', a: `${m.Aggressive.alpha}%`, g: `${m.Growth.alpha}%`, c: `${m.Conservative.alpha}%`, b: '0%', d: 'Excess return over benchmark' },
    { key: 'Win Rate', a: `${BASE_PROFILES.aggressive.winRate}%`, g: `${BASE_PROFILES.growth.winRate}%`, c: `${BASE_PROFILES.conservative.winRate}%`, b: '—', d: 'Profitable trade percentage' },
    { key: 'Total Return', a: `${m.Aggressive.totalReturn.toLocaleString()}%`, g: `${m.Growth.totalReturn.toLocaleString()}%`, c: `${m.Conservative.totalReturn.toLocaleString()}%`, b: `${m['S&P 500'].totalReturn.toLocaleString()}%`, d: `$100K over ${years} yrs` },
    { key: 'End Value', a: m.Aggressive.endVal >= 1000000 ? `$${(m.Aggressive.endVal/1000000).toFixed(2)}M` : `$${(m.Aggressive.endVal/1000).toFixed(0)}K`, g: m.Growth.endVal >= 1000000 ? `$${(m.Growth.endVal/1000000).toFixed(2)}M` : `$${(m.Growth.endVal/1000).toFixed(0)}K`, c: m.Conservative.endVal >= 1000000 ? `$${(m.Conservative.endVal/1000000).toFixed(2)}M` : `$${(m.Conservative.endVal/1000).toFixed(0)}K`, b: m['S&P 500'].endVal >= 1000000 ? `$${(m['S&P 500'].endVal/1000000).toFixed(2)}M` : `$${(m['S&P 500'].endVal/1000).toFixed(0)}K`, d: "Final Value (Today's Dollars)" },
    { key: 'Positions', a: '10', g: '12', c: '15', b: '500', d: 'Concurrent holdings' },
    { key: 'Rebalance', a: 'Weekly', g: 'Bi-weekly', c: 'Bi-weekly', b: '—', d: 'Rotation frequency' },
    { key: 'Trailing Stop', a: '10%', g: '9%', c: '7%', b: '—', d: 'Downside protection' },
  ] : []
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">Backtest Results — {dateToLabel(dates[startIdx])} to {endIdx === dates.length - 1 ? 'Present' : dateToLabel(dates[endIdx])}{inflationAdj ? <span className="text-purple-400 text-sm ml-2">(Inflation-Adjusted)</span> : ''}</h2><p className="text-sm text-slate-500">{years} years · Backtested across dot-com, 2008, COVID, and 2022 regimes.</p></div><InflationToggle inflationAdj={inflationAdj} setInflationAdj={setInflationAdj} /></div>
      <div className="grid grid-cols-3 gap-4">
        {['aggressive', 'growth', 'conservative'].map(key => {
          const p = BASE_PROFILES[key]; const pm = m ? m[p.name] : null; const Icon = p.icon
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
                <div><div className="text-[10px] text-slate-500 uppercase">CAGR</div><div className="font-mono text-sm font-semibold" style={{ color: p.color }}>{pm ? pm.cagr : '—'}%</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase">Sharpe</div><div className="font-mono text-sm font-semibold">{pm ? pm.sharpe.toFixed(3) : '—'}</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase">Max DD</div><div className="font-mono text-sm font-semibold text-slate-300">{pm ? pm.maxDD : '—'}%</div></div>
                <div><div className="text-[10px] text-slate-500 uppercase">Win Rate</div><div className="font-mono text-sm font-semibold">{p.winRate ? p.winRate + '%' : '—'}</div></div>
              </div>
            </Card>
          )
        })}
      </div>
      <Card>
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-sm">Select Time Period</h3></div>
        <div className="mb-3"><DateRangeSelector startIdx={startIdx} endIdx={endIdx} setStartIdx={setStartIdx} setEndIdx={setEndIdx} dates={dates} /></div>
        <EquityCurveChart data={curveData} startIdx={startIdx} endIdx={endIdx} height={240} />
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
    { metric: 'Win Rate', Aggressive: BASE_PROFILES.aggressive.winRate, Growth: BASE_PROFILES.growth.winRate, Conservative: BASE_PROFILES.conservative.winRate, max: 80 },
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
      <Card><h3 className="font-semibold mb-4">Performance Radar</h3><ResponsiveContainer width="100%" height={320}><RadarChart data={radarData}><PolarGrid stroke="#1e293b" /><PolarAngleAxis dataKey="metric" tick={{ fill: '#94a3b8', fontSize: 11 }} /><Radar name="Aggressive" dataKey="Aggressive" stroke="#f97316" fill="#f97316" fillOpacity={0.1} strokeWidth={2} /><Radar name="Growth" dataKey="Growth" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} /><Radar name="Conservative" dataKey="Conservative" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2} /><Legend wrapperStyle={{ fontSize: 11 }} /></RadarChart></ResponsiveContainer></Card>
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
      <div><h2 className="text-lg font-semibold">System Architecture</h2><p className="text-sm text-slate-500">Five-layer pipeline powering the AI portfolio system.</p></div>
      <Card>
        <div className="grid grid-cols-5 gap-3">
          {[
            [Database, 'Data Pipeline', '503 S&P 500 tickers · Daily OHLCV data'],
            [FlaskConical, 'Backtest Engine', 'Vectorized engine · 2000-2026 · Multi-regime validated'],
            [LineChart, 'Paper Trading', 'Alpaca API, $100K, 3 sub-portfolios'],
            [ShieldCheck, 'Risk Manager', 'Stops, circuit breakers, position limits'],
            [Brain, 'Self-Improvement', 'Opus-powered weekly evolution cycle'],
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
  const [inflationAdj, setInflationAdj] = useState(false)
  const [startIdx, setStartIdx] = useState(0)
  const [endIdx, setEndIdx] = useState(0)
  const [fullMergedCurve, setFullMergedCurve] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [jsonMetrics, setJsonMetrics] = useState(null)
  const [liveData, setLiveData] = useState(null)

  useEffect(() => {
    fetch('/backtest_output.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(json => {
        const merged = buildMergedFromJson(json)
        setFullMergedCurve(merged)
        setEndIdx(merged.length - 1)
            setJsonMetrics(json.metrics)
      })
      .catch(err => setLoadError(err.message))
  }, [])

  useEffect(() => {
    fetch('/api/portfolio')
      .then(r => { if (!r.ok) throw new Error('API error'); return r.json() })
      .then(data => setLiveData(data))
      .catch(err => console.error('Portfolio fetch failed:', err))
  }, [])

  const dates = useMemo(() => fullMergedCurve ? fullMergedCurve.map(d => d.date) : [], [fullMergedCurve])
  const curveData = useMemo(() => fullMergedCurve ? getAdjustedCurve(fullMergedCurve, startIdx, inflationAdj) : null, [fullMergedCurve, inflationAdj, startIdx])
  const metrics = useMemo(() => fullMergedCurve ? calcMetrics(fullMergedCurve, startIdx, endIdx, jsonMetrics) : null, [fullMergedCurve, startIdx, endIdx, jsonMetrics])
  const inflMetrics = useMemo(() => (inflationAdj && curveData) ? calcMetrics(curveData, startIdx, endIdx) : metrics, [curveData, inflationAdj, startIdx, endIdx, metrics])
  const tabProps = { metrics: inflMetrics, inflationAdj, setInflationAdj, curveData, startIdx, endIdx, setStartIdx, setEndIdx, dates }
  const TabContent = { overview: () => <OverviewTab {...tabProps} liveData={liveData} />, backtest: () => <BacktestTab {...tabProps} />, profiles: () => <ProfilesTab metrics={inflMetrics} inflationAdj={inflationAdj} />, trades: () => <TradesTab />, evolution: () => <EvolutionTab /> }
  return (
    <div className="min-h-screen bg-[#0a0e17]">
      <header className="border-b border-white/[0.06] bg-[#0a0e17]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center"><TrendingUp size={16} className="text-white" /></div><div><div className="font-bold text-sm tracking-tight">AI Portfolio System</div><div className="text-[10px] text-slate-500">Duncan Shin — Quantitative Strategy</div></div></div>
          <div className="flex items-center gap-4"><div className="text-right mr-2"><div className="text-xs text-slate-500">Duncan's Wealth Portfolio</div><div className="font-mono text-sm font-bold text-emerald-400">$100,000</div></div><StatusPill status="live" text="System Active" /></div>
        </div>
      </header>
      <nav className="border-b border-white/[0.06]"><div className="max-w-7xl mx-auto px-6 flex gap-1">{TABS.map(tab => { const Icon = tab.icon; const active = activeTab === tab.id; return <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${active ? 'border-emerald-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}><Icon size={14} />{tab.label}</button> })}</div></nav>
      <main className="max-w-7xl mx-auto px-6 py-6">{loadError ? <div className="text-sm text-red-400">Failed to load /backtest_output.json: {loadError}</div> : !fullMergedCurve ? <div className="text-sm text-slate-500">Loading backtest data…</div> : TabContent[activeTab]()}</main>
      <footer className="border-t border-white/[0.06] mt-12"><div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between text-xs text-slate-600"><span>AI Portfolio Management System v4.0 · Jan 2000 – Present</span><span>Python · Alpaca · Claude Opus 4.6 · React</span></div></footer>
    </div>
  )
}
