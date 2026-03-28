#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT = path.join(PROJECT_ROOT, "public", "assets", "saves", "savefile.json");
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, "public", "assets", "data", "sectionworld", "realmap-slice-test");
const DEFAULT_SECTION_RADIUS = 50;
const SECTION_DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 }
];

function parseArgs(argv) {
    const options = {
        input: DEFAULT_INPUT,
        output: DEFAULT_OUTPUT,
        sectionRadius: DEFAULT_SECTION_RADIUS,
        allowOverwrite: false
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--input" && argv[i + 1]) {
            options.input = path.resolve(PROJECT_ROOT, argv[++i]);
            continue;
        }
        if (arg === "--output" && argv[i + 1]) {
            options.output = path.resolve(PROJECT_ROOT, argv[++i]);
            continue;
        }
        if (arg === "--section-radius" && argv[i + 1]) {
            options.sectionRadius = Math.max(3, Math.floor(Number(argv[++i])) || DEFAULT_SECTION_RADIUS);
            continue;
        }
        if (arg === "--allow-overwrite") {
            options.allowOverwrite = true;
            continue;
        }
        if (arg === "--help" || arg === "-h") {
            printUsageAndExit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }

    return options;
}

function printUsageAndExit(code) {
    console.log("Usage: node scripts/slice-real-map.js [--input <savefile>] [--output <dir>] [--section-radius <n>] [--allow-overwrite]");
    process.exit(code);
}

function readJson(jsonPath) {
    return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
}

function makeSectionKey(coord) {
    return `${Number(coord.q) || 0},${Number(coord.r) || 0}`;
}

function evenQOffsetToAxial(x, y) {
    return {
        q: x,
        r: y - ((x + (x & 1)) / 2)
    };
}

function axialToEvenQOffset(coord) {
    const q = Number(coord.q) || 0;
    const r = Number(coord.r) || 0;
    return {
        x: q,
        y: r + ((q + (q & 1)) / 2)
    };
}

function offsetToWorld(offsetCoord) {
    const x = Number(offsetCoord && offsetCoord.x) || 0;
    const y = Number(offsetCoord && offsetCoord.y) || 0;
    return {
        x: x * 0.866,
        y: y + (x % 2 === 0 ? 0.5 : 0)
    };
}

function axialDistance(a, b) {
    const aq = Number(a.q) || 0;
    const ar = Number(a.r) || 0;
    const as = -aq - ar;
    const bq = Number(b.q) || 0;
    const br = Number(b.r) || 0;
    const bs = -bq - br;
    return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs));
}

function getSectionStride(radius) {
    return Math.max(1, Math.floor(Number(radius) || 1) * 2 - 1);
}

function getSectionBasisVectors(radius) {
    const sectionRadius = Math.max(1, Math.floor(Number(radius)) || 1);
    return {
        qAxis: {
            q: getSectionStride(sectionRadius),
            r: -(sectionRadius - 1)
        },
        rAxis: {
            q: sectionRadius - 1,
            r: sectionRadius
        }
    };
}

function computeSectionCenterAxial(sectionCoord, basis, anchorCenter) {
    return {
        q: (Number(anchorCenter && anchorCenter.q) || 0)
            + ((Number(sectionCoord && sectionCoord.q) || 0) * (Number(basis && basis.qAxis && basis.qAxis.q) || 0))
            + ((Number(sectionCoord && sectionCoord.r) || 0) * (Number(basis && basis.rAxis && basis.rAxis.q) || 0)),
        r: (Number(anchorCenter && anchorCenter.r) || 0)
            + ((Number(sectionCoord && sectionCoord.q) || 0) * (Number(basis && basis.qAxis && basis.qAxis.r) || 0))
            + ((Number(sectionCoord && sectionCoord.r) || 0) * (Number(basis && basis.rAxis && basis.rAxis.r) || 0))
    };
}

function cloneJsonValue(value) {
    return JSON.parse(JSON.stringify(value));
}

