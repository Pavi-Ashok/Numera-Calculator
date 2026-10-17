const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, format, MATH, SYNTAX } = require('../src/engine.js');

const calc = (expr, opts) => format(evaluate(expr, opts));
const throwsWith = (expr, message, opts) =>
  assert.throws(() => evaluate(expr, opts), { message });

test('basic arithmetic and precedence', () => {
  assert.equal(calc('2+3×4'), '14');
  assert.equal(calc('(2+3)×4'), '20');
  assert.equal(calc('10−4÷2'), '8');
  assert.equal(calc('2*3-4/2'), '4');
  assert.equal(calc('7 mod 3'), '1');
});

test('powers, unary minus and associativity', () => {
  assert.equal(calc('2^3^2'), '512');
  assert.equal(calc('−2^2'), '-4');
  assert.equal(calc('(−2)^2'), '4');
  assert.equal(calc('2^−1'), '0.5');
  assert.equal(calc('3²'), '9');
  assert.equal(calc('2³'), '8');
  assert.equal(calc('4⁻¹'), '0.25');
  assert.equal(calc('27ʸ√3'), '3');
  assert.equal(calc('−8ʸ√3'), '-2');
});

test('implicit multiplication and constants', () => {
  assert.equal(calc('2π'), format(2 * Math.PI));
  assert.equal(calc('3(4+1)'), '15');
  assert.equal(calc('(1+1)(2+2)'), '8');
  assert.equal(calc('2sin(30)'), '1');
  assert.equal(calc('e'), format(Math.E));
  assert.equal(calc('Ans×2', { ans: 21 }), '42');
});

test('auto-closes missing parentheses', () => {
  assert.equal(calc('(2+3'), '5');
  assert.equal(calc('√(16'), '4');
  assert.equal(calc('sin(30'), '0.5');
});

test('trigonometry in all angle modes', () => {
  assert.equal(calc('sin(30)'), '0.5');
  assert.equal(calc('cos(60)'), '0.5');
  assert.equal(calc('sin(180)'), '0');
  assert.equal(calc('tan(45)'), '1');
  assert.equal(calc('sin(π/2)', { angle: 'rad' }), '1');
  assert.equal(calc('cos(π)', { angle: 'rad' }), '-1');
  assert.equal(calc('sin(π)', { angle: 'rad' }), '0');
  assert.equal(calc('sin(100)', { angle: 'grad' }), '1');
  assert.equal(calc('sin⁻¹(0.5)'), '30');
  assert.equal(calc('tan⁻¹(1)', { angle: 'rad' }), format(Math.PI / 4));
  assert.equal(calc('cos⁻¹(0)', { angle: 'grad' }), '100');
  throwsWith('tan(90)', MATH);
  throwsWith('sin⁻¹(2)', MATH);
});

test('hyperbolic functions', () => {
  assert.equal(calc('sinh(0)'), '0');
  assert.equal(calc('cosh(0)'), '1');
  assert.equal(calc('tanh⁻¹(0)'), '0');
  assert.equal(calc('sinh⁻¹(sinh(2))'), '2');
});

test('logs, roots and abs', () => {
  assert.equal(calc('log(1000)'), '3');
  assert.equal(calc('ln(e)'), '1');
  assert.equal(calc('log₂(8)'), '3');
  assert.equal(calc('√9'), '3');
  assert.equal(calc('∛(−27)'), '-3');
  assert.equal(calc('abs(−5)'), '5');
  assert.equal(calc('10^(2)'), '100');
  throwsWith('log(0)', MATH);
  throwsWith('ln(−1)', MATH);
  throwsWith('√(−1)', MATH);
});

test('factorial, permutations, combinations, percent', () => {
  assert.equal(calc('5!'), '120');
  assert.equal(calc('0!'), '1');
  assert.equal(calc('0.5!'), format(Math.sqrt(Math.PI) / 2));
  assert.equal(calc('5P2'), '20');
  assert.equal(calc('5C2'), '10');
  assert.equal(calc('52C5'), '2598960');
  assert.equal(calc('50%'), '0.5');
  assert.equal(calc('200×10%'), '20');
  throwsWith('(−1)!', MATH);
  throwsWith('2C5', MATH);
});

