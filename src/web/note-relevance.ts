export const IRRELEVANT_NOTE = '- Nicht relevant';
export const isIrrelevantNote = (text: string) => /^-\s+nicht\s+relevant$/i.test(text.trim());