function decodeGroundTextureAt(encoded, x, y) {
    if (!encoded || encoded.encoding !== "base36-char-grid" || typeof encoded.data !== "string") {
        return 0;
    }
    const width = Number(encoded.width) || 0;
    const height = Number(encoded.height) || 0;
    if (x < 0 || x >= width || y < 0 || y >= height) return 0;
    const index = (y * width) + x;
    const char = encoded.data[index];
    const parsed = parseInt(char, 36);
    return Number.isFinite(parsed) ? parsed : 0;
}

function invertBasis(delta, basis) {
    const a = Number(basis && basis.qAxis && basis.qAxis.q) || 0;
    const b = Number(basis && basis.rAxis && basis.rAxis.q) || 0;
    const c = Number(basis && basis.qAxis && basis.qAxis.r) || 0;
    const d = Number(basis && basis.rAxis && basis.rAxis.r) || 0;
    const det = (a * d) - (b * c);
    if (!Number.isFinite(det) || det === 0) {
        return { q: 0, r: 0 };
    }
    return {
        q: ((delta.q * d) - (b * delta.r)) / det,
        r: ((a * delta.r) - (delta.q * c)) / det
    };
}

function findOwningSectionCoord(axial, basis, anchorCenter, radius) {
    const delta = {
        q: (Number(axial.q) || 0) - (Number(anchorCenter.q) || 0),
        r: (Number(axial.r) || 0) - (Number(anchorCenter.r) || 0)
    };
    const estimate = invertBasis(delta, basis);
    const baseQ = Math.round(estimate.q);
    const baseR = Math.round(estimate.r);

    let bestCoord = null;
    let bestDistance = Infinity;
    for (let searchRadius = 2; searchRadius <= 6; searchRadius++) {
        for (let dq = -searchRadius; dq <= searchRadius; dq++) {
            for (let dr = -searchRadius; dr <= searchRadius; dr++) {
                const candidate = { q: baseQ + dq, r: baseR + dr };
                const centerAxial = computeSectionCenterAxial(candidate, basis, anchorCenter);
                const distance = axialDistance(axial, centerAxial);
                if (
                    distance < bestDistance ||
                    (distance === bestDistance && bestCoord && (candidate.q < bestCoord.q || (candidate.q === bestCoord.q && candidate.r < bestCoord.r)))
                ) {
                    bestCoord = candidate;
                    bestDistance = distance;
                }
            }
        }
        if (bestCoord && bestDistance <= (radius - 1)) {
            return bestCoord;
        }
    }

    if (!bestCoord) {
        throw new Error(`Unable to find owning section for tile ${axial.q},${axial.r}`);
    }
    return bestCoord;
}

function buildEmptySectionAsset(coord, basis, anchorCenter) {
    const key = makeSectionKey(coord);
    const centerAxial = computeSectionCenterAxial(coord, basis, anchorCenter);
    const centerOffset = axialToEvenQOffset(centerAxial);
    const centerWorld = offsetToWorld(centerOffset);
    return {
        id: key,
        key,
        coord: { q: coord.q, r: coord.r },
        centerAxial,
        centerOffset,
        centerWorld,
        neighborKeys: new Array(6).fill(null),
        tileCoordKeys: [],
        groundTextureId: 0,
        groundTiles: {},
        walls: [],
        blockedEdges: [],
        clearanceByTile: {},
        objects: [],
        animals: [],
        powerups: []
    };
}

function getOrCreateSectionAsset(sectionAssetsByKey, coord, basis, anchorCenter) {
    const key = makeSectionKey(coord);
    if (!sectionAssetsByKey.has(key)) {
        sectionAssetsByKey.set(key, buildEmptySectionAsset(coord, basis, anchorCenter));
    }
    return sectionAssetsByKey.get(key);
}

function worldPointToOffset(worldX, worldY) {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
    const approxX = Math.round(worldX / 0.866);
    const approxY = Math.round(worldY - (approxX % 2 === 0 ? 0.5 : 0));
    return { x: approxX, y: approxY };
}