test('scientific notation input and formatting', () => {
  assert.equal(calc('2E3'), '2000');
  assert.equal(calc('1.5E-3'), '0.0015');
  assert.equal(calc('1.5E−3'), '0.0015');
  assert.equal(calc('0.1+0.2'), '0.3');
  assert.equal(calc('1/3'), '0.333333333333');
  assert.equal(calc('10^20'), '1E20');
  assert.equal(calc('10^−8'), '1E-8');
  assert.equal(calc(calc('2^60')), calc('2^60'));
});

test('errors', () => {
  throwsWith('1/0', MATH);
  throwsWith('5 mod 0', MATH);
  throwsWith('', SYNTAX);
  throwsWith('2+', SYNTAX);
  throwsWith('2)', SYNTAX);
  throwsWith('×3', SYNTAX);
  throwsWith('2E', SYNTAX);
  throwsWith('171!', MATH);
});

// ---------- real-world edge cases ----------

test('edge: floating point noise is hidden', () => {
  assert.equal(calc('0.1+0.2−0.3'), '0');
  assert.equal(calc('1−0.9−0.1'), '0');
  assert.equal(calc('0.1×3'), '0.3');
  assert.equal(calc('1.1×1.1'), '1.21');
  assert.equal(calc('0.7+0.1'), '0.8');
  assert.equal(calc('4.35×100'), '435');
  assert.equal(calc('1.005×1000'), '1005');
  assert.equal(calc('3×1.1'), '3.3');
  assert.equal(calc('100−99.99'), '0.01');
  assert.equal(calc('1÷3×3'), '1');
  assert.equal(calc('2÷3'), '0.666666666667');
});

test('edge: very large and very small numbers', () => {
  assert.equal(calc('1234567890123'), '1234567890123');
  assert.equal(calc('999999999999999'), '999999999999999');
  assert.equal(calc('999999999999999+1'), '1E15');
  assert.equal(calc('123456789×987654321'), '1.21932631113E17');
  assert.equal(calc('2^1023'), '8.98846567431E307');
  assert.equal(calc('170!'), '7.25741561531E306');
  assert.equal(calc('1E−400'), '0');
  assert.equal(calc('0.000001'), '0.000001');
  assert.equal(calc('0.0000001'), '1E-7');
  throwsWith('2^1024', MATH);
  throwsWith('1E308×10', MATH);
  throwsWith('1E400', MATH);
});

test('edge: percent behaves like a desktop calculator', () => {
  assert.equal(calc('200+10%'), '220');
  assert.equal(calc('200−10%'), '180');
  assert.equal(calc('50+50%'), '75');
  assert.equal(calc('200×10%'), '20');
  assert.equal(calc('200÷10%'), '2000');
  assert.equal(calc('10%'), '0.1');
  assert.equal(calc('200+(10%)'), '200.1');
  assert.equal(calc('5+5+10%'), '11');
});

test('edge: signs, negatives and powers', () => {
  assert.equal(calc('−5+3'), '-2');
  assert.equal(calc('2×−3'), '-6');
  assert.equal(calc('2−−3'), '5');
  assert.equal(calc('−(−4)'), '4');
  assert.equal(calc('(−2)^3'), '-8');
  assert.equal(calc('(−8)^(1/3)'), '-2');
  assert.equal(calc('(−32)^(1/5)'), '-2');
  assert.equal(calc('2^−2'), '0.25');
  assert.equal(calc('0^0'), '1');
  assert.equal(calc('−0'), '0');
  throwsWith('(−8)^0.5', MATH);
  throwsWith('0^−1', MATH);
});

