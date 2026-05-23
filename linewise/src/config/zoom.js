/* Timeline zoom presets — UI config, not planning data.
   Lives on the frontend because it controls geometry of the rendered
   timeline (px-per-day, days-back, days-ahead), not anything the model
   produces. */
export const ZOOM = {
  day:   { dayW: 124, back: 7,  ahead: 14, label: 'Day' },
  week:  { dayW: 54,  back: 14, ahead: 28, label: 'Week' },
  month: { dayW: 22,  back: 30, ahead: 60, label: 'Month' },
};