function getWallRecordRepresentativeWorldPoint(record) {
    const start = record && record.startPoint;
    const end = record && record.endPoint;
    const points = [];

    function collectEndpointWorld(endpoint) {
        if (!endpoint || typeof endpoint !== "object") return;
        if (Number.isFinite(endpoint.x) && Number.isFinite(endpoint.y)) {
            points.push({ x: Number(endpoint.x), y: Number(endpoint.y) });
            return;
        }
        if (endpoint.kind === "node" && Number.isFinite(endpoint.xindex) && Number.isFinite(endpoint.yindex)) {
            points.push(offsetToWorld({ x: Number(endpoint.xindex), y: Number(endpoint.yindex) }));
        }
        if (
            endpoint.kind === "midpoint" &&
            endpoint.a &&
            endpoint.b &&
            Number.isFinite(endpoint.a.xindex) &&
            Number.isFinite(endpoint.a.yindex) &&
            Number.isFinite(endpoint.b.xindex) &&
            Number.isFinite(endpoint.b.yindex)
        ) {
            const a = offsetToWorld({ x: Number(endpoint.a.xindex), y: Number(endpoint.a.yindex) });
            const b = offsetToWorld({ x: Number(endpoint.b.xindex), y: Number(endpoint.b.yindex) });
            points.push({ x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 });
        }
    }

    collectEndpointWorld(start);
    collectEndpointWorld(end);
    if (points.length === 0) return null;

    let sumX = 0;
    let sumY = 0;
    for (const point of points) {
        sumX += point.x;
        sumY += point.y;
    }
    return { x: sumX / points.length, y: sumY / points.length };
}

function getObjectOwnerSectionCoord(record, basis, anchorCenter, radius) {
    if (!record || typeof record !== "object") return null;
    let offset = null;
    if (record.type === "wallSection") {
        const worldPoint = getWallRecordRepresentativeWorldPoint(record);
        if (worldPoint) {
            offset = worldPointToOffset(worldPoint.x, worldPoint.y);
        }
    } else if (Number.isFinite(record.x) && Number.isFinite(record.y)) {
        offset = worldPointToOffset(Number(record.x), Number(record.y));
    }
    if (!offset) return null;
    const axial = evenQOffsetToAxial(offset.x, offset.y);
    return findOwningSectionCoord(axial, basis, anchorCenter, radius);
}

function assignNeighbors(sectionAssetsByKey) {
    for (const asset of sectionAssetsByKey.values()) {
        asset.neighborKeys = SECTION_DIRECTIONS.map((direction) => {
            const neighborCoord = {
                q: asset.coord.q + direction.q,
                r: asset.coord.r + direction.r
            };
            const neighborKey = makeSectionKey(neighborCoord);
            return sectionAssetsByKey.has(neighborKey) ? neighborKey : null;
        });
    }
}

function sortSectionAssets(sectionAssetsByKey) {
    return Array.from(sectionAssetsByKey.values()).sort((a, b) => {
        if (a.coord.q !== b.coord.q) return a.coord.q - b.coord.q;
        return a.coord.r - b.coord.r;
    });
}

