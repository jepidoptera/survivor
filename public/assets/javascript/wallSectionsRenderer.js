(function initWallSectionsRenderer(globalScope) {
    const sectionCompositeCache = new Map();
    const wallSectionInstances = new Map();
    const sectionObjectIdMap = new WeakMap();
    let nextSectionObjectId = 1;
    let sectionDirtyAll = true;
    const sectionDirtyIds = new Set();
    const placementSectionCache = new Map();
    let placementDirtyAll = true;
    const placementDirtyIds = new Set();
    let sectionLastViewscale = NaN;
    let sectionLastXyRatio = NaN;
    let sectionForcedRebuildFrames = 0;

    function getSectionObjectId(item) {
        if (!item || (typeof item !== "object" && typeof item !== "function")) return 0;
        if (sectionObjectIdMap.has(item)) return sectionObjectIdMap.get(item);
        const nextId = nextSectionObjectId++;
        sectionObjectIdMap.set(item, nextId);
        return nextId;
    }

    function markDirty(sectionId = null) {
        if (Number.isInteger(sectionId)) {
            sectionDirtyIds.add(Number(sectionId));
            placementDirtyIds.add(Number(sectionId));
            return;
        }
        sectionDirtyAll = true;
        placementDirtyAll = true;
    }

    function markAllDirty() {
        sectionDirtyAll = true;
        placementDirtyAll = true;
    }

    function destroyBundle(bundle) {
        if (!bundle) return;
        if (bundle.sprite && bundle.sprite.parent) {
            bundle.sprite.parent.removeChild(bundle.sprite);
        }
        if (bundle.sprite && typeof bundle.sprite.destroy === "function") {
            bundle.sprite.destroy({ children: false, texture: false, baseTexture: false });
        }
        if (bundle.renderTexture && typeof bundle.renderTexture.destroy === "function") {
            bundle.renderTexture.destroy(true);
        }
    }

    function clearCache() {
        if (sectionCompositeCache.size > 0) {
            sectionCompositeCache.forEach(bundle => {
                destroyBundle(bundle);
            });
            sectionCompositeCache.clear();
        }
        wallSectionInstances.clear();
        placementSectionCache.clear();
        sectionDirtyIds.clear();
        placementDirtyIds.clear();
        sectionDirtyAll = true;
        placementDirtyAll = true;
    }

    function queueRebuildPass(frameCount = 6) {
        const frames = Number.isFinite(frameCount) ? Math.max(1, Math.floor(frameCount)) : 6;
        sectionForcedRebuildFrames = Math.max(sectionForcedRebuildFrames, frames);
        clearCache();
        markAllDirty();
    }

    function prepareFrame(viewscale, xyratio) {
        if (sectionForcedRebuildFrames > 0) {
            markAllDirty();
        }
        if (!Number.isFinite(sectionLastViewscale) || Math.abs(sectionLastViewscale - viewscale) > 1e-6) {
            sectionLastViewscale = viewscale;
            markAllDirty();
        }
        if (!Number.isFinite(sectionLastXyRatio) || Math.abs(sectionLastXyRatio - xyratio) > 1e-6) {
            sectionLastXyRatio = xyratio;
            markAllDirty();
        }
    }

    function endFrame() {
        sectionDirtyAll = false;
        if (sectionForcedRebuildFrames > 0) {
            sectionForcedRebuildFrames -= 1;
        }
    }

    function barycentricAtPoint(px, py, ax, ay, bx, by, cx, cy) {
        const v0x = bx - ax;
        const v0y = by - ay;
        const v1x = cx - ax;
        const v1y = cy - ay;
        const v2x = px - ax;
        const v2y = py - ay;
        const denom = v0x * v1y - v1x * v0y;
        if (Math.abs(denom) < 1e-8) return null;
        const invDen = 1 / denom;
        const v = (v2x * v1y - v1x * v2y) * invDen;
        const w = (v0x * v2y - v2x * v0y) * invDen;
        const u = 1 - v - w;
        return { u, v, w };
    }

    function pointInSectionQuad(p, q0, q1, q2, q3) {
        const inTri = (a, b, c) => {
            const bc = barycentricAtPoint(p.x, p.y, a.x, a.y, b.x, b.y, c.x, c.y);
            if (!bc) return false;
            const eps = 1e-4;
            return bc.u >= -eps && bc.v >= -eps && bc.w >= -eps;
        };
        return inTri(q0, q1, q2) || inTri(q0, q2, q3);
    }

    function computeHoverForWallPlacement(options = {}) {
        const wall = options.wall || null;
        const wallPool = Array.isArray(options.wallPool) ? options.wallPool : [];
        const mapRef = options.map || null;
        const worldToScreen = (typeof options.worldToScreen === "function") ? options.worldToScreen : null;
        const viewscale = Number(options.viewscale);
        const xyratio = Number(options.xyratio);
        const mouseScreen = options.mouseScreen || null;
        if (!wall || wall.type !== "wall" || !wall.a || !wall.b || !worldToScreen || !mouseScreen) return null;
        if (!Number.isFinite(mouseScreen.x) || !Number.isFinite(mouseScreen.y)) return null;

        const ax = Number(wall.a.x);
        const ay = Number(wall.a.y);
        const bx = Number(wall.b.x);
        const by = Number(wall.b.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;
        const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(ax, bx)
            : (bx - ax);
        const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(ay, by)
            : (by - ay);
        const length = Math.hypot(dx, dy);
        if (!(length > 1e-6)) return null;

        const nx = -dy / length;
        const ny = dx / length;
        const halfT = Math.max(0.001, (Number(wall.thickness) || 0.1) * 0.5);
        const sidePlusA = { x: ax + nx * halfT, y: ay + ny * halfT };
        const sidePlusB = { x: ax + dx + nx * halfT, y: ay + dy + ny * halfT };
        const sideMinusA = { x: ax - nx * halfT, y: ay - ny * halfT };
        const sideMinusB = { x: ax + dx - nx * halfT, y: ay + dy - ny * halfT };
        const plusAScreen = worldToScreen(sidePlusA);
        const plusBScreen = worldToScreen(sidePlusB);
        const minusAScreen = worldToScreen(sideMinusA);
        const minusBScreen = worldToScreen(sideMinusB);
        const plusAvgY = (plusAScreen.y + plusBScreen.y) * 0.5;
        const minusAvgY = (minusAScreen.y + minusBScreen.y) * 0.5;
        const facingSign = plusAvgY >= minusAvgY ? 1 : -1;

        const ux = dx / length;
        const uy = dy / length;
        const vx = -uy;
        const vy = ux;
        const nominalThickness = Math.max(0.001, Number(wall.thickness) || 0.1);
        const maxPerpDrift = nominalThickness * 2.5 + 0.2;
        let sectionMin = Infinity;
        let sectionMax = -Infinity;
        for (let i = 0; i < wallPool.length; i++) {
            const segment = wallPool[i];
            if (!segment || segment.gone || segment.vanishing || segment.type !== "wall" || !segment.a || !segment.b) continue;
            if (
                (Number.isInteger(wall.lineGroupId) && segment.lineGroupId !== wall.lineGroupId) ||
                (!Number.isInteger(wall.lineGroupId) && segment !== wall)
            ) {
                continue;
            }
            const sax = Number(segment.a.x);
            const say = Number(segment.a.y);
            const sbx = Number(segment.b.x);
            const sby = Number(segment.b.y);
            if (!Number.isFinite(sax) || !Number.isFinite(say) || !Number.isFinite(sbx) || !Number.isFinite(sby)) continue;
            const rax = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(ax, sax)
                : (sax - ax);
            const ray = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(ay, say)
                : (say - ay);
            const rbx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(ax, sbx)
                : (sbx - ax);
            const rby = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(ay, sby)
                : (sby - ay);
            const aPerp = Math.abs(rax * vx + ray * vy);
            const bPerp = Math.abs(rbx * vx + rby * vy);
            if (aPerp > maxPerpDrift || bPerp > maxPerpDrift) continue;
            const aAlong = rax * ux + ray * uy;
            const bAlong = rbx * ux + rby * uy;
            sectionMin = Math.min(sectionMin, aAlong, bAlong);
            sectionMax = Math.max(sectionMax, aAlong, bAlong);
        }
        if (!Number.isFinite(sectionMin) || !Number.isFinite(sectionMax) || sectionMax <= sectionMin) {
            sectionMin = 0;
            sectionMax = length;
        }

        const wallHalfT = Math.max(0.001, (Number(wall.thickness) || 0.1) * 0.5);
        const sectionStartWorld = {
            x: ax + ux * sectionMin + vx * wallHalfT * facingSign,
            y: ay + uy * sectionMin + vy * wallHalfT * facingSign
        };
        const sectionEndWorld = {
            x: ax + ux * sectionMax + vx * wallHalfT * facingSign,
            y: ay + uy * sectionMax + vy * wallHalfT * facingSign
        };
        const sectionStartScreen = worldToScreen(sectionStartWorld);
        const sectionEndScreen = worldToScreen(sectionEndWorld);
        const wallHeight = Math.max(0, Number(wall.height) || 0);
        const topStartScreen = {
            x: sectionStartScreen.x,
            y: sectionStartScreen.y - wallHeight * viewscale * xyratio
        };
        const topEndScreen = {
            x: sectionEndScreen.x,
            y: sectionEndScreen.y - wallHeight * viewscale * xyratio
        };
        const containsMouse = pointInSectionQuad(
            mouseScreen,
            sectionStartScreen,
            sectionEndScreen,
            topEndScreen,
            topStartScreen
        );
        const sdx = sectionEndScreen.x - sectionStartScreen.x;
        const sdy = sectionEndScreen.y - sectionStartScreen.y;
        const sLen2 = sdx * sdx + sdy * sdy;
        if (!(sLen2 > 1e-6)) return null;
        const mouseRelX = mouseScreen.x - sectionStartScreen.x;
        const mouseRelY = mouseScreen.y - sectionStartScreen.y;
        const screenProjT = Math.max(0, Math.min(1, (mouseRelX * sdx + mouseRelY * sdy) / sLen2));
        const projScreen = {
            x: sectionStartScreen.x + sdx * screenProjT,
            y: sectionStartScreen.y + sdy * screenProjT
        };
        const distPx = Math.hypot(mouseScreen.x - projScreen.x, mouseScreen.y - projScreen.y);
        if (!Number.isFinite(distPx)) return null;

        return { containsMouse, distPx, facingSign };
    }

    function buildLosWallOpeningMap(options = {}) {
        const candidates = Array.isArray(options.candidates) ? options.candidates : [];
        const windowOpenings = Array.isArray(options.windowOpenings) ? options.windowOpenings : [];
        const mapRef = options.map || null;

        const walls = candidates.filter(obj =>
            obj &&
            obj.type === "wall" &&
            !obj.gone &&
            !obj.vanishing &&
            obj.groundPlaneHitbox &&
            obj.a &&
            obj.b
        );
        const result = new Map();
        if (walls.length === 0 || windowOpenings.length === 0) return result;

        const shortestDX = (fromX, toX) =>
            (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(fromX, toX)
                : (toX - fromX);
        const shortestDY = (fromY, toY) =>
            (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(fromY, toY)
                : (toY - fromY);

        const sections = new Map();
        const wallToSection = new Map();
        walls.forEach((wall, idx) => {
            const key = Number.isInteger(wall.lineGroupId) ? `gid:${wall.lineGroupId}` : `wall:${idx}`;
            if (!sections.has(key)) sections.set(key, { walls: [], openings: [], lineGroupId: Number.isInteger(wall.lineGroupId) ? wall.lineGroupId : null });
            const section = sections.get(key);
            section.walls.push(wall);
            wallToSection.set(wall, section);
        });

        const openingAssigned = new Set();
        const sectionByGroup = new Map();
        sections.forEach(section => {
            if (Number.isInteger(section.lineGroupId)) sectionByGroup.set(section.lineGroupId, section);
        });
        for (let i = 0; i < windowOpenings.length; i++) {
            const opening = windowOpenings[i];
            const gid = Number.isInteger(opening && opening.mountedWallLineGroupId) ? Number(opening.mountedWallLineGroupId) : null;
            if (!Number.isInteger(gid)) continue;
            const section = sectionByGroup.get(gid);
            if (!section) continue;
            section.openings.push(opening);
            openingAssigned.add(opening);
        }

        const getOpeningCenter = (opening) => {
            const hitbox = opening && opening.groundPlaneHitbox ? opening.groundPlaneHitbox : null;
            if (!hitbox) return null;
            if (hitbox.type === "circle" && Number.isFinite(hitbox.x) && Number.isFinite(hitbox.y)) {
                return { x: hitbox.x, y: hitbox.y };
            }
            if (Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
                let sx = 0;
                let sy = 0;
                for (let i = 0; i < hitbox.points.length; i++) {
                    sx += Number(hitbox.points[i].x) || 0;
                    sy += Number(hitbox.points[i].y) || 0;
                }
                return { x: sx / hitbox.points.length, y: sy / hitbox.points.length };
            }
            return null;
        };

        const sectionMetrics = [];
        sections.forEach(section => {
            const firstWall = section.walls[0];
            if (!firstWall) return;
            const ax = Number(firstWall.a && firstWall.a.x);
            const ay = Number(firstWall.a && firstWall.a.y);
            const bx = Number(firstWall.b && firstWall.b.x);
            const by = Number(firstWall.b && firstWall.b.y);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return;
            const dx = shortestDX(ax, bx);
            const dy = shortestDY(ay, by);
            const len = Math.hypot(dx, dy);
            if (!(len > 1e-6)) return;
            const ux = dx / len;
            const uy = dy / len;
            const vx = -uy;
            const vy = ux;
            let minAlong = Infinity;
            let maxAlong = -Infinity;
            let thickness = 0.1;
            section.walls.forEach(wall => {
                const wax = Number(wall.a && wall.a.x);
                const way = Number(wall.a && wall.a.y);
                const wbx = Number(wall.b && wall.b.x);
                const wby = Number(wall.b && wall.b.y);
                if (!Number.isFinite(wax) || !Number.isFinite(way) || !Number.isFinite(wbx) || !Number.isFinite(wby)) return;
                const rax = shortestDX(ax, wax);
                const ray = shortestDY(ay, way);
                const rbx = shortestDX(ax, wbx);
                const rby = shortestDY(ay, wby);
                minAlong = Math.min(minAlong, rax * ux + ray * uy, rbx * ux + rby * uy);
                maxAlong = Math.max(maxAlong, rax * ux + ray * uy, rbx * ux + rby * uy);
                if (Number.isFinite(wall.thickness)) thickness = Math.max(thickness, Number(wall.thickness));
            });
            if (!Number.isFinite(minAlong) || !Number.isFinite(maxAlong)) return;
            sectionMetrics.push({ section, ax, ay, ux, uy, vx, vy, minAlong, maxAlong, thickness });
        });

        for (let i = 0; i < windowOpenings.length; i++) {
            const opening = windowOpenings[i];
            if (!opening || openingAssigned.has(opening)) continue;
            const center = getOpeningCenter(opening);
            if (!center) continue;
            let bestMetric = null;
            let bestScore = Infinity;
            for (let j = 0; j < sectionMetrics.length; j++) {
                const metric = sectionMetrics[j];
                const dx = shortestDX(metric.ax, center.x);
                const dy = shortestDY(metric.ay, center.y);
                const along = dx * metric.ux + dy * metric.uy;
                const perp = Math.abs(dx * metric.vx + dy * metric.vy);
                if (along < metric.minAlong - 1.2 || along > metric.maxAlong + 1.2) continue;
                if (perp > Math.max(1.2, metric.thickness * 4)) continue;
                if (perp < bestScore) {
                    bestScore = perp;
                    bestMetric = metric;
                }
            }
            if (bestMetric) {
                bestMetric.section.openings.push(opening);
                openingAssigned.add(opening);
            }
        }

        wallToSection.forEach((section, wall) => {
            if (!section || !Array.isArray(section.openings) || section.openings.length === 0) return;
            result.set(wall, section.openings);
        });
        return result;
    }

    function buildCompositeSubgroups(layerItems, mapRef = null, isWallMountedPredicate = null) {
        const isWallMounted = (typeof isWallMountedPredicate === "function")
            ? isWallMountedPredicate
            : (() => false);
        const grouped = new Map();
        for (let i = 0; i < layerItems.length; i++) {
            const item = layerItems[i];
            if (!item || !item.pixiSprite || item.gone || item.vanishing) continue;
            if (!(item.type === "wall" || (item.type !== "placedObjectPreview" && isWallMounted(item)))) continue;
            const baseGroupId = (item.type === "wall")
                ? (Number.isInteger(item.lineGroupId) ? item.lineGroupId : null)
                : (Number.isInteger(item.mountedWallLineGroupId) ? item.mountedWallLineGroupId : null);
            if (!Number.isInteger(baseGroupId)) continue;
            if (!grouped.has(baseGroupId)) {
                grouped.set(baseGroupId, { walls: [], mounted: [] });
            }
            const bucket = grouped.get(baseGroupId);
            if (item.type === "wall") {
                bucket.walls.push(item);
            } else {
                bucket.mounted.push(item);
            }
        }

        const subgroups = new Map();
        grouped.forEach((bucket, baseGroupId) => {
            if (!bucket || !Array.isArray(bucket.walls) || bucket.walls.length === 0) return;
            const subgroupKey = String(baseGroupId);
            const subgroup = {
                key: subgroupKey,
                baseGroupId,
                members: bucket.walls.slice(),
                walls: bucket.walls.slice()
            };
            if (Array.isArray(bucket.mounted) && bucket.mounted.length > 0) {
                subgroup.members.push(...bucket.mounted);
            }
            subgroups.set(subgroupKey, subgroup);
        });
        return subgroups;
    }

    function getSectionRegistry(mapRef) {
        const wallClass = (typeof globalScope.Wall !== "undefined") ? globalScope.Wall : null;
        const registry = wallClass && wallClass._sectionsById instanceof Map
            ? wallClass._sectionsById
            : null;
        if (!(registry instanceof Map)) return null;
        if (registry.size === 0 && wallClass && typeof wallClass.rebuildSectionRegistryFromWalls === "function" && mapRef) {
            const walls = Array.isArray(mapRef.objects)
                ? mapRef.objects.filter(obj => obj && obj.type === "wall")
                : [];
            wallClass.rebuildSectionRegistryFromWalls(walls);
        }
        return wallClass._sectionsById instanceof Map ? wallClass._sectionsById : registry;
    }

    function getOrBuildPlacementSection(sectionId, mapRef) {
        if (!Number.isInteger(sectionId)) return null;
        const id = Number(sectionId);
        const registry = getSectionRegistry(mapRef);
        if (!(registry instanceof Map)) return null;
        const entry = registry.get(id);
        const walls = entry && Array.isArray(entry.walls) ? entry.walls : null;
        if (!walls || walls.length === 0) return null;
        const isDirty = placementDirtyAll || placementDirtyIds.has(id) || !placementSectionCache.has(id);
        if (!isDirty) return placementSectionCache.get(id) || null;
        const section = new WallSection({ id });
        const ok = section.setFromWalls(walls, mapRef, id, []);
        if (!ok) {
            placementSectionCache.delete(id);
            return null;
        }
        placementSectionCache.set(id, section);
        placementDirtyIds.delete(id);
        return section;
    }

    class WallSection {
        constructor(options = {}) {
            this.id = options.id || "";
            this.walls = Array.isArray(options.walls) ? options.walls.slice() : [];
            this.mounted = Array.isArray(options.mounted) ? options.mounted.slice() : [];
            this.mapRef = options.mapRef || null;
            this.height = Number.isFinite(options.height) ? Number(options.height) : 0;
            this.halfThickness = Number.isFinite(options.halfThickness) ? Number(options.halfThickness) : 0.05;
            this.origin = options.origin || { x: 0, y: 0 };
            this.u = options.u || { x: 1, y: 0 };
            this.v = options.v || { x: 0, y: 1 };
            this.minAlong = Number.isFinite(options.minAlong) ? Number(options.minAlong) : 0;
            this.maxAlong = Number.isFinite(options.maxAlong) ? Number(options.maxAlong) : 0;
            this.capBaseStart = Number.isFinite(options.capBaseStart) ? Number(options.capBaseStart) : 0;
            this.capBaseEnd = Number.isFinite(options.capBaseEnd) ? Number(options.capBaseEnd) : 0;
        }

        setFromWalls(walls, mapRef = null, id = this.id, mounted = this.mounted) {
            if (!Array.isArray(walls) || walls.length === 0) return false;
            const first = walls[0];
            if (!first || !first.a || !first.b) return false;
            const ax = Number(first.a.x);
            const ay = Number(first.a.y);
            const bx = Number(first.b.x);
            const by = Number(first.b.y);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return false;

            const shortestDX = (fromX, toX) =>
                (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(fromX, toX)
                    : (toX - fromX);
            const shortestDY = (fromY, toY) =>
                (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(fromY, toY)
                    : (toY - fromY);

            const dx = shortestDX(ax, bx);
            const dy = shortestDY(ay, by);
            const len = Math.hypot(dx, dy);
            if (!(len > 1e-6)) return false;
            const ux = dx / len;
            const uy = dy / len;
            const vx = -uy;
            const vy = ux;

            let minAlong = Infinity;
            let maxAlong = -Infinity;
            let maxHalfThickness = 0.05;
            let height = 0;
            const projectPoint = (px, py) => {
                const rx = shortestDX(ax, px);
                const ry = shortestDY(ay, py);
                return rx * ux + ry * uy;
            };

            for (let i = 0; i < walls.length; i++) {
                const wall = walls[i];
                if (!wall || !wall.a || !wall.b) continue;
                const wax = Number(wall.a.x);
                const way = Number(wall.a.y);
                const wbx = Number(wall.b.x);
                const wby = Number(wall.b.y);
                if (!Number.isFinite(wax) || !Number.isFinite(way) || !Number.isFinite(wbx) || !Number.isFinite(wby)) continue;
                minAlong = Math.min(minAlong, projectPoint(wax, way), projectPoint(wbx, wby));
                maxAlong = Math.max(maxAlong, projectPoint(wax, way), projectPoint(wbx, wby));
                const half = Math.max(0.001, Number(wall.thickness) || 0.001) * 0.5;
                maxHalfThickness = Math.max(maxHalfThickness, half);
                height = Math.max(height, Math.max(0, Number(wall.height) || 0));
            }
            if (!Number.isFinite(minAlong) || !Number.isFinite(maxAlong) || maxAlong <= minAlong) return false;

            const endpointKey = (point) => `${Number(point.x).toFixed(6)},${Number(point.y).toFixed(6)}`;
            const endpointWalls = new Map();
            for (let i = 0; i < walls.length; i++) {
                const wall = walls[i];
                if (!wall || !wall.a || !wall.b) continue;
                const ka = endpointKey(wall.a);
                const kb = endpointKey(wall.b);
                if (!endpointWalls.has(ka)) endpointWalls.set(ka, []);
                if (!endpointWalls.has(kb)) endpointWalls.set(kb, []);
                endpointWalls.get(ka).push({ wall, endpoint: wall.a });
                endpointWalls.get(kb).push({ wall, endpoint: wall.b });
            }
            let startEndpoint = null;
            let endEndpoint = null;
            let startAlong = Infinity;
            let endAlong = -Infinity;
            endpointWalls.forEach((entries, key) => {
                if (!Array.isArray(entries) || entries.length === 0) return;
                const endpoint = entries[0].endpoint;
                const along = projectPoint(endpoint.x, endpoint.y);
                if (along < startAlong) {
                    startAlong = along;
                    startEndpoint = endpoint;
                }
                if (along > endAlong) {
                    endAlong = along;
                    endEndpoint = endpoint;
                }
            });

            const findNeighborHeightAtEndpoint = endpoint => {
                if (!endpoint) return 0;
                let maxNeighborHeight = 0;
                for (let i = 0; i < walls.length; i++) {
                    const wall = walls[i];
                    if (!wall || typeof wall.collectPotentialJoinWalls !== "function") continue;
                    const matchesEndpoint = (wall.a && Math.abs(wall.a.x - endpoint.x) <= 1e-6 && Math.abs(wall.a.y - endpoint.y) <= 1e-6) ||
                        (wall.b && Math.abs(wall.b.x - endpoint.x) <= 1e-6 && Math.abs(wall.b.y - endpoint.y) <= 1e-6);
                    if (!matchesEndpoint) continue;
                    const neighbors = wall.collectPotentialJoinWalls();
                    if (!Array.isArray(neighbors)) continue;
                    for (let j = 0; j < neighbors.length; j++) {
                        const n = neighbors[j];
                        if (!n || n.type !== "wall") continue;
                        const sameSection = Number.isInteger(n.sectionId) && Number.isInteger(wall.sectionId) && n.sectionId === wall.sectionId;
                        if (sameSection) continue;
                        const sameAxis = (typeof wall.getLineAxis === "function" && typeof n.getLineAxis === "function")
                            ? wall.getLineAxis() === n.getLineAxis()
                            : true;
                        if (!sameAxis) continue;
                        const nh = Math.max(0, Number(n.height) || 0);
                        maxNeighborHeight = Math.max(maxNeighborHeight, nh);
                    }
                }
                return Math.min(height, maxNeighborHeight);
            };

            const capBaseStart = findNeighborHeightAtEndpoint(startEndpoint);
            const capBaseEnd = findNeighborHeightAtEndpoint(endEndpoint);

            this.id = id;
            this.walls = walls.slice();
            this.mounted = Array.isArray(mounted) ? mounted.slice() : [];
            this.mapRef = mapRef;
            this.height = height;
            this.halfThickness = maxHalfThickness;
            this.origin = { x: ax, y: ay };
            this.u = { x: ux, y: uy };
            this.v = { x: vx, y: vy };
            this.minAlong = minAlong;
            this.maxAlong = maxAlong;
            this.capBaseStart = capBaseStart;
            this.capBaseEnd = capBaseEnd;
            return true;
        }

        getVisibleFacingSign(worldToScreenFn) {
            if (!(this.maxAlong > this.minAlong) || typeof worldToScreenFn !== "function") return 1;
            const startCenter = {
                x: this.origin.x + this.u.x * this.minAlong,
                y: this.origin.y + this.u.y * this.minAlong
            };
            const endCenter = {
                x: this.origin.x + this.u.x * this.maxAlong,
                y: this.origin.y + this.u.y * this.maxAlong
            };
            const plusA = {
                x: startCenter.x + this.v.x * this.halfThickness,
                y: startCenter.y + this.v.y * this.halfThickness
            };
            const plusB = {
                x: endCenter.x + this.v.x * this.halfThickness,
                y: endCenter.y + this.v.y * this.halfThickness
            };
            const minusA = {
                x: startCenter.x - this.v.x * this.halfThickness,
                y: startCenter.y - this.v.y * this.halfThickness
            };
            const minusB = {
                x: endCenter.x - this.v.x * this.halfThickness,
                y: endCenter.y - this.v.y * this.halfThickness
            };
            const plusAScreen = worldToScreenFn(plusA);
            const plusBScreen = worldToScreenFn(plusB);
            const minusAScreen = worldToScreenFn(minusA);
            const minusBScreen = worldToScreenFn(minusB);
            const plusAvgY = (plusAScreen.y + plusBScreen.y) * 0.5;
            const minusAvgY = (minusAScreen.y + minusBScreen.y) * 0.5;
            return plusAvgY >= minusAvgY ? 1 : -1;
        }

        generateMountedPlacementCandidate(options = {}) {
            const category = (typeof options.category === "string") ? options.category.trim().toLowerCase() : "";
            if (category !== "windows" && category !== "doors") return null;
            if (!Number.isFinite(this.height) || !(this.maxAlong > this.minAlong)) return null;
            const worldToScreenFn = (typeof options.worldToScreen === "function") ? options.worldToScreen : null;
            if (!worldToScreenFn) return null;

            const objectWorldWidth = Math.max(0.2, Number(options.objectWorldWidth) || 1);
            const objectWorldHeight = Math.max(0.2, Number(options.objectWorldHeight) || 1);
            const anchorX = Number.isFinite(options.anchorX) ? Number(options.anchorX) : 0.5;
            const anchorY = Number.isFinite(options.anchorY) ? Number(options.anchorY) : 1;
            const viewscale = Number(options.viewscale);
            const xyratio = Number(options.xyratio);
            const mapRef = options.map || this.mapRef || null;
            const mouseScreen = options.mouseScreen && Number.isFinite(options.mouseScreen.x) && Number.isFinite(options.mouseScreen.y)
                ? { x: Number(options.mouseScreen.x), y: Number(options.mouseScreen.y) }
                : null;
            if (!mouseScreen || !Number.isFinite(viewscale) || !Number.isFinite(xyratio)) return null;

            const wallHalfT = Math.max(0.001, Number(this.halfThickness) || 0.05);
            const sectionLength = this.maxAlong - this.minAlong;
            const fitsLength = sectionLength + 1e-6 >= objectWorldWidth;
            const wallHeight = Math.max(0, Number(this.height) || 0);
            const fitsHeight = objectWorldHeight <= wallHeight + 1e-6;
            const toScreen = (pt, z = 0) => {
                const s = worldToScreenFn(pt);
                return {
                    x: s.x,
                    y: s.y - z * viewscale * xyratio
                };
            };
            const startCenter = {
                x: this.origin.x + this.u.x * this.minAlong,
                y: this.origin.y + this.u.y * this.minAlong
            };
            const endCenter = {
                x: this.origin.x + this.u.x * this.maxAlong,
                y: this.origin.y + this.u.y * this.maxAlong
            };
            const gSL = { x: startCenter.x + this.v.x * wallHalfT, y: startCenter.y + this.v.y * wallHalfT };
            const gSR = { x: startCenter.x - this.v.x * wallHalfT, y: startCenter.y - this.v.y * wallHalfT };
            const gEL = { x: endCenter.x + this.v.x * wallHalfT, y: endCenter.y + this.v.y * wallHalfT };
            const gER = { x: endCenter.x - this.v.x * wallHalfT, y: endCenter.y - this.v.y * wallHalfT };
            const tSL = toScreen(gSL, wallHeight);
            const tSR = toScreen(gSR, wallHeight);
            const tEL = toScreen(gEL, wallHeight);
            const tER = toScreen(gER, wallHeight);
            const mSL = toScreen(gSL, this.capBaseStart);
            const mSR = toScreen(gSR, this.capBaseStart);
            const mEL = toScreen(gEL, this.capBaseEnd);
            const mER = toScreen(gER, this.capBaseEnd);
            const longFaceA = [toScreen(gSL, 0), toScreen(gEL, 0), tEL, tSL];
            const longFaceB = [toScreen(gSR, 0), toScreen(gER, 0), tER, tSR];
            const capFaceStart = [mSR, mSL, tSL, tSR];
            const capFaceEnd = [mEL, mER, tER, tEL];
            const topFace = [tSL, tEL, tER, tSR];
            const faceDepth = pts => pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
            const longAFront = faceDepth(longFaceA) >= faceDepth(longFaceB);
            const startCapFront = faceDepth(capFaceStart) >= faceDepth(capFaceEnd);
            const showStartCap = this.capBaseStart < wallHeight - 1e-5;
            const showEndCap = this.capBaseEnd < wallHeight - 1e-5;
            const visiblePolygons = [];
            visiblePolygons.push(longAFront ? longFaceA : longFaceB);
            visiblePolygons.push(topFace);
            if (startCapFront && showStartCap) visiblePolygons.push(capFaceStart);
            if (!startCapFront && showEndCap) visiblePolygons.push(capFaceEnd);
            const containsMouse = visiblePolygons.some(poly => pointInSectionQuad(mouseScreen, poly[0], poly[1], poly[2], poly[3]));

            if (!containsMouse) return null;
            const distPx = 0;

            const facingSign = longAFront ? 1 : -1;
            const sectionStartWorld = (facingSign > 0) ? gSL : gSR;
            const sectionEndWorld = (facingSign > 0) ? gEL : gER;
            const sectionStartScreen = (facingSign > 0) ? longFaceA[0] : longFaceB[0];
            const sectionEndScreen = (facingSign > 0) ? longFaceA[1] : longFaceB[1];
            const sdx = sectionEndScreen.x - sectionStartScreen.x;
            const sdy = sectionEndScreen.y - sectionStartScreen.y;
            const sLen2 = sdx * sdx + sdy * sdy;
            if (!(sLen2 > 1e-6)) return null;
            const mouseRelX = mouseScreen.x - sectionStartScreen.x;
            const mouseRelY = mouseScreen.y - sectionStartScreen.y;
            const sectionProjTRaw = (mouseRelX * sdx + mouseRelY * sdy) / sLen2;
            const sectionProjT = Math.max(0, Math.min(1, sectionProjTRaw));
            const projScreen = {
                x: sectionStartScreen.x + sdx * sectionProjT,
                y: sectionStartScreen.y + sdy * sectionProjT
            };

            const halfWidth = objectWorldWidth * 0.5;
            const projectedAlong = this.minAlong + sectionProjT * sectionLength;
            let along = fitsLength
                ? Math.max(this.minAlong + halfWidth, Math.min(this.maxAlong - halfWidth, projectedAlong))
                : Math.max(this.minAlong, Math.min(this.maxAlong, projectedAlong));
            const sectionCenterAlong = (this.minAlong + this.maxAlong) * 0.5;
            const sectionCenterWorld = {
                x: this.origin.x + this.u.x * sectionCenterAlong + this.v.x * wallHalfT * facingSign,
                y: this.origin.y + this.u.y * sectionCenterAlong + this.v.y * wallHalfT * facingSign
            };
            const sectionCenterScreen = worldToScreenFn(sectionCenterWorld);
            const centerSnapPx = 10;
            const centerDistPx = Math.hypot(projScreen.x - sectionCenterScreen.x, projScreen.y - sectionCenterScreen.y);
            let centerSnapActive = false;
            if (Number.isFinite(centerDistPx) && centerDistPx <= centerSnapPx) {
                const centerAlong = sectionCenterAlong;
                along = fitsLength
                    ? Math.max(this.minAlong + halfWidth, Math.min(this.maxAlong - halfWidth, centerAlong))
                    : Math.max(this.minAlong, Math.min(this.maxAlong, centerAlong));
                centerSnapActive = true;
            }
            const centerXRaw = this.origin.x + this.u.x * along;
            const centerYRaw = this.origin.y + this.u.y * along;
            let centerX = centerXRaw;
            let centerY = centerYRaw;
            if (mapRef && typeof mapRef.wrapWorldX === "function") centerX = mapRef.wrapWorldX(centerX);
            if (mapRef && typeof mapRef.wrapWorldY === "function") centerY = mapRef.wrapWorldY(centerY);

            const rotDeg = Math.atan2(this.u.y, this.u.x) * (180 / Math.PI);
            const isDoorPlacement = category === "doors";
            const nx = this.v.x;
            const ny = this.v.y;
            const tx = this.u.x;
            const ty = this.u.y;
            const hitboxHalfT = isDoorPlacement ? (wallHalfT * 1.1) : wallHalfT;
            const alongOffset = (anchorX - 0.5) * objectWorldWidth;
            const verticalOffset = (1 - anchorY) * objectWorldHeight;
            const wallFaceCenterX = centerX + nx * wallHalfT * facingSign;
            const wallFaceCenterY = centerY + ny * wallHalfT * facingSign;
            const desiredBaseX = wallFaceCenterX;
            const desiredBaseY = isDoorPlacement
                ? wallFaceCenterY
                : (wallFaceCenterY - Math.max(0, (wallHeight - objectWorldHeight) * 0.5));
            let snappedX = desiredBaseX + tx * alongOffset;
            let snappedY = desiredBaseY + ty * alongOffset - verticalOffset;
            if (mapRef && typeof mapRef.wrapWorldX === "function") snappedX = mapRef.wrapWorldX(snappedX);
            if (mapRef && typeof mapRef.wrapWorldY === "function") snappedY = mapRef.wrapWorldY(snappedY);

            const p1 = { x: centerXRaw - tx * halfWidth + nx * hitboxHalfT, y: centerYRaw - ty * halfWidth + ny * hitboxHalfT };
            const p2 = { x: centerXRaw + tx * halfWidth + nx * hitboxHalfT, y: centerYRaw + ty * halfWidth + ny * hitboxHalfT };
            const p3 = { x: centerXRaw + tx * halfWidth - nx * hitboxHalfT, y: centerYRaw + ty * halfWidth - ny * hitboxHalfT };
            const p4 = { x: centerXRaw - tx * halfWidth - nx * hitboxHalfT, y: centerYRaw - ty * halfWidth - ny * hitboxHalfT };
            const wrapPoint = (pt) => ({
                x: (mapRef && typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(pt.x) : pt.x,
                y: (mapRef && typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(pt.y) : pt.y
            });

            const id = Number.isInteger(this.id) ? Number(this.id) : (Number.isInteger(options.sectionId) ? Number(options.sectionId) : null);
            return {
                valid: fitsLength && fitsHeight,
                reason: !fitsLength
                    ? ((category === "doors")
                        ? "Door is wider than this wall section."
                        : "Window is wider than this wall section.")
                    : (!fitsHeight
                        ? ((category === "doors")
                            ? "Door is taller than this wall."
                            : "Window is taller than this wall.")
                        : null),
                targetWall: Array.isArray(this.walls) && this.walls.length > 0 ? this.walls[0] : null,
                mountedWallLineGroupId: id,
                mountedSectionId: id,
                mountedWallFacingSign: facingSign,
                snappedX,
                snappedY,
                snappedRotationDeg: rotDeg,
                wallGroundHitboxPoints: [wrapPoint(p1), wrapPoint(p2), wrapPoint(p3), wrapPoint(p4)],
                wallHeight,
                wallThickness: wallHalfT * 2,
                centerSnapActive,
                sectionCenterX: (mapRef && typeof mapRef.wrapWorldX === "function")
                    ? mapRef.wrapWorldX(sectionCenterWorld.x)
                    : sectionCenterWorld.x,
                sectionCenterY: (mapRef && typeof mapRef.wrapWorldY === "function")
                    ? mapRef.wrapWorldY(sectionCenterWorld.y)
                    : sectionCenterWorld.y,
                sectionFacingSign: facingSign,
                sectionNormalX: nx,
                sectionNormalY: ny,
                sectionDirX: tx,
                sectionDirY: ty,
                wallFaceCenterX,
                wallFaceCenterY,
                placementHalfWidth: halfWidth,
                placementCenterX: desiredBaseX,
                placementCenterY: desiredBaseY,
                sectionFaceQuadScreenPoints: [
                    { x: sectionStartScreen.x, y: sectionStartScreen.y },
                    { x: sectionEndScreen.x, y: sectionEndScreen.y },
                    {
                        x: sectionEndScreen.x,
                        y: sectionEndScreen.y - wallHeight * viewscale * xyratio
                    },
                    {
                        x: sectionStartScreen.x,
                        y: sectionStartScreen.y - wallHeight * viewscale * xyratio
                    }
                ],
                sectionVisiblePolygonsScreen: visiblePolygons.map(poly => poly.map(p => ({ x: p.x, y: p.y }))),
                wallContainsMouse: containsMouse,
                screenDist: distPx
            };
        }

        computeMembershipSignature(getObjectId) {
            if (typeof getObjectId !== "function") return "";
            const wallIds = this.walls.map(item => String(getObjectId(item))).filter(Boolean);
            const mountedIds = this.mounted.map(item => String(getObjectId(item))).filter(Boolean);
            return `${wallIds.join(",")}::${mountedIds.join(",")}`;
        }

        buildMeshSprite(pixiRef, options = {}) {
            if (!pixiRef || !(this.maxAlong > this.minAlong) || !(this.height > 0)) return null;
            const viewscale = Number(options.viewscale);
            const xyratio = Number(options.xyratio);
            const screenOffsetX = Number(options.screenOffsetX) || 0;
            const screenOffsetY = Number(options.screenOffsetY) || 0;
            if (!Number.isFinite(viewscale) || !Number.isFinite(xyratio)) return null;
            if (typeof worldToScreen !== "function") return null;

            const wallClass = (typeof globalScope.Wall !== "undefined") ? globalScope.Wall : null;
            const stoneTexture = (wallClass && typeof wallClass.getStoneWallTexture === "function")
                ? wallClass.getStoneWallTexture()
                : null;
            const color = Number.isFinite(options.color) ? Number(options.color) : 0x555555;
            const alpha = Number.isFinite(options.alpha) ? Number(options.alpha) : 1;

            const startCenter = {
                x: this.origin.x + this.u.x * this.minAlong,
                y: this.origin.y + this.u.y * this.minAlong
            };
            const endCenter = {
                x: this.origin.x + this.u.x * this.maxAlong,
                y: this.origin.y + this.u.y * this.maxAlong
            };
            const gSL = { x: startCenter.x + this.v.x * this.halfThickness, y: startCenter.y + this.v.y * this.halfThickness };
            const gSR = { x: startCenter.x - this.v.x * this.halfThickness, y: startCenter.y - this.v.y * this.halfThickness };
            const gEL = { x: endCenter.x + this.v.x * this.halfThickness, y: endCenter.y + this.v.y * this.halfThickness };
            const gER = { x: endCenter.x - this.v.x * this.halfThickness, y: endCenter.y - this.v.y * this.halfThickness };

            const toScreen = (pt, z = 0) => {
                const s = worldToScreen(pt);
                return {
                    x: s.x + screenOffsetX,
                    y: (s.y - z * viewscale * xyratio) + screenOffsetY
                };
            };
            const tSL = toScreen(gSL, this.height);
            const tSR = toScreen(gSR, this.height);
            const tEL = toScreen(gEL, this.height);
            const tER = toScreen(gER, this.height);
            const mSL = toScreen(gSL, this.capBaseStart);
            const mSR = toScreen(gSR, this.capBaseStart);
            const mEL = toScreen(gEL, this.capBaseEnd);
            const mER = toScreen(gER, this.capBaseEnd);

            const longFaceA = [toScreen(gSL, 0), toScreen(gEL, 0), tEL, tSL];
            const longFaceB = [toScreen(gSR, 0), toScreen(gER, 0), tER, tSR];
            const capFaceStart = [mSR, mSL, tSL, tSR];
            const capFaceEnd = [mEL, mER, tER, tEL];
            const topFace = [tSL, tEL, tER, tSR];

            const faceDepth = pts => pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
            const shadeColor = (hex, factor) => {
                const f = Math.max(0, factor);
                const r = Math.min(255, Math.max(0, Math.round(((hex >> 16) & 0xff) * f)));
                const g = Math.min(255, Math.max(0, Math.round(((hex >> 8) & 0xff) * f)));
                const b = Math.min(255, Math.max(0, Math.round((hex & 0xff) * f)));
                return (r << 16) | (g << 8) | b;
            };
            const longAFront = faceDepth(longFaceA) >= faceDepth(longFaceB);
            const startCapFront = faceDepth(capFaceStart) >= faceDepth(capFaceEnd);
            const showStartCap = this.capBaseStart < this.height - 1e-5;
            const showEndCap = this.capBaseEnd < this.height - 1e-5;

            const graphics = new pixiRef.Graphics();
            const faces = [
                longAFront
                    ? { pts: longFaceA, color: shadeColor(color, 1.18), textured: true, phaseA: this.minAlong / 3, phaseB: this.maxAlong / 3 }
                    : { pts: longFaceB, color: shadeColor(color, 1.18), textured: true, phaseA: this.minAlong / 3, phaseB: this.maxAlong / 3 }
            ];
            if (startCapFront && showStartCap) {
                faces.push({ pts: capFaceStart, color: shadeColor(color, 1.08), textured: true, phaseA: 0, phaseB: Math.max(1e-6, this.halfThickness * 2 / 3) });
            }
            if (!startCapFront && showEndCap) {
                faces.push({ pts: capFaceEnd, color: shadeColor(color, 1.08), textured: true, phaseA: 0, phaseB: Math.max(1e-6, this.halfThickness * 2 / 3) });
            }
            faces.sort((a, b) => faceDepth(a.pts) - faceDepth(b.pts));

            const zUnitPx = Math.max(1, viewscale * xyratio);
            graphics.lineStyle(0);
            for (let i = 0; i < faces.length; i++) {
                const face = faces[i];
                const pts = face.pts;
                const canTexture = !!stoneTexture && face.textured;
                if (canTexture) {
                    const bottomA = pts[0];
                    const bottomB = pts[1];
                    const topA = pts[3];
                    const u = { x: bottomB.x - bottomA.x, y: bottomB.y - bottomA.y };
                    const v = { x: topA.x - bottomA.x, y: topA.y - bottomA.y };
                    const uLen = Math.max(1e-6, Math.hypot(u.x, u.y));
                    const vLen = Math.max(1e-6, Math.hypot(v.x, v.y));
                    const uDir = { x: u.x / uLen, y: u.y / uLen };
                    const vDir = { x: v.x / vLen, y: v.y / vLen };
                    const texW = Math.max(1, stoneTexture.width || (stoneTexture.baseTexture && stoneTexture.baseTexture.width) || 256);
                    const texH = Math.max(1, stoneTexture.height || (stoneTexture.baseTexture && stoneTexture.baseTexture.height) || 256);
                    const repeatsAcrossFace = Math.max(1e-6, Math.abs(face.phaseB - face.phaseA));
                    const uRepeatPx = Math.max(1, uLen / repeatsAcrossFace);
                    const vRepeatPx = zUnitPx * 3;
                    const phaseShiftPx = face.phaseA * uRepeatPx;
                    const matrix = new pixiRef.Matrix(
                        uDir.x * (uRepeatPx / texW),
                        uDir.y * (uRepeatPx / texW),
                        vDir.x * (vRepeatPx / texH),
                        vDir.y * (vRepeatPx / texH),
                        bottomA.x - uDir.x * phaseShiftPx,
                        bottomA.y - uDir.y * phaseShiftPx
                    );
                    graphics.beginTextureFill({ texture: stoneTexture, color: face.color, alpha, matrix });
                } else {
                    graphics.beginFill(face.color, alpha);
                }
                graphics.moveTo(pts[0].x, pts[0].y);
                for (let p = 1; p < pts.length; p++) graphics.lineTo(pts[p].x, pts[p].y);
                graphics.closePath();
                graphics.endFill();
            }

            const topCenter = topFace.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
            topCenter.x /= topFace.length;
            topCenter.y /= topFace.length;
            const orderedTop = topFace.slice().sort(
                (p1, p2) => Math.atan2(p1.y - topCenter.y, p1.x - topCenter.x) - Math.atan2(p2.y - topCenter.y, p2.x - topCenter.x)
            );
            graphics.beginFill(shadeColor(color, 1.2), alpha);
            graphics.moveTo(orderedTop[0].x, orderedTop[0].y);
            for (let i = 1; i < orderedTop.length; i++) graphics.lineTo(orderedTop[i].x, orderedTop[i].y);
            graphics.closePath();
            graphics.endFill();
            return graphics;
        }

        buildSectionImage(appRef, pixiRef, options = {}) {
            if (!appRef || !appRef.renderer || !pixiRef) return null;
            const viewscale = Number(options.viewscale);
            const xyratio = Number(options.xyratio);
            const color = Number.isFinite(options.color) ? Number(options.color) : 0x555555;
            const alpha = Number.isFinite(options.alpha) ? Number(options.alpha) : 1;
            const pad = Number.isFinite(options.pad) ? Math.max(0, Number(options.pad)) : 2;
            if (!Number.isFinite(viewscale) || !Number.isFinite(xyratio)) return null;

            const wallMeshAtOrigin = this.buildMeshSprite(pixiRef, {
                viewscale,
                xyratio,
                screenOffsetX: 0,
                screenOffsetY: 0,
                color,
                alpha
            });
            if (!wallMeshAtOrigin) return null;

            let wallBounds = null;
            try {
                wallBounds = wallMeshAtOrigin.getBounds(false);
            } catch (_) {
                wallBounds = null;
            }
            if (!wallBounds || !Number.isFinite(wallBounds.x) || !Number.isFinite(wallBounds.y) || !Number.isFinite(wallBounds.width) || !Number.isFinite(wallBounds.height)) {
                wallMeshAtOrigin.destroy();
                return null;
            }

            let minX = wallBounds.x;
            let minY = wallBounds.y;
            let maxX = wallBounds.x + wallBounds.width;
            let maxY = wallBounds.y + wallBounds.height;
            const mountedEntries = [];
            for (let i = 0; i < this.mounted.length; i++) {
                const item = this.mounted[i];
                const displayObj = item && item.pixiSprite ? item.pixiSprite : null;
                if (!displayObj) continue;
                let bounds = null;
                try {
                    bounds = displayObj.getBounds(false);
                } catch (_) {
                    bounds = null;
                }
                if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) continue;
                if (!(bounds.width > 0 && bounds.height > 0)) continue;
                mountedEntries.push({ item, displayObj, bounds });
                minX = Math.min(minX, bounds.x);
                minY = Math.min(minY, bounds.y);
                maxX = Math.max(maxX, bounds.x + bounds.width);
                maxY = Math.max(maxY, bounds.y + bounds.height);
            }

            const baseX = Math.floor(minX) - pad;
            const baseY = Math.floor(minY) - pad;
            const width = Math.max(2, Math.ceil(maxX - minX) + (pad * 2) + 2);
            const height = Math.max(2, Math.ceil(maxY - minY) + (pad * 2) + 2);

            wallMeshAtOrigin.destroy();
            const wallMesh = this.buildMeshSprite(pixiRef, {
                viewscale,
                xyratio,
                screenOffsetX: -baseX,
                screenOffsetY: -baseY,
                color,
                alpha
            });
            if (!wallMesh) return null;

            const tempContainer = new pixiRef.Container();
            tempContainer.addChild(wallMesh);
            const tempTextures = [];
            let generationFailed = false;
            for (let i = 0; i < mountedEntries.length; i++) {
                const entry = mountedEntries[i];
                const displayObj = entry.displayObj;
                let generatedTexture = null;
                const originalAlpha = Number.isFinite(displayObj.alpha) ? displayObj.alpha : 1;
                const originalTint = Number.isFinite(displayObj.tint) ? displayObj.tint : 0xFFFFFF;
                try {
                    displayObj.alpha = 1;
                    if (Number.isFinite(displayObj.tint)) displayObj.tint = 0xFFFFFF;
                    generatedTexture = appRef.renderer.generateTexture(displayObj);
                } catch (_) {
                    generatedTexture = null;
                } finally {
                    displayObj.alpha = originalAlpha;
                    if (Number.isFinite(displayObj.tint)) displayObj.tint = originalTint;
                }
                if (!generatedTexture) {
                    generationFailed = true;
                    break;
                }
                tempTextures.push(generatedTexture);
                const sprite = new pixiRef.Sprite(generatedTexture);
                sprite.anchor.set(0, 0);
                sprite.x = entry.bounds.x - baseX;
                sprite.y = entry.bounds.y - baseY;
                tempContainer.addChild(sprite);
            }
            if (generationFailed) {
                tempContainer.destroy({ children: true });
                for (let i = 0; i < tempTextures.length; i++) {
                    if (tempTextures[i] && typeof tempTextures[i].destroy === "function") {
                        tempTextures[i].destroy(true);
                    }
                }
                return null;
            }

            const renderTexture = pixiRef.RenderTexture.create({ width, height });
            try {
                appRef.renderer.render({ container: tempContainer, target: renderTexture, clear: true });
            } catch (_) {
                appRef.renderer.render(tempContainer, renderTexture, true);
            }
            tempContainer.destroy({ children: true });
            for (let i = 0; i < tempTextures.length; i++) {
                if (tempTextures[i] && typeof tempTextures[i].destroy === "function") {
                    tempTextures[i].destroy(true);
                }
            }

            return { renderTexture, baseX, baseY, width, height };
        }
    }

    function getWallMountedPlacementCandidate(options = {}) {
        const mapRef = options.map || null;
        const category = (typeof options.category === "string") ? options.category.trim().toLowerCase() : "";
        if (category !== "windows" && category !== "doors") return null;
        if (!mapRef) return null;
        const worldToScreenFn = (typeof options.worldToScreen === "function")
            ? options.worldToScreen
            : ((typeof worldToScreen === "function") ? worldToScreen : null);
        if (!worldToScreenFn) return null;
        const worldX = Number(options.worldX);
        const worldY = Number(options.worldY);
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const mouseScreen = options.mouseScreen && Number.isFinite(options.mouseScreen.x) && Number.isFinite(options.mouseScreen.y)
            ? options.mouseScreen
            : worldToScreenFn({ x: worldX, y: worldY });

        const onscreenSource = (typeof globalScope !== "undefined" && globalScope)
            ? (
                globalScope.onscreenObjects ||
                (typeof globalScope.getOnscreenObjects === "function" ? globalScope.getOnscreenObjects() : null)
            )
            : null;
        if (!onscreenSource || typeof onscreenSource.forEach !== "function") return null;
        const onscreenSectionIds = new Set();
        onscreenSource.forEach(obj => {
            if (!obj) return;
            if (obj.gone || obj.vanishing) return;
            if (obj.type !== "wall" || !obj.a || !obj.b) return;
            if (Number.isInteger(obj.sectionId)) {
                onscreenSectionIds.add(Number(obj.sectionId));
                return;
            }
            if (Number.isInteger(obj.lineGroupId)) {
                onscreenSectionIds.add(Number(obj.lineGroupId));
            }
        });
        if (onscreenSectionIds.size === 0) return null;

        let best = null;
        const sectionIds = Array.from(onscreenSectionIds);
        for (let i = 0; i < sectionIds.length; i++) {
            const sectionId = sectionIds[i];
            const section = getOrBuildPlacementSection(sectionId, mapRef);
            if (!section) continue;
            const candidate = section.generateMountedPlacementCandidate({
                category,
                objectWorldWidth: options.objectWorldWidth,
                objectWorldHeight: options.objectWorldHeight,
                anchorX: options.anchorX,
                anchorY: options.anchorY,
                viewscale: options.viewscale,
                xyratio: options.xyratio,
                mouseScreen,
                maxSnapDistPx: options.maxSnapDistPx,
                map: mapRef,
                worldToScreen: worldToScreenFn,
                sectionId: sectionId
            });
            if (!candidate) continue;
            const replace = (
                !best ||
                (candidate.wallContainsMouse && !best.wallContainsMouse) ||
                (
                    candidate.wallContainsMouse === best.wallContainsMouse &&
                    candidate.screenDist < best.screenDist - 1e-6
                )
            );
            if (replace) best = candidate;
        }
        placementDirtyAll = false;
        return best;
    }

    function restoreRenderable(items, isWallMountedPlaceable) {
        if (!Array.isArray(items)) return;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item || !item.pixiSprite) continue;
            if (item.type === "wall" || (isWallMountedPlaceable(item) && item.type !== "placedObjectPreview")) {
                item.pixiSprite.renderable = true;
            }
        }
    }

    function buildCompositeRenderItems(options = {}) {
        const enabled = !!options.enabled;
        const items = Array.isArray(options.items) ? options.items : [];
        const cachePrefix = (typeof options.cachePrefix === "string" && options.cachePrefix.length > 0) ? options.cachePrefix : "default";
        const camera = options.camera || null;
        const mapRef = options.map || null;
        const appRef = options.app || null;
        const pixiRef = options.PIXI || (typeof globalScope.PIXI !== "undefined" ? globalScope.PIXI : null);
        const viewscale = Number(options.viewscale);
        const xyratio = Number(options.xyratio);
        const isWallMountedPlaceable = (typeof options.isWallMountedPlaceable === "function")
            ? options.isWallMountedPlaceable
            : (() => false);

        if (!enabled || !appRef || !appRef.renderer || !pixiRef) {
            return { renderItems: [], hiddenItems: new Set(), stats: { groups: 0, rebuilt: 0 } };
        }

        // Reset section-member renderability each frame. Compositing will hide
        // only the members represented by active composite items this frame.
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item || !item.pixiSprite || item.gone || item.vanishing) continue;
            if (item.type === "wall" || (isWallMountedPlaceable(item) && item.type !== "placedObjectPreview")) {
                item.pixiSprite.renderable = true;
                item._wallSectionCompositeSprite = null;
                item._wallSectionCompositeDisplayObject = null;
            }
        }

        const groups = buildCompositeSubgroups(items, mapRef, isWallMountedPlaceable);
        const seenSectionIds = new Set();
        const dirtyGroupIdsToClear = new Set();
        const seenKeys = new Set();
        const hiddenItems = new Set();
        const renderItems = [];
        let groupsCount = 0;
        let rebuiltCount = 0;

        groups.forEach(groupEntry => {
            const members = Array.isArray(groupEntry && groupEntry.members) ? groupEntry.members : [];
            const groupId = Number.isInteger(groupEntry && groupEntry.baseGroupId) ? groupEntry.baseGroupId : null;
            const subgroupKey = (groupEntry && typeof groupEntry.key === "string" && groupEntry.key.length > 0)
                ? groupEntry.key
                : null;
            if (!Array.isArray(members) || members.length === 0 || !subgroupKey) return;

            const wallMembers = members.filter(item => item && item.type === "wall");
            const mountedMembers = members.filter(item => item && item.type !== "wall");
            if (wallMembers.length === 0) return;
            wallMembers.sort((a, b) => getSectionObjectId(a) - getSectionObjectId(b));
            mountedMembers.sort((a, b) => getSectionObjectId(a) - getSectionObjectId(b));
            groupsCount += 1;

            const compositeKey = `${cachePrefix}:${subgroupKey}`;
            seenKeys.add(compositeKey);
            seenSectionIds.add(subgroupKey);
            let bundle = sectionCompositeCache.get(compositeKey);
            if (!bundle) {
                bundle = {
                    key: compositeKey,
                    sprite: new pixiRef.Sprite(pixiRef.Texture.WHITE),
                    renderTexture: null,
                    renderItem: null,
                    membershipSignature: "",
                    buildCameraX: Number.isFinite(camera && camera.x) ? Number(camera.x) : 0,
                    buildCameraY: Number.isFinite(camera && camera.y) ? Number(camera.y) : 0,
                    baseScreenX: 0,
                    baseScreenY: 0,
                    textureWidth: 0,
                    textureHeight: 0,
                    viewscale,
                    xyratio
                };
                bundle.sprite.anchor.set(0, 0);
                bundle.sprite.roundPixels = false;
                sectionCompositeCache.set(compositeKey, bundle);
            }

            const groupDirty = sectionDirtyAll || (Number.isInteger(groupId) && sectionDirtyIds.has(groupId));
            const wallIds = wallMembers.map(item => String(getSectionObjectId(item))).filter(Boolean);
            const mountedIds = mountedMembers.map(item => String(getSectionObjectId(item))).filter(Boolean);
            const membershipSignature = `${wallIds.join(",")}::${mountedIds.join(",")}`;
            const needsRebuild = (
                groupDirty ||
                !bundle.renderTexture ||
                bundle.membershipSignature !== membershipSignature ||
                !Number.isFinite(bundle.viewscale) ||
                Math.abs(bundle.viewscale - viewscale) > 1e-6 ||
                !Number.isFinite(bundle.xyratio) ||
                Math.abs(bundle.xyratio - xyratio) > 1e-6
            );

            if (needsRebuild) {
                let section = wallSectionInstances.get(subgroupKey);
                if (!section) {
                    section = new WallSection({ id: subgroupKey });
                    wallSectionInstances.set(subgroupKey, section);
                }
                const sectionReady = section.setFromWalls(wallMembers, mapRef, subgroupKey, mountedMembers);
                if (!sectionReady) {
                    bundle.sprite.visible = false;
                    bundle.membershipSignature = "";
                    return;
                }
                const generatedImage = section.buildSectionImage(appRef, pixiRef, {
                    viewscale,
                    xyratio,
                    color: 0x555555,
                    alpha: 1,
                    pad: 2
                });
                if (!generatedImage || !generatedImage.renderTexture) {
                    bundle.sprite.visible = false;
                    bundle.membershipSignature = "";
                    return;
                }
                const nextRenderTexture = generatedImage.renderTexture;
                if (bundle.renderTexture && typeof bundle.renderTexture.destroy === "function") {
                    bundle.renderTexture.destroy(true);
                }
                bundle.renderTexture = nextRenderTexture;
                bundle.sprite.texture = nextRenderTexture;
                bundle.membershipSignature = membershipSignature;
                bundle.baseScreenX = generatedImage.baseX;
                bundle.baseScreenY = generatedImage.baseY;
                bundle.textureWidth = generatedImage.width;
                bundle.textureHeight = generatedImage.height;
                bundle.buildCameraX = Number.isFinite(camera && camera.x) ? Number(camera.x) : 0;
                bundle.buildCameraY = Number.isFinite(camera && camera.y) ? Number(camera.y) : 0;
                bundle.viewscale = viewscale;
                bundle.xyratio = xyratio;
                if (Number.isInteger(groupId)) dirtyGroupIdsToClear.add(groupId);
                rebuiltCount += 1;
            }

            const camDx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(camera.x, bundle.buildCameraX)
                : (bundle.buildCameraX - camera.x);
            const camDy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(camera.y, bundle.buildCameraY)
                : (bundle.buildCameraY - camera.y);
            bundle.sprite.x = bundle.baseScreenX + camDx * viewscale;
            bundle.sprite.y = bundle.baseScreenY + camDy * viewscale * xyratio;

            let sectionVisualSource = wallMembers.find(item => item && item.pixiSprite && item.pixiSprite.visible);
            if (!sectionVisualSource && wallMembers.length > 0) sectionVisualSource = wallMembers[0];
            if (!sectionVisualSource && members.length > 0) sectionVisualSource = members[0];
            const sourceSprite = sectionVisualSource && sectionVisualSource.pixiSprite ? sectionVisualSource.pixiSprite : null;
            bundle.sprite.alpha = sourceSprite && Number.isFinite(sourceSprite.alpha) ? sourceSprite.alpha : 1;
            bundle.sprite.tint = sourceSprite && Number.isFinite(sourceSprite.tint) ? sourceSprite.tint : 0xFFFFFF;
            bundle.sprite.visible = true;

            for (let i = 0; i < members.length; i++) {
                const member = members[i];
                if (!member || !member.pixiSprite) continue;
                member.pixiSprite.renderable = false;
                member._wallSectionCompositeSprite = bundle.sprite;
                member._wallSectionCompositeDisplayObject = null;
                hiddenItems.add(member);
            }

            let minBottom = Infinity;
            let maxTop = -Infinity;
            let avgX = 0;
            let avgY = 0;
            let count = 0;
            for (let i = 0; i < wallMembers.length; i++) {
                const wall = wallMembers[i];
                if (!wall) continue;
                const bottom = Number.isFinite(wall.bottomZ) ? Number(wall.bottomZ) : (Number.isFinite(wall.z) ? Number(wall.z) : 0);
                const top = bottom + (Number.isFinite(wall.height) ? Math.max(0, Number(wall.height)) : 0);
                minBottom = Math.min(minBottom, bottom);
                maxTop = Math.max(maxTop, top);
                if (Number.isFinite(wall.x) && Number.isFinite(wall.y)) {
                    avgX += Number(wall.x);
                    avgY += Number(wall.y);
                    count += 1;
                }
            }
            if (!Number.isFinite(minBottom)) minBottom = 0;
            if (!Number.isFinite(maxTop)) maxTop = minBottom;
            if (count > 0) {
                avgX /= count;
                avgY /= count;
            } else {
                avgX = 0;
                avgY = 0;
            }
            const representativeWall = wallMembers[0] || null;
            const representativeHitbox = representativeWall && representativeWall.groundPlaneHitbox
                ? representativeWall.groundPlaneHitbox
                : null;
            if (!bundle.renderItem) {
                bundle.renderItem = {
                    type: "wallSectionComposite",
                    x: 0,
                    y: 0,
                    z: 0,
                    bottomZ: 0,
                    height: 0,
                    lineGroupId: null,
                    mountedWallLineGroupId: null,
                    sectionId: null,
                    groundPlaneHitbox: null,
                    pixiSprite: bundle.sprite,
                    skipTransform: true,
                    draw: () => {},
                    _sectionCompositeBundleKey: compositeKey,
                    _sectionMemberWalls: [],
                    _sectionMountedMembers: [],
                    _sectionCompositeMembershipSignature: ""
                };
            }
            bundle.renderItem.x = avgX;
            bundle.renderItem.y = avgY;
            bundle.renderItem.z = minBottom;
            bundle.renderItem.bottomZ = minBottom;
            bundle.renderItem.height = Math.max(0, maxTop - minBottom);
            bundle.renderItem.lineGroupId = Number.isInteger(groupId) ? Number(groupId) : null;
            bundle.renderItem.mountedWallLineGroupId = Number.isInteger(groupId) ? Number(groupId) : null;
            bundle.renderItem.sectionId = Number.isInteger(groupId) ? Number(groupId) : null;
            bundle.renderItem.groundPlaneHitbox = representativeHitbox;
            bundle.renderItem.pixiSprite = bundle.sprite;
            bundle.renderItem._sectionMemberWalls = wallMembers.slice();
            bundle.renderItem._sectionMountedMembers = mountedMembers.slice();
            bundle.renderItem._sectionCompositeMembershipSignature = membershipSignature;
            renderItems.push(bundle.renderItem);
        });

        const cacheKeys = Array.from(sectionCompositeCache.keys());
        for (let i = 0; i < cacheKeys.length; i++) {
            const key = cacheKeys[i];
            if (!key.startsWith(`${cachePrefix}:`)) continue;
            if (seenKeys.has(key)) continue;
            const bundle = sectionCompositeCache.get(key);
            destroyBundle(bundle);
            sectionCompositeCache.delete(key);
        }
        const sectionIds = Array.from(wallSectionInstances.keys());
        for (let i = 0; i < sectionIds.length; i++) {
            const id = sectionIds[i];
            if (seenSectionIds.has(id)) continue;
            wallSectionInstances.delete(id);
        }
        dirtyGroupIdsToClear.forEach(id => {
            sectionDirtyIds.delete(id);
        });

        return { renderItems, hiddenItems, stats: { groups: groupsCount, rebuilt: rebuiltCount } };
    }

    globalScope.WallSectionsRenderer = {
        markDirty,
        markAllDirty,
        queueRebuildPass,
        clearCache,
        prepareFrame,
        endFrame,
        restoreRenderable,
        buildCompositeRenderItems,
        computeHoverForWallPlacement,
        buildLosWallOpeningMap,
        getWallMountedPlacementCandidate
    };

    // Backward-compatible globals used by other files.
    globalScope.markWallSectionDirty = markDirty;
    globalScope.markAllWallSectionsDirty = markAllDirty;
    globalScope.queueWallSectionRebuildPass = queueRebuildPass;
})(typeof globalThis !== "undefined" ? globalThis : window);
