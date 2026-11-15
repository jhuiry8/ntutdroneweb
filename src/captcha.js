// Self-hosted image CAPTCHA for the admin login.
//
// Characters are drawn as jittered SVG stroke paths (never as <text>), so the
// answer is not present in the page source. Each challenge is stored in KV with
// a short TTL and is single-use: it is deleted on the first verification
// attempt, whether or not the answer was correct.

export const CAPTCHA_TTL_SECONDS = 300;
const CAPTCHA_LENGTH = 5;
const WIDTH = 180;
const HEIGHT = 60;

// Stroke font on a 10 x 14 grid. Ambiguous glyphs (0/O, 1/I/L, 5/S, 2/Z, 8/B)
// are left out so the code is easy for people to read.
const GLYPHS = {
    '3': [[[0, 1], [9, 1], [4, 6], [9, 9], [8, 13], [0, 13]]],
    '4': [[[7, 13], [7, 1], [0, 9], [10, 9]]],
    '6': [[[8, 1], [2, 5], [0, 10], [2, 13], [8, 13], [10, 10], [8, 7], [1, 8]]],
    '7': [[[0, 1], [10, 1], [3, 13]]],
    '9': [[[9, 6], [2, 7], [0, 4], [2, 1], [8, 1], [10, 4], [8, 9], [2, 13]]],
    'A': [[[0, 13], [5, 1], [10, 13]], [[2, 8], [8, 8]]],
    'C': [[[10, 2], [7, 1], [3, 1], [0, 4], [0, 10], [3, 13], [7, 13], [10, 12]]],
    'E': [[[10, 1], [0, 1], [0, 13], [10, 13]], [[0, 7], [7, 7]]],
    'F': [[[10, 1], [0, 1], [0, 13]], [[0, 7], [7, 7]]],
    'G': [[[10, 2], [7, 1], [3, 1], [0, 4], [0, 10], [3, 13], [7, 13], [10, 11], [10, 7], [6, 7]]],
    'H': [[[0, 1], [0, 13]], [[10, 1], [10, 13]], [[0, 7], [10, 7]]],
    'J': [[[3, 1], [10, 1]], [[7, 1], [7, 11], [5, 13], [2, 13], [0, 11]]],
    'K': [[[0, 1], [0, 13]], [[10, 1], [0, 8]], [[3, 6], [10, 13]]],
    'M': [[[0, 13], [0, 1], [5, 8], [10, 1], [10, 13]]],
    'N': [[[0, 13], [0, 1], [10, 13], [10, 1]]],
    'P': [[[0, 13], [0, 1], [7, 1], [10, 3], [10, 5], [7, 7], [0, 7]]],
    'R': [[[0, 13], [0, 1], [7, 1], [10, 3], [10, 5], [7, 7], [0, 7]], [[5, 7], [10, 13]]],
    'T': [[[0, 1], [10, 1]], [[5, 1], [5, 13]]],
    'U': [[[0, 1], [0, 10], [3, 13], [7, 13], [10, 10], [10, 1]]],
    'V': [[[0, 1], [5, 13], [10, 1]]],
    'W': [[[0, 1], [2, 13], [5, 6], [8, 13], [10, 1]]],
    'X': [[[0, 1], [10, 13]], [[10, 1], [0, 13]]],
    'Y': [[[0, 1], [5, 7], [10, 1]], [[5, 7], [5, 13]]]
};
export const CAPTCHA_CHARSET = Object.keys(GLYPHS).join('');

function randomInt(max) {
    // Rejection sampling keeps the distribution uniform.
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do crypto.getRandomValues(buf); while (buf[0] >= limit);
    return buf[0] % max;
}
const randomRange = (min, max) => min + (randomInt(10000) / 10000) * (max - min);
const fmt = n => n.toFixed(1);

