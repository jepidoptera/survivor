class Roof {
    static _depthMeshState = null;
    static DEFAULT_TEXTURE = "/assets/images/roofs/smallshingles.png";
    static _depthVs = `
precision mediump float;
attribute vec2 aVertexPosition;
attribute vec3 aDepthWorld;
attribute vec2 aUvs;
uniform vec2 uScreenSize;
uniform vec2 uCameraWorld;
uniform float uViewScale;
uniform float uXyRatio;
uniform vec2 uDepthRange;
uniform vec3 uModelOrigin;
uniform vec2 uWorldSize;
uniform vec2 uWrapEnabled;
uniform vec2 uWrapAnchorWorld;
varying vec2 vUvs;

float shortestDelta(float fromV, float toV, float sizeV, float wrapEnabled) {
    if (wrapEnabled < 0.5 || sizeV <= 0.0) return toV - fromV;
    float d = toV - fromV;
    float halfSize = sizeV * 0.5;
    if (d > halfSize) d -= sizeV;
    else if (d < -halfSize) d += sizeV;
    return d;
}

void main(void) {
    float anchorWrappedX = uWrapAnchorWorld.x + shortestDelta(uWrapAnchorWorld.x, uModelOrigin.x, uWorldSize.x, uWrapEnabled.x);
    float anchorWrappedY = uWrapAnchorWorld.y + shortestDelta(uWrapAnchorWorld.y, uModelOrigin.y, uWorldSize.y, uWrapEnabled.y);
    float anchorCamDx = shortestDelta(uCameraWorld.x, anchorWrappedX, uWorldSize.x, uWrapEnabled.x);
    float anchorCamDy = shortestDelta(uCameraWorld.y, anchorWrappedY, uWorldSize.y, uWrapEnabled.y);

    float screenX = anchorCamDx * uViewScale + aVertexPosition.x * uViewScale;
    float screenY = (anchorCamDy - uModelOrigin.z) * uViewScale * uXyRatio + aVertexPosition.y * uViewScale;

    float worldX = uModelOrigin.x + aDepthWorld.x;
    float worldY = uModelOrigin.y + aDepthWorld.y;
    float worldZ = uModelOrigin.z + aDepthWorld.z;

    float wrappedX = uWrapAnchorWorld.x + shortestDelta(uWrapAnchorWorld.x, worldX, uWorldSize.x, uWrapEnabled.x);
    float wrappedY = uWrapAnchorWorld.y + shortestDelta(uWrapAnchorWorld.y, worldY, uWorldSize.y, uWrapEnabled.y);

    float camDy = shortestDelta(uCameraWorld.y, wrappedY, uWorldSize.y, uWrapEnabled.y);
    float camDz = worldZ;
    float sx = max(1.0, uScreenSize.x);
    float sy = max(1.0, uScreenSize.y);
    float depthMetric = camDy + camDz;
    float farMetric = uDepthRange.x;
    float invSpan = max(1e-6, uDepthRange.y);
    float nd = clamp((farMetric - depthMetric) * invSpan, 0.0, 1.0);

    vec2 clip = vec2(
        (screenX / sx) * 2.0 - 1.0,
        1.0 - (screenY / sy) * 2.0
    );
    gl_Position = vec4(clip, nd * 2.0 - 1.0, 1.0);
    vUvs = aUvs;
}
`;

    static _depthFs = `
precision mediump float;
varying vec2 vUvs;
uniform sampler2D uSampler;
uniform vec4 uTint;
uniform float uAlphaCutoff;
void main(void) {
    vec4 tex = texture2D(uSampler, vUvs) * uTint;
    if (tex.a < uAlphaCutoff) discard;
    gl_FragColor = tex;
}
`;

    static _ensureDepthMeshState() {
        if (typeof PIXI === "undefined" || !PIXI.State) return null;
        if (Roof._depthMeshState) return Roof._depthMeshState;
        const state = new PIXI.State();
        state.depthTest = true;
        state.depthMask = true;
        state.blend = false;
        state.culling = false;
        Roof._depthMeshState = state;
        return state;
    }

    static normalizeTexturePath(texturePath) {
        if (typeof texturePath !== "string" || texturePath.length === 0) return Roof.DEFAULT_TEXTURE;
        let path = texturePath.trim();
        if (path.length === 0) return Roof.DEFAULT_TEXTURE;
        if (!path.startsWith("/")) path = `/${path}`;

        // Backward compatibility for older saves that used the pre-roofs location.
        if (path === "/assets/images/smallshingles.png") return Roof.DEFAULT_TEXTURE;
        return path;
    }

    static _barycentricAtPoint(px, py, ax, ay, bx, by, cx, cy) {
        const v0x = bx - ax;
        const v0y = by - ay;
        const v1x = cx - ax;
        const v1y = cy - ay;
        const v2x = px - ax;
        const v2y = py - ay;
        const denom = (v0x * v1y - v1x * v0y);
        if (Math.abs(denom) < 1e-8) return null;
        const invDenom = 1 / denom;
        const v = (v2x * v1y - v1x * v2y) * invDenom;
        const w = (v0x * v2y - v2x * v0y) * invDenom;
        const u = 1 - v - w;
        return { u, v, w };
    }

    static _pointInQuad(p, q0, q1, q2, q3) {
        const inTri = (pt, a, b, c) => {
            const bc = Roof._barycentricAtPoint(pt.x, pt.y, a.x, a.y, b.x, b.y, c.x, c.y);
            if (!bc) return false;
            const eps = 1e-4;
            return bc.u >= -eps && bc.v >= -eps && bc.w >= -eps;
        };
        return inTri(p, q0, q1, q2) || inTri(p, q0, q2, q3);
    }

    static _getSectionEndpointKeys(section, wallCtor) {
        if (!section || !wallCtor || typeof wallCtor.endpointKey !== "function") return [];
        const startKey = wallCtor.endpointKey(section.startPoint);
        const endKey = wallCtor.endpointKey(section.endPoint);
        const keys = [];
        if (typeof startKey === "string" && startKey.length > 0) keys.push(startKey);
        if (typeof endKey === "string" && endKey.length > 0 && endKey !== startKey) keys.push(endKey);
        return keys;
    }

    static _getSectionEndpointByKey(section, endpointKey, wallCtor) {
        if (!section || !wallCtor || typeof endpointKey !== "string" || endpointKey.length === 0) return null;
        const startKey = wallCtor.endpointKey(section.startPoint);
        if (startKey === endpointKey) return section.startPoint || null;
        const endKey = wallCtor.endpointKey(section.endPoint);
        if (endKey === endpointKey) return section.endPoint || null;
        return null;
    }

    static _getOtherEndpointKey(section, endpointKey, wallCtor) {
        if (!section || !wallCtor || typeof endpointKey !== "string" || endpointKey.length === 0) return null;
        const startKey = wallCtor.endpointKey(section.startPoint);
        const endKey = wallCtor.endpointKey(section.endPoint);
        if (startKey === endpointKey) return endKey || null;
        if (endKey === endpointKey) return startKey || null;
        return null;
    }

    static _getSharedEndpointKey(a, b, wallCtor) {
        if (!a || !b || !wallCtor || typeof wallCtor.endpointKey !== "function") return null;
        const keysA = Roof._getSectionEndpointKeys(a, wallCtor);
        const keySetB = new Set(Roof._getSectionEndpointKeys(b, wallCtor));
        for (let i = 0; i < keysA.length; i++) {
            if (keySetB.has(keysA[i])) return keysA[i];
        }
        return null;
    }

    static _getConnectedSectionsAtEndpoint(section, endpointKey, wallCtor) {
        if (
            !section ||
            !(section.connections instanceof Map) ||
            typeof endpointKey !== "string" ||
            endpointKey.length === 0 ||
            !wallCtor
        ) {
            return [];
        }
        const out = [];
        for (const payload of section.connections.values()) {
            const candidate = payload && payload.section;
            if (!candidate || candidate.gone || candidate.vanishing || candidate === section) continue;
            const sharedKey = Roof._getSharedEndpointKey(section, candidate, wallCtor);
            if (sharedKey !== endpointKey) continue;
            out.push(candidate);
        }
        return out;
    }

    static _getVectorFromEndpointToOther(section, endpointKey, mapRef, wallCtor) {
        if (!section || !wallCtor || typeof endpointKey !== "string" || endpointKey.length === 0) return null;
        const from = Roof._getSectionEndpointByKey(section, endpointKey, wallCtor);
        if (!from) return null;
        const otherKey = Roof._getOtherEndpointKey(section, endpointKey, wallCtor);
        const to = Roof._getSectionEndpointByKey(section, otherKey, wallCtor);
        if (!to) return null;
        const fromX = Number(from.x);
        const fromY = Number(from.y);
        const toX = Number(to.x);
        const toY = Number(to.y);
        if (!Number.isFinite(fromX) || !Number.isFinite(fromY) || !Number.isFinite(toX) || !Number.isFinite(toY)) return null;
        const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(fromX, toX)
            : (toX - fromX);
        const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(fromY, toY)
            : (toY - fromY);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
        return { x: dx, y: dy };
    }

    static _getBendSign(currentSection, nextSection, sharedEndpointKey, mapRef, wallCtor) {
        const currentOut = Roof._getVectorFromEndpointToOther(currentSection, sharedEndpointKey, mapRef, wallCtor);
        const nextOut = Roof._getVectorFromEndpointToOther(nextSection, sharedEndpointKey, mapRef, wallCtor);
        if (!currentOut || !nextOut) return null;
        const incomingX = -currentOut.x;
        const incomingY = -currentOut.y;
        const cross = incomingX * nextOut.y - incomingY * nextOut.x;
        if (!Number.isFinite(cross) || Math.abs(cross) <= 1e-6) return 0;
        return cross > 0 ? 1 : -1;
    }

    static _getWallSectionVisiblePolygonsAtMouse(section, mouseScreen, worldToScreenFn, viewScale, xyRatio) {
        if (!section || !mouseScreen || typeof worldToScreenFn !== "function") return null;
        const profile = (typeof section.getWallProfile === "function") ? section.getWallProfile() : null;
        if (!profile) return null;
        const wallHeight = Math.max(0, Number(section.height) || 0);
        const toScreen = (pt, z) => {
            const s = worldToScreenFn(pt);
            return { x: s.x, y: s.y - z * viewScale * xyRatio };
        };
        const longFaceA = [toScreen(profile.aLeft, 0), toScreen(profile.bLeft, 0), toScreen(profile.bLeft, wallHeight), toScreen(profile.aLeft, wallHeight)];
        const longFaceB = [toScreen(profile.aRight, 0), toScreen(profile.bRight, 0), toScreen(profile.bRight, wallHeight), toScreen(profile.aRight, wallHeight)];
        const capBaseA = Number.isFinite(section.getAdjacentCollinearWallHeightAtEndpoint && section.getAdjacentCollinearWallHeightAtEndpoint("a"))
            ? Math.max(0, Math.min(wallHeight, Number(section.getAdjacentCollinearWallHeightAtEndpoint("a"))))
            : 0;
        const capBaseB = Number.isFinite(section.getAdjacentCollinearWallHeightAtEndpoint && section.getAdjacentCollinearWallHeightAtEndpoint("b"))
            ? Math.max(0, Math.min(wallHeight, Number(section.getAdjacentCollinearWallHeightAtEndpoint("b"))))
            : 0;
        const capFaceStart = [toScreen(profile.aRight, capBaseA), toScreen(profile.aLeft, capBaseA), toScreen(profile.aLeft, wallHeight), toScreen(profile.aRight, wallHeight)];
        const capFaceEnd = [toScreen(profile.bLeft, capBaseB), toScreen(profile.bRight, capBaseB), toScreen(profile.bRight, wallHeight), toScreen(profile.bLeft, wallHeight)];
        const topFace = [toScreen(profile.aLeft, wallHeight), toScreen(profile.bLeft, wallHeight), toScreen(profile.bRight, wallHeight), toScreen(profile.aRight, wallHeight)];
        const faceDepth = pts => pts.reduce((sum, p) => sum + p.y, 0) / Math.max(1, pts.length);
        const longAFront = faceDepth(longFaceA) >= faceDepth(longFaceB);
        const startCapFront = faceDepth(capFaceStart) >= faceDepth(capFaceEnd);
        const showStartCap = capBaseA < wallHeight - 1e-5;
        const showEndCap = capBaseB < wallHeight - 1e-5;
        const visiblePolygons = [];
        visiblePolygons.push(longAFront ? longFaceA : longFaceB);
        visiblePolygons.push(topFace);
        if (startCapFront && showStartCap) visiblePolygons.push(capFaceStart);
        if (!startCapFront && showEndCap) visiblePolygons.push(capFaceEnd);
        const containsMouse = visiblePolygons.some(poly =>
            Roof._pointInQuad(mouseScreen, poly[0], poly[1], poly[2], poly[3])
        );
        if (!containsMouse) return null;
        return { profile };
    }

    static getHoveredWallSectionAtPoint(wizardRef, worldX, worldY) {
        if (!wizardRef || !wizardRef.map || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const worldToScreenFn = (typeof globalThis.worldToScreen === "function") ? globalThis.worldToScreen : null;
        if (!worldToScreenFn) return null;
        const mouseScreen = (
            globalThis.mousePos &&
            Number.isFinite(globalThis.mousePos.screenX) &&
            Number.isFinite(globalThis.mousePos.screenY)
        ) ? { x: globalThis.mousePos.screenX, y: globalThis.mousePos.screenY } : worldToScreenFn({ x: worldX, y: worldY });
        const wallCtor = globalThis.WallSectionUnit || null;
        if (!wallCtor || !wallCtor._allSections || wallCtor._allSections.size === 0) return null;
        const viewScale = Number.isFinite(globalThis.viewscale) ? globalThis.viewscale : 1;
        const xyRatio = Number.isFinite(globalThis.xyratio) ? globalThis.xyratio : 0.66;
        for (const section of wallCtor._allSections.values()) {
            if (!section || section.gone || section.vanishing || !section.startPoint || !section.endPoint) continue;
            if (Roof._getWallSectionVisiblePolygonsAtMouse(section, mouseScreen, worldToScreenFn, viewScale, xyRatio)) {
                return section;
            }
        }
        return null;
    }

    static findConvexWallLoopFromStartSection(startSection, mapRef, wallCtor, maxDepth = 12) {
        if (!startSection || !wallCtor) return null;
        const startNeighbors = Roof._getConnectedSectionsAtEndpoint(startSection, wallCtor.endpointKey(startSection.startPoint), wallCtor)
            .concat(Roof._getConnectedSectionsAtEndpoint(startSection, wallCtor.endpointKey(startSection.endPoint), wallCtor));
        const dedupNeighbors = [];
        const neighborIds = new Set();
        for (let i = 0; i < startNeighbors.length; i++) {
            const section = startNeighbors[i];
            if (!section || !Number.isInteger(section.id) || neighborIds.has(section.id)) continue;
            neighborIds.add(section.id);
            dedupNeighbors.push(section);
        }

        const dfs = (currentSection, entryEndpointKey, turnSign, pathSections, depth) => {
            if (!currentSection || depth > maxDepth) return null;
            const exitEndpointKey = Roof._getOtherEndpointKey(currentSection, entryEndpointKey, wallCtor);
            if (!exitEndpointKey) return null;
            const candidates = Roof._getConnectedSectionsAtEndpoint(currentSection, exitEndpointKey, wallCtor);
            for (let i = 0; i < candidates.length; i++) {
                const next = candidates[i];
                if (!next || next === currentSection) continue;
                const bendSign = Roof._getBendSign(currentSection, next, exitEndpointKey, mapRef, wallCtor);
                if (bendSign === null) continue;
                let nextTurnSign = turnSign;
                if (bendSign !== 0) {
                    if (nextTurnSign === 0) nextTurnSign = bendSign;
                    else if (bendSign !== nextTurnSign) continue;
                }
                if (next === startSection) {
                    if (pathSections.length >= 3) return pathSections.slice();
                    continue;
                }
                if (pathSections.includes(next)) continue;
                const nextPath = pathSections.concat(next);
                const found = dfs(next, exitEndpointKey, nextTurnSign, nextPath, depth + 1);
                if (found) return found;
            }
            return null;
        };

        for (let i = 0; i < dedupNeighbors.length; i++) {
            const neighbor = dedupNeighbors[i];
            const sharedEndpointKey = Roof._getSharedEndpointKey(startSection, neighbor, wallCtor);
            if (!sharedEndpointKey) continue;
            const found = dfs(neighbor, sharedEndpointKey, 0, [startSection, neighbor], 1);
            if (Array.isArray(found) && found.length >= 3) return found;
        }
        return null;
    }

    static getPlacementCandidate(wizardRef, worldX, worldY, options = {}) {
        if (!wizardRef || !wizardRef.map || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const mapRef = wizardRef.map;
        const wallCtor = globalThis.WallSectionUnit || null;
        if (!wallCtor || !wallCtor._allSections || wallCtor._allSections.size === 0) return null;
        const hoveredSection = Roof.getHoveredWallSectionAtPoint(wizardRef, worldX, worldY);
        if (!hoveredSection) return null;

        const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(1, Number(options.maxDepth)) : 12;
        const loopSections = Roof.findConvexWallLoopFromStartSection(hoveredSection, mapRef, wallCtor, maxDepth);
        if (!Array.isArray(loopSections) || loopSections.length < 3) return null;

        let baseCenter = null;
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        let count = 0;
        for (let i = 0; i < loopSections.length; i++) {
            const section = loopSections[i];
            if (!section || typeof section.getWallProfile !== "function") continue;
            const profile = section.getWallProfile();
            if (!profile) continue;
            const cx = (
                Number(profile.aLeft.x) +
                Number(profile.aRight.x) +
                Number(profile.bLeft.x) +
                Number(profile.bRight.x)
            ) * 0.25;
            const cy = (
                Number(profile.aLeft.y) +
                Number(profile.aRight.y) +
                Number(profile.bLeft.y) +
                Number(profile.bRight.y)
            ) * 0.25;
            if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
            const topZ = Math.max(0, Number(section.bottomZ) || 0) + Math.max(0, Number(section.height) || 0);
            if (!baseCenter) {
                baseCenter = { x: cx, y: cy };
                sumX += cx;
                sumY += cy;
            } else {
                const relX = (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? (baseCenter.x + mapRef.shortestDeltaX(baseCenter.x, cx))
                    : cx;
                const relY = (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? (baseCenter.y + mapRef.shortestDeltaY(baseCenter.y, cy))
                    : cy;
                sumX += relX;
                sumY += relY;
            }
            sumZ += topZ;
            count += 1;
        }
        if (count <= 0) return null;

        let previewX = sumX / count;
        let previewY = sumY / count;
        const previewZ = sumZ / count;
        if (mapRef && typeof mapRef.wrapWorldX === "function") previewX = mapRef.wrapWorldX(previewX);
        if (mapRef && typeof mapRef.wrapWorldY === "function") previewY = mapRef.wrapWorldY(previewY);

        return {
            valid: true,
            targetWall: hoveredSection,
            wallSections: loopSections.slice(),
            previewX,
            previewY,
            previewZ
        };
    }

    static getPlacementDiagnostics(wizardRef, worldX, worldY, options = {}) {
        const candidate = Roof.getPlacementCandidate(wizardRef, worldX, worldY, options);
        if (candidate) {
            return {
                active: true,
                valid: true,
                hoveredSection: candidate.targetWall || null,
                wallSections: Array.isArray(candidate.wallSections) ? candidate.wallSections.slice() : [],
                candidate
            };
        }
        const hoveredSection = Roof.getHoveredWallSectionAtPoint(wizardRef, worldX, worldY);
        return {
            active: !!hoveredSection,
            valid: false,
            hoveredSection: hoveredSection || null,
            wallSections: hoveredSection ? [hoveredSection] : [],
            candidate: null
        };
    }

    static buildWallLoopMeshData(wallSections, mapRef, options = {}) {
        if (!Array.isArray(wallSections) || wallSections.length === 0) return null;
        const wallCtor = globalThis.WallSectionUnit || null;
        if (!wallCtor || typeof wallCtor.endpointKey !== "function") return null;
        const peakOffsetZ = Number.isFinite(options.peakOffsetZ) ? Number(options.peakOffsetZ) : 2;
        const overhang = Number.isFinite(options.overhang) ? Math.max(0, Number(options.overhang)) : 0.25;

        const unwrapPointAround = (origin, point) => {
            if (!origin || !point) return null;
            const px = Number(point.x);
            const py = Number(point.y);
            if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
            const ox = Number(origin.x);
            const oy = Number(origin.y);
            const x = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? (ox + mapRef.shortestDeltaX(ox, px))
                : px;
            const y = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? (oy + mapRef.shortestDeltaY(oy, py))
                : py;
            return { x, y };
        };

        let baseMid = null;
        let sumMidX = 0;
        let sumMidY = 0;
        let sumMidZ = 0;
        let midCount = 0;
        const endpointAggByKey = new Map();

        for (let i = 0; i < wallSections.length; i++) {
            const section = wallSections[i];
            if (!section || !section.startPoint || !section.endPoint) continue;
            const sx = Number(section.startPoint.x);
            const sy = Number(section.startPoint.y);
            const ex = Number(section.endPoint.x);
            const ey = Number(section.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) continue;

            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(sx, ex)
                : (ex - sx);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(sy, ey)
                : (ey - sy);
            const midpoint = { x: sx + dx * 0.5, y: sy + dy * 0.5 };
            const topZ = Math.max(0, Number(section.bottomZ) || 0) + Math.max(0, Number(section.height) || 0);

            if (!baseMid) {
                baseMid = { x: midpoint.x, y: midpoint.y };
            }
            const unwrappedMid = unwrapPointAround(baseMid, midpoint);
            if (unwrappedMid) {
                sumMidX += unwrappedMid.x;
                sumMidY += unwrappedMid.y;
                sumMidZ += topZ;
                midCount += 1;
            }

            const startKey = wallCtor.endpointKey(section.startPoint);
            const endKey = wallCtor.endpointKey(section.endPoint);
            if (typeof startKey === "string" && startKey.length > 0) {
                const startPt = unwrapPointAround(baseMid, section.startPoint);
                if (startPt) {
                    const agg = endpointAggByKey.get(startKey) || { x: 0, y: 0, z: 0, count: 0 };
                    agg.x += startPt.x;
                    agg.y += startPt.y;
                    agg.z += topZ;
                    agg.count += 1;
                    endpointAggByKey.set(startKey, agg);
                }
            }
            if (typeof endKey === "string" && endKey.length > 0) {
                const endPt = unwrapPointAround(baseMid, section.endPoint);
                if (endPt) {
                    const agg = endpointAggByKey.get(endKey) || { x: 0, y: 0, z: 0, count: 0 };
                    agg.x += endPt.x;
                    agg.y += endPt.y;
                    agg.z += topZ;
                    agg.count += 1;
                    endpointAggByKey.set(endKey, agg);
                }
            }
        }

        if (midCount <= 0 || endpointAggByKey.size < 2) return null;
        const meanMidX = sumMidX / midCount;
        const meanMidY = sumMidY / midCount;
        const meanMidZ = sumMidZ / midCount;
        const peakWorldZ = meanMidZ + peakOffsetZ;

        // Build loop corner order from pairwise shared endpoints between adjacent
        // loop sections. Stable ordering avoids self-intersecting roof footprints.
        const orderedEndpointKeys = [];
        for (let i = 0; i < wallSections.length; i++) {
            const section = wallSections[i];
            const nextSection = wallSections[(i + 1) % wallSections.length];
            const sharedKey = Roof._getSharedEndpointKey(section, nextSection, wallCtor);
            if (!sharedKey || !endpointAggByKey.has(sharedKey)) return null;
            orderedEndpointKeys.push(sharedKey);
        }

        // Require a simple closed polygon: at least 3 unique corners.
        const uniqueOrderedKeys = [];
        const seenOrderedKeys = new Set();
        for (let i = 0; i < orderedEndpointKeys.length; i++) {
            const key = orderedEndpointKeys[i];
            if (!seenOrderedKeys.has(key)) {
                seenOrderedKeys.add(key);
                uniqueOrderedKeys.push(key);
            }
        }
        if (uniqueOrderedKeys.length < 3) return null;

        const vertices = [];
        const endpointIndexByKey = new Map();
        for (let i = 0; i < uniqueOrderedKeys.length; i++) {
            const key = uniqueOrderedKeys[i];
            const agg = endpointAggByKey.get(key);
            if (!agg || !agg.count) continue;
            endpointIndexByKey.set(key, vertices.length);
            vertices.push({
                x: (agg.x / agg.count) - meanMidX,
                y: (agg.y / agg.count) - meanMidY,
                // Store local z relative to roof base; world base is roofRef.z.
                z: (agg.z / agg.count) - meanMidZ
            });
        }
        if (vertices.length < 2) return null;

        const interiorLocalPoints = vertices.map(v => ({ x: Number(v.x) || 0, y: Number(v.y) || 0 }));

        if (overhang > 1e-6 && vertices.length >= 3) {
            const signedArea = (() => {
                let area = 0;
                for (let i = 0; i < vertices.length; i++) {
                    const a = vertices[i];
                    const b = vertices[(i + 1) % vertices.length];
                    area += a.x * b.y - b.x * a.y;
                }
                return area * 0.5;
            })();
            const ccw = signedArea >= 0;
            const getOutwardNormal = (edgeX, edgeY) => {
                const len = Math.hypot(edgeX, edgeY);
                if (len <= 1e-7) return null;
                const ex = edgeX / len;
                const ey = edgeY / len;
                return ccw ? { x: ey, y: -ex } : { x: -ey, y: ex };
            };
            const cross2d = (ax, ay, bx, by) => ax * by - ay * bx;

            const offsetVertices = [];
            for (let i = 0; i < vertices.length; i++) {
                const prev = vertices[(i - 1 + vertices.length) % vertices.length];
                const curr = vertices[i];
                const next = vertices[(i + 1) % vertices.length];
                const ePrev = { x: curr.x - prev.x, y: curr.y - prev.y };
                const eNext = { x: next.x - curr.x, y: next.y - curr.y };
                const nPrev = getOutwardNormal(ePrev.x, ePrev.y);
                const nNext = getOutwardNormal(eNext.x, eNext.y);
                if (!nPrev || !nNext) {
                    offsetVertices.push({ x: curr.x, y: curr.y, z: curr.z });
                    continue;
                }

                const p1 = { x: curr.x + nPrev.x * overhang, y: curr.y + nPrev.y * overhang };
                const p2 = { x: curr.x + nNext.x * overhang, y: curr.y + nNext.y * overhang };
                const denom = cross2d(ePrev.x, ePrev.y, eNext.x, eNext.y);
                if (Math.abs(denom) <= 1e-7) {
                    const nx = nPrev.x + nNext.x;
                    const ny = nPrev.y + nNext.y;
                    const nLen = Math.hypot(nx, ny);
                    if (nLen <= 1e-7) {
                        offsetVertices.push({ x: curr.x, y: curr.y, z: curr.z });
                    } else {
                        offsetVertices.push({
                            x: curr.x + (nx / nLen) * overhang,
                            y: curr.y + (ny / nLen) * overhang,
                            z: curr.z
                        });
                    }
                    continue;
                }
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const t = cross2d(dx, dy, eNext.x, eNext.y) / denom;
                offsetVertices.push({
                    x: p1.x + ePrev.x * t,
                    y: p1.y + ePrev.y * t,
                    z: curr.z
                });
            }

            if (offsetVertices.length === vertices.length) {
                for (let i = 0; i < vertices.length; i++) {
                    vertices[i].x = offsetVertices[i].x;
                    vertices[i].y = offsetVertices[i].y;
                }
            }
        }

        const peakIndex = vertices.length;
        vertices.push({ x: 0, y: 0, z: peakWorldZ - meanMidZ });

        const faces = [];
        for (let i = 0; i < wallSections.length; i++) {
            const prevKey = orderedEndpointKeys[(i - 1 + orderedEndpointKeys.length) % orderedEndpointKeys.length];
            const nextKey = orderedEndpointKeys[i];
            const startIdx = endpointIndexByKey.get(prevKey);
            const endIdx = endpointIndexByKey.get(nextKey);
            if (!Number.isInteger(startIdx) || !Number.isInteger(endIdx) || startIdx === endIdx) continue;
            faces.push([startIdx, endIdx, peakIndex]);
        }
        if (faces.length === 0) return null;

        let centerX = meanMidX;
        let centerY = meanMidY;
        if (mapRef && typeof mapRef.wrapWorldX === "function") centerX = mapRef.wrapWorldX(centerX);
        if (mapRef && typeof mapRef.wrapWorldY === "function") centerY = mapRef.wrapWorldY(centerY);

        return {
            centerX,
            centerY,
            baseZ: meanMidZ,
            peakZ: peakWorldZ,
            vertices,
            faces,
            interiorLocalPoints,
            numEaves: endpointIndexByKey.size,
            numHexRing: 0
        };
    }

    static buildLegacyFaces(numEaves, numHexRing) {
        const faces = [];
        const eaveStartIdx = 0;
        const hexRingStartIdx = numEaves;
        const hexRingOuterStartIdx = numEaves + numHexRing;
        const peakIdx = numEaves + numHexRing + numHexRing;

        for (let i = 0; i < numHexRing; i++) {
            const eaveIdx1 = eaveStartIdx + (2 * i);
            const eaveIdx2 = eaveStartIdx + ((2 * i + 1) % numEaves);
            const eaveIdx3 = eaveStartIdx + ((2 * i + 2) % numEaves);
            const hexIdx1 = hexRingStartIdx + i;
            const hexIdx2 = hexRingStartIdx + (i + 1) % numHexRing;

            faces.push([eaveIdx1, eaveIdx2, hexIdx1]);
            faces.push([eaveIdx2, eaveIdx3, hexIdx1]);
            faces.push([eaveIdx3, hexIdx2, hexIdx1]);
        }

        for (let i = 0; i < numHexRing; i++) {
            const hexIdx1 = hexRingOuterStartIdx + i;
            const hexIdx2 = hexRingOuterStartIdx + (i + 1) % numHexRing;
            faces.push([hexIdx1, hexIdx2, peakIdx]);
        }

        return faces;
    }

    static buildLegacyMeshDataFromWallLoopMesh(meshData) {
        if (!meshData || !Array.isArray(meshData.vertices)) return null;
        const numEaves = Number(meshData.numEaves);
        if (numEaves !== 12) return null;

        const eaveVerts = meshData.vertices.slice(0, 12);
        if (eaveVerts.length !== 12) return null;

        let radiusSum = 0;
        let radiusCount = 0;
        for (let i = 0; i < eaveVerts.length; i++) {
            const v = eaveVerts[i];
            const vx = Number(v && v.x);
            const vy = Number(v && v.y);
            if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
            const r = Math.hypot(vx, vy);
            if (!Number.isFinite(r) || r <= 1e-6) continue;
            radiusSum += r;
            radiusCount += 1;
        }
        if (radiusCount <= 0) return null;

        const radius = radiusSum / radiusCount;
        const peakLocalZ = Math.max(0, Number(meshData.peakZ) - Number(meshData.baseZ));
        const innerLocalZ = peakLocalZ * (4 / 7);
        const outerLocalZ = peakLocalZ * (3.5 / 7);

        const legacyVertices = [];
        for (let i = 0; i < 12; i++) {
            const angle = (30 * i - 15) * (Math.PI / 180);
            legacyVertices.push({
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                z: 0
            });
        }
        for (let i = 0; i < 6; i++) {
            const angle = (60 * i) * (Math.PI / 180);
            legacyVertices.push({
                x: Math.cos(angle) * radius * 0.5,
                y: Math.sin(angle) * radius * 0.5,
                z: innerLocalZ
            });
        }
        for (let i = 0; i < 6; i++) {
            const angle = (60 * i) * (Math.PI / 180);
            legacyVertices.push({
                x: Math.cos(angle) * radius * 0.625,
                y: Math.sin(angle) * radius * 0.625,
                z: outerLocalZ
            });
        }
        legacyVertices.push({ x: 0, y: 0, z: peakLocalZ });

        return {
            centerX: Number(meshData.centerX),
            centerY: Number(meshData.centerY),
            baseZ: Number(meshData.baseZ),
            peakZ: Number(meshData.peakZ),
            vertices: legacyVertices,
            faces: Roof.buildLegacyFaces(12, 6),
            interiorLocalPoints: Array.isArray(meshData.interiorLocalPoints)
                ? meshData.interiorLocalPoints.map(p => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }))
                : null,
            numEaves: 12,
            numHexRing: 6
        };
    }

    static applyWallLoopCandidateToRoof(roofRef, candidate, mapRef, options = {}) {
        if (!roofRef || !candidate || !Array.isArray(candidate.wallSections)) return false;
        let meshData = Roof.buildWallLoopMeshData(candidate.wallSections, mapRef, options);
        if (!meshData) return false;
        if (Number(meshData.numEaves) === 12) {
            const legacyMeshData = Roof.buildLegacyMeshDataFromWallLoopMesh(meshData);
            if (legacyMeshData) meshData = legacyMeshData;
        }

        roofRef.x = Number(meshData.centerX);
        roofRef.y = Number(meshData.centerY);
        roofRef.z = Number(meshData.baseZ);
        roofRef.heightFromGround = Number(meshData.baseZ);
        roofRef.peakHeight = Math.max(0, Number(meshData.peakZ) - Number(meshData.baseZ));
        roofRef.midHeight = Math.max(0, roofRef.peakHeight * 0.5);
        roofRef.vertices = Array.isArray(meshData.vertices) ? meshData.vertices.slice() : [];
        roofRef.faces = Array.isArray(meshData.faces) ? meshData.faces.slice() : [];
        roofRef.numEaves = Number.isFinite(meshData.numEaves) ? Number(meshData.numEaves) : Math.max(0, roofRef.vertices.length - 1);
        roofRef.numHexRing = Number.isFinite(meshData.numHexRing) ? Number(meshData.numHexRing) : 0;
        roofRef.placed = true;
        roofRef.currentAlpha = 1;
        roofRef.setInteriorHideHitboxFromLocalPoints(meshData.interiorLocalPoints);
        roofRef.updateGroundPlaneHitbox();
        roofRef.createPixiMesh();
        return true;
    }

    static buildConvexHull(points) {
        if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? points.slice() : [];

        const sorted = points
            .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
            .slice()
            .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
        if (sorted.length < 3) return sorted;

        const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
        const lower = [];
        for (let i = 0; i < sorted.length; i++) {
            const p = sorted[i];
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
                lower.pop();
            }
            lower.push(p);
        }

        const upper = [];
        for (let i = sorted.length - 1; i >= 0; i--) {
            const p = sorted[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
                upper.pop();
            }
            upper.push(p);
        }

        lower.pop();
        upper.pop();
        return lower.concat(upper);
    }

    constructor(x, y, heightFromGround) {
        this.type = "roof";
        this.x = x;
        this.y = y;
        this.heightFromGround = heightFromGround;
        this.z = heightFromGround;
        this.peakHeight = heightFromGround + 7; // Peak is 3 units above base
        this.midHeight = heightFromGround + 4; // Midpoint for hex ring
        this.pixiMesh = null;
        this.textureName = Roof.DEFAULT_TEXTURE;
        this.placed = false;
        this.interiorHideHitbox = null;
        this.interiorHidePolygonPoints = null;

        const radius = 10.5; // Distance from center to eave

        const eaves = Array.from({ length: 12 }, (_, i) => {
            const angle = 30 * i - 15; // Start at -15° to align with hex points
            const rad = angle * (Math.PI / 180);

            return {
                x: Math.cos(rad) * radius,
                y: Math.sin(rad) * radius,
                z: this.heightFromGround
            };
        });
        
        const hexRingInner = Array.from({ length: 6 }, (_, i) => {
            const angle = 60 * i;
            const rad = angle * (Math.PI / 180);
            return {
                x: Math.cos(rad) * radius * 0.5,
                y: Math.sin(rad) * radius * 0.5,
                z: this.heightFromGround + this.midHeight
            };
        });

        const hexRingOuter = Array.from({ length: 6 }, (_, i) => {
            const angle = 60 * i;
            const rad = angle * (Math.PI / 180);
            return {
                x: Math.cos(rad) * radius * 0.625,
                y: Math.sin(rad) * radius * 0.625,
                z: this.heightFromGround + this.midHeight - 0.5
            };
        });

        const topPoint = { x: 0, y: 0, z: this.heightFromGround + this.peakHeight };

        this.numEaves = eaves.length;
        this.numHexRing = hexRingInner.length;
        this.vertices = [...eaves, ...hexRingInner, ...hexRingOuter, topPoint];
        this.faces = this.buildFaces(this.numEaves, this.numHexRing);
        this.updateGroundPlaneHitbox();
    }

    buildFaces(numEaves, numHexRing) {
        const faces = [];
        const eaveStartIdx = 0;
        const hexRingStartIdx = numEaves;
        const hexRingOuterStartIdx = numEaves + numHexRing;
        const peakIdx = numEaves + numHexRing + numHexRing;

        // Connect eaves to hexring with 3 triangles per section
        // Each section spans 2 adjacent eaves and 1 hexring, plus the next hexring
        for (let i = 0; i < numHexRing; i++) {
            const eaveIdx1 = eaveStartIdx + (2 * i);
            const eaveIdx2 = eaveStartIdx + ((2 * i + 1) % numEaves);
            const eaveIdx3 = eaveStartIdx + ((2 * i + 2) % numEaves);
            const hexIdx1 = hexRingStartIdx + i;
            const hexIdx2 = hexRingStartIdx + (i + 1) % numHexRing;

            // Triangle 1: Two eaves + first hexring vertex
            faces.push([eaveIdx1, eaveIdx2, hexIdx1]);

            // Triangle 2: Second eave + both hexring vertices (forms trapezoid)
            faces.push([eaveIdx2, eaveIdx3, hexIdx1]);

            // Triangle 3: Second eave + hexring vertices (completes section)
            faces.push([eaveIdx3, hexIdx2, hexIdx1]);
        }

        // Connect hexring vertices to peak (cone at top)
        for (let i = 0; i < numHexRing; i++) {
            const hexIdx1 = hexRingOuterStartIdx + i;
            const hexIdx2 = hexRingOuterStartIdx + (i + 1) % numHexRing;

            // Triangle from hexring edge up to peak
            faces.push([hexIdx1, hexIdx2, peakIdx]);
        }

        return faces;
    }

    createPixiMesh() {
        if (this.pixiMesh) {
            this.pixiMesh.destroy();
        }

        // Calculate rotation angle for isometric view
        const rotationRadians = Math.atan(1.15547);

        // Light direction (from upper right, slightly in front)
        const lightDir = { x: 0.5, y: -0.5, z: 0.7 };
        const lightLen = Math.sqrt(lightDir.x * lightDir.x + lightDir.y * lightDir.y + lightDir.z * lightDir.z);
        lightDir.x /= lightLen;
        lightDir.y /= lightLen;
        lightDir.z /= lightLen;

        // Calculate lighting for each face
        const faceLighting = new Array(this.faces.length);
        for (let i = 0; i < this.faces.length; i++) {
            const face = this.faces[i];
            const v0 = this.vertices[face[0]];
            const v1 = this.vertices[face[1]];
            const v2 = this.vertices[face[2]];

            // Calculate face normal (cross product)
            const edge1 = { x: v1.x - v0.x, y: v1.y - v0.y, z: v1.z - v0.z };
            const edge2 = { x: v2.x - v0.x, y: v2.y - v0.y, z: v2.z - v0.z };
            const normal = {
                x: edge1.y * edge2.z - edge1.z * edge2.y,
                y: edge1.z * edge2.x - edge1.x * edge2.z,
                z: edge1.x * edge2.y - edge1.y * edge2.x
            };
            const normalLen = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
            normal.x /= normalLen;
            normal.y /= normalLen;
            normal.z /= normalLen;

            // Calculate lighting (dot product with light direction)
            const dot = normal.x * lightDir.x + normal.y * lightDir.y + normal.z * lightDir.z;
            faceLighting[i] = dot * 0.7 + 0.5;
        }

        // Normalize lighting to keep roof textures close to source brightness
        // while preserving some directional shape.
        let lightingSum = 0;
        let lightingCount = 0;
        for (let i = 0; i < faceLighting.length; i++) {
            const value = faceLighting[i];
            if (!Number.isFinite(value)) continue;
            lightingSum += value;
            lightingCount++;
        }
        const meanLighting = lightingCount > 0 ? (lightingSum / lightingCount) : 1;
        for (let i = 0; i < faceLighting.length; i++) {
            const value = Number.isFinite(faceLighting[i]) ? faceLighting[i] : meanLighting;
            const normalized = value / Math.max(1e-6, meanLighting);
            faceLighting[i] = Math.max(0.85, Math.min(1.15, normalized));
        }

        // Create vertex colors based on face lighting
        const vertexColors = new Float32Array(this.vertices.length);
        for (let i = 0; i < this.vertices.length; i++) {
            // Find all faces that use this vertex and average their lighting
            let totalBrightness = 0;
            let faceCount = 0;
            for (let f = 0; f < this.faces.length; f++) {
                if (this.faces[f].includes(i)) {
                    totalBrightness += faceLighting[f];
                    faceCount++;
                }
            }
            vertexColors[i] = faceCount > 0 ? totalBrightness / faceCount : 1.0;
        }

        // Flatten vertices for PIXI geometry with rotation applied
        const vertexData = new Float32Array(this.vertices.length * 2);
        for (let i = 0; i < this.vertices.length; i++) {
            const v = this.vertices[i];
            
            // Apply rotation on X-axis (pitch the roof toward the viewer)
            const cosR = Math.cos(rotationRadians);
            const sinR = Math.sin(rotationRadians);
            const rotatedY = v.y * cosR - v.z * sinR;
            const rotatedZ = v.y * sinR + v.z * cosR;
            
            // Store rotated coordinates without scaling
            vertexData[i * 2] = v.x;
            vertexData[i * 2 + 1] = rotatedY;
        }

        // Flatten indices from faces
        const indexData = new Uint16Array(this.faces.length * 3);
        for (let i = 0; i < this.faces.length; i++) {
            indexData[i * 3] = this.faces[i][0];
            indexData[i * 3 + 1] = this.faces[i][1];
            indexData[i * 3 + 2] = this.faces[i][2];
        }

        // Create a container to hold all face meshes
        this.pixiMesh = new PIXI.Container();
        this.pixiMesh.visible = false;
        const depthState = Roof._ensureDepthMeshState();
        this.pixiMesh._roofDepthUniforms = [];
        this.pixiMesh._usesRoofDepthShader = !!(depthState && PIXI.Shader);

        // Load shingles texture
        const texturePath = Roof.normalizeTexturePath(this.textureName);
        this.textureName = texturePath;
        const shinglesTexture = PIXI.Texture.from(texturePath);
        
        // Neutral base color so texture color stays true after normalization.
        const baseColor = { r: 0xff, g: 0xff, b: 0xff };

        // Create a separate mesh for each face with its own lighting
        for (let f = 0; f < this.faces.length; f++) {
            const face = this.faces[f];
            const brightness = faceLighting[f];
            
            // Create vertex data for this face
            const faceVertexData = new Float32Array(6); // 3 vertices * 2 projected coords
            const faceDepthData = new Float32Array(9);  // 3 vertices * 3 world-local coords
            for (let i = 0; i < 3; i++) {
                const vertexIndex = face[i];
                faceVertexData[i * 2] = vertexData[vertexIndex * 2];
                faceVertexData[i * 2 + 1] = vertexData[vertexIndex * 2 + 1];
                const v = this.vertices[vertexIndex];
                faceDepthData[i * 3] = Number(v.x) || 0;
                faceDepthData[i * 3 + 1] = Number(v.y) || 0;
                faceDepthData[i * 3 + 2] = Number(v.z) || 0;
            }

            // Simple index data for single triangle
            const faceIndexData = new Uint16Array([0, 1, 2]);

            const faceUvData = new Float32Array(6);
            const isRoofSideFace = f < this.numHexRing * 3;
            const faceInSection = f % 3;

            if (isRoofSideFace && faceInSection === 1) {
                // Triangle 2: part of rectangular face (eave2, eave3, hex1)
                faceUvData[0] = 0; faceUvData[1] = 1;
                faceUvData[2] = 1; faceUvData[3] = 1;
                faceUvData[4] = 0; faceUvData[5] = 0;
            } else if (isRoofSideFace && faceInSection === 2) {
                // Triangle 3: completes rectangular face (eave3, hex2, hex1)
                faceUvData[0] = 1; faceUvData[1] = 1;
                faceUvData[2] = 1; faceUvData[3] = 0;
                faceUvData[4] = 0; faceUvData[5] = 0;
            } else {
                // Triangle-only faces (eave triangle + peak cone)
                faceUvData[0] = 0; faceUvData[1] = 1;
                faceUvData[2] = 1; faceUvData[3] = 1;
                faceUvData[4] = 0.5; faceUvData[5] = 0;
            }

            let faceMesh = null;
            if (depthState && PIXI.Shader) {
                const faceGeometry = new PIXI.Geometry()
                    .addAttribute("aVertexPosition", faceVertexData, 2)
                    .addAttribute("aDepthWorld", faceDepthData, 3)
                    .addAttribute("aUvs", faceUvData, 2)
                    .addIndex(faceIndexData);
                const tintR = Math.floor(baseColor.r * brightness) / 255;
                const tintG = Math.floor(baseColor.g * brightness) / 255;
                const tintB = Math.floor(baseColor.b * brightness) / 255;
                const uniforms = {
                    uScreenSize: new Float32Array([1, 1]),
                    uCameraWorld: new Float32Array([0, 0]),
                    uViewScale: 1,
                    uXyRatio: 1,
                    uDepthRange: new Float32Array([0, 1]),
                    uModelOrigin: new Float32Array([this.x || 0, this.y || 0, this.z || this.heightFromGround || 0]),
                    uWorldSize: new Float32Array([0, 0]),
                    uWrapEnabled: new Float32Array([0, 0]),
                    uWrapAnchorWorld: new Float32Array([this.x || 0, this.y || 0]),
                    uTint: new Float32Array([tintR, tintG, tintB, 1]),
                    uAlphaCutoff: 0.02,
                    uSampler: shinglesTexture || PIXI.Texture.WHITE
                };
                const faceShader = PIXI.Shader.from(Roof._depthVs, Roof._depthFs, uniforms);
                faceMesh = new PIXI.Mesh(faceGeometry, faceShader, depthState, PIXI.DRAW_MODES.TRIANGLES);
                this.pixiMesh._roofDepthUniforms.push(uniforms);
            } else {
                const faceGeometry = new PIXI.Geometry()
                    .addAttribute('aVertexPosition', faceVertexData, 2)
                    .addAttribute('aUvs', faceUvData, 2)
                    .addIndex(faceIndexData);
                const faceMaterial = new PIXI.MeshMaterial(shinglesTexture);
                faceMesh = new PIXI.Mesh(faceGeometry, faceMaterial);
                const r = Math.floor(baseColor.r * brightness);
                const g = Math.floor(baseColor.g * brightness);
                const b = Math.floor(baseColor.b * brightness);
                faceMesh.tint = (r << 16) | (g << 8) | b;
            }

            this.pixiMesh.addChild(faceMesh);
        }

        return this.pixiMesh;
    }

    updateGroundPlaneHitbox() {
        // Ground-plane hitbox uses eave footprint, inset by 0.75 world units
        // (0.5 original + 0.25 additional), at z=0 semantics.
        // Wall depth ordering uses projected eaves-to-ground footprint.
        const eaveCount = Math.max(0, this.numEaves || 0);
        const eaves = Array.isArray(this.vertices) ? this.vertices.slice(0, eaveCount) : [];
        if (!eaves.length || typeof PolygonHitbox === 'undefined') {
            this.groundPlaneHitbox = null;
            this.wallDepthHitbox = null;
            return;
        }

        const eavePoints = eaves.map(v => ({
            x: this.x + v.x,
            y: this.y + v.y
        }));
        const projectedPoints = eaves.map(v => {
            // Project roof eaves to ground along the vertical draw axis used by
            // tall objects (y decreases as height increases), so occlusion depth
            // captures walls visually covered by roof slopes near the perimeter.
            const projection = Math.max(0, Number(this.peakHeight) || 0);
            return {
                x: this.x + v.x,
                y: this.y + v.y + projection
            };
        });
        const wallDepthHull = Roof.buildConvexHull(eavePoints.concat(projectedPoints));
        this.wallDepthHitbox = wallDepthHull.length >= 3 ? new PolygonHitbox(wallDepthHull) : null;

        const shrunkPoints = eaves.map(v => {
            const len = Math.hypot(v.x, v.y);
            if (len <= 0.000001) {
                return { x: this.x, y: this.y };
            }
            const targetLen = Math.max(0, len - 0.75);
            const scale = targetLen / len;
            return {
                x: this.x + v.x * scale,
                y: this.y + v.y * scale
            };
        });

        this.groundPlaneHitbox = new PolygonHitbox(shrunkPoints);
    }

    setInteriorHideHitboxFromLocalPoints(localPoints) {
        if (
            !Array.isArray(localPoints) ||
            localPoints.length < 3 ||
            typeof PolygonHitbox === "undefined"
        ) {
            this.interiorHideHitbox = null;
            this.interiorHidePolygonPoints = null;
            return;
        }
        const points = localPoints
            .map(p => ({ x: this.x + (Number(p && p.x) || 0), y: this.y + (Number(p && p.y) || 0) }))
            .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (points.length < 3) {
            this.interiorHideHitbox = null;
            this.interiorHidePolygonPoints = null;
            return;
        }
        this.interiorHidePolygonPoints = points.map(p => ({ x: p.x, y: p.y }));
        this.interiorHideHitbox = new PolygonHitbox(this.interiorHidePolygonPoints);
    }

    saveJson() {
        const data = {
            type: 'roof',
            x: this.x,
            y: this.y,
            z: Number.isFinite(this.z) ? this.z : this.heightFromGround,
            heightFromGround: this.heightFromGround,
            peakHeight: this.peakHeight,
            midHeight: this.midHeight,
            textureName: this.textureName,
            placed: !!this.placed,
            numEaves: this.numEaves,
            numHexRing: this.numHexRing,
            vertices: Array.isArray(this.vertices)
                ? this.vertices.map(v => ({ x: v.x, y: v.y, z: v.z }))
                : [],
            triangles: Array.isArray(this.faces)
                ? this.faces.map(face => [face[0], face[1], face[2]])
                : [],
            groundPlaneHitbox: this.groundPlaneHitbox && Array.isArray(this.groundPlaneHitbox.points)
                ? { points: this.groundPlaneHitbox.points.map(p => ({ x: p.x, y: p.y })) }
                : null,
            interiorHideHitbox: this.interiorHideHitbox && Array.isArray(this.interiorHideHitbox.points)
                ? { points: this.interiorHideHitbox.points.map(p => ({ x: p.x, y: p.y })) }
                : null
        };
        if (typeof this.script !== "undefined") {
            try {
                data.script = JSON.parse(JSON.stringify(this.script));
            } catch (_err) {
                data.script = this.script;
            }
        }
        return data;
    }

    static loadJson(data) {
        if (!data || data.type !== 'roof') return null;

        const x = Number.isFinite(data.x) ? data.x : 0;
        const y = Number.isFinite(data.y) ? data.y : 0;
        const heightFromGround = Number.isFinite(data.heightFromGround) ? data.heightFromGround : 0;
        const z = Number.isFinite(data.z) ? Number(data.z) : heightFromGround;
        const roof = new Roof(x, y, heightFromGround);
        roof.z = z;
        roof.heightFromGround = z;

        if (Number.isFinite(data.peakHeight)) roof.peakHeight = data.peakHeight;
        if (Number.isFinite(data.midHeight)) roof.midHeight = data.midHeight;
        if (typeof data.textureName === 'string' && data.textureName.length > 0) {
            roof.textureName = Roof.normalizeTexturePath(data.textureName);
        }
        if (Object.prototype.hasOwnProperty.call(data, "script")) {
            roof.script = data.script;
        }
        roof.placed = !!data.placed;

        if (Array.isArray(data.vertices) && data.vertices.length >= 3) {
            roof.vertices = data.vertices.map(v => ({
                x: Number(v.x) || 0,
                y: Number(v.y) || 0,
                z: Number(v.z) || 0
            }));
        }
        if (Array.isArray(data.triangles) && data.triangles.length > 0) {
            roof.faces = data.triangles.map(t => [
                Number(t[0]) || 0,
                Number(t[1]) || 0,
                Number(t[2]) || 0
            ]);
        }

        // Keep ring metadata available for UV mapping fallback.
        roof.numEaves = Number.isFinite(data.numEaves) ? data.numEaves : 12;
        roof.numHexRing = Number.isFinite(data.numHexRing) ? data.numHexRing : 6;

        // Always rebuild derived hitboxes from geometry for current logic.
        roof.updateGroundPlaneHitbox();
        // Preserve saved indoor mask when present for backward compatibility.
        if (
            data.interiorHideHitbox &&
            Array.isArray(data.interiorHideHitbox.points) &&
            data.interiorHideHitbox.points.length >= 3 &&
            typeof PolygonHitbox !== 'undefined'
        ) {
            roof.interiorHidePolygonPoints = data.interiorHideHitbox.points.map(p => ({
                x: Number(p.x) || 0,
                y: Number(p.y) || 0
            }));
            roof.interiorHideHitbox = new PolygonHitbox(roof.interiorHidePolygonPoints);
        } else {
            // Backward-compatible fallback for old saves.
            roof.interiorHidePolygonPoints = (
                roof.groundPlaneHitbox &&
                Array.isArray(roof.groundPlaneHitbox.points)
            ) ? roof.groundPlaneHitbox.points.map(p => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })) : null;
            roof.interiorHideHitbox = roof.interiorHidePolygonPoints && roof.interiorHidePolygonPoints.length >= 3
                ? new PolygonHitbox(roof.interiorHidePolygonPoints)
                : null;
        }

        if (
            data.groundPlaneHitbox &&
            Array.isArray(data.groundPlaneHitbox.points) &&
            data.groundPlaneHitbox.points.length >= 3 &&
            typeof PolygonHitbox !== 'undefined'
        ) {
            roof.groundPlaneHitbox = new PolygonHitbox(
                data.groundPlaneHitbox.points.map(p => ({
                    x: Number(p.x) || 0,
                    y: Number(p.y) || 0
                }))
            );
        }

        return roof;
    }
}

if (typeof globalThis !== "undefined") {
    globalThis.Roof = Roof;
}
