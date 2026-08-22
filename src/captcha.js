import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const WIDTH = 300;
const HEIGHT = 110;

function pick(list) {
  return list[randomInt(list.length)];
}

function noiseLine() {
  const x1 = randomInt(0, WIDTH);
  const y1 = randomInt(0, HEIGHT);
  const x2 = randomInt(0, WIDTH);
  const y2 = randomInt(0, HEIGHT);
  const cx = randomInt(0, WIDTH);
  const cy = randomInt(0, HEIGHT);
  const color = pick(['#4b5563', '#6b7280', '#52525b', '#57534e']);
  return `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" stroke="${color}" stroke-width="${randomInt(1, 3)}" fill="none" opacity="0.55"/>`;
}

function noiseDot() {
  return `<circle cx="${randomInt(0, WIDTH)}" cy="${randomInt(0, HEIGHT)}" r="${randomInt(1, 3)}" fill="#6b7280" opacity="0.5"/>`;
}

export function generateCaptcha(length = 5) {
  const text = Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const step = WIDTH / (length + 1);
  const colors = ['#f87171', '#60a5fa', '#34d399', '#fbbf24', '#c084fc', '#22d3ee'];

  const glyphs = [...text]
    .map((char, i) => {
      const x = step * (i + 1) + randomInt(-8, 8);
      const y = HEIGHT / 2 + randomInt(-6, 14);
      const rotation = randomInt(-28, 28);
      const size = randomInt(38, 52);
      const skew = randomInt(-10, 10);
      return `<text x="${x}" y="${y}" font-family="Georgia,serif" font-size="${size}" font-weight="bold" fill="${colors[i % colors.length]}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rotation} ${x} ${y}) skewX(${skew})">${char}</text>`;
    })
    .join('');

  const lines = Array.from({ length: 7 }, noiseLine).join('');
  const dots = Array.from({ length: 45 }, noiseDot).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="codice di verifica"><rect width="${WIDTH}" height="${HEIGHT}" rx="12" fill="#111827"/>${lines}${glyphs}${dots}</svg>`;

  return { text, svg };
}