export function randomCaptchaCode(length = CAPTCHA_LENGTH) {
    let code = '';
    for (let i = 0; i < length; i++) code += CAPTCHA_CHARSET[randomInt(CAPTCHA_CHARSET.length)];
    return code;
}

export function renderCaptchaSvg(code) {
    const parts = [];
    const colors = ['#1d3557', '#6a040f', '#264653', '#3c096c', '#7f4f24', '#0b0c10'];

    // Background noise: curves that cross the glyph area.
    for (let i = 0; i < 6; i++) {
        const color = colors[randomInt(colors.length)];
        parts.push(`<path d="M${fmt(randomRange(0, 30))} ${fmt(randomRange(5, HEIGHT - 5))} Q${fmt(randomRange(40, 140))} ${fmt(randomRange(-20, HEIGHT + 20))} ${fmt(randomRange(150, WIDTH))} ${fmt(randomRange(5, HEIGHT - 5))}" stroke="${color}" stroke-opacity="0.35" stroke-width="${fmt(randomRange(1, 2))}" fill="none"/>`);
    }
    for (let i = 0; i < 40; i++) {
        parts.push(`<circle cx="${fmt(randomRange(0, WIDTH))}" cy="${fmt(randomRange(0, HEIGHT))}" r="${fmt(randomRange(0.6, 1.6))}" fill="${colors[randomInt(colors.length)]}" fill-opacity="0.45"/>`);
    }

    const slot = (WIDTH - 20) / code.length;
    [...code].forEach((char, index) => {
        const scale = randomRange(2.0, 2.4);
        const angle = randomRange(-0.35, 0.35);
        const skew = randomRange(-0.25, 0.25);
        const cx = 10 + slot * index + slot / 2 + randomRange(-4, 4);
        const cy = HEIGHT / 2 + randomRange(-5, 5);
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const transform = ([x, y]) => {
            // Centre the glyph, add per-point jitter, skew, rotate and scale.
            let px = (x - 5 + randomRange(-0.6, 0.6)) * scale;
            const py = (y - 7 + randomRange(-0.6, 0.6)) * scale;
            px += py * skew;
            return [cx + px * cos - py * sin, cy + px * sin + py * cos];
        };
        const d = GLYPHS[char].map(stroke => stroke.map((point, i) => {
            const [x, y] = transform(point);
            return `${i ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`;
        }).join(' ')).join(' ');
        parts.push(`<path d="${d}" stroke="${colors[randomInt(colors.length)]}" stroke-width="${fmt(randomRange(2.4, 3.2))}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`);
    });

    // A couple of strike-through lines drawn over the glyphs.
    for (let i = 0; i < 2; i++) {
        parts.push(`<path d="M0 ${fmt(randomRange(15, HEIGHT - 15))} C${fmt(randomRange(40, 80))} ${fmt(randomRange(0, HEIGHT))} ${fmt(randomRange(100, 140))} ${fmt(randomRange(0, HEIGHT))} ${WIDTH} ${fmt(randomRange(15, HEIGHT - 15))}" stroke="${colors[randomInt(colors.length)]}" stroke-opacity="0.6" stroke-width="1.6" fill="none"/>`);
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="驗證碼圖片"><rect width="100%" height="100%" fill="#f4f1e8"/>${parts.join('')}</svg>`;
}

export async function createCaptcha(kv) {
    const id = crypto.randomUUID();
    const code = randomCaptchaCode();
    await kv.put(`captcha:${id}`, code, { expirationTtl: CAPTCHA_TTL_SECONDS });
    return { id, svg: renderCaptchaSvg(code) };
}

export async function verifyCaptcha(kv, id, answer) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return false;
    const key = `captcha:${id}`;
    const expected = await kv.get(key);
    if (!expected) return false;
    await kv.delete(key); // single use
    const normalized = String(answer || '').replace(/\s+/g, '').toUpperCase();
    if (normalized.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < expected.length; i++) difference |= normalized.charCodeAt(i) ^ expected.charCodeAt(i);
    return difference === 0;
}
