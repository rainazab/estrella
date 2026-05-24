import { useEffect, useState } from 'react'
import './deck.css'

function Deck() {
  const slides = [
    <TitleSlide key="title" />,
    <DecisionMomentSlide key="decision" />,
    <FeedbackLoopSlide key="feedback-loop" />,
    <PromiseSlide key="promise" />,
    <FeatureSlide
      key="diagnose"
      number="04"
      label="Feature 1"
      title="Diagnose where sequencing hurt OEE."
      subtitle="LineWise starts by investigating executed history, not by asking the planner to trust a prediction."
      mode="diagnose"
    />,
    <FeatureSlide
      key="simulate"
      number="05"
      label="Feature 2"
      title="Simulate the urgent order before committing."
      subtitle="The planner can compare the obvious move against alternative line and slot choices."
      mode="simulate"
    />,
    <FeatureSlide
      key="recommend"
      number="06"
      label="Feature 3"
      title="Recommend the best line and position."
      subtitle="The answer comes with expected OEE impact and the historical cases behind it."
      mode="recommend"
    />,
    <ApproachSlide key="approach" />,
    <ImpactSlide key="impact" />,
    <FutureSlide key="future" />,
    <CloseSlide key="close" />,
  ]
  const [slide, setSlide] = useState(() => {
    const requested = Number(new URLSearchParams(location.search).get('slide'))
    return Number.isFinite(requested) ? Math.min(Math.max(requested - 1, 0), slides.length - 1) : 0
  })

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'ArrowRight' || event.key === ' ') {
        setSlide((current) => Math.min(current + 1, slides.length - 1))
      }
      if (event.key === 'ArrowLeft') {
        setSlide((current) => Math.max(current - 1, 0))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [slides.length])

  return (
    <main className="deck-root" aria-label="LineWise presentation">
      {slides[slide]}
      <div className="slide-progress" aria-hidden="true">
        <span>{String(slide + 1).padStart(2, '0')}</span>
        <i />
        <span>{String(slides.length).padStart(2, '0')}</span>
      </div>
    </main>
  )
}

function TitleSlide() {
  return (
    <section className="slide title-slide" aria-label="Slide 1: LineWise">
      <div className="brand-row" aria-label="Hackathon partners">
        <img src="/brand/logo-damm.png" alt="Damm" className="brand-logo damm-logo" />
        <span className="partner-mark">x</span>
        <img src="/brand/logo-ehub.png" alt="E-Hub" className="brand-logo ehub-logo" />
      </div>

      <div className="line-system" aria-hidden="true">
        <div className="line-track line-track-a">
          <span className="order-block block-red" />
          <span className="order-block block-green" />
          <span className="order-block block-gold" />
          <span className="line-node" />
        </div>
        <div className="line-track line-track-b">
          <span className="order-block block-green" />
          <span className="order-block block-ink" />
          <span className="order-block block-red" />
          <span className="line-node" />
        </div>
        <div className="line-track line-track-c">
          <span className="order-block block-gold" />
          <span className="order-block block-red" />
          <span className="order-block block-green" />
          <span className="line-node" />
        </div>
      </div>

      <div className="title-content">
        <p className="challenge-label">Operations Challenge</p>
        <h1>LineWise</h1>
        <p className="title-subtitle">When the plan changes, decide with evidence.</p>
      </div>

      <footer className="slide-footer">
        <span>Damm x Engineering HUB Hackathon</span>
        <span>Team LineWise</span>
      </footer>
    </section>
  )
}

function DecisionMomentSlide() {
  return (
    <section className="slide decision-slide" aria-label="Slide 2: The decision moment">
      <div className="slide-kicker">
        <span>01</span>
        <b>The Decision Moment</b>
      </div>

      <div className="decision-copy">
        <h2>An urgent order enters the plan.</h2>
        <p>The planner has to choose where it goes before the factory pays for the wrong move.</p>
      </div>

      <div className="planner-board" aria-hidden="true">
        <div className="board-head">
          <span>Current production plan</span>
          <b>Lines 14 / 17 / 19</b>
        </div>

        <PlanLine line="14" blocks={['red', 'green', 'gold']} candidate="after-first" />
        <PlanLine line="17" blocks={['green', 'ink', 'red']} candidate="after-second" />
        <PlanLine line="19" blocks={['gold', 'red', 'green']} candidate="end" />

        <div className="urgent-card">
          <div className="urgent-label">Urgent order</div>
          <div className="urgent-code">OF-NEW</div>
          <div className="urgent-meta">SKU + volume</div>
        </div>

        <div className="decision-options">
          <span>Same line?</span>
          <span>Another line?</span>
          <span>Next slot?</span>
          <span>Later slot?</span>
        </div>
      </div>
    </section>
  )
}

