import { describe, it, expect } from 'vitest';
import {
  resolveRange, todayIn, dayStart, addDays, addMonths, daysBetween,
  autoGranularity, bucketKeys, densify, pctChange, startOfIsoWeek,
  normalizeTimezone, zonedToUtc, bucketKeyOf,
} from '../time.js';

/** Fixed instant: 2024-03-15T18:30:00Z → 2024-03-16 00:00 IST. */
const NOW = new Date('2024-03-15T18:30:00.000Z');

describe('calendar arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29'); // leap year
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDays('2024-01-01', -1)).toBe('2023-12-31');
  });

  it('clamps when adding months to a longer month', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2023-01-31', 1)).toBe('2023-02-28');
    expect(addMonths('2024-03-15', -12)).toBe('2023-03-15');
  });

  it('counts days inclusively', () => {
    expect(daysBetween('2024-03-01', '2024-03-01')).toBe(1);
    expect(daysBetween('2024-03-01', '2024-03-07')).toBe(7);
    expect(daysBetween('2024-02-01', '2024-03-01')).toBe(30); // leap February
  });

  it('finds the Monday of an ISO week', () => {
    expect(startOfIsoWeek('2024-03-15')).toBe('2024-03-11'); // Friday → Monday
    expect(startOfIsoWeek('2024-03-11')).toBe('2024-03-11'); // Monday → itself
    expect(startOfIsoWeek('2024-03-17')).toBe('2024-03-11'); // Sunday → same week
  });
});

describe('timezone handling', () => {
  it('resolves "today" in the project zone, not the server zone', () => {
    // 18:30 UTC is already the next calendar day in Kolkata (+05:30).
    expect(todayIn('UTC', NOW)).toBe('2024-03-15');
    expect(todayIn('Asia/Kolkata', NOW)).toBe('2024-03-16');
    expect(todayIn('America/Los_Angeles', NOW)).toBe('2024-03-15');
  });

  it('anchors day boundaries to the project zone', () => {
    // Midnight in Kolkata is 18:30 UTC the previous day.
    expect(dayStart('2024-03-16', 'Asia/Kolkata').toISOString()).toBe('2024-03-15T18:30:00.000Z');
    expect(dayStart('2024-03-16', 'UTC').toISOString()).toBe('2024-03-16T00:00:00.000Z');
  });

  it('handles DST transitions', () => {
    // US DST began 2024-03-10. Midnight New York is UTC-05:00 after the switch.
    expect(dayStart('2024-03-11', 'America/New_York').toISOString()).toBe('2024-03-11T04:00:00.000Z');
    // …and UTC-05:00 before it too (EST), but the day before the switch is -05:00.
    expect(dayStart('2024-03-09', 'America/New_York').toISOString()).toBe('2024-03-09T05:00:00.000Z');
  });

  it('round-trips a wall clock through zonedToUtc', () => {
    expect(zonedToUtc(2024, 3, 16, 0, 0, 0, 'Asia/Kolkata').toISOString())
      .toBe('2024-03-15T18:30:00.000Z');
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(normalizeTimezone('Mars/Olympus_Mons')).toBe('UTC');
    expect(normalizeTimezone(null)).toBe('UTC');
    expect(normalizeTimezone('Europe/Berlin')).toBe('Europe/Berlin');
  });
});

describe('resolveRange presets', () => {
  const IST = 'Asia/Kolkata';

  it('defaults to the last 7 days including today', () => {
    const r = resolveRange({}, IST, NOW);
    expect(r.preset).toBe('last_7d');
    expect(r.fromDate).toBe('2024-03-10');
    expect(r.toDate).toBe('2024-03-16');
    expect(r.days).toBe(7);
    expect(r.isOpen).toBe(true);
  });

  it('resolves today and yesterday in project time', () => {
    expect(resolveRange({ preset: 'today' }, IST, NOW).fromDate).toBe('2024-03-16');
    const y = resolveRange({ preset: 'yesterday' }, IST, NOW);
    expect(y.fromDate).toBe('2024-03-15');
    expect(y.toDate).toBe('2024-03-15');
    expect(y.isOpen).toBe(false);
  });

  it('resolves month presets', () => {
    expect(resolveRange({ preset: 'this_month' }, IST, NOW).fromDate).toBe('2024-03-01');
    const lastMonth = resolveRange({ preset: 'last_month' }, IST, NOW);
    expect(lastMonth.fromDate).toBe('2024-02-01');
    expect(lastMonth.toDate).toBe('2024-02-29');
    expect(resolveRange({ preset: 'year_to_date' }, IST, NOW).fromDate).toBe('2024-01-01');
  });

  it('produces a half-open UTC interval covering the whole range', () => {
    const r = resolveRange({ preset: 'today' }, IST, NOW);
    expect(r.from.toISOString()).toBe('2024-03-15T18:30:00.000Z');
    // Exclusive end = start of the following day.
    expect(r.to.toISOString()).toBe('2024-03-16T18:30:00.000Z');
  });

  it('accepts a custom range', () => {
    const r = resolveRange({ from: '2024-01-01', to: '2024-01-31' }, IST, NOW);
    expect(r.preset).toBe('custom');
    expect(r.days).toBe(31);
    expect(r.isOpen).toBe(false);
  });
});

