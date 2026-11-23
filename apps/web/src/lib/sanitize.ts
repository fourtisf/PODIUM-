// Notification bodies are server HTML limited to <b>. Strip everything else before rendering.
export function onlyBold(html: string): string {
  return String(html)
    .replace(/<(?!\/?b>)[^>]*>/gi, '')
    .replace(/<(?!\/?b>)/gi, '&lt;');
}
