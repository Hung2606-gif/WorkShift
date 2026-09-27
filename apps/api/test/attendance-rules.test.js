import { describe, expect, it } from 'vitest';
import {
  assertGpsFix,
  assignmentForCheckIn,
  checkInStatus,
  distanceMeters,
  ipMatchesAllowed,
  localDate,
  monthRange,
  shiftWindow,
  zonedTime
} from '../src/services/attendance.js';

const VN = 'Asia/Ho_Chi_Minh';
const dayShift = { start_time: '08:00:00', end_time: '17:00:00', late_grace_minutes: 10, is_overnight: false };
const nightShift = { start_time: '22:00:00', end_time: '06:00:00', late_grace_minutes: 0, is_overnight: true };
const office = { latitude: 10.7769, longitude: 106.7009, radius_meters: 100 };

describe('attendance time rules', () => {
  it('converts wall-clock shift times in the configured zone', () => {
    expect(zonedTime('2026-09-28', '08:00', VN).toISOString()).toBe('2026-09-28T01:00:00.000Z');
    expect(zonedTime('2026-07-01', '09:00', 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(localDate(new Date('2026-09-27T17:30:00Z'), VN)).toBe('2026-09-28');
  });

  it('ends an overnight shift on the next day', () => {
    const { start, end } = shiftWindow('2026-09-27', nightShift, VN);
    expect(start.toISOString()).toBe('2026-09-27T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-27T23:00:00.000Z');
  });

  it('bounds a month without assuming it has 31 days', () => {
    expect(monthRange('2026-09', VN)).toEqual({ from: '2026-08-31T17:00:00.000Z', to: '2026-09-30T17:00:00.000Z' });
    expect(monthRange('2026-12', VN).to).toBe('2026-12-31T17:00:00.000Z');
  });

  it('opens check-in an hour before the shift and closes it at the end', () => {
    const assignments = [{ id: 'day', work_date: '2026-09-28', work_shifts: dayShift }];
    expect(assignmentForCheckIn(assignments, new Date('2026-09-27T23:59:00Z'), VN)).toBeNull();
    expect(assignmentForCheckIn(assignments, new Date('2026-09-28T00:00:00Z'), VN)?.assignment.id).toBe('day');
    expect(assignmentForCheckIn(assignments, new Date('2026-09-28T10:00:01Z'), VN)).toBeNull();
  });

  it('chooses the later shift when an overnight shift overlaps an early one', () => {
    const earlyShift = { ...dayShift, start_time: '06:30:00' };
    const assignments = [
      { id: 'night', work_date: '2026-09-27', work_shifts: nightShift },
      { id: 'early', work_date: '2026-09-28', work_shifts: earlyShift }
    ];
    // 05:45 local on 28 Sep: the night shift has not ended and the early shift is open.
    expect(assignmentForCheckIn(assignments, new Date('2026-09-27T22:45:00Z'), VN)?.assignment.id).toBe('early');
  });

  it('marks a check-in late only after the grace period', () => {
    const window = shiftWindow('2026-09-28', dayShift, VN);
    expect(checkInStatus(window, dayShift, new Date('2026-09-28T01:10:00Z'))).toBe('NORMAL');
    expect(checkInStatus(window, dayShift, new Date('2026-09-28T01:10:01Z'))).toBe('LATE');
  });
});

describe('attendance presence rules', () => {
  const now = new Date('2026-09-28T01:05:00Z');
  const fix = (overrides) => ({ latitude: office.latitude, longitude: office.longitude, accuracy: 20, capturedAt: now.toISOString(), ...overrides });

  it('measures great-circle distance', () => {
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(111_195, -1);
  });

  it('accepts a fresh, accurate fix inside the radius', () => {
    expect(assertGpsFix(fix({ latitude: office.latitude + 0.0005 }), office, now)).toBeCloseTo(55.6, 0);
  });

  it('rejects stale, imprecise or distant fixes', () => {
    expect(() => assertGpsFix(fix({ capturedAt: '2026-09-28T01:02:00Z' }), office, now)).toThrow(expect.objectContaining({ code: 'GPS_FIX_STALE' }));
    expect(() => assertGpsFix(fix({ accuracy: 150 }), office, now)).toThrow(expect.objectContaining({ code: 'GPS_INACCURATE' }));
    expect(() => assertGpsFix(fix({ latitude: office.latitude + 0.002 }), office, now)).toThrow(expect.objectContaining({ code: 'OUTSIDE_WORK_LOCATION' }));
  });

  it('compares IP addresses rather than their spelling', () => {
    expect(ipMatchesAllowed('203.0.113.10', '203.0.113.10')).toBe(true);
    expect(ipMatchesAllowed('203.0.113.77', '203.0.113.0/24')).toBe(true);
    expect(ipMatchesAllowed('2001:db8::1', '2001:0db8:0:0:0:0:0:1')).toBe(true);
    expect(ipMatchesAllowed('203.0.113.11', '203.0.113.10')).toBe(false);
    expect(ipMatchesAllowed('203.0.113.10', null)).toBe(false);
  });
});
