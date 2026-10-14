import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseModelJSON, distillToCards, setOpenAiFallbackKey } from '../gemini';

describe('parseModelJSON (tolerant model-JSON parsing)', () => {
  it('parses plain JSON', () => {
    expect(parseModelJSON<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });
  it('strips ```json code fences', () => {
    expect(parseModelJSON('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it('extracts a JSON array from surrounding prose', () => {
    expect(parseModelJSON('Sure! Here you go:\n[{"term":"x"}]\nHope that helps')).toEqual([{ term: 'x' }]);
  });
  it('throws a helpful error on non-JSON', () => {
    expect(() => parseModelJSON('there is no json here')).toThrow();
  });
});

// --- Transport: retries, fallback, error messages --------------------------

const CARDS = [{ term: 'Allele', definition: 'A gene version.' }];
const gemini = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const openai = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const fail = (status: number, message: string) => new Response(JSON.stringify({ error: { message } }), { status });

function mockFetch(...responses: Response[]) {
  const fn = vi.fn(async () => responses.shift() ?? fail(500, 'no more mock responses'));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setOpenAiFallbackKey('');
});

describe('AI transport', () => {
  it('sends the key in a header, never in the URL', async () => {
    const fetchMock = mockFetch(gemini(JSON.stringify(CARDS)));
    await distillToCards('secret-key', 'text', 'en');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('secret-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key');
  });

  it('fails fast on a bad key with the provider message (no retries)', async () => {
    const fetchMock = mockFetch(fail(400, 'API key not valid'), gemini(JSON.stringify(CARDS)));
    await expect(distillToCards('bad', 'text', 'en')).rejects.toThrow('Gemini (400): API key not valid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient 503 once, then falls back to OpenAI when a key is set', async () => {
    vi.useFakeTimers();
    setOpenAiFallbackKey('sk-test');
    const fetchMock = mockFetch(fail(503, 'overloaded'), fail(503, 'overloaded'), openai(JSON.stringify(CARDS)));
    const result = distillToCards('k', 'text', 'en');
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual(CARDS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[2] as unknown as [string])[0]).toContain('api.openai.com');
  });

  it('without a fallback key, a persistent 503 surfaces after exactly two attempts', async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch(fail(503, 'overloaded'), fail(503, 'overloaded'), gemini('[]'));
    const result = distillToCards('k', 'text', 'en');
    const assertion = expect(result).rejects.toThrow('Gemini (503): overloaded');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks again once when the reply is not JSON', async () => {
    const fetchMock = mockFetch(gemini('Sorry, I cannot help.'), gemini(JSON.stringify(CARDS)));
    await expect(distillToCards('k', 'text', 'en')).resolves.toEqual(CARDS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
