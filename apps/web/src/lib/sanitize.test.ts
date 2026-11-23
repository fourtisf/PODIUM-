import { describe, expect, it } from 'vitest';
import { onlyBold } from './sanitize';

describe('onlyBold', () => {
  it('keeps <b> and drops every other tag', () => {
    expect(onlyBold('<b>Ann</b> passed you')).toBe('<b>Ann</b> passed you');
    expect(onlyBold('<img src=x onerror=alert(1)><b>hi</b>')).toBe('<b>hi</b>');
    expect(onlyBold('<script>alert(1)</script>ok')).toBe('alert(1)ok');
    expect(onlyBold('<b onclick="x()">no</b>')).toBe('no</b>');
    expect(onlyBold('<a href="javascript:1">x</a>')).toBe('x');
  });
  it('neutralises an unclosed tag', () => {
    expect(onlyBold('hello <img src=x onerror=alert(1)')).toBe('hello &lt;img src=x onerror=alert(1)');
  });
});
