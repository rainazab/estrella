import { useState } from 'react';
import TimelineCard from '../components/TimelineCard.jsx';
import AggregateCard from '../components/AggregateCard.jsx';
import RunDetailModal from '../components/RunDetailModal.jsx';

/* CardLab — visit /?lab=card to see this.
   Renders every state of the timeline card so the design can be
   reviewed in isolation, plus the popup wired to a click.
   All cards use the same width (W) so the gallery compares fairly
   — height, breakpoints, content layout should match across states. */
const W = 220;

export default function CardLab() {
  const [active, setActive] = useState(null);

  const lineBaseline = { '14': 0.52, '17': 0.56, '19': 0.49 };

  return (
    <div className="lab">
      <div className="lab-h">Timeline card · lab</div>
      <div className="lab-sub">
        Every state of the card in isolation, plus the click → modal flow.
        Click any card.
      </div>

      {/* ----- single card states ----- */}
      <div className="lab-section">
        <div className="lab-section-h">States</div>
        <div className="lab-row">
          <TimelineCard
            widthPx={W}
            material="FDT13LT"
            sku="Free Damm · lata 33cl"
            volume={48000}
            oee={0.54}
            lineBaseline={lineBaseline['14']}
            durationHours={1.4}
            onClick={() => setActive({
              material: 'FDT13LT', sku: 'Free Damm · lata 33cl',
              volume: 48000, oee: 0.54, durationHours: 1.4,
              lineKey: '14', prev: null,
              next: { material: 'ED13LTNN', sku: 'Estrella Damm · lata 33cl' },
            })}
          />
          <TimelineCard
            widthPx={W}
            material="ED13LTNN"
            sku="Estrella Damm · lata 33cl"
            volume={92000}
            oee={0.61}
            lineBaseline={lineBaseline['14']}
            durationHours={2.6}
            onClick={() => setActive({
              material: 'ED13LTNN', sku: 'Estrella Damm · lata 33cl',
              volume: 92000, oee: 0.61, durationHours: 2.6,
              lineKey: '14',
              prev: { material: 'FDT13LT', sku: 'Free Damm · lata 33cl' },
              next: { material: 'VO13LTMP', sku: 'Voll-Damm · lata 33cl' },
            })}
          />
          <TimelineCard
            widthPx={W}
            material="ED05LTNN"
            sku="Estrella Damm · lata 50cl"
            volume={55000}
            oee={0.43}
            lineBaseline={lineBaseline['19']}
            durationHours={1.6}
            onClick={() => setActive({
              material: 'ED05LTNN', sku: 'Estrella Damm · lata 50cl',
              volume: 55000, oee: 0.43, durationHours: 1.6,
              lineKey: '19',
              prev: { material: 'AM05LTST', sku: 'AmiBock · lata 50cl', kind: null },
              next: { kind: 'maint', durationHours: 0.6 },
            })}
          />
          <TimelineCard widthPx={W} kind="clean" durationHours={0.5} />
          <TimelineCard widthPx={W} kind="maint" durationHours={0.6} />
        </div>
      </div>

      {/* ----- insertion + shifted ----- */}
      <div className="lab-section">
        <div className="lab-section-h">Insertion &amp; shifted (rec mode)</div>
        <div className="lab-row">
          <TimelineCard
            widthPx={W}
            material="ED13LTNN"
            sku="Estrella Damm · lata 33cl"
            volume={18000}
            oee={0.57}
            lineBaseline={lineBaseline['17']}
            durationHours={1.6}
            kind="ins"
            onClick={() => setActive({
              material: 'ED13LTNN', sku: 'Estrella Damm · lata 33cl',
              volume: 18000, oee: 0.57, durationHours: 1.6, kind: 'ins',
              lineKey: '17',
              prev: { material: 'AM05LTST', sku: 'AmiBock · lata 50cl' },
              next: { material: 'FDT13LT', sku: 'Free Damm · lata 33cl' },
              analogue: 'OF 004182 ran a same-envase 33cl restart on 14 Mar 2025 at OEE 0.61',
            })}
          />
          <TimelineCard
            widthPx={W}
            material="FDT13LT"
            sku="Free Damm · lata 33cl"
            volume={47000}
            oee={0.56}
            lineBaseline={lineBaseline['17']}
            durationHours={1.4}
            kind="shift"
            shiftFromHours={6}
            onClick={() => setActive({
              material: 'FDT13LT', sku: 'Free Damm · lata 33cl',
              volume: 47000, oee: 0.56, durationHours: 1.4, kind: 'shift', shiftFromHours: 6,
              lineKey: '17',
              prev: { material: 'ED13LTNN', sku: 'Estrella Damm · lata 33cl' },
              next: { kind: 'clean', durationHours: 0.5 },
            })}
          />
          <TimelineCard
            widthPx={W}
            kind="ghost"
            material="FDT13LT"
            durationHours={1.4}
          />
        </div>
      </div>

      {/* ----- selected + executed ----- */}
      <div className="lab-section">
        <div className="lab-section-h">Selected · executed</div>
        <div className="lab-row">
          <TimelineCard
            widthPx={W}
            material="VO13LTMP"
            sku="Voll-Damm · lata 33cl"
            volume={34000}
            oee={0.56}
            lineBaseline={lineBaseline['14']}
            durationHours={1.0}
            selected
            onClick={() => {}}
          />
          <TimelineCard
            widthPx={W}
            material="ED05LTNN"
            sku="Estrella Damm · lata 50cl"
            volume={71000}
            oee={0.53}
            lineBaseline={lineBaseline['14']}
            durationHours={1.9}
            state="executed"
          />
        </div>
      </div>

      {/* ----- WEEK VIEW — each card = one day ----- */}
      <div className="lab-section">
        <div className="lab-section-h">Week view — one card per day (L14)</div>
        <div className="lab-row">
          <AggregateCard
            widthPx={W}
            period="day"
            label="Mon 18 May"
            dominantMaterial="FDT13LT"
            dominantSku="Free Damm · lata 33cl"
            runCount={1}
            formats={['33cl']}
            totalVolume={88000}
            productiveHours={22}
            avgOee={0.54}
            lineBaseline={lineBaseline['14']}
          />
          <AggregateCard
            widthPx={W}
            period="day"
            label="Tue 19 May"
            runCount={2}
            cleanCount={1}
            formats={['33cl', '50cl']}
            totalVolume={132000}
            productiveHours={20}
            avgOee={0.50}
            lineBaseline={lineBaseline['14']}
          />
          <AggregateCard
            widthPx={W}
            period="day"
            label="Wed 20 May"
            dominantMaterial="ED13LTNN"
            dominantSku="Estrella Damm · lata 33cl"
            runCount={1}
            formats={['33cl']}
            totalVolume={184000}
            productiveHours={24}
            avgOee={0.55}
            lineBaseline={lineBaseline['14']}
          />
          <AggregateCard
            widthPx={W}
            period="day"
            label="Thu 21 May"
            runCount={3}
            cleanCount={1}
            formats={['33cl', '50cl']}
            totalVolume={154000}
            productiveHours={22}
            avgOee={0.43}
            lineBaseline={lineBaseline['14']}
            hasUrgentInsert
          />
          <AggregateCard
            widthPx={W}
            period="day"
            label="Fri 22 May"
            isToday
            dominantMaterial="VO13LTMP"
            dominantSku="Voll-Damm · lata 33cl"
            runCount={1}
            formats={['33cl']}
            totalVolume={62000}
            productiveHours={16}
            avgOee={0.56}
            lineBaseline={lineBaseline['14']}
          />
        </div>
      </div>

      <div className="lab-section">
        <div className="lab-section-h">Week view — edge states</div>
        <div className="lab-row">
          <AggregateCard
            widthPx={W}
            period="day"
            label="Sat 23 May"
            isIdle
          />
          <AggregateCard
            widthPx={W}
            period="day"
            label="Sun 24 May"
            runCount={4}
            cleanCount={2}
            maintCount={1}
            formats={['33cl', '50cl', '44cl']}
            totalVolume={208000}
            productiveHours={19}
            avgOee={0.61}
            lineBaseline={lineBaseline['19']}
          />
        </div>
      </div>

      {/* ----- MONTH VIEW — each card = one week ----- */}
      <div className="lab-section">
        <div className="lab-section-h">Month view — one card per week (L14)</div>
        <div className="lab-row">
          <AggregateCard
            widthPx={W}
            period="week"
            label="Week 19"
            subLabel="4–10 May"
            runCount={14}
            cleanCount={3}
            formats={['33cl', '50cl']}
            totalVolume={920000}
            productiveHours={142}
            avgOee={0.50}
            lineBaseline={lineBaseline['14']}
          />
          <AggregateCard
            widthPx={W}
            period="week"
            label="Week 20"
            subLabel="11–17 May"
            runCount={16}
            cleanCount={4}
            formats={['33cl', '50cl']}
            totalVolume={1080000}
            productiveHours={148}
            avgOee={0.55}
            lineBaseline={lineBaseline['14']}
          />
          <AggregateCard
            widthPx={W}
            period="week"
            label="Week 21"
            subLabel="18–24 May"
            isToday
            runCount={18}
            cleanCount={3}
            formats={['33cl', '50cl']}
            totalVolume={1240000}
            productiveHours={156}
            avgOee={0.54}
            lineBaseline={lineBaseline['14']}
            hasUrgentInsert
          />
          <AggregateCard
            widthPx={W}
            period="week"
            label="Week 22"
            subLabel="25–31 May"
            runCount={15}
            cleanCount={4}
            formats={['33cl']}
            totalVolume={1010000}
            productiveHours={140}
            avgOee={0.48}
            lineBaseline={lineBaseline['14']}
          />
        </div>
      </div>

      <RunDetailModal
        open={!!active}
        run={active}
        prev={active?.prev}
        next={active?.next}
        lineKey={active?.lineKey}
        lineBaseline={active ? lineBaseline[active.lineKey] : null}
        onClose={() => setActive(null)}
        onMove={() => { /* hook up later */ }}
        onLock={() => { /* hook up later */ }}
      />
    </div>
  );
}
