import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeFreeText, sanitizeFreeTextFields, sanitizeHtml } from '../src/lib/sanitize.ts';

test('sanitizeFreeText strips script tags entirely', () => {
  const input = 'Hello<script>alert("xss")</script>World';
  const out = sanitizeFreeText(input);
  assert.equal(out.includes('<script'), false);
  assert.equal(out.includes('alert'), false);
  // Plain content survives
  assert.ok(out.includes('Hello'));
  assert.ok(out.includes('World'));
});

test('sanitizeFreeText strips img onerror handlers', () => {
  const input = '<img src=x onerror=alert(1)>';
  const out = sanitizeFreeText(input);
  assert.equal(out.includes('onerror'), false);
  assert.equal(out.includes('<img'), false);
});

test('sanitizeFreeText strips event handlers and inline styles', () => {
  const input = '<a href="javascript:alert(1)" onclick="alert(2)">click</a>';
  const out = sanitizeFreeText(input);
  assert.equal(out.includes('javascript:'), false);
  assert.equal(out.includes('onclick'), false);
  assert.equal(out.includes('<a'), false);
  // Visible text remains
  assert.ok(out.includes('click'));
});

test('sanitizeFreeText preserves plain text untouched', () => {
  const input = 'Build a REST API with proper auth & rate limiting.';
  assert.equal(sanitizeFreeText(input), input);
});

test('sanitizeFreeText preserves emoji and unicode', () => {
  const input = 'Ship it 🚀 — résumé attached';
  assert.equal(sanitizeFreeText(input), input);
});

test('sanitizeFreeTextFields only touches specified string fields', () => {
  const input = {
    title: '<script>x</script>Title',
    description: '<b>desc</b>',
    budgetMax: 1000n,
    skills: ['ts'],
    untouched: '<script>keep</script>',
  };
  const out = sanitizeFreeTextFields(input, ['title', 'description']);
  assert.equal(out.title.includes('<script'), false);
  assert.equal(out.description.includes('<b>'), false);
  // Non-string fields pass through unchanged
  assert.equal(out.budgetMax, 1000n);
  assert.deepEqual(out.skills, ['ts']);
  // Fields not listed are not sanitized
  assert.ok(out.untouched.includes('<script'));
});

test('sanitizeFreeTextFields skips non-string values silently', () => {
  const input = { title: undefined as string | undefined, count: 42 };
  const out = sanitizeFreeTextFields(input, ['title']);
  assert.equal(out.title, undefined);
  assert.equal(out.count, 42);
});

test('sanitizeHtml allows safe tags but blocks scripts and on* attrs', () => {
  const input = '<p>safe <b>bold</b><script>bad</script><img onerror="x" src="y"></p>';
  const out = sanitizeHtml(input);
  assert.equal(out.includes('<script'), false);
  assert.equal(out.includes('onerror'), false);
  assert.ok(out.includes('<p>'));
  assert.ok(out.includes('<b>bold</b>'));
});