function PlanLine({ line, blocks, candidate }) {
  return (
    <div className={`plan-line candidate-${candidate}`}>
      <div className="line-label">Line {line}</div>
      <div className="plan-track">
        {blocks.map((block, index) => (
          <span className={`plan-block block-${block}`} key={`${line}-${block}-${index}`} />
        ))}
        <span className="candidate-dot candidate-one" />
        <span className="candidate-dot candidate-two" />
      </div>
    </div>
  )
}

function FeedbackLoopSlide() {
  return (
    <section className="slide feedback-slide" aria-label="Slide 3: The missing feedback loop">
      <div className="slide-kicker">
        <span>02</span>
        <b>The Missing Feedback Loop</b>
      </div>

      <div className="feedback-copy">
        <h2>Planning is theoretical. Execution is real.</h2>
        <p>Executed history exists, but it does not guide the next urgent decision.</p>
      </div>

      <div className="loop-stage" aria-hidden="true">
        <div className="loop-card plan-card">
          <div className="loop-card-label">Planned sequence</div>
          <div className="mini-track">
            <span className="mini-block block-red" />
            <span className="mini-block block-green" />
            <span className="mini-block block-gold" />
          </div>
          <ul>
            <li>standard changeovers</li>
            <li>expected capacity</li>
            <li>logical order</li>
          </ul>
        </div>

        <div className="loop-card reality-card">
          <div className="loop-card-label">Actual execution</div>
          <div className="actual-track">
            <span className="jitter-block block-red" />
            <span className="downtime-gap">cleaning</span>
            <span className="jitter-block block-green" />
            <span className="downtime-gap dark">stop</span>
            <span className="jitter-block block-gold" />
          </div>
          <ul>
            <li>cleanings</li>
            <li>stoppages</li>
            <li>maintenance</li>
            <li>line behavior</li>
          </ul>
        </div>

        <div className="broken-loop">
          <svg viewBox="0 0 520 280" role="presentation">
            <path className="loop-path loop-path-a" d="M105 80 C180 20, 330 20, 405 80" />
            <path className="loop-path loop-path-b" d="M405 200 C330 260, 180 260, 105 200" />
            <path className="loop-break" d="M410 88 L444 122 M444 88 L410 122" />
            <circle className="loop-pulse" cx="403" cy="80" r="12" />
          </svg>
          <div className="stuck-note">history gets stuck in hindsight</div>
        </div>
      </div>
    </section>
  )
}

function PromiseSlide() {
  return (
    <section className="slide promise-slide" aria-label="Slide 4: Our promise">
      <div className="slide-kicker">
        <span>03</span>
        <b>Our Promise</b>
      </div>

      <div className="promise-hero">
        <h2>LineWise gives the factory a memory.</h2>
        <p>Executed history becomes decision support at the moment of replanning.</p>
      </div>

      <div className="memory-loop" aria-hidden="true">
        <div className="memory-node node-history">
          <span>Executed history</span>
          <b>orders · OEE · changeovers</b>
        </div>

        <div className="memory-core">
          <div className="core-ring" />
          <div className="core-title">LineWise</div>
          <div className="core-sub">evidence engine</div>
        </div>

        <div className="memory-node node-decision">
          <span>Planner decision</span>
          <b>line · position · impact</b>
        </div>

        <svg className="closed-loop" viewBox="0 0 760 360" role="presentation">
          <path className="closed-loop-path path-top" d="M155 116 C260 20, 500 20, 605 116" />
          <path className="closed-loop-path path-bottom" d="M605 244 C500 340, 260 340, 155 244" />
          <circle className="moving-dot dot-a" cx="155" cy="116" r="9" />
          <circle className="moving-dot dot-b" cx="605" cy="244" r="9" />
        </svg>

        <div className="workflow-strip">
          <div>
            <span>01</span>
            <b>Diagnose</b>
            <small>where OEE was lost</small>
          </div>
          <div>
            <span>02</span>
            <b>Simulate</b>
            <small>what could happen</small>
          </div>
          <div>
            <span>03</span>
            <b>Recommend</b>
            <small>what to do next</small>
          </div>
        </div>
      </div>
    </section>
  )
}

function FeatureSlide({ number, label, title, subtitle, mode }) {
  return (
    <section className={`slide feature-slide ${mode}-slide`} aria-label={`Slide ${number}: ${label}`}>
      <div className="slide-kicker">
        <span>{number}</span>
        <b>{label}</b>
      </div>

      <div className="feature-copy">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>

      <div className="demo-frame" aria-hidden="true">
        <div className="demo-topbar">
          <span>LineWise product UI</span>
          <b>{mode}</b>
        </div>
        <ProductUiExample mode={mode} />
      </div>
    </section>
  )
}

