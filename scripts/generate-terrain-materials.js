"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT_DIR = path.join(__dirname, "..", "public", "assets", "images", "terrain", "materials");
const SIZE = 512;
const PREVIEW_TILES = 3;

const MATERIALS = [
    { name: "grass", renderer: renderGrass },
    { name: "sand", renderer: renderSand },
    { name: "water", renderer: renderWater }
];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

function hash2(x, y, seed) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967295;
}

function periodicValueNoise(x, y, period, seed) {
    const px = Math.max(1, Math.floor(period));
    const py = px;
    const fx = ((x % px) + px) % px;
    const fy = ((y % py) + py) % py;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = (x0 + 1) % px;
    const y1 = (y0 + 1) % py;
    const tx = smoothstep(fx - x0);
    const ty = smoothstep(fy - y0);
    const a = hash2(x0, y0, seed);
    const b = hash2(x1, y0, seed);
    const c = hash2(x0, y1, seed);
    const d = hash2(x1, y1, seed);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function octaveNoise(u, v, basePeriod, seed, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let ampSum = 0;
    for (let i = 0; i < octaves; i++) {
        const period = Math.max(2, Math.round(basePeriod * Math.pow(lacunarity, i)));
        sum += periodicValueNoise(u * period, v * period, period, seed + i * 1013) * amp;
        ampSum += amp;
        amp *= gain;
    }
    return ampSum > 0 ? sum / ampSum : 0;
}

function channel(value) {
    return clamp(Math.round(value), 0, 255);
}

function rgba(r, g, b, a = 255) {
    return [channel(r), channel(g), channel(b), channel(a)];
}

function mixColor(a, b, t) {
    return [
        lerp(a[0], b[0], t),
        lerp(a[1], b[1], t),
        lerp(a[2], b[2], t),
        lerp(a[3] === undefined ? 255 : a[3], b[3] === undefined ? 255 : b[3], t)
    ];
}

function renderSand(u, v) {
    const broad = octaveNoise(u, v, 5, 4001, 4, 2, 0.56);
    const grain = octaveNoise(u, v, 82, 4119, 3, 2, 0.48);
    const speckle = hash2(Math.floor(u * SIZE), Math.floor(v * SIZE), 4319);
    const rippleA = Math.sin(Math.PI * 2 * (u * 5 + v * 1.5 + 0.05 * octaveNoise(u, v, 8, 4561)));
    const rippleB = Math.sin(Math.PI * 2 * (u * 2 - v * 4 + 0.06 * octaveNoise(u, v, 10, 4591)));
    const ripple = (rippleA * 0.7 + rippleB * 0.3) * 0.5 + 0.5;
    let shade = (broad - 0.5) * 26 + (grain - 0.5) * 18 + (ripple - 0.5) * 11;
    if (speckle > 0.988) shade += 24;
    else if (speckle < 0.012) shade -= 20;
    const base = [187, 166, 92, 255];
    return rgba(base[0] + shade, base[1] + shade * 0.82, base[2] + shade * 0.42, 255);
}

function renderWater(u, v) {
    const depth = octaveNoise(u, v, 4, 8001, 4, 2, 0.58);
    const distortion = (octaveNoise(u, v, 12, 8017, 3, 2, 0.5) - 0.5) * 0.08;
    const wave1 = Math.sin(Math.PI * 2 * (u * 7 + v * 1 + distortion));
    const wave2 = Math.sin(Math.PI * 2 * (u * 3 - v * 6 + distortion * 1.3));
    const wave3 = Math.sin(Math.PI * 2 * (u * 13 + v * 5 + distortion * 0.6));
    const waves = wave1 * 0.48 + wave2 * 0.34 + wave3 * 0.18;
    const foam = Math.max(0, waves - 0.78);
    const base = mixColor([35, 132, 176, 255], [97, 201, 225, 255], depth);
    const shimmer = Math.max(0, Math.sin(Math.PI * 2 * (u * 18 + v * 2 + distortion)) - 0.72);
    return rgba(
        base[0] + waves * 12 + foam * 190 + shimmer * 85,
        base[1] + waves * 18 + foam * 170 + shimmer * 95,
        base[2] + waves * 23 + foam * 145 + shimmer * 70,
        255
    );
}

function renderGrass(u, v) {
    const broad = octaveNoise(u, v, 6, 1001, 4, 2, 0.55);
    const fine = octaveNoise(u, v, 48, 1103, 3, 2, 0.48);
    const blade = Math.sin(Math.PI * 2 * (u * 19 + v * 9 + 0.08 * octaveNoise(u, v, 9, 1217)));
    const fleck = hash2(Math.floor(u * SIZE), Math.floor(v * SIZE), 1301);
    let shade = (broad - 0.5) * 38 + (fine - 0.5) * 22 + blade * 5;
    if (fleck > 0.992) shade += 26;
    const base = [39, 113, 31, 255];
    return rgba(base[0] + shade * 0.48, base[1] + shade, base[2] + shade * 0.38, 255);
}

function makeImage(width, height, renderer) {
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        const v = y === height - 1 ? 0 : y / height;
        for (let x = 0; x < width; x++) {
            const u = x === width - 1 ? 0 : x / width;
            const [r, g, b, a] = renderer(u, v, x, y);
            const index = (y * width + x) * 4;
            data[index] = r;
            data[index + 1] = g;
            data[index + 2] = b;
            data[index + 3] = a;
        }
    }
    return { width, height, data };
}

