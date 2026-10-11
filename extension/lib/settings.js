export const DEFAULT_SETTINGS = Object.freeze({ maxDuration: 120, maxHeight: 30000, waitMs: 700, loadTimeout: 5000 });

export function normalizeSettings(input = {}) {
  const number = (key, min, max) => {
    const value = Number(input[key] ?? DEFAULT_SETTINGS[key]);
    return Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : DEFAULT_SETTINGS[key];
  };
  return { maxDuration: number('maxDuration', 10, 600), maxHeight: number('maxHeight', 1000, 100000),
    waitMs: number('waitMs', 300, 5000), loadTimeout: number('loadTimeout', 1000, 10000) };
}
