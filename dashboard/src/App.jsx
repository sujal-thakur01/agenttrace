import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import './App.css'

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS   = 3_000
const HEALTH_INTERVAL_MS = 10_000

// ─────────────────────────────────────────────────────────────────────────────
//  Icons
// ─────────────────────────────────────────────────────────────────────────────

const IconRuns = () => (
  <svg className="nav-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
  </svg>
)
const IconPipelines = () => (
  <svg className="nav-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
  </svg>
)
const IconAlerts = () => (
  <svg className="nav-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
)
const IconSettings = () => (
  <svg className="nav-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)
const BrandLogoSvg = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="brand-logo-svg">
    <line x1="4" y1="18" x2="8" y2="14" />
    <line x1="10" y1="18" x2="16" y2="12" />
    <line x1="16" y1="18" x2="22" y2="8" />
  </svg>
)
const IconSun = () => (
  <svg className="nav-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
)
const IconMoon = () => (
  <svg className="nav-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
  </svg>
)

// ─────────────────────────────────────────────────────────────────────────────
//  Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2, '0')} ${d.toLocaleString('en-US', { month: 'short' }).toUpperCase()} · ${d.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`
}

function formatCost(val) {
  if (val == null) return '—'
  if (val === 0)   return '$0.00'
  return '$' + val.toFixed(6).replace(/\.?0+$/, '')
}

function formatLatency(ms) {
  if (ms == null) return '—'
  return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : Math.round(ms) + 'ms'
}

// ─────────────────────────────────────────────────────────────────────────────
//  AnimatedNumber
// ─────────────────────────────────────────────────────────────────────────────

function AnimatedNumber({ value, formatter, isNew }) {
  const [displayValue, setDisplayValue] = useState(isNew ? 0 : (value ?? 0))
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])
  useEffect(() => {
    if (!isNew || value == null || value === 0) { setDisplayValue(value ?? 0); return }
    let start = null; const duration = 500; let animationFrameId
    const step = (ts) => {
      if (!start) start = ts
      const p = Math.min((ts - start) / duration, 1), easeOut = p * (2 - p)
      setDisplayValue(0 + easeOut * (value - 0))
      if (p < 1) animationFrameId = requestAnimationFrame(step)
      else setDisplayValue(valueRef.current ?? 0)
    }
    animationFrameId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(animationFrameId)
  }, [isNew, value])
  if (value == null) return '—'
  return <>{formatter(displayValue)}</>
}

// ─────────────────────────────────────────────────────────────────────────────
//  CostSparkline — tiny SVG used inside SUCCESS RATE stat card
// ─────────────────────────────────────────────────────────────────────────────

function CostSparkline({ runs }) {
  if (!runs || runs.length < 2) return null
  const costs = [...runs].reverse().map(r => r.total_cost_usd || 0)
  const max = Math.max(...costs, 0.000001)
  const H = 20, W = 48, barW = Math.max(2, Math.floor((W - (costs.length - 1)) / costs.length))
  return (
    <svg width={W} height={H} style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 8 }}>
      {costs.map((c, i) => {
        const h = Math.max(2, Math.round((c / max) * H))
        return <rect key={i} x={i * (barW + 1)} y={H - h} width={barW} height={h} fill="var(--brand)" opacity="0.7" rx="1" />
      })}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  StepDetailPanel
// ─────────────────────────────────────────────────────────────────────────────

