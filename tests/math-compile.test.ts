import { describe, expect, it } from 'vitest';
import { compileMath } from '../src/web/math-compile';

describe('LaTeX-Formeln in Notizen', () => {
  it('kompiliert mehrere Formeln samt Quelltextpositionen auch in Stichpunkten', () => {
    const value = String.raw`- Bruch $\frac{1}{2}$ und $x^2$
    - Summe $$\sum_{i=1}^n i$$`;
    const result = compileMath(value);
    expect(result.failed).toBe(0);
    expect(result.formulas).toHaveLength(3);
    for (const formula of result.formulas) {
      expect(value.slice(formula.from, formula.to)).toBe(formula.source);
      expect(formula.html).toContain('class="katex');
    }
  });
  it('behält gültige Formeln bei ungültigem LaTeX und unvollständigen Begrenzern', () => {
    const result = compileMath(String.raw`$x$ $\frac{1}{$ $\unbekannt$ $offen`);
    expect(result.formulas.map((formula) => formula.source)).toEqual(['$x$']);
    expect(result.failed).toBe(3);
    expect(compileMath('$$').formulas).toEqual([]);
    expect(compileMath('$$$$').failed).toBe(1);
  });
  it('überspringt maskierte Dollarzeichen und unterstützt mehrzeilige Formeln', () => {
    expect(compileMath(String.raw`Preis \$5 und $x+\$1$`).formulas.map((formula) => formula.source)).toEqual([String.raw`$x+\$1$`]);
    expect(compileMath('$x\n+y$').formulas).toHaveLength(1);
    expect(compileMath('Nur Text')).toEqual({ formulas: [], failed: 0 });
  });
  it('erhält Textformatierungen und verschachtelte Mathematik in der Dollar-Umgebung', () => {
    const value = String.raw`- $$\textbf{Größe und $x^2$}$$
- $$\textit{Überwachtes Lernen}$$
- $$\textbf{Text mit \textit{Betonung}}+x^2$$`;
    const result = compileMath(value);
    expect(result.failed).toBe(0);
    expect(result.formulas).toHaveLength(3);
    expect(result.formulas[0]!.html).toContain('textbf');
    expect(result.formulas[1]!.html).toContain('textit');
    expect(result.formulas[2]!.html).toContain('textbf textit');
    for (const formula of result.formulas) expect(value.slice(formula.from, formula.to)).toBe(formula.source);
  });
  it('erfordert maskierte Unterstriche in Textbefehlen und erhält sie als sichtbaren Text', () => {
    expect(compileMath(String.raw`$\textbf{PF_* = AF_*}$`).failed).toBe(1);
    const source = String.raw`$\textbf{PF\_* = AF\_*}$`;
    const result = compileMath(source);
    expect(result.failed).toBe(0);
    expect(result.formulas).toHaveLength(1);
    expect(result.formulas[0]!.source).toBe(source);
    expect(result.formulas[0]!.html).toContain('textbf');
  });
  it('begrenzt Makroexpansionen und erlaubt keine HTML-Injektion', () => {
    expect(compileMath(String.raw`$\def\a{\a}\a$`).failed).toBe(1);
    const result = compileMath(String.raw`$\href{javascript:alert(1)}{x}$`);
    expect(result.formulas.every((formula) => !formula.html.includes('href="javascript:'))).toBe(true);
  });
});