function makePreview(source, tiles) {
    const width = source.width * tiles;
    const height = source.height * tiles;
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcX = x % source.width;
            const srcY = y % source.height;
            const srcIndex = (srcY * source.width + srcX) * 4;
            const dstIndex = (y * width + x) * 4;
            data[dstIndex] = source.data[srcIndex];
            data[dstIndex + 1] = source.data[srcIndex + 1];
            data[dstIndex + 2] = source.data[srcIndex + 2];
            data[dstIndex + 3] = source.data[srcIndex + 3];
        }
    }
    return { width, height, data };
}

function assertSeamless(image, label) {
    const maxDelta = 3;
    for (let y = 0; y < image.height; y++) {
        const left = (y * image.width) * 4;
        const right = (y * image.width + image.width - 1) * 4;
        for (let c = 0; c < 4; c++) {
            if (Math.abs(image.data[left + c] - image.data[right + c]) > maxDelta) {
                throw new Error(`${label} failed horizontal seam validation at row ${y}`);
            }
        }
    }
    for (let x = 0; x < image.width; x++) {
        const top = x * 4;
        const bottom = ((image.height - 1) * image.width + x) * 4;
        for (let c = 0; c < 4; c++) {
            if (Math.abs(image.data[top + c] - image.data[bottom + c]) > maxDelta) {
                throw new Error(`${label} failed vertical seam validation at column ${x}`);
            }
        }
    }
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let b = 0; b < 8; b++) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const typeBuffer = Buffer.from(type, "ascii");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
    return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(image) {
    const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(image.width, 0);
    ihdr.writeUInt32BE(image.height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const stride = image.width * 4;
    const raw = Buffer.alloc((stride + 1) * image.height);
    for (let y = 0; y < image.height; y++) {
        const rowStart = y * (stride + 1);
        raw[rowStart] = 0;
        image.data.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
    }
    return Buffer.concat([
        header,
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        pngChunk("IEND", Buffer.alloc(0))
    ]);
}

function writeImage(filePath, image) {
    fs.writeFileSync(filePath, encodePng(image));
}

function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const material of MATERIALS) {
        const image = makeImage(SIZE, SIZE, material.renderer);
        assertSeamless(image, material.name);
        const preview = makePreview(image, PREVIEW_TILES);
        writeImage(path.join(OUT_DIR, `${material.name}.png`), image);
        writeImage(path.join(OUT_DIR, `${material.name}-preview.png`), preview);
        console.log(`wrote ${material.name}.png and ${material.name}-preview.png`);
    }
}

main();