function writeSectionWorld(outputDir, manifest, bundle) {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    fs.writeFileSync(path.join(outputDir, "bundle.json"), JSON.stringify(bundle, null, 2), "utf8");
    for (const section of bundle.sections) {
        fs.writeFileSync(
            path.join(outputDir, `${section.coord.q},${section.coord.r}.json`),
            JSON.stringify(section, null, 2),
            "utf8"
        );
    }
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.input)) {
        throw new Error(`Input save file not found: ${options.input}`);
    }
    if (fs.existsSync(options.output) && !options.allowOverwrite) {
        throw new Error(`Output directory already exists: ${options.output}`);
    }

    const saveData = readJson(options.input);
    const encodedGround = saveData && saveData.groundTiles;
    const width = Number(encodedGround && encodedGround.width) || 0;
    const height = Number(encodedGround && encodedGround.height) || 0;
    if (!width || !height) {
        throw new Error("Save file does not contain a valid ground tile grid");
    }

    const radius = options.sectionRadius;
    const basis = getSectionBasisVectors(radius);
    const anchorOffset = {
        x: Math.max(0, Math.floor(width * 0.5)),
        y: Math.max(0, Math.floor(height * 0.5))
    };
    const anchorCenter = evenQOffsetToAxial(anchorOffset.x, anchorOffset.y);
    const sectionAssetsByKey = new Map();

    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const axial = evenQOffsetToAxial(x, y);
            const ownerCoord = findOwningSectionCoord(axial, basis, anchorCenter, radius);
            const asset = getOrCreateSectionAsset(sectionAssetsByKey, ownerCoord, basis, anchorCenter);
            const coordKey = `${x},${y}`;
            asset.tileCoordKeys.push(coordKey);
            asset.groundTiles[coordKey] = decodeGroundTextureAt(encodedGround, x, y);
        }
    }

    const staticObjects = Array.isArray(saveData.staticObjects) ? saveData.staticObjects : [];
    for (const record of staticObjects) {
        if (!record || typeof record !== "object" || typeof record.type !== "string") continue;
        const ownerCoord = getObjectOwnerSectionCoord(record, basis, anchorCenter, radius);
        if (!ownerCoord) continue;
        const asset = getOrCreateSectionAsset(sectionAssetsByKey, ownerCoord, basis, anchorCenter);
        if (record.type === "wallSection") {
            asset.walls.push(cloneJsonValue(record));
        } else {
            asset.objects.push(cloneJsonValue(record));
        }
    }

    const animals = Array.isArray(saveData.animals) ? saveData.animals : [];
    for (const record of animals) {
        const ownerCoord = getObjectOwnerSectionCoord(record, basis, anchorCenter, radius);
        if (!ownerCoord) continue;
        const asset = getOrCreateSectionAsset(sectionAssetsByKey, ownerCoord, basis, anchorCenter);
        asset.animals.push(cloneJsonValue(record));
    }

    const powerups = Array.isArray(saveData.powerups) ? saveData.powerups : [];
    for (const record of powerups) {
        const ownerCoord = getObjectOwnerSectionCoord(record, basis, anchorCenter, radius);
        if (!ownerCoord) continue;
        const asset = getOrCreateSectionAsset(sectionAssetsByKey, ownerCoord, basis, anchorCenter);
        asset.powerups.push(cloneJsonValue(record));
    }

    assignNeighbors(sectionAssetsByKey);
    const orderedSections = sortSectionAssets(sectionAssetsByKey);
    for (const section of orderedSections) {
        section.tileCoordKeys.sort((a, b) => {
            const [ax, ay] = a.split(",").map(Number);
            const [bx, by] = b.split(",").map(Number);
            if (ax !== bx) return ax - bx;
            return ay - by;
        });
    }

    const wizardSectionCoord = saveData && saveData.wizard
        ? getObjectOwnerSectionCoord(saveData.wizard, basis, anchorCenter, radius)
        : null;
    const manifest = {
        source: {
            input: path.relative(PROJECT_ROOT, options.input),
            width,
            height
        },
        wizard: saveData && saveData.wizard && Number.isFinite(saveData.wizard.x) && Number.isFinite(saveData.wizard.y)
            ? {
                x: Number(saveData.wizard.x),
                y: Number(saveData.wizard.y)
            }
            : null,
        activeCenterKey: wizardSectionCoord ? makeSectionKey(wizardSectionCoord) : "",
        sectionRadius: radius,
        sectionCount: orderedSections.length
    };
    const bundle = {
        radius,
        anchorCenter,
        manifest,
        sections: orderedSections
    };

    writeSectionWorld(options.output, manifest, bundle);

    console.log(JSON.stringify({
        ok: true,
        output: path.relative(PROJECT_ROOT, options.output),
        sectionRadius: radius,
        sectionCount: orderedSections.length,
        tileCount: width * height,
        objectCount: staticObjects.length,
        animalCount: animals.length,
        powerupCount: powerups.length,
        activeCenterKey: manifest.activeCenterKey
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
}
