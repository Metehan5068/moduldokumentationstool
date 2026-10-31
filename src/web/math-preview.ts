import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { CompiledFormula } from './math-compile';
import 'katex/dist/katex.min.css';

export const showMath = StateEffect.define<CompiledFormula[]>();
export const hideMath = StateEffect.define<null>();

class FormulaWidget extends WidgetType {
  constructor(readonly formula: CompiledFormula) { super(); }
  eq(other: FormulaWidget) { return this.formula.source === other.formula.source; }
  toDOM(view: EditorView) {
    const element = document.createElement('span');
    element.className = 'note-formula';
    element.dataset.mathSource = this.formula.source;
    element.title = 'Formel anklicken, um den LaTeX-Quelltext zu bearbeiten';
    element.innerHTML = this.formula.html;
    element.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if (view.state.readOnly) return;
      view.dispatch({ effects: hideMath.of(null), selection: { anchor: this.formula.from + (this.formula.source.startsWith('$$') ? 2 : 1) } });
      view.focus();
    });
    return element;
  }
  ignoreEvent() { return true; }
}

export const mathPreview = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none;
    for (const effect of transaction.effects) {
      if (effect.is(hideMath)) value = Decoration.none;
      if (effect.is(showMath)) value = Decoration.set(effect.value.map((formula) => Decoration.replace({ widget: new FormulaWidget(formula) }).range(formula.from, formula.to)));
    }
    return value;
  },
  provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
});