const UI_EXAMPLES = {
  diagnose: {
    src: '/deck/ui-diagnose.png',
    eyebrow: 'Planning board + executed timeline',
    headline: 'The urgent decision is framed against real line history.',
    stats: ['Urgent order', 'External signals', 'Line baselines'],
  },
  simulate: {
    src: '/deck/ui-simulate.png',
    eyebrow: 'Scenario comparison',
    headline: 'The planner compares impact before committing.',
    stats: ['Objectives', 'Cala AI', 'Draft action'],
  },
  recommend: {
    src: '/deck/ui-recommend.png',
    eyebrow: 'Recommendation with evidence',
    headline: 'LineWise ranks the move and shows the cases behind it.',
    stats: ['+16.9 OEE', '6 analogues', 'Line 19'],
  },
}

function ProductUiExample({ mode }) {
  const example = UI_EXAMPLES[mode]

  return (
    <div className="product-ui-example">
      <div className="product-shot-wrap">
        <img src={example.src} alt="" className="product-shot" />
        <div className="product-scanline" />
      </div>
      <div className="product-caption">
        <span>{example.eyebrow}</span>
        <b>{example.headline}</b>
        <div className="product-pills">
          {example.stats.map((stat) => (
            <i key={stat}>{stat}</i>
          ))}
        </div>
      </div>
    </div>
  )
}

function ApproachSlide() {
  return (
    <section className="slide approach-slide" aria-label="Slide 8: How LineWise works">
      <div className="slide-kicker">
        <span>07</span>
        <b>How LineWise Works</b>
      </div>
      <div className="approach-title">
        <h2>A decision pipeline, not just a dashboard.</h2>
      </div>
      <div className="pipeline">
        {[
          ['Integrate', 'orders · OEE · volumes · time categories · changeovers'],
          ['Model', 'order-level expected OEE impact'],
          ['Generate', 'candidate insertions across lines 14 / 17 / 19'],
          ['Score', 'compare each scenario against the naive plan'],
          ['Explain', 'return historical cases as evidence'],
        ].map(([step, detail], index) => (
          <div className="pipeline-step" key={step}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <b>{step}</b>
            <small>{detail}</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function ImpactSlide() {
  return (
    <section className="slide impact-slide" aria-label="Slide 9: Why it matters">
      <div className="slide-kicker">
        <span>08</span>
        <b>Why It Matters</b>
      </div>
      <div className="impact-title">
        <h2>Built to match the way Damm will judge it.</h2>
      </div>
      <div className="rubric-grid">
        {[
          ['Business impact', 'less avoidable OEE loss'],
          ['Data use', 'execution history becomes planning evidence'],
          ['Technical solution', 'prediction + simulation + recommendation'],
          ['Explainability', 'recommendations with receipts'],
          ['Demo', 'one urgent-order flow end to end'],
        ].map(([name, proof]) => (
          <div className="rubric-card" key={name}>
            <span>{name}</span>
            <b>{proof}</b>
          </div>
        ))}
      </div>
    </section>
  )
}

function FutureSlide() {
  const features = [
    ['Daily agents', 'Scan yesterday’s execution, detect OEE leaks, and push recommendations before the morning planning meeting.'],
    ['Cala AI signals', 'Bring commodity, packaging, and market signals into planning so external constraints are visible before they hit the line.'],
    ['Multi-order replanning', 'Optimize several urgent and queued orders together, not one order at a time.'],
    ['Shift handoff intelligence', 'Turn planner decisions, stoppages, and overrides into a clear next-shift briefing.'],
    ['Continuous learning', 'Use accepted, rejected, and manually adjusted recommendations as feedback for the next run.'],
    ['System integration', 'Sit beside Blue Yonder and MES as an evidence layer, not a replacement workflow.'],
  ]

  return (
    <section className="slide future-slide" aria-label="Slide 10: Beyond the demo">
      <div className="slide-kicker">
        <span>09</span>
        <b>Beyond The Demo</b>
      </div>

      <div className="future-title">
        <p className="challenge-label">What we proved today</p>
        <h2>One urgent decision is the wedge.</h2>
        <p>Once the factory has a memory, the same loop can run every day, across more orders, with richer signals.</p>
      </div>

      <div className="future-grid" aria-hidden="true">
        {features.map(([title, detail], index) => (
          <div className="future-card" key={title}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <b>{title}</b>
            <small>{detail}</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function CloseSlide() {
  return (
    <section className="slide close-slide" aria-label="Slide 11: Close">
      <div className="close-content">
        <p className="challenge-label">Current scope</p>
        <h2>When the plan breaks, decide with what the factory has already learned.</h2>
        <div className="scope-row">
          <span>Lines 14 / 17 / 19</span>
          <span>single urgent-order insertion</span>
          <span>order-level model</span>
          <span>Blue Yonder enrichment</span>
        </div>
      </div>
      <div className="next-panel" aria-hidden="true">
        <b>Next</b>
        <span>multi-order optimization</span>
        <span>richer constraints</span>
        <span>planning workflow integration</span>
      </div>
    </section>
  )
}

export default Deck
