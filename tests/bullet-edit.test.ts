import { describe, expect, it } from 'vitest';
import { bulletKeyEdit, enableBullets, type BulletEdit } from '../src/web/bullet-edit';

const apply = (value: string, edit: BulletEdit | undefined) => edit ? value.slice(0, edit.start) + edit.text + value.slice(edit.end) : value;
describe('Stichpunktbearbeitung', () => {
  it('aktiviert nur die aktuelle Zeile und erhält Auswahl, Einrückung und vorhandene Marker', () => {
    const value = 'Vorspann\n    Text bleibt';
    const edit = enableBullets(value, 15, 19)!;
    expect(apply(value, edit)).toBe('Vorspann\n    - Text bleibt');
    expect([edit.selectionStart, edit.selectionEnd]).toEqual([17, 21]);
    expect(enableBullets('- vorhanden', 4, 6)).toBeUndefined();
    expect(enableBullets('  * vorhanden', 5, 5)).toBeUndefined();
    expect(apply('\nText', enableBullets('\nText', 0, 0))).toBe('- \nText');
  });
  it('setzt auch leere und verschachtelte Punkte fort und ersetzt eine Auswahl wie Enter', () => {
    for (const value of ['- ', '    - ', '    - Text']) {
      const edit = bulletKeyEdit(value, value.length, value.length, 'Enter')!;
      expect(apply(value, edit)).toBe(`${value}\n${value.match(/^ */)![0]}- `);
      expect(edit.selectionStart).toBe(apply(value, edit).length);
    }
    expect(apply('- abcdef', bulletKeyEdit('- abcdef', 3, 6, 'Enter'))).toBe('- a\n- ef');
    expect(bulletKeyEdit('Prosa', 3, 3, 'Enter')).toBeUndefined();
    expect(bulletKeyEdit('- Text', 0, 0, 'Enter')).toBeUndefined();
  });
  it('erhält mehrzeilige Auswahl beim Ein-/Ausrücken und schließt die folgende Zeile aus', () => {
    const value = '- eins\n- zwei\nProsa';
    const indent = bulletKeyEdit(value, 2, 14, 'Tab')!;
    expect(apply(value, indent)).toBe('    - eins\n    - zwei\nProsa');
    expect([indent.selectionStart, indent.selectionEnd]).toEqual([6, 22]);
    const outdent = bulletKeyEdit(apply(value, indent), indent.selectionStart, indent.selectionEnd, 'Tab', true)!;
    expect(apply(apply(value, indent), outdent)).toBe(value);
    expect([outdent.selectionStart, outdent.selectionEnd]).toEqual([2, 14]);
    const insideIndent = bulletKeyEdit('    - Punkt', 2, 2, 'Tab', true)!;
    expect(insideIndent.selectionStart).toBe(0);
  });
  it('rückt nur leere Punkte aus und schützt den Punkt in der ersten Zeile', () => {
    const nested = bulletKeyEdit('    - ', 6, 6, 'Backspace')!;
    expect(apply('    - ', nested)).toBe('- ');
    expect(nested.selectionStart).toBe(2);
    for (const value of ['- ', '* ', '+ ']) {
      for (let repeat = 0; repeat < 3; repeat++) {
        const unchanged = bulletKeyEdit(value, value.length, value.length, 'Backspace')!;
        expect(unchanged).toBeDefined();
        expect(apply(value, unchanged)).toBe(value);
        expect([unchanged.selectionStart, unchanged.selectionEnd]).toEqual([value.length, value.length]);
      }
    }
    expect(bulletKeyEdit('- Text', 6, 6, 'Backspace')).toBeUndefined();
    expect(bulletKeyEdit('- ', 0, 2, 'Backspace')).toBeUndefined();
  });
  it('entfernt leere Punkte auf oberster Ebene und setzt den Cursor ans Ende der vorherigen Zeile', () => {
    for (const previous of ['Vorher', '- Vorher', '    - Unterpunkt', '- ', '']) {
      for (const marker of ['- ', '* ', '+ ']) {
        const value = `${previous}\n${marker}\n- Danach`;
        const position = previous.length + 1 + marker.length;
        const edit = bulletKeyEdit(value, position, position, 'Backspace')!;
        expect(apply(value, edit)).toBe(`${previous}\n- Danach`);
        expect([edit.selectionStart, edit.selectionEnd]).toEqual([previous.length, previous.length]);
      }
    }
    const value = '- Vorher\n- ';
    expect(apply(value, bulletKeyEdit(value, value.length, value.length, 'Backspace'))).toBe('- Vorher');
  });
  it('erzeugt Fortsetzungszeilen mit Umschalt+Enter und nimmt danach die Liste wieder auf', () => {
    const value = '    - Punkt';
    const continuation = apply(value, bulletKeyEdit(value, value.length, value.length, 'Enter', true));
    expect(continuation).toBe('    - Punkt\n      ');
    const typed = `${continuation}Fortsetzung`;
    expect(apply(typed, bulletKeyEdit(typed, typed.length, typed.length, 'Enter'))).toBe(`${typed}\n    - `);
  });
});
