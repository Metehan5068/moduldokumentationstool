import katex from 'katex';

export interface CompiledFormula { from: number; to: number; source: string; html: string }
export interface MathCompilation { formulas: CompiledFormula[]; failed: number }

/** Dollar delimiters are kept in the document; escaped dollars remain ordinary text. */
export function compileMath(value: string): MathCompilation {
  const result: MathCompilation = { formulas: [], failed: 0 };
  const escaped = (position: number) => {
    let slashes = 0;
    while (position > 0 && value[--position] === '\\') slashes++;
    return slashes % 2 === 1;
  };
  for (let from = 0; from < value.length; from++) {
    if (value[from] !== '$' || escaped(from)) continue;
    const displayMode = value[from + 1] === '$';
    const width = displayMode ? 2 : 1;
    let close = from + width;
    while (close < value.length) {
      if (value[close] === '$' && !escaped(close) && (!displayMode || value[close + 1] === '$')) break;
      close++;
    }
    if (close === value.length) { result.failed++; break; }
    const to = close + width;
    const expression = value.slice(from + width, close);
    try {
      if (!expression.trim()) throw new Error('Empty formula');
      const html = katex.renderToString(expression, { displayMode, throwOnError: true, trust: false, maxExpand: 1000, maxSize: 20, strict: 'error' });
      result.formulas.push({ from, to, source: value.slice(from, to), html });
    } catch { result.failed++; }
    from = to - 1;
  }
  return result;
}
