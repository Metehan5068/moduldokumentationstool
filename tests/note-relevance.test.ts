import { expect, it } from 'vitest';
import { IRRELEVANT_NOTE, isIrrelevantNote } from '../src/web/note-relevance';

it('erkennt ausschließlich vollständige bestehende Nicht-relevant-Marker ohne Text umzuschreiben', () => {
  for (const text of [IRRELEVANT_NOTE, '- nicht relevant', '  -  NICHT\tRELEVANT\n']) expect(isIrrelevantNote(text)).toBe(true);
  for (const text of ['', 'Nicht relevant', '- nicht relevant, weil …', '- Nicht relevant\n- Frage', 'Vorher\n- Nicht relevant', '- Nicht relevante Informationen']) expect(isIrrelevantNote(text)).toBe(false);
});
