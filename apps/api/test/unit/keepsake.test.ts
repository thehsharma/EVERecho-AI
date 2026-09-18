import { it, expect } from 'vitest';
import { renderKeepsake } from '../../src/lib/keepsake';
it('renders an offline collection without interpreting any family text as HTML', () => {
  const attack = '<script>alert("x")</script>';
  const html = renderKeepsake(attack, attack, [
    { id: 'story', title: attack, body: attack, date: null, place: attack, sources: [attack] },
  ]);
  expect(html).not.toContain('<script>');
  expect(html.match(/&lt;script&gt;/g)).toHaveLength(7);
  expect(html).toContain('Content-Security-Policy');
  expect(html).toContain('does not include original audio');
});
