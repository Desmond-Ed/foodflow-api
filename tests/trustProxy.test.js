const { resolveTrustProxy } = require('../src/config/trustProxy');

describe('resolveTrustProxy', () => {
  it.each([
    [undefined, false],
    [null, false],
    ['', false],
    ['false', false],
    ['FALSE', false],
    ['False', false],
    ['0', false],
    [' 0 ', false],
    ['true', 1],
    ['TRUE', 1],
    ['True', 1],
    ['2', 2],
    [' 2 ', 2],
    ['10', 10],
    ['-1', false],
    ['1.5', false],
    ['abc', false],
    ['   ', false],
  ])('resolves %p to %p', (value, expected) => {
    expect(resolveTrustProxy(value)).toBe(expected);
  });
});