test('edge: typos and malformed input', () => {
  throwsWith('1.2.3', SYNTAX);
  throwsWith('2..5', SYNTAX);
  throwsWith('()', SYNTAX);
  throwsWith('2()', SYNTAX);
  throwsWith('2×÷3', SYNTAX);
  throwsWith('sin(', SYNTAX);
  throwsWith('2E3E4', SYNTAX);
  throwsWith('abc', SYNTAX);
  assert.equal(calc('((((2))))'), '2');
  assert.equal(calc('3(((2'), '6');
  assert.equal(calc('007'), '7');
  assert.equal(calc('.5'), '0.5');
  assert.equal(calc('5.'), '5');
  assert.equal(calc(' 2 + 2 '), '4');
});

test('edge: trigonometry special angles', () => {
  assert.equal(calc('sin(−30)'), '-0.5');
  assert.equal(calc('cos(360)'), '1');
  assert.equal(calc('sin(450)'), '1');
  assert.equal(calc('sin(720)'), '0');
  assert.equal(calc('cos(120)'), '-0.5');
  assert.equal(calc('tan(135)'), '-1');
  assert.equal(calc('sin(1000000)'), '-0.984807753012');
  assert.equal(calc('sin(π÷6)', { angle: 'rad' }), '0.5');
  assert.equal(calc('cos(π÷3)', { angle: 'rad' }), '0.5');
  assert.equal(calc('tan(π)', { angle: 'rad' }), '0');
  assert.equal(calc('sin⁻¹(1)'), '90');
  assert.equal(calc('cos⁻¹(−1)'), '180');
  assert.equal(calc('cos(200)', { angle: 'grad' }), '-1');
  throwsWith('tan(270)', MATH);
  throwsWith('tan(−90)', MATH);
  throwsWith('cos⁻¹(1.0000001)', MATH);
});

test('edge: logs, roots and inverses round-trip', () => {
  assert.equal(calc('log(1)'), '0');
  assert.equal(calc('log(0.001)'), '-3');
  assert.equal(calc('log₂(1024)'), '10');
  assert.equal(calc('10^(log(7))'), '7');
  assert.equal(calc('e^(ln(5))'), '5');
  assert.equal(calc('√0'), '0');
  assert.equal(calc('√(1E−10)'), '0.00001');
  assert.equal(calc('√2^2'), '2');
  assert.equal(calc('16ʸ√4'), '2');
  assert.equal(calc('−16ʸ√4'), '-2');
  throwsWith('(−16)ʸ√4', MATH);
  throwsWith('8ʸ√0', MATH);
  throwsWith('log(−1)', MATH);
});

test('edge: factorial and combinatorics', () => {
  assert.equal(calc('1!'), '1');
  assert.equal(calc('3.5!'), '11.6317283966');
  assert.equal(calc('(−0.5)!'), format(Math.sqrt(Math.PI)));
  assert.equal(calc('0C0'), '1');
  assert.equal(calc('5C0'), '1');
  assert.equal(calc('5C5'), '1');
  assert.equal(calc('5P0'), '1');
  assert.equal(calc('10P10'), '3628800');
  assert.equal(calc('100C50'), '1.00891344546E29');
  throwsWith('(−3)!', MATH);
  throwsWith('5.5C2', MATH);
  throwsWith('5C(−1)', MATH);
});

test('edge: mod and mixed precedence', () => {
  assert.equal(calc('10 mod 3'), '1');
  assert.equal(calc('−7 mod 3'), '-1');
  assert.equal(calc('7.5 mod 2'), '1.5');
  assert.equal(calc('2+3×4^2'), '50');
  assert.equal(calc('(2+3)!'), '120');
  assert.equal(calc('2×3!'), '12');
  assert.equal(calc('2^3!'), '64');
  assert.equal(calc('5−3−1'), '1');
  assert.equal(calc('100÷10÷2'), '5');
  assert.equal(calc('3²³'), '729');
  assert.equal(calc('2sin(30)cos(60)'), '0.5');
  assert.equal(calc('2π²'), format(2 * Math.PI * Math.PI));
});