describe('resolveRange hardening', () => {
  const IST = 'Asia/Kolkata';

  it('swaps an inverted range instead of returning nothing', () => {
    const r = resolveRange({ from: '2024-03-10', to: '2024-03-01' }, IST, NOW);
    expect(r.fromDate).toBe('2024-03-01');
    expect(r.toDate).toBe('2024-03-10');
  });

  it('clamps a future end date to today', () => {
    const r = resolveRange({ from: '2024-03-01', to: '2099-01-01' }, IST, NOW);
    expect(r.toDate).toBe('2024-03-16');
  });

  it('degrades a malformed preset to the default rather than throwing', () => {
    expect(resolveRange({ preset: 'nonsense' }, IST, NOW).preset).toBe('last_7d');
    expect(resolveRange({ from: 'not-a-date', to: 'also-not' }, IST, NOW).preset).toBe('last_7d');
  });
});

describe('comparison periods', () => {
  const IST = 'Asia/Kolkata';

  it('produces an immediately preceding window of equal length', () => {
    const r = resolveRange({ preset: 'last_7d', compare: 'previous' }, IST, NOW);
    expect(r.compare).not.toBeNull();
    expect(r.compare!.fromDate).toBe('2024-03-03');
    expect(r.compare!.toDate).toBe('2024-03-09');
    expect(daysBetween(r.compare!.fromDate, r.compare!.toDate)).toBe(r.days);
  });

  it('supports year over year', () => {
    const r = resolveRange({ preset: 'last_7d', compare: 'year_over_year' }, IST, NOW);
    expect(r.compare!.fromDate).toBe('2023-03-10');
    expect(r.compare!.toDate).toBe('2023-03-16');
  });

  it('omits the comparison when not requested', () => {
    expect(resolveRange({ preset: 'last_7d' }, IST, NOW).compare).toBeNull();
  });
});

describe('granularity and dense series', () => {
  it('picks a granularity that keeps charts readable', () => {
    expect(autoGranularity(1)).toBe('hour');
    expect(autoGranularity(7)).toBe('day');
    expect(autoGranularity(90)).toBe('day');
    expect(autoGranularity(180)).toBe('week');
    expect(autoGranularity(500)).toBe('month');
  });

  it('honours an explicit granularity override', () => {
    expect(resolveRange({ preset: 'last_7d', granularity: 'hour' }, 'UTC', NOW).granularity).toBe('hour');
  });

  it('emits one bucket per day with no gaps', () => {
    const r = resolveRange({ from: '2024-03-01', to: '2024-03-05' }, 'UTC', NOW);
    expect(bucketKeys(r, 'day', 'UTC')).toEqual([
      '2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04', '2024-03-05',
    ]);
  });

  it('fills zero-traffic days so the chart cannot draw a false continuous line', () => {
    const r = resolveRange({ from: '2024-03-01', to: '2024-03-04' }, 'UTC', NOW);
    const rows = [
      { bucket: '2024-03-01T00:00:00.000Z', pageviews: 10, visitors: 4 },
      // 03-02 and 03-03 had no traffic at all
      { bucket: '2024-03-04T00:00:00.000Z', pageviews: 7, visitors: 3 },
    ];
    const filled = densify(rows, r, 'day', 'UTC', { pageviews: 0, visitors: 0 });

    expect(filled).toHaveLength(4);
    expect(filled.map((f) => f.pageviews)).toEqual([10, 0, 0, 7]);
    expect(filled.map((f) => f.bucket)).toEqual([
      '2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04',
    ]);
  });

  it('normalises Postgres bucket values to comparable keys', () => {
    expect(bucketKeyOf(new Date('2024-03-01T00:00:00Z'), 'day')).toBe('2024-03-01');
    expect(bucketKeyOf('2024-03-01', 'day')).toBe('2024-03-01');
    expect(bucketKeyOf('2024-03-01T13:00:00.000Z', 'hour')).toBe('2024-03-01T13:00:00');
  });
});

describe('percentage change', () => {
  it('computes signed change against the previous period', () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(80, 100)).toBe(-20);
    expect(pctChange(100, 100)).toBe(0);
  });

  it('reports no baseline rather than dividing by zero', () => {
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(50, 0)).toBeNull();
  });
});
