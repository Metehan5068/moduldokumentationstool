import { expect, it } from 'vitest';
import { VisitTracker } from '../src/web/visit-tracker';
it('zählt erst nach drei Sekunden und beginnt nach einer Unterbrechung erneut', () => {
  const visits = new VisitTracker(0);
  expect(visits.update([13], true, 0)).toBe(0);
  expect(visits.update([13], true, 2999)).toBe(0);
  visits.update([], true, 2999);
  expect(visits.update([13], true, 4000)).toBe(0);
  expect(visits.update([13], true, 6999)).toBe(0);
  expect(visits.update([13], true, 7000)).toBe(13);
});
it('unterbricht bei unsichtbarem Tab und zählt Notizbearbeitung sofort', () => {
  const visits = new VisitTracker(2);
  visits.update([10], true, 0); visits.update([10], false, 2900);
  expect(visits.update([10], true, 5000)).toBe(2);
  expect(visits.update([10], true, 7999)).toBe(2);
  visits.edited(18); expect(visits.maximum).toBe(18);
  expect(visits.update([3], true, 10000)).toBe(18);
});
