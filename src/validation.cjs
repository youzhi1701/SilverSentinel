'use strict';

const UI_SCALE_MIN = 0.5;
const UI_SCALE_MAX = 2;

function clampUiScale(value, fallback = 1) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, safe));
}

function isValidClockTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

module.exports = {
  UI_SCALE_MIN,
  UI_SCALE_MAX,
  clampUiScale,
  isValidClockTime,
};