function StepDetailPanel({ step }) {
  const isFailed = step.status === 'failed'
  return (
    <div className={`step-detail-panel panel-${step.status}`}>
      <div className="step-detail-header">
        <div className="step-detail-title">
          <span className="step-detail-name">{step.agent_name}</span>
          <span className={`step-detail-status status-${step.status}-text`}>{step.status}</span>
        </div>
        <div className="step-detail-stats">
          <span>IN <strong>{step.prompt_tokens ?? '—'}</strong></span>
          <span>·</span>
          <span>OUT <strong>{step.completion_tokens ?? '—'}</strong></span>
          <span>·</span>
          <span><strong>{formatCost(step.cost_usd)}</strong></span>
          <span>·</span>
          <span><strong>{formatLatency(step.latency_ms)}</strong></span>
        </div>
      </div>
      <div className="detail-section-label">INPUT</div>
      <pre className={`detail-text ${!step.input ? 'empty' : ''}`}>
        {step.input ? (() => { try { return JSON.stringify(JSON.parse(step.input), null, 2) } catch { return step.input } })() : '(NO INPUT RECORDED)'}
      </pre>
      {isFailed ? (
        <>
          <div className="detail-section-label error-label">ERROR TRACEBACK</div>
          <pre className="detail-text error-block">{step.error || '(NO TRACEBACK)'}</pre>
        </>
      ) : (
        <>
          <div className="detail-section-label">OUTPUT</div>
          <pre className={`detail-text ${!step.output ? 'empty' : ''}`}>
            {step.output ? (() => { try { return JSON.stringify(JSON.parse(step.output), null, 2) } catch { return step.output } })() : '(NO OUTPUT RECORDED)'}
          </pre>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  RunDetail — flight-path chain + step detail panel
// ─────────────────────────────────────────────────────────────────────────────

function RunDetail({ runId, onDetailLoaded }) {
  const [detail, setDetail]     = useState(null)
  const [loading, setLoading]   = useState(true)
  const [fetchErr, setFetchErr] = useState(null)
  const [selectedStep, setSelectedStep] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setFetchErr(null); setSelectedStep(null)
    fetch(`/api/runs/${runId}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => {
        if (!cancelled) {
          data.steps = [...(data.steps || [])].sort((a, b) => a.seq - b.seq)
          setDetail(data); setLoading(false)
          if (onDetailLoaded) onDetailLoaded(runId, data)
        }
      })
      .catch(err => { if (!cancelled) { setFetchErr(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [runId, onDetailLoaded])

  if (loading) return <div className="detail-loading-box"><div className="detail-loading">RETRIEVING TELEMETRY…</div></div>
  if (fetchErr) return <div className="detail-error-box"><div className="detail-error">SIGNAL LOST: {fetchErr}</div></div>

  const steps = detail?.steps ?? []
  const isVertical = steps.length > 5

  return (
    <div className="run-detail-content">
      {steps.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)', padding: '24px' }}>NO STEPS RECORDED</p>
      ) : (
        <div style={{ padding: '0 24px 24px' }}>
          <div className={`flight-path ${isVertical ? 'vertical-chain' : ''}`}>
            {steps.map((step, idx) => (
              <Fragment key={step.id}>
                {idx > 0 && (
                  <div className="flight-path-line-segment" style={{ '--delay': `${idx * 90 + 200}ms`, backgroundColor: steps[idx - 1].status === 'success' ? 'var(--signal-green)' : 'var(--border)' }} />
                )}
                <div className="step-node-wrapper" style={{ '--delay': `${idx * 90}ms` }}>
                  <div
                    className={`step-node status-${step.status} ${selectedStep?.id === step.id ? 'selected' : ''}`}
                    onClick={() => setSelectedStep(prev => prev?.id === step.id ? null : step)}
                    title={`Click to ${selectedStep?.id === step.id ? 'collapse' : 'expand'} step detail`}
                  >
                    {step.status === 'success' && <span className="node-icon icon-success">✓</span>}
                    {step.status === 'failed'  && <span className="node-icon icon-failed">×</span>}
                    {step.status === 'partial' && <span className="node-icon icon-partial">…</span>}
                  </div>
                  <div className="step-labels">
                    <div className="step-agent-name">{step.agent_name}</div>
                    <div className="step-latency">{formatLatency(step.latency_ms)}</div>
                  </div>
                </div>
              </Fragment>
            ))}
          </div>
          {selectedStep && <StepDetailPanel step={selectedStep} />}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Side Drawer
// ─────────────────────────────────────────────────────────────────────────────

function SideDrawer({ run, onClose, onDetailLoaded, allRuns, onNavigate }) {
  const [copied, setCopied] = useState(false)
  const drawerRef = useRef(null)

  const currentIdx = allRuns ? allRuns.findIndex(r => r.id === run?.id) : -1
  const canPrev = currentIdx > 0
  const canNext = currentIdx >= 0 && currentIdx < (allRuns?.length ?? 0) - 1

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowLeft' && canPrev) onNavigate(allRuns[currentIdx - 1])
      if (e.key === 'ArrowRight' && canNext) onNavigate(allRuns[currentIdx + 1])
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, canPrev, canNext, currentIdx, allRuns, onNavigate])

  if (!run) return null

  const handleCopy = () => {
    navigator.clipboard.writeText(run.id)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <div className="side-drawer-backdrop active" onClick={onClose} />
      <div className="side-drawer active" ref={drawerRef}>
        <div className="drawer-header">
          <div className="drawer-nav-arrows">
            <button className="drawer-arrow-btn" onClick={() => canPrev && onNavigate(allRuns[currentIdx - 1])} disabled={!canPrev} title="Previous run (←)">←</button>
            <button className="drawer-arrow-btn" onClick={() => canNext && onNavigate(allRuns[currentIdx + 1])} disabled={!canNext} title="Next run (→)">→</button>
          </div>
          <div className="drawer-title-area">
            <div className="drawer-title">
              <span className="drawer-pipeline-name">{run.pipeline_name}</span>
              <span className={`drawer-status status-${run.status}-text`}>{run.status}</span>
            </div>
            <div className="drawer-id-row">
              <span className="drawer-id" onClick={handleCopy} title="Click to copy full ID">{run.id}</span>
              {copied && <span className="copy-tooltip">COPIED</span>}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close panel">×</button>
        </div>
        <div className="drawer-meta-bar">
          <span>STARTED: <strong>{formatDate(run.started_at)}</strong></span>
          <span>·</span>
          <span>COST: <strong>{formatCost(run.total_cost_usd)}</strong></span>
          <span>·</span>
          <span>TOKENS: <strong>{run.total_tokens?.toLocaleString() ?? '—'}</strong></span>
        </div>
        <div className="drawer-body">
          <RunDetail runId={run.id} onDetailLoaded={onDetailLoaded} />
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Stats Bar (with sparkline in SUCCESS RATE card)
// ─────────────────────────────────────────────────────────────────────────────

function StatsBar({ runs, isNew }) {
  const totalRuns   = runs ? runs.length : 0
  const successRuns = runs ? runs.filter(r => r.status === 'success').length : 0
  const successRate = totalRuns > 0 ? parseFloat(((successRuns / totalRuns) * 100).toFixed(1)) : 0.0
  const totalCost   = runs ? runs.reduce((acc, r) => acc + (r.total_cost_usd || 0), 0) : 0
  const totalTokens = runs ? runs.reduce((acc, r) => acc + (r.total_tokens || 0), 0) : 0
  let rateColor = 'status-failed-text'
  if (successRate >= 80) rateColor = 'status-success-text'
  else if (successRate >= 50) rateColor = 'status-partial-text'

  return (
    <div className="stats-bar">
      <div className="stat-card">
        <div className="stat-label">TOTAL RUNS</div>
        <div className="stat-value"><AnimatedNumber value={totalRuns} formatter={(v) => Math.round(v).toString()} isNew={isNew} /></div>
      </div>
      <div className="stat-card">
        <div className="stat-label">SUCCESS RATE</div>
        <div className={`stat-value ${rateColor}`} style={{ display: 'flex', alignItems: 'center' }}>
          <AnimatedNumber value={successRate} formatter={(v) => v.toFixed(1) + '%'} isNew={isNew} />
          <CostSparkline runs={runs} />
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-label">TOTAL COST</div>
        <div className="stat-value"><AnimatedNumber value={totalCost} formatter={formatCost} isNew={isNew} /></div>
      </div>
      <div className="stat-card">
        <div className="stat-label">TOTAL TOKENS</div>
        <div className="stat-value"><AnimatedNumber value={totalTokens} formatter={(v) => Math.round(v).toLocaleString()} isNew={isNew} /></div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cost Chart
// ─────────────────────────────────────────────────────────────────────────────

function CostChart({ runs, onSelectRun }) {
  if (!runs || runs.length < 2) return null
  const sortedRuns = [...runs].reverse()
  const maxCost = Math.max(...sortedRuns.map(r => r.total_cost_usd || 0), 0.000001)
  return (
    <div className="cost-chart-section">
      <div className="cost-chart-label">COST PER RUN</div>
      <div className="cost-chart-bars">
        {sortedRuns.map(run => {
          const pct = Math.max(8, ((run.total_cost_usd || 0) / maxCost) * 100)
          return (
            <div key={run.id} className="cost-bar-container" onClick={() => onSelectRun(run)}>
              <div className={`cost-bar ${run.status === 'failed' ? 'status-failed' : 'status-brand'}`} style={{ height: `${pct}%` }} />
              <div className="cost-bar-tooltip">
                <span className="tooltip-id">{run.id.slice(0, 8)}</span>
                <span className="tooltip-cost">{formatCost(run.total_cost_usd)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent Performance Heatmap
// ─────────────────────────────────────────────────────────────────────────────

function AgentHeatmap({ runs, runDetailsCache }) {
  if (!runs || runs.length < 3) return null

  // Collect steps only for runs whose details are fetched
  const allSteps = []
  runs.forEach(run => {
    const detail = runDetailsCache[run.id]
    if (detail?.steps) {
      detail.steps.forEach(s => allSteps.push({ ...s, runId: run.id }))
    }
  })
  const agentNames = [...new Set(allSteps.map(s => s.agent_name))]
  if (agentNames.length < 2) return null

  // Newest runs on right — runs list is already newest-first, so reverse for columns
  const columnRuns = [...runs].reverse()

  // Compute quartile thresholds per agent
  function getColor(latency, agentLatencies) {
    if (latency == null) return 'var(--border)'
    const sorted = [...agentLatencies].filter(v => v != null).sort((a, b) => a - b)
    if (!sorted.length) return 'var(--border)'
    const q1 = sorted[Math.floor(sorted.length * 0.25)]
    const q2 = sorted[Math.floor(sorted.length * 0.50)]
    const q3 = sorted[Math.floor(sorted.length * 0.75)]
    if (latency <= q1) return 'var(--signal-green)'
    if (latency <= q2) return '#4ade80'
    if (latency <= q3) return 'var(--signal-amber)'
    return 'var(--signal-red)'
  }

  // Per-agent latency arrays
  const agentLatencyMap = {}
  agentNames.forEach(name => {
    agentLatencyMap[name] = columnRuns.map(run => {
      const detail = runDetailsCache[run.id]
      const step = detail?.steps?.find(s => s.agent_name === name)
      return step?.latency_ms ?? null
    })
  })

  return (
    <div className="heatmap-section">
      <div className="heatmap-label">AGENT LATENCY HEATMAP</div>
      <div className="heatmap-legend">
        <span className="heatmap-legend-item" style={{ color: 'var(--signal-green)' }}>■ Q1 fastest</span>
        <span className="heatmap-legend-item" style={{ color: '#4ade80' }}>■ Q2</span>
        <span className="heatmap-legend-item" style={{ color: 'var(--signal-amber)' }}>■ Q3</span>
        <span className="heatmap-legend-item" style={{ color: 'var(--signal-red)' }}>■ Q4 slowest</span>
        <span className="heatmap-legend-item" style={{ color: 'var(--border)' }}>■ not fetched</span>
      </div>
      <div className="heatmap-grid">
        {agentNames.map(name => (
          <div key={name} className="heatmap-row">
            <div className="heatmap-agent-label">{name}</div>
            {columnRuns.map(run => {
              const detail = runDetailsCache[run.id]
              const step = detail?.steps?.find(s => s.agent_name === name)
              const lat = step?.latency_ms ?? null
              const color = getColor(lat, agentLatencyMap[name])
              const title = lat != null
                ? `${name} on ${run.id.slice(0, 8)}: ${formatLatency(lat)} (${step.status})`
                : `${name} on ${run.id.slice(0, 8)}: not fetched`
              return (
                <div
                  key={run.id}
                  className="heatmap-cell"
                  style={{ backgroundColor: color, opacity: lat != null ? 0.85 : 0.25 }}
                  title={title}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Run Diff / Compare panel
// ─────────────────────────────────────────────────────────────────────────────

function DiffPanel({ runA, runB, detailA, detailB, onBack }) {
  const stepsA = detailA?.steps ?? []
  const stepsB = detailB?.steps ?? []
  const allNames = [...new Set([...stepsA.map(s => s.agent_name), ...stepsB.map(s => s.agent_name)])]

  return (
    <div className="diff-panel">
      <div className="diff-header">
        <button className="diff-back-btn" onClick={onBack}>← Back to runs</button>
        <div className="diff-title">RUN COMPARISON</div>
      </div>
      <div className="diff-run-headers">
        <div className="diff-run-header diff-run-a">
          <div className="diff-run-name">{runA.pipeline_name}</div>
          <div className={`diff-run-status status-${runA.status}-text`}>{runA.status}</div>
          <div className="diff-run-meta">{formatDate(runA.started_at)} · {formatCost(runA.total_cost_usd)} · {runA.total_tokens?.toLocaleString() ?? '—'} tok</div>
          <div className="diff-run-id">{runA.id.slice(0, 16)}…</div>
        </div>
        <div className="diff-run-header diff-run-b">
          <div className="diff-run-name">{runB.pipeline_name}</div>
          <div className={`diff-run-status status-${runB.status}-text`}>{runB.status}</div>
          <div className="diff-run-meta">{formatDate(runB.started_at)} · {formatCost(runB.total_cost_usd)} · {runB.total_tokens?.toLocaleString() ?? '—'} tok</div>
          <div className="diff-run-id">{runB.id.slice(0, 16)}…</div>
        </div>
      </div>
      {allNames.map(name => {
        const sA = stepsA.find(s => s.agent_name === name)
        const sB = stepsB.find(s => s.agent_name === name)
        const latDelta = sA && sB ? sB.latency_ms - sA.latency_ms : null
        const costDelta = sA && sB ? (sB.cost_usd || 0) - (sA.cost_usd || 0) : null
        return (
          <div key={name} className="diff-step-row">
            <div className="diff-step-label">{name}</div>
            <div className="diff-step-cells">
              <div className="diff-step-cell">
                {sA ? (
                  <>
                    <div className={`diff-step-status status-${sA.status}-text`}>{sA.status} · {formatLatency(sA.latency_ms)} · {formatCost(sA.cost_usd)}</div>
                    <pre className="diff-step-output">{sA.output || sA.error || '—'}</pre>
                  </>
                ) : <div className="diff-step-missing">— (not reached)</div>}
              </div>
              <div className="diff-delta-col">
                {latDelta != null && <div className={`diff-delta ${latDelta > 0 ? 'diff-delta-worse' : 'diff-delta-better'}`}>{latDelta > 0 ? '+' : ''}{Math.round(latDelta)}ms</div>}
                {costDelta != null && <div className={`diff-delta ${costDelta > 0 ? 'diff-delta-worse' : 'diff-delta-better'}`}>{costDelta > 0 ? '+' : ''}{formatCost(costDelta)}</div>}
              </div>
              <div className="diff-step-cell">
                {sB ? (
                  <>
                    <div className={`diff-step-status status-${sB.status}-text`}>{sB.status} · {formatLatency(sB.latency_ms)} · {formatCost(sB.cost_usd)}</div>
                    <pre className="diff-step-output">{sB.output || sB.error || '—'}</pre>
                  </>
                ) : <div className="diff-step-missing">— (not reached)</div>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Alerts Panel
// ─────────────────────────────────────────────────────────────────────────────

function AlertsPanel({ onClose }) {
  const LS_KEY = 'agenttrace_alert_rules'
  const [rules, setRules] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
  })
  const [ruleType, setRuleType] = useState('cost')
  const [ruleValue, setRuleValue] = useState('')

  const save = (newRules) => { setRules(newRules); localStorage.setItem(LS_KEY, JSON.stringify(newRules)) }

  const addRule = () => {
    const val = parseFloat(ruleValue)
    if (isNaN(val) || val <= 0) return
    save([...rules, { id: Date.now(), type: ruleType, value: val }])
    setRuleValue('')
  }

  const removeRule = (id) => save(rules.filter(r => r.id !== id))

  return (
    <div className="panel-overlay">
      <div className="panel-modal">
        <div className="panel-modal-header">
          <div className="panel-modal-title">ALERTS</div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="panel-modal-body">
          <div className="alerts-add-row">
            <select className="alerts-select" value={ruleType} onChange={e => setRuleType(e.target.value)}>
              <option value="cost">Alert if run cost exceeds $</option>
              <option value="consecutive_failures">Alert if N consecutive runs fail</option>
            </select>
            <input
              className="alerts-input"
              type="number"
              min="0"
              step={ruleType === 'cost' ? '0.0001' : '1'}
              placeholder={ruleType === 'cost' ? '0.01' : '3'}
              value={ruleValue}
              onChange={e => setRuleValue(e.target.value)}
            />
            <button className="alerts-add-btn" onClick={addRule}>Add rule</button>
          </div>
          <div className="alerts-rules-list">
            {rules.length === 0 && <div className="alerts-empty">No rules configured.</div>}
            {rules.map(rule => (
              <div key={rule.id} className="alert-rule-item">
                <span>{rule.type === 'cost' ? `Cost exceeds $${rule.value}` : `${rule.value} consecutive failures`}</span>
                <button className="alert-rule-delete" onClick={() => removeRule(rule.id)}>×</button>
              </div>
            ))}
          </div>
          <div className="alerts-footnote">Rules are stored in your browser only.</div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Settings Panel
// ─────────────────────────────────────────────────────────────────────────────

function SettingsPanel({ onClose }) {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(d => { setConfig(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="panel-overlay">
      <div className="panel-modal">
        <div className="panel-modal-header">
          <div className="panel-modal-title">SETTINGS</div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="panel-modal-body">
          {loading ? <div className="detail-loading">Loading…</div> : config ? (
            <div className="settings-kv-list">
              <div className="settings-kv-row">
                <span className="settings-key">SERVER VERSION</span>
                <span className="settings-val">{config.server_version}</span>
              </div>
              <div className="settings-kv-row">
                <span className="settings-key">DB BACKEND</span>
                <span className="settings-val">{config.db_backend}</span>
              </div>
              <div className="settings-kv-row">
                <span className="settings-key">PROMPT COST</span>
                <span className="settings-val">${(config.prompt_token_cost_usd * 1_000_000).toFixed(2)} / 1M tokens</span>
              </div>
              <div className="settings-kv-row">
                <span className="settings-key">COMPLETION COST</span>
                <span className="settings-val">${(config.completion_token_cost_usd * 1_000_000).toFixed(2)} / 1M tokens</span>
              </div>
              <div className="settings-kv-row">
                <span className="settings-key">LIVE DEMO</span>
                <span className={`settings-badge ${config.groq_configured ? 'badge-enabled' : 'badge-disabled'}`}>
                  {config.groq_configured ? 'Demo enabled' : 'Demo disabled'}
                </span>
              </div>
            </div>
          ) : <div className="detail-error">Could not load config.</div>}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Keyboard Shortcuts Modal
// ─────────────────────────────────────────────────────────────────────────────

function ShortcutsModal({ onClose }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="panel-modal-header">
          <div className="panel-modal-title">KEYBOARD SHORTCUTS</div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="panel-modal-body">
          <div className="shortcuts-list">
            {[
              ['/','Focus search'],['Esc','Close drawer / modal'],['R','Refresh runs'],
              ['←','Previous run (drawer open)'],['→','Next run (drawer open)'],['?','Show this panel'],
            ].map(([k, d]) => (
              <div key={k} className="shortcut-row">
                <kbd className="kbd">{k}</kbd>
                <span className="shortcut-desc">{d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sidebar
// ─────────────────────────────────────────────────────────────────────────────

function Sidebar({ activeTab, onTabSelect, healthStatus, onOpenAlerts, onOpenSettings, theme, onToggleTheme }) {
  const dotClass   = healthStatus === 'ok' ? 'online' : healthStatus === 'offline' ? 'offline' : 'dim'
  const label      = healthStatus === 'ok' ? 'SIGNAL: LIVE' : healthStatus === 'offline' ? 'SIGNAL: LOST' : 'SIGNAL: SYNC'
  const textClass  = healthStatus === 'ok' ? 'status-success-text' : healthStatus === 'offline' ? 'status-failed-text' : 'status-partial-text'

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <BrandLogoSvg />
          <span className="sidebar-logo-text">AgentTrace</span>
          <span className="sidebar-logo-abbr">AT</span>
        </div>
        <div className="sidebar-version">v0.1.0</div>
      </div>
      <nav className="sidebar-nav">
        <button className={`nav-item ${activeTab === 'runs' ? 'active' : ''}`} onClick={() => onTabSelect('runs')}><IconRuns /><span>Runs</span></button>
        <button className={`nav-item ${activeTab === 'pipelines' ? 'active' : ''}`} onClick={() => onTabSelect('pipelines')}><IconPipelines /><span>Pipelines</span></button>
        <button className="nav-item" onClick={onOpenAlerts}><IconAlerts /><span>Alerts</span></button>
        <button className="nav-item" onClick={onOpenSettings}><IconSettings /><span>Settings</span></button>
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item theme-toggle" onClick={onToggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
        <div className="sidebar-status">
          <span className={`status-dot ${dotClass}`} />
          <span className={`status-text ${textClass}`}>{label}</span>
        </div>
      </div>
    </aside>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Table Row
// ─────────────────────────────────────────────────────────────────────────────

function TableRow({ run, isNew, onSeen, cachedDetail, onSelect, compareMode, isChecked, onCheck }) {
  const [hovering, setHovering] = useState(false)
  useEffect(() => { if (isNew) onSeen(run.id) }, [run.id, isNew, onSeen])
  const dotClass = run.status === 'failed' ? 'offline' : run.status === 'success' ? 'online' : 'amber'
  const steps = cachedDetail?.steps || []

  return (
    <tr
      className={`table-row status-${run.status} ${isNew ? 'run-card-entrance' : ''}`}
      onClick={() => !compareMode && onSelect(run)}
      tabIndex={0}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !compareMode && onSelect(run)}
    >
      <td className="cell-compare">
        {(hovering || isChecked) && (
          <input type="checkbox" className="compare-checkbox" checked={isChecked} onChange={e => { e.stopPropagation(); onCheck(run.id, e.target.checked) }} onClick={e => e.stopPropagation()} />
        )}
      </td>
      <td className="cell-status">
        <div className="run-status-indicator">
          <span className={`status-dot ${dotClass}`} />
          <span className={`run-status-word status-${run.status}-text`}>{run.status}</span>
        </div>
      </td>
      <td className="cell-pipeline">{run.pipeline_name}</td>
      <td className="cell-id">{run.id.slice(0, 8)}…</td>
      <td className="cell-started">{formatDate(run.started_at)}</td>
      <td className="cell-steps">
        {cachedDetail ? (
          <div className="table-steps-dots">{steps.map((s, idx) => <span key={s.id || idx} className={`step-dot-mini status-${s.status}`} title={`${s.agent_name}: ${s.status}`} />)}</div>
        ) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
      </td>
      <td className="cell-tokens">{run.total_tokens?.toLocaleString() ?? '—'}</td>
      <td className="cell-cost">{formatCost(run.total_cost_usd)}</td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Pipelines View
// ─────────────────────────────────────────────────────────────────────────────

function PipelinesView({ runs, onSelectPipeline }) {
  if (!runs) return null
  const grouped = runs.reduce((acc, run) => {
    if (!acc[run.pipeline_name]) acc[run.pipeline_name] = []
    acc[run.pipeline_name].push(run)
    return acc
  }, {})
  const pipelineNames = Object.keys(grouped).sort()
  return (
    <div className="pipelines-grid">
      {pipelineNames.map(name => {
        const pipelineRuns = grouped[name]
        const totalRuns = pipelineRuns.length
        const successRuns = pipelineRuns.filter(r => r.status === 'success').length
        const successRate = totalRuns > 0 ? ((successRuns / totalRuns) * 100).toFixed(1) : '0.0'
        const totalCost = pipelineRuns.reduce((acc, r) => acc + (r.total_cost_usd || 0), 0)
        const totalTokens = pipelineRuns.reduce((acc, r) => acc + (r.total_tokens || 0), 0)
        const last10 = [...pipelineRuns].slice(0, 10).reverse()
        return (
          <div key={name} className="pipeline-card" onClick={() => onSelectPipeline(name)} tabIndex={0} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSelectPipeline(name)}>
            <div className="pipeline-card-header">
              <div className="pipeline-card-name">{name}</div>
              <div className="pipeline-sparkline">{last10.map((run, idx) => <span key={run.id || idx} className={`sparkline-dot status-${run.status}`} title={`${run.id.slice(0,8)} (${run.status})`} />)}</div>
            </div>
            <div className="pipeline-card-metrics">
              <div className="pipeline-metric-item"><div className="pipeline-metric-label">RUNS</div><div className="pipeline-metric-value">{totalRuns}</div></div>
              <div className="pipeline-metric-item"><div className="pipeline-metric-label">SUCCESS</div><div className="pipeline-metric-value status-success-text">{successRate}%</div></div>
              <div className="pipeline-metric-item"><div className="pipeline-metric-label">COST</div><div className="pipeline-metric-value">{formatCost(totalCost)}</div></div>
              <div className="pipeline-metric-item"><div className="pipeline-metric-label">TOKENS</div><div className="pipeline-metric-value">{totalTokens.toLocaleString()}</div></div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  App (root)
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  // ── Theme ──────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState(() => localStorage.getItem('agenttrace_theme') || 'dark')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('agenttrace_theme', theme)
  }, [theme])

  // ── Core state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]       = useState('runs')
  const [runs, setRuns]                 = useState(null)
  const [fetchErr, setFetchErr]         = useState(null)
  const [healthStatus, setHealthStatus] = useState('checking')
  const [seenRunIds, setSeenRunIds]     = useState(new Set())
  const [selectedRun, setSelectedRun]   = useState(null)
  const [runDetailsCache, setRunDetailsCache] = useState({})
  const [lastSynced, setLastSynced]     = useState('')
  const [groqConfigured, setGroqConfigured] = useState(false)

  // ── UI panels ──────────────────────────────────────────────────────────────
  const [showAlerts, setShowAlerts]     = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

  // ── Filter bar state ───────────────────────────────────────────────────────
  const [searchText, setSearchText]     = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [pipelineFilter, setPipelineFilter] = useState(null)
  const searchRef = useRef(null)

  // ── Compare mode ───────────────────────────────────────────────────────────
  const [checkedRuns, setCheckedRuns]   = useState(new Set())
  const [diffMode, setDiffMode]         = useState(false)
  const [diffRunA, setDiffRunA]         = useState(null)
  const [diffRunB, setDiffRunB]         = useState(null)

  // ── Demo button ────────────────────────────────────────────────────────────
  const [demoRunning, setDemoRunning]   = useState(false)
  const [demoError, setDemoError]       = useState(null)

  // ── Toasts ─────────────────────────────────────────────────────────────────
  const [toasts, setToasts]             = useState([])
  const prevAlertTriggered              = useRef(new Set())

  const addToast = useCallback((msg) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, msg }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }, [])

  // ── markAsSeen ─────────────────────────────────────────────────────────────
  const markAsSeen = useCallback((runId) => {
    setSeenRunIds(prev => {
      if (prev.has(runId)) return prev
      const next = new Set(prev); next.add(runId); return next
    })
  }, [])

  // ── Cache run details ──────────────────────────────────────────────────────
  const cacheRunDetails = useCallback((runId, data) => {
    setRunDetailsCache(prev => ({ ...prev, [runId]: data }))
  }, [])

  // ── Fetch config once ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => setGroqConfigured(d.groq_configured)).catch(() => {})
  }, [])

  // ── Health polling ─────────────────────────────────────────────────────────
  const checkHealth = useCallback(() => {
    fetch('/api/health')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setHealthStatus(d.status === 'ok' ? 'ok' : 'offline'))
      .catch(() => setHealthStatus('offline'))
  }, [])

  useEffect(() => {
    checkHealth()
    const id = setInterval(checkHealth, HEALTH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [checkHealth])

  // ── Runs polling ───────────────────────────────────────────────────────────
  const fetchRuns = useCallback(() => {
    fetch('/api/runs')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => {
        setRuns(data); setFetchErr(null)
        const now = new Date()
        setLastSynced(`SYNCED ${now.toTimeString().split(' ')[0]}`)
        setSeenRunIds(prev => {
          if (prev.size === 0) return new Set(data.map(r => r.id))
          return prev
        })
      })
      .catch(err => setFetchErr(err.message))
  }, [])

  useEffect(() => {
    fetchRuns()
    const id = setInterval(fetchRuns, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchRuns])

  // ── Alert evaluation on each poll ─────────────────────────────────────────
  useEffect(() => {
    if (!runs || runs.length === 0) return
    try {
      const alertRules = JSON.parse(localStorage.getItem('agenttrace_alert_rules') || '[]')
      alertRules.forEach(rule => {
        const ruleKey = `${rule.id}`
        if (rule.type === 'cost') {
          const recent = runs[0]
          if (recent && (recent.total_cost_usd || 0) > rule.value) {
            if (!prevAlertTriggered.current.has(ruleKey + recent.id)) {
              prevAlertTriggered.current.add(ruleKey + recent.id)
              addToast(`⚠ Alert: run cost $${(recent.total_cost_usd||0).toFixed(6)} exceeds threshold $${rule.value}`)
            }
          }
        }
        if (rule.type === 'consecutive_failures') {
          const n = Math.floor(rule.value)
          if (n > 0 && runs.slice(0, n).every(r => r.status === 'failed')) {
            if (!prevAlertTriggered.current.has(ruleKey + runs[0].id)) {
              prevAlertTriggered.current.add(ruleKey + runs[0].id)
              addToast(`⚠ Alert: ${n} consecutive runs failed`)
            }
          }
        }
      })
    } catch {}
  }, [runs, addToast])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const tag = e.target.tagName.toLowerCase()
      const inInput = tag === 'input' || tag === 'textarea' || e.target.isContentEditable

      if (e.key === 'Escape') {
        if (showShortcuts) { setShowShortcuts(false); return }
        if (showSettings)  { setShowSettings(false); return }
        if (showAlerts)    { setShowAlerts(false); return }
        if (selectedRun)   { setSelectedRun(null); return }
      }
      if (e.key === '/' && !inInput) { e.preventDefault(); searchRef.current?.focus(); return }
      if (e.key === '?' && !inInput) { setShowShortcuts(true); return }
      if (e.key === 'r' && !inInput) { fetchRuns(); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showShortcuts, showSettings, showAlerts, selectedRun, fetchRuns])

  // ── Demo trigger ───────────────────────────────────────────────────────────
  const handleRunDemo = () => {
    setDemoRunning(true); setDemoError(null)
    fetch('/api/demo/trigger', { method: 'POST' })
      .then(r => r.json().then(d => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (!ok) setDemoError(data.detail || 'Demo unavailable')
        setDemoRunning(false)
      })
      .catch(() => { setDemoError('Network error triggering demo'); setDemoRunning(false) })
  }

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filteredRuns = (runs ?? []).filter(run => {
    if (pipelineFilter && run.pipeline_name !== pipelineFilter) return false
    if (searchText && !run.pipeline_name.toLowerCase().includes(searchText.toLowerCase())) return false
    if (statusFilter !== 'ALL' && run.status !== statusFilter.toLowerCase()) return false
    return true
  })

  const anyFilterActive = searchText || statusFilter !== 'ALL' || pipelineFilter

  const handleSelectPipeline = (name) => { setPipelineFilter(name); setActiveTab('runs') }

  const handleCheck = (runId, checked) => {
    setCheckedRuns(prev => {
      const next = new Set(prev)
      if (checked) { if (next.size < 2) next.add(runId) }
      else next.delete(runId)
      return next
    })
  }

  const handleCompare = async () => {
    const [idA, idB] = [...checkedRuns]
    const rA = runs.find(r => r.id === idA)
    const rB = runs.find(r => r.id === idB)
    if (!rA || !rB) return

    // Fetch details if needed
    const fetches = []
    if (!runDetailsCache[idA]) fetches.push(fetch(`/api/runs/${idA}`).then(r => r.json()).then(d => cacheRunDetails(idA, d)))
    if (!runDetailsCache[idB]) fetches.push(fetch(`/api/runs/${idB}`).then(r => r.json()).then(d => cacheRunDetails(idB, d)))
    await Promise.all(fetches)

    setDiffRunA(rA); setDiffRunB(rB); setDiffMode(true)
  }

  const handleExport = () => {
    const data = filteredRuns.map(run => ({
      ...run,
      ...(runDetailsCache[run.id] ? { steps: runDetailsCache[run.id].steps } : {}),
    }))
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `agenttrace-export-${Date.now()}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const isInitialLoad = runs === null && fetchErr === null
  const anyNew = runs ? runs.some(r => !seenRunIds.has(r.id)) : false

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      <Sidebar
        activeTab={activeTab}
        onTabSelect={setActiveTab}
        healthStatus={healthStatus}
        onOpenAlerts={() => setShowAlerts(true)}
        onOpenSettings={() => setShowSettings(true)}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      />

      <div className="main-layout">
        <header className="main-header">
          <div className="main-header-left">
            PIPELINE RUNS {runs && <span className="runs-logged-badge">· {runs.length} LOGGED</span>}
            {pipelineFilter && (
              <span className="filter-chip">
                FILTER: {pipelineFilter}
                <button className="clear-filter-btn" onClick={() => setPipelineFilter(null)}>×</button>
              </span>
            )}
          </div>
          <div className="main-header-right">
            {lastSynced && <span className="sync-timestamp">{lastSynced}</span>}
            <span className="live-pill"><span className="status-dot online" />LIVE</span>
          </div>
        </header>

        <main className="main-workspace">
          {diffMode ? (
            <DiffPanel
              runA={diffRunA} runB={diffRunB}
              detailA={runDetailsCache[diffRunA?.id]} detailB={runDetailsCache[diffRunB?.id]}
              onBack={() => { setDiffMode(false); setCheckedRuns(new Set()) }}
            />
          ) : activeTab === 'pipelines' ? (
            <PipelinesView runs={runs} onSelectPipeline={handleSelectPipeline} />
          ) : (
            <>
              {/* Stats bar */}
              {filteredRuns.length > 0 && <StatsBar runs={filteredRuns} isNew={anyNew} />}

              {/* Filter bar */}
              {runs && runs.length > 0 && (
                <div className="filter-bar">
                  <input
                    ref={searchRef}
                    className="filter-search"
                    type="text"
                    placeholder="Search by pipeline… (/)"
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                  />
                  <div className="status-chips">
                    {['ALL', 'SUCCESS', 'FAILED'].map(s => (
                      <button key={s} className={`status-chip ${statusFilter === s ? 'active' : ''}`} onClick={() => setStatusFilter(s)}>{s}</button>
                    ))}
                  </div>
                  {anyFilterActive && (
                    <button className="clear-filter-btn-bar" onClick={() => { setSearchText(''); setStatusFilter('ALL'); setPipelineFilter(null) }}>× Clear filters</button>
                  )}
                  {checkedRuns.size === 2 && (
                    <button className="compare-btn" onClick={handleCompare}>Compare selected</button>
                  )}
                  <div style={{ flex: 1 }} />
                  {groqConfigured && (
                    <button className="demo-btn" onClick={handleRunDemo} disabled={demoRunning}>
                      {demoRunning ? '⏳ Running…' : '▶ Run Live Demo'}
                    </button>
                  )}
                  <button className="export-btn" onClick={handleExport}>↓ Export JSON</button>
                </div>
              )}

              {demoError && (
                <div className="error-banner" style={{ marginBottom: 16 }}>
                  <span>⚠</span><span>Demo unavailable — {demoError}</span>
                  <button className="clear-filter-btn" onClick={() => setDemoError(null)} style={{ marginLeft: 'auto' }}>×</button>
                </div>
              )}

              {demoRunning && (
                <div className="demo-running-bar">
                  <span className="status-dot amber" />
                  Running planner → researcher → writer…
                </div>
              )}

              {/* Cost chart */}
              {filteredRuns.length >= 2 && <CostChart runs={filteredRuns} onSelectRun={setSelectedRun} />}

              {/* Heatmap */}
              <AgentHeatmap runs={filteredRuns} runDetailsCache={runDetailsCache} />

              {/* Error banner */}
              {fetchErr && (
                <div className="error-banner"><span>⚠</span><span>TELEMETRY SIGNAL LOST — {fetchErr}</span></div>
              )}

              {/* Skeleton loader */}
              {isInitialLoad && (
                <div className="table-skeleton-container">
                  {[1,2,3,4].map(i => <div key={i} className="skeleton skeleton-card" style={{ marginBottom: 8 }} />)}
                </div>
              )}

              {/* Empty state */}
              {!isInitialLoad && !fetchErr && runs?.length === 0 && (
                <div className="empty-state">
                  <span className="status-dot dim" style={{ marginBottom: 16 }} />
                  <h2>AWAITING SIGNAL</h2>
                  {groqConfigured ? (
                    <>
                      <p>See AgentTrace in action — click to run a live 3-agent research pipeline and watch it record in real time.</p>
                      <button className="demo-btn demo-btn-prominent" onClick={handleRunDemo} disabled={demoRunning}>
                        {demoRunning ? '⏳ Running pipeline…' : '▶ Run First Pipeline'}
                      </button>
                    </>
                  ) : (
                    <p>Run <code>examples/demo_pipeline.py</code> to begin recording.</p>
                  )}
                </div>
              )}

              {/* Runs table */}
              {filteredRuns.length > 0 && (
                <div className="table-container">
                  <table className="runs-table">
                    <thead>
                      <tr>
                        <th style={{ width: 32 }}></th>
                        <th>STATUS</th><th>PIPELINE</th><th>RUN ID</th><th>STARTED</th><th>STEPS</th><th>TOKENS</th><th>COST</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRuns.map(run => (
                        <TableRow
                          key={run.id}
                          run={run}
                          isNew={!seenRunIds.has(run.id)}
                          onSeen={markAsSeen}
                          cachedDetail={runDetailsCache[run.id]}
                          onSelect={setSelectedRun}
                          compareMode={checkedRuns.size > 0}
                          isChecked={checkedRuns.has(run.id)}
                          onCheck={handleCheck}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Side drawer */}
      {selectedRun && (
        <SideDrawer
          run={selectedRun}
          onClose={() => setSelectedRun(null)}
          onDetailLoaded={cacheRunDetails}
          allRuns={filteredRuns}
          onNavigate={setSelectedRun}
        />
      )}

      {/* Panels */}
      {showAlerts && <AlertsPanel onClose={() => setShowAlerts(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {/* Toasts */}
      <div className="toast-stack">
        {toasts.map(t => <div key={t.id} className="toast-notification">{t.msg}</div>)}
      </div>
    </div>
  )
}
