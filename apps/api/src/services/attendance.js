import { BlockList, isIP } from 'node:net';
import { HttpError } from '../lib/errors.js';

// Check-in opens this long before a shift starts and closes when it ends.
export const CHECK_IN_OPENS_BEFORE_MINUTES = 60;
// Check-out stays open this long after a shift ends. Later corrections go
// through an explanation request reviewed by HR.
export const CHECK_OUT_CLOSES_AFTER_MINUTES = 240;
export const MAX_GPS_ACCURACY_METERS = 100;
export const MAX_GPS_FIX_AGE_MS = 2 * 60_000;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const EARTH_RADIUS_METERS = 6_371_008.8;

function wallClock(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

/** Calendar date (YYYY-MM-DD) of `instant` in `timeZone`. */
export function localDate(instant, timeZone) {
  const { year, month, day } = wallClock(instant, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The instant at which a wall-clock date and time (HH:MM[:SS]) occurs in `timeZone`. */
export function zonedTime(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second = 0] = time.split(':').map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const wall = wallClock(new Date(asUtc), timeZone);
  const offset = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - asUtc;
  return new Date(asUtc - offset);
}

/** [from, to) bounds of a YYYY-MM month in `timeZone`, as ISO strings. */
export function monthRange(month, timeZone) {
  const [year, monthNumber] = month.split('-').map(Number);
  const next = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
  return {
    from: zonedTime(`${month}-01`, '00:00', timeZone).toISOString(),
    to: zonedTime(`${next}-01`, '00:00', timeZone).toISOString()
  };
}

/** Start and end instants of a shift worked on `workDate`; overnight shifts end the next day. */
export function shiftWindow(workDate, shift, timeZone) {
  const start = zonedTime(workDate, shift.start_time, timeZone);
  let end = zonedTime(workDate, shift.end_time, timeZone);
  if (shift.is_overnight || end <= start) end = zonedTime(addDays(workDate, 1), shift.end_time, timeZone);
  return { start, end };
}

/**
 * The assignment a check-in at `now` belongs to. When windows overlap (an
 * overnight shift followed by an early shift), the later-starting one wins.
 */
export function assignmentForCheckIn(assignments, now, timeZone) {
  let match = null;
  for (const assignment of assignments) {
    const window = shiftWindow(assignment.work_date, assignment.work_shifts, timeZone);
    const opensAt = window.start.getTime() - CHECK_IN_OPENS_BEFORE_MINUTES * MINUTE_MS;
    const isOpen = now.getTime() >= opensAt && now.getTime() <= window.end.getTime();
    if (isOpen && (!match || window.start > match.window.start)) match = { assignment, window };
  }
  return match;
}

export function checkInStatus(window, shift, now) {
  const lateAfter = window.start.getTime() + (shift.late_grace_minutes ?? 0) * MINUTE_MS;
  return now.getTime() > lateAfter ? 'LATE' : 'NORMAL';
}

export function checkOutClosesAt(window) {
  return new Date(window.end.getTime() + CHECK_OUT_CLOSES_AFTER_MINUTES * MINUTE_MS);
}

export function distanceMeters(from, to) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(to.latitude - from.latitude);
  const dLng = radians(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Checks a device-reported GPS fix against the work location and returns the
 * distance to it. A device can fake its location, so a passing fix is a
 * signal that is stored for review, not proof of presence.
 */
export function assertGpsFix(fix, office, now) {
  if (Math.abs(now.getTime() - Date.parse(fix.capturedAt)) > MAX_GPS_FIX_AGE_MS) {
    throw new HttpError(422, 'Vị trí GPS đã cũ hoặc đồng hồ thiết bị bị lệch. Vui lòng thử lại.', 'GPS_FIX_STALE');
  }
  if (fix.accuracy > MAX_GPS_ACCURACY_METERS) {
    throw new HttpError(422, `Tín hiệu GPS chưa đủ chính xác (±${Math.round(fix.accuracy)}m). Vui lòng bật định vị chính xác và thử lại.`, 'GPS_INACCURATE');
  }
  const distance = distanceMeters(fix, office);
  if (distance > office.radius_meters) {
    throw new HttpError(403, `Bạn đang cách địa điểm làm việc khoảng ${Math.round(distance)}m, ngoài bán kính ${office.radius_meters}m cho phép.`, 'OUTSIDE_WORK_LOCATION');
  }
  return distance;
}

/** Compares addresses, not strings, so a CIDR range or an alternate IPv6 spelling still matches. */
export function ipMatchesAllowed(ip, allowed) {
  if (!ip || !allowed || !isIP(ip)) return false;
  const [address, prefix] = String(allowed).split('/');
  if (!isIP(address)) return false;
  const family = (value) => (isIP(value) === 6 ? 'ipv6' : 'ipv4');
  const rules = new BlockList();
  if (prefix === undefined) rules.addAddress(address, family(address));
  else rules.addSubnet(address, Number(prefix), family(address));
  return rules.check(ip, family(ip));
}
