/* stoppagePlan — pure function for the "Replan after stoppage" flow.
   Shifts every planned segment on the stopped line forward by the
   stoppage's expected duration so the timeline reflects reality.

   Service blocks (clean/maint) shift too — a hackathon simplification
   identical to the one in movePlan.js; in production they'd be
   time-locked and we'd negotiate around them. */

/* Map the modal's duration chip key to hours. "unknown" defaults to
   1 hour — enough to make the visual shift obvious without being
   alarmist. */
export function durationToHours(key) {
  return {
    '15m':     0.25,
    '30m':     0.5,
    '1h':      1,
    '2h+':     2,
    'unknown': 1,
  }[key] ?? 0.5;
}

/* Returns the new plan plus a per-run shift list the stoppage-review
   surface uses to render every moved card. `shiftedRuns` excludes
   service blocks (the review focuses on production work being pushed);
   `shiftedCount`/`shiftedHours` still count the whole lane so existing
   toast copy stays accurate. */
export function computeStoppageReplan({ basePlan, line, durationKey }) {
  const lane = basePlan?.[line];
  if (!lane || lane.length === 0) {
    return { plan: basePlan, shiftedCount: 0, shiftedHours: 0, shiftedRuns: [] };
  }
  const hours = durationToHours(durationKey);
  const shiftDays = hours / 24;

  const shifted = lane.map((seg) => ({
    ...seg,
    start: (seg.start ?? 0) + shiftDays,
  }));

  const shiftedRuns = lane
    .filter((seg) => seg && seg.kind !== 'clean' && seg.kind !== 'maint')
    .map((seg) => ({
      of: seg.of,
      sku: seg.sku,
      vol: seg.vol,
      oee: seg.oee,
      fromStart: seg.start ?? 0,
      toStart: (seg.start ?? 0) + shiftDays,
      shiftHours: hours,
      durationDays: seg.w ?? 0,
      kind: seg.kind,
    }));

  return {
    plan: { ...basePlan, [line]: shifted },
    shiftedCount: lane.length,
    shiftedHours: hours,
    shiftedRuns,
  };
}
