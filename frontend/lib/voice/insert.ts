/** Appends text to a textarea that React controls inside a component we do not edit, so React's onChange sees it. */
export function appendToTextarea(el: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  const next = el.value.trim() ? `${el.value.trimEnd()} ${text}` : text;
  setter?.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
