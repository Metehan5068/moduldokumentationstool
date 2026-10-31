import { expect, type Locator } from '@playwright/test';

/** Read actual rendered text; all test documents fit within the editor's rendered viewport margin. */
export async function editorText(editor: Locator): Promise<string> {
  return editor.evaluate((element) => {
    if (element instanceof HTMLTextAreaElement) return element.value;
    return [...element.querySelectorAll('.cm-line')].map((line) => {
      const copy = line.cloneNode(true) as HTMLElement;
      copy.querySelectorAll<HTMLElement>('[data-math-source]').forEach((formula) => formula.replaceWith(formula.dataset.mathSource!));
      copy.querySelectorAll('.cm-placeholder,.cm-widgetBuffer').forEach((widget) => widget.remove());
      return copy.textContent ?? '';
    }).join('\n');
  });
}
export async function expectEditorText(editor: Locator, text: string) {
  await expect.poll(() => editorText(editor)).toBe(text);
}
export async function setEditorSelection(editor: Locator, start: number, end = start) {
  await editor.evaluate((element, offsets) => {
    if (element instanceof HTMLTextAreaElement) { element.setSelectionRange(offsets.start, offsets.end); return; }
    const lines = [...element.querySelectorAll('.cm-line')];
    const point = (offset: number): [Node, number] => {
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        const length = line.textContent?.length ?? 0;
        if (offset <= length || index === lines.length - 1) {
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (offset <= (node.textContent?.length ?? 0)) return [node, offset];
            offset -= node.textContent?.length ?? 0;
          }
          return [line, line.childNodes.length];
        }
        offset -= length + 1;
      }
      return [element, 0];
    };
    const anchor = point(offsets.start), head = point(offsets.end);
    document.getSelection()!.setBaseAndExtent(anchor[0], anchor[1], head[0], head[1]);
    document.dispatchEvent(new Event('selectionchange'));
  }, { start, end });
}
export async function editorSelection(editor: Locator) {
  return editor.evaluate((element) => {
    const selection = document.getSelection()!;
    const lines = [...element.querySelectorAll('.cm-line')];
    const offset = (node: Node | null, within: number) => {
      let total = 0;
      for (const line of lines) {
        if (node && line.contains(node)) {
          const range = document.createRange(); range.setStart(line, 0); range.setEnd(node, within);
          return total + (range.cloneContents().textContent?.length ?? 0);
        }
        total += (line.textContent?.length ?? 0) + 1;
      }
      return 0;
    };
    const anchor = offset(selection.anchorNode, selection.anchorOffset), head = offset(selection.focusNode, selection.focusOffset);
    return { start: Math.min(anchor, head), end: Math.max(anchor, head), text: selection.toString() };
  });
}
