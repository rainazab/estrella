import { useEffect, useState } from 'react'
import './deck.css'

function Deck() {
  const slides = [
    <TitleSlide key="title" />,
    <DecisionMomentSlide key="decision" />,
    <FeedbackLoopSlide key="feedback-loop" />,
    <PromiseSlide key="promise" />,
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

export default Deck
