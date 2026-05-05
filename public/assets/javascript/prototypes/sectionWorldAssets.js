(function (globalScope) {
    "use strict";

    function createSectionWorldAssetHelpers(deps) {
        const {
            hashCoordinatePair,
            hashToUnitFloat,
            offsetToWorld
        } = deps;

        function getPrototypeGroundTextureCount(map) {
            if (map && Array.isArray(map.groundTextures) && map.groundTextures.length > 0) {
                return map.groundTextures.length;
            }
            if (map && Array.isArray(map.groundPalette) && map.groundPalette.length > 0) {
                return map.groundPalette.length;
            }
            return 1;
        }

        function pickPrototypeGroundTextureId(x, y, textureCount) {
            const count = Math.max(1, Math.floor(Number(textureCount)) || 1);
            if (count <= 1) return 0;

            const patchHash = hashCoordinatePair(Math.floor((Number(x) || 0) / 5), Math.floor((Number(y) || 0) / 4), 11);
            const bandHash = hashCoordinatePair(Math.floor(((Number(x) || 0) - (Number(y) || 0)) / 6), Math.floor(((Number(x) || 0) + (Number(y) || 0)) / 6), 23);
            const detailHash = hashCoordinatePair(Number(x) || 0, Number(y) || 0, 41);
            const selector = hashToUnitFloat(hashCoordinatePair(Number(x) || 0, Number(y) || 0, 67));

            let chosenHash = patchHash;
            if (selector > 0.72) {
                chosenHash = detailHash;
            } else if (selector > 0.38) {
                chosenHash = bandHash;
            }

            return chosenHash % count;
        }

        function comparePrototypeTileCoordKeys(a, b) {
            const [axRaw, ayRaw] = String(a || "").split(",");
            const [bxRaw, byRaw] = String(b || "").split(",");
            const ax = Number(axRaw) || 0;
            const ay = Number(ayRaw) || 0;
            const bx = Number(bxRaw) || 0;
            const by = Number(byRaw) || 0;
            if (ay !== by) return ay - by;
            return ax - bx;
        }

        function sortPrototypeTileCoordKeys(tileCoordKeys) {
            if (!Array.isArray(tileCoordKeys)) return [];
            return tileCoordKeys.slice().sort(comparePrototypeTileCoordKeys);
        }

        function prototypeFloorWorldFromTileKey(tileKey) {
            const [xRaw, yRaw] = String(tileKey || "").split(",");
            const x = Number(xRaw);
            const y = Number(yRaw);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return { x: x * 0.866, y: y + (x % 2 === 0 ? 0.5 : 0) };
        }

        function getPrototypeFloorHexEdgeMidpoints(centerPoint) {
            const cx = Number(centerPoint && centerPoint.x);
            const cy = Number(centerPoint && centerPoint.y);
            if (!Number.isFinite(cx) || !Number.isFinite(cy)) return [];
            const halfColumnStep = 0.866 / 2;
            return [
                { x: cx, y: cy - 0.5 },
                { x: cx + halfColumnStep, y: cy - 0.25 },
                { x: cx + halfColumnStep, y: cy + 0.25 },
                { x: cx, y: cy + 0.5 },
                { x: cx - halfColumnStep, y: cy + 0.25 },
                { x: cx - halfColumnStep, y: cy - 0.25 }
            ];
        }

        function intersectPrototypeFloorBoundaryLines(pointA, normalA, pointB, normalB) {
            const a1 = Number(normalA && normalA.x) || 0;
            const b1 = Number(normalA && normalA.y) || 0;
            const c1 = (a1 * (Number(pointA && pointA.x) || 0)) + (b1 * (Number(pointA && pointA.y) || 0));
            const a2 = Number(normalB && normalB.x) || 0;
            const b2 = Number(normalB && normalB.y) || 0;
            const c2 = (a2 * (Number(pointB && pointB.x) || 0)) + (b2 * (Number(pointB && pointB.y) || 0));
            const det = (a1 * b2) - (a2 * b1);
            if (Math.abs(det) < 1e-9) return null;
            return {
                x: ((c1 * b2) - (c2 * b1)) / det,
                y: ((a1 * c2) - (a2 * c1)) / det
            };
        }

        function getPrototypeFloorHexBoundaryVertices(centerPoint) {
            return getPrototypeFloorHexEdgeMidpoints(centerPoint);
        }

        function getPrototypeFloorPointKey(point, precision = 1000000) {
            const x = Math.round((Number(point && point.x) || 0) * precision) / precision;
            const y = Math.round((Number(point && point.y) || 0) * precision) / precision;
            return `${x},${y}`;
        }

        function buildPrototypeFloorBoundaryPolygonFromTiles(tileCoordKeys) {
            const edgeMap = new Map();
            const pointByKey = new Map();
            for (let i = 0; i < tileCoordKeys.length; i++) {
                const centerPoint = prototypeFloorWorldFromTileKey(tileCoordKeys[i]);
                if (!centerPoint) continue;
                const ring = getPrototypeFloorHexEdgeMidpoints(centerPoint);
                if (ring.length < 3) continue;
                for (let r = 0; r < ring.length; r++) {
                    const a = ring[r];
                    const b = ring[(r + 1) % ring.length];
                    const aKey = getPrototypeFloorPointKey(a);
                    const bKey = getPrototypeFloorPointKey(b);
                    if (aKey === bKey) continue;
                    if (!pointByKey.has(aKey)) pointByKey.set(aKey, { x: Number(a.x), y: Number(a.y) });
                    if (!pointByKey.has(bKey)) pointByKey.set(bKey, { x: Number(b.x), y: Number(b.y) });
                    const edgeKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
                    const entry = edgeMap.get(edgeKey);
                    if (entry) {
                        entry.count += 1;
                    } else {
                        edgeMap.set(edgeKey, { aKey, bKey, count: 1 });
                    }
                }
            }

            const boundaryEdges = [];
            for (const edge of edgeMap.values()) {
                if (edge.count === 1) boundaryEdges.push(edge);
            }
            if (boundaryEdges.length < 3) return [];

            const adjacency = new Map();
            const pushNeighbor = (from, to) => {
                if (!adjacency.has(from)) adjacency.set(from, []);
                adjacency.get(from).push(to);
            };
            for (let i = 0; i < boundaryEdges.length; i++) {
                const edge = boundaryEdges[i];
                pushNeighbor(edge.aKey, edge.bKey);
                pushNeighbor(edge.bKey, edge.aKey);
            }

            const visitedEdges = new Set();
            const loops = [];
            for (let i = 0; i < boundaryEdges.length; i++) {
                const seed = boundaryEdges[i];
                const seedKey = seed.aKey < seed.bKey ? `${seed.aKey}|${seed.bKey}` : `${seed.bKey}|${seed.aKey}`;
                if (visitedEdges.has(seedKey)) continue;

                const loop = [];
                let start = seed.aKey;
                let prev = seed.aKey;
                let curr = seed.bKey;
                loop.push(pointByKey.get(start));
                loop.push(pointByKey.get(curr));
                visitedEdges.add(seedKey);

                for (let guard = 0; guard < boundaryEdges.length + 5; guard++) {
                    const neighbors = adjacency.get(curr) || [];
                    let next = null;
                    for (let n = 0; n < neighbors.length; n++) {
                        const candidate = neighbors[n];
                        if (candidate === prev) continue;
                        const candidateEdgeKey = candidate < curr ? `${candidate}|${curr}` : `${curr}|${candidate}`;
                        if (visitedEdges.has(candidateEdgeKey)) continue;
                        next = candidate;
                        break;
                    }
                    if (!next) {
                        if (neighbors.indexOf(start) !== -1) {
                            const closeEdgeKey = start < curr ? `${start}|${curr}` : `${curr}|${start}`;
                            if (!visitedEdges.has(closeEdgeKey)) visitedEdges.add(closeEdgeKey);
                        }
                        break;
                    }
                    const nextEdgeKey = next < curr ? `${next}|${curr}` : `${curr}|${next}`;
                    visitedEdges.add(nextEdgeKey);
                    prev = curr;
                    curr = next;
                    if (curr === start) break;
                    loop.push(pointByKey.get(curr));
                }

                if (loop.length >= 3) {
                    const deduped = [];
                    for (let p = 0; p < loop.length; p++) {
                        const point = loop[p];
                        if (!point) continue;
                        const last = deduped[deduped.length - 1];
                        if (!last || Math.abs(last.x - point.x) > 1e-9 || Math.abs(last.y - point.y) > 1e-9) {
                            deduped.push(point);
                        }
                    }
                    if (deduped.length >= 3) loops.push(deduped);
                }
            }

            if (loops.length === 0) return [];
            const area = (polygon) => {
                let sum = 0;
                for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                    const a = polygon[j];
                    const b = polygon[i];
                    sum += (Number(a && a.x) || 0) * (Number(b && b.y) || 0) - (Number(b && b.x) || 0) * (Number(a && a.y) || 0);
                }
                return Math.abs(sum) / 2;
            };
            loops.sort((a, b) => area(b) - area(a));
            return loops[0];
        }

        function prototypeFloorCross(a, b, c) {
            return ((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x));
        }

        function buildPrototypeFloorConvexHull(points) {
            if (!Array.isArray(points)) return [];
            const normalized = [];
            for (let i = 0; i < points.length; i++) {
                const point = points[i];
                const x = Number(point && point.x);
                const y = Number(point && point.y);
                if (Number.isFinite(x) && Number.isFinite(y)) normalized.push({ x, y });
            }
            normalized.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
            if (normalized.length <= 1) return normalized;
            const unique = [];
            for (let i = 0; i < normalized.length; i++) {
                const point = normalized[i];
                const prev = unique[unique.length - 1];
                if (!prev || Math.abs(prev.x - point.x) > 1e-9 || Math.abs(prev.y - point.y) > 1e-9) {
                    unique.push(point);
                }
            }
            if (unique.length <= 2) return unique;
            const lower = [];
            for (let i = 0; i < unique.length; i++) {
                while (lower.length >= 2 && prototypeFloorCross(lower[lower.length - 2], lower[lower.length - 1], unique[i]) <= 0) {
                    lower.pop();
                }
                lower.push(unique[i]);
            }
            const upper = [];
            for (let i = unique.length - 1; i >= 0; i--) {
                while (upper.length >= 2 && prototypeFloorCross(upper[upper.length - 2], upper[upper.length - 1], unique[i]) <= 0) {
                    upper.pop();
                }
                upper.push(unique[i]);
            }
            lower.pop();
            upper.pop();
            return lower.concat(upper);
        }

        function getPrototypeSectionFloorPolygon(asset) {
            if (!asset || typeof asset !== "object") return [];
            if (Array.isArray(asset._prototypeSectionFloorPolygon) && asset._prototypeSectionFloorPolygon.length >= 3) {
                return asset._prototypeSectionFloorPolygon;
            }
            const tileCoordKeys = Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys : [];
            const points = [];
            for (let i = 0; i < tileCoordKeys.length; i++) {
                const centerPoint = prototypeFloorWorldFromTileKey(tileCoordKeys[i]);
                if (!centerPoint) continue;
                const edgeMidpoints = getPrototypeFloorHexEdgeMidpoints(centerPoint);
                for (let j = 0; j < edgeMidpoints.length; j++) {
                    points.push(edgeMidpoints[j]);
                }
            }
            const hull = buildPrototypeFloorConvexHull(points);
            asset._prototypeSectionFloorPolygon = hull.length >= 3 ? hull : [];
            return asset._prototypeSectionFloorPolygon;
        }

        function normalizePrototypeGroundTiles(rawGroundTiles, tileCoordKeys, textureCount) {
            const count = Math.max(1, Math.floor(Number(textureCount)) || 1);
            const normalized = {};
            const coords = Array.isArray(tileCoordKeys) ? tileCoordKeys : [];
            const source = (rawGroundTiles && typeof rawGroundTiles === "object") ? rawGroundTiles : null;

            for (let i = 0; i < coords.length; i++) {
                const coordKey = coords[i];
                if (typeof coordKey !== "string" || coordKey.length === 0) continue;
                const [xRaw, yRaw] = coordKey.split(",");
                const fallbackTextureId = pickPrototypeGroundTextureId(Number(xRaw), Number(yRaw), count);
                const rawValue = source ? source[coordKey] : undefined;
                const nextTextureId = Number.isFinite(rawValue)
                    ? Math.max(0, Math.min(count - 1, Math.floor(Number(rawValue))))
                    : fallbackTextureId;
                normalized[coordKey] = nextTextureId;
            }

            return normalized;
        }

        function clonePrototypeBlockedEdges(rawBlockedEdges) {
            if (!Array.isArray(rawBlockedEdges)) return [];
            const cloned = [];
            for (let i = 0; i < rawBlockedEdges.length; i++) {
                const edge = rawBlockedEdges[i];
                if (!edge || typeof edge !== "object") continue;
                const a = edge.a && typeof edge.a === "object"
                    ? { xindex: Number(edge.a.xindex), yindex: Number(edge.a.yindex) }
                    : null;
                const b = edge.b && typeof edge.b === "object"
                    ? { xindex: Number(edge.b.xindex), yindex: Number(edge.b.yindex) }
                    : null;
                const recordId = Number(edge.recordId);
                if (!a || !b || !Number.isInteger(recordId)) continue;
                cloned.push({ recordId, a, b });
            }
            return cloned;
        }

        function clonePrototypeClearanceByTile(rawClearanceByTile) {
            if (!rawClearanceByTile || typeof rawClearanceByTile !== "object") return {};
            const cloned = {};
            const entries = Object.entries(rawClearanceByTile);
            for (let i = 0; i < entries.length; i++) {
                const [coordKey, rawValue] = entries[i];
                if (typeof coordKey !== "string" || coordKey.length === 0) continue;
                if (rawValue === null) {
                    cloned[coordKey] = null;
                    continue;
                }
                const numeric = Number(rawValue);
                cloned[coordKey] = Number.isFinite(numeric) ? numeric : null;
            }
            return cloned;
        }

        function clonePrototypePointList(points) {
            if (!Array.isArray(points)) return [];
            const cloned = [];
            for (let i = 0; i < points.length; i++) {
                const point = points[i];
                if (!point || typeof point !== "object") continue;
                cloned.push({
                    x: Number(point.x) || 0,
                    y: Number(point.y) || 0
                });
            }
            return cloned;
        }

        function clonePrototypePolygonList(polygons) {
            if (!Array.isArray(polygons)) return [];
            const cloned = [];
            for (let i = 0; i < polygons.length; i++) {
                const polygon = clonePrototypePointList(polygons[i]);
                if (polygon.length > 0) cloned.push(polygon);
            }
            return cloned;
        }

        function pointInPrototypeFloorPolygon2D(x, y, points) {
            if (!Array.isArray(points) || points.length < 3) return false;
            let inside = false;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                const xi = Number(points[i] && points[i].x) || 0;
                const yi = Number(points[i] && points[i].y) || 0;
                const xj = Number(points[j] && points[j].x) || 0;
                const yj = Number(points[j] && points[j].y) || 0;
                const intersect = ((yi > y) !== (yj > y))
                    && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-7) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }

        function bakePrototypeFloorFragmentTileCoordKeys(asset) {
            if (!asset || !Array.isArray(asset.floors) || !Array.isArray(asset.tileCoordKeys)) return;
            for (let i = 0; i < asset.floors.length; i++) {
                const fragment = asset.floors[i];
                if (!fragment || typeof fragment !== "object") continue;
                if (Array.isArray(fragment.tileCoordKeys) && fragment.tileCoordKeys.length > 0) continue;
                if (fragment._prototypeSynthesizedGround === true) {
                    fragment.tileCoordKeys = asset.tileCoordKeys.slice();
                    continue;
                }
                const outerPolygon = Array.isArray(fragment.outerPolygon) ? fragment.outerPolygon : [];
                if (outerPolygon.length < 3) continue;
                const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
                const baked = [];
                for (let t = 0; t < asset.tileCoordKeys.length; t++) {
                    const coordKey = asset.tileCoordKeys[t];
                    if (typeof coordKey !== "string" || coordKey.length === 0) continue;
                    const [xRaw, yRaw] = coordKey.split(",");
                    const nx = Number(xRaw);
                    const ny = Number(yRaw);
                    const wx = nx * 0.866;
                    const wy = ny + (nx % 2 === 0 ? 0.5 : 0);
                    if (!pointInPrototypeFloorPolygon2D(wx, wy, outerPolygon)) continue;
                    let inHole = false;
                    for (let h = 0; h < holes.length; h++) {
                        if (pointInPrototypeFloorPolygon2D(wx, wy, holes[h])) { inHole = true; break; }
                    }
                    if (!inHole) baked.push(coordKey);
                }
                fragment.tileCoordKeys = baked;
            }
        }

        function clonePrototypeFloorRecords(rawRecords, ownerSectionKey) {
            if (!Array.isArray(rawRecords)) return [];
            const sectionKey = (typeof ownerSectionKey === "string") ? ownerSectionKey : "";
            const cloned = [];
            for (let i = 0; i < rawRecords.length; i++) {
                const record = rawRecords[i];
                if (!record || typeof record !== "object") continue;
                const fragmentId = (typeof record.fragmentId === "string" && record.fragmentId.length > 0)
                    ? record.fragmentId
                    : ((typeof record.id === "string" && record.id.length > 0)
                        ? record.id
                        : `section:${sectionKey}:floor:${i}`);
                const level = Number.isFinite(record.level) ? Math.round(Number(record.level)) : 0;
                const canonicalBaseZ = level * 3;
                const explicitOffset = Number.isFinite(record.nodeBaseZOffset) ? Number(record.nodeBaseZOffset) : null;
                const legacyBaseZ = Number.isFinite(record.nodeBaseZ) ? Number(record.nodeBaseZ) : null;
                let resolvedOffset = 0;
                if (Number.isFinite(explicitOffset)) {
                    resolvedOffset = Number(explicitOffset);
                } else if (Number.isFinite(legacyBaseZ)) {
                    const looksLikeLegacyBug = Math.abs(Number(legacyBaseZ) - level) < 1e-6
                        && Math.abs(Number(legacyBaseZ) - canonicalBaseZ) > 1e-6;
                    resolvedOffset = looksLikeLegacyBug ? 0 : (Number(legacyBaseZ) - canonicalBaseZ);
                }
                cloned.push({
                    ...record,
                    fragmentId,
                    surfaceId: (typeof record.surfaceId === "string" && record.surfaceId.length > 0)
                        ? record.surfaceId
                        : fragmentId,
                    ownerSectionKey: (typeof record.ownerSectionKey === "string" && record.ownerSectionKey.length > 0)
                        ? record.ownerSectionKey
                        : sectionKey,
                    level,
                    nodeBaseZOffset: resolvedOffset,
                    nodeBaseZ: canonicalBaseZ + resolvedOffset,
                    outerPolygon: clonePrototypePointList(record.outerPolygon),
                    holes: clonePrototypePolygonList(record.holes),
                    visibilityPolygon: Array.isArray(record.visibilityPolygon) && record.visibilityPolygon.length > 0
                        ? clonePrototypePointList(record.visibilityPolygon)
                        : clonePrototypePointList(record.outerPolygon),
                    visibilityHoles: Array.isArray(record.visibilityHoles)
                        ? clonePrototypePolygonList(record.visibilityHoles)
                        : clonePrototypePolygonList(record.holes),
                    tileCoordKeys: sortPrototypeTileCoordKeys(record.tileCoordKeys)
                });
            }
            return cloned;
        }

        function clonePrototypeFloorHoleRecords(rawRecords) {
            if (!Array.isArray(rawRecords)) return [];
            return rawRecords
                .filter((record) => record && typeof record === "object")
                .map((record) => ({
                    ...record,
                    level: Number.isFinite(record.level) ? Number(record.level) : 0,
                    points: clonePrototypePointList(record.points),
                    tileCoordKeys: sortPrototypeTileCoordKeys(record.tileCoordKeys)
                }));
        }

        function clonePrototypeFloorVoidRecords(rawRecords) {
            if (!Array.isArray(rawRecords)) return [];
            return rawRecords
                .filter((record) => record && typeof record === "object")
                .map((record) => ({
                    ...record,
                    level: Number.isFinite(record.level) ? Number(record.level) : 0,
                    points: clonePrototypePointList(record.points),
                    holes: clonePrototypePolygonList(record.holes)
                }));
        }

        function clonePrototypeFloorTransitions(rawTransitions) {
            if (!Array.isArray(rawTransitions)) return [];
            const cloned = [];
            for (let i = 0; i < rawTransitions.length; i++) {
                const transition = rawTransitions[i];
                if (!transition || typeof transition !== "object") continue;
                cloned.push({
                    ...transition,
                    from: (transition.from && typeof transition.from === "object") ? { ...transition.from } : {},
                    to: (transition.to && typeof transition.to === "object") ? { ...transition.to } : {},
                    metadata: (transition.metadata && typeof transition.metadata === "object") ? { ...transition.metadata } : {}
                });
            }
            return cloned;
        }

        function createPrototypeImplicitGroundFloorFragment(asset) {
            if (!asset || typeof asset !== "object") return null;
            const outerPolygon = getPrototypeSectionFloorPolygon(asset).map(point => ({ ...point }));
            return {
                fragmentId: `section:${asset.key}:ground`,
                surfaceId: "overworld_ground_surface",
                ownerSectionKey: asset.key,
                level: 0,
                nodeBaseZ: 0,
                tileCoordKeys: Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys.slice() : [],
                outerPolygon,
                holes: [],
                visibilityPolygon: outerPolygon.map(point => ({ ...point })),
                visibilityHoles: [],
                _prototypeGroundFloor: true
            };
        }

        function ensurePrototypeLevel0FloorRecord(asset) {
            if (!asset || typeof asset !== "object") return false;
            if (!Array.isArray(asset.floors)) asset.floors = [];
            const sectionTileCoordKeys = sortPrototypeTileCoordKeys(asset.tileCoordKeys);
            let hasLevel0 = false;
            let changed = false;
            for (let i = 0; i < asset.floors.length; i++) {
                const fragment = asset.floors[i];
                if (!fragment || Number(fragment.level) !== 0) continue;
                hasLevel0 = true;
                const outer = Array.isArray(fragment.outerPolygon) ? fragment.outerPolygon : [];
                const fragmentTileCoordKeys = sortPrototypeTileCoordKeys(fragment.tileCoordKeys);
                const coversWholeSection = sectionTileCoordKeys.length > 0
                    && fragmentTileCoordKeys.length === sectionTileCoordKeys.length
                    && fragmentTileCoordKeys.every((key, index) => key === sectionTileCoordKeys[index]);
                if (fragment._prototypeSynthesizedGround === true
                    || fragment._prototypeGroundFloor === true
                    || coversWholeSection
                    || outer.length < 3) {
                    const ground = createPrototypeImplicitGroundFloorFragment(asset);
                    if (!ground) continue;
                    fragment.fragmentId = fragment.fragmentId || ground.fragmentId;
                    fragment.surfaceId = fragment.surfaceId || ground.surfaceId;
                    fragment.ownerSectionKey = fragment.ownerSectionKey || ground.ownerSectionKey;
                    fragment.nodeBaseZ = Number.isFinite(fragment.nodeBaseZ) ? fragment.nodeBaseZ : ground.nodeBaseZ;
                    fragment.tileCoordKeys = ground.tileCoordKeys.slice();
                    fragment.outerPolygon = ground.outerPolygon.map(point => ({ ...point }));
                    fragment.holes = Array.isArray(fragment.holes) ? fragment.holes : [];
                    fragment.visibilityPolygon = ground.visibilityPolygon.map(point => ({ ...point }));
                    fragment.visibilityHoles = Array.isArray(fragment.visibilityHoles) ? fragment.visibilityHoles : [];
                    fragment._prototypeGroundFloor = true;
                    delete fragment._prototypeSynthesizedGround;
                    changed = true;
                }
            }
            if (hasLevel0) return changed;
            const ground = createPrototypeImplicitGroundFloorFragment(asset);
            if (!ground) return false;
            asset.floors.unshift(ground);
            return true;
        }

        function applyRawPrototypeSectionAssetToStateAsset(asset, rawAsset, map) {
            if (!asset || !rawAsset || typeof rawAsset !== "object") return false;
            const textureCount = getPrototypeGroundTextureCount(map);
            asset.id = (typeof rawAsset.id === "string" && rawAsset.id.length > 0) ? rawAsset.id : asset.id;
            asset.coord = rawAsset.coord && typeof rawAsset.coord === "object"
                ? { q: Number(rawAsset.coord.q) || 0, r: Number(rawAsset.coord.r) || 0 }
                : asset.coord;
            asset.centerAxial = rawAsset.centerAxial && typeof rawAsset.centerAxial === "object"
                ? { q: Number(rawAsset.centerAxial.q) || 0, r: Number(rawAsset.centerAxial.r) || 0 }
                : asset.centerAxial;
            asset.centerOffset = rawAsset.centerOffset && typeof rawAsset.centerOffset === "object"
                ? { x: Number(rawAsset.centerOffset.x) || 0, y: Number(rawAsset.centerOffset.y) || 0 }
                : asset.centerOffset;
            asset.centerWorld = offsetToWorld(asset.centerOffset);
            asset.neighborKeys = Array.isArray(rawAsset.neighborKeys) ? rawAsset.neighborKeys.slice() : asset.neighborKeys;
            asset.tileCoordKeys = Array.isArray(rawAsset.tileCoordKeys)
                ? sortPrototypeTileCoordKeys(rawAsset.tileCoordKeys)
                : sortPrototypeTileCoordKeys(asset.tileCoordKeys);
            asset.groundTextureId = Number.isFinite(rawAsset.groundTextureId) ? Number(rawAsset.groundTextureId) : asset.groundTextureId;
            asset.groundTiles = normalizePrototypeGroundTiles(rawAsset.groundTiles, asset.tileCoordKeys, textureCount);
            asset.floors = clonePrototypeFloorRecords(rawAsset.floors, asset.key);
            ensurePrototypeLevel0FloorRecord(asset);
            asset.floorHoles = clonePrototypeFloorHoleRecords(rawAsset.floorHoles);
            asset.floorVoids = clonePrototypeFloorVoidRecords(rawAsset.floorVoids);
            bakePrototypeFloorFragmentTileCoordKeys(asset);
            asset.walls = Array.isArray(rawAsset.walls) ? rawAsset.walls.map((wall) => ({ ...wall })) : [];
            asset.blockedEdges = clonePrototypeBlockedEdges(rawAsset.blockedEdges);
            asset.clearanceByTile = clonePrototypeClearanceByTile(rawAsset.clearanceByTile);
            asset.objects = Array.isArray(rawAsset.objects) ? rawAsset.objects.map((obj) => ({ ...obj })) : [];
            asset.animals = Array.isArray(rawAsset.animals) ? rawAsset.animals.map((animal) => ({ ...animal })) : [];
            asset.powerups = Array.isArray(rawAsset.powerups) ? rawAsset.powerups.map((powerup) => ({ ...powerup })) : [];
            asset._prototypeBlockedEdgesDirty = !Array.isArray(rawAsset.blockedEdges)
                || (asset.blockedEdges.length === 0 && asset.walls.length > 0);
            asset._prototypeClearanceDirty = Object.keys(asset.clearanceByTile).length !== asset.tileCoordKeys.length;
            asset._prototypeSectionHydrated = true;
            asset._prototypeNamedObjectRecordIdByName = new Map();
            asset._prototypeNamedObjectConflictRecordIdsByName = new Map();
            return true;
        }

        return {
            applyRawPrototypeSectionAssetToStateAsset,
            bakePrototypeFloorFragmentTileCoordKeys,
            clonePrototypeBlockedEdges,
            clonePrototypeClearanceByTile,
            clonePrototypeFloorRecords,
            clonePrototypeFloorHoleRecords,
            clonePrototypeFloorVoidRecords,
            clonePrototypeFloorTransitions,
            createPrototypeImplicitGroundFloorFragment,
            comparePrototypeTileCoordKeys,
            ensurePrototypeLevel0FloorRecord,
            getPrototypeGroundTextureCount,
            normalizePrototypeGroundTiles,
            pickPrototypeGroundTextureId,
            sortPrototypeTileCoordKeys
        };
    }

    globalScope.__sectionWorldAssets = {
        createSectionWorldAssetHelpers,
        createPrototypeAssetHelpers: createSectionWorldAssetHelpers
    };
    globalScope.__twoSectionPrototypeAssets = globalScope.__sectionWorldAssets;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldAssets;
}
