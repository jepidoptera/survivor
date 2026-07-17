(function () {
    function finiteNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function normalizeSnapPointsPerSection(value) {
        const count = Math.round(Number(value));
        return Number.isInteger(count) && count >= 1 && count <= 64 ? count : 1;
    }

    function nearestSnapT(t, snapPointsPerSection) {
        const count = normalizeSnapPointsPerSection(snapPointsPerSection);
        const clamped = Math.max(0, Math.min(1, Number(t)));
        const index = Math.max(0, Math.min(count - 1, Math.floor(clamped * count)));
        return (index + 0.5) / count;
    }

    function wrapPoint(mapRef, point) {
        return {
            x: mapRef && typeof mapRef.wrapWorldX === "function" ? mapRef.wrapWorldX(point.x) : point.x,
            y: mapRef && typeof mapRef.wrapWorldY === "function" ? mapRef.wrapWorldY(point.y) : point.y
        };
    }

    function resolveWallMountedPlacementCandidate(options) {
        const section = options && options.section;
        const worldX = finiteNumber(options && options.worldX);
        const worldY = finiteNumber(options && options.worldY);
        if (!section || worldX === null || worldY === null) return null;

        const category = String((options && options.category) || "").trim().toLowerCase();
        if (category !== "windows" && category !== "doors") return null;

        const placeableScale = finiteNumber(options && options.placeableScale);
        const scaleMin = finiteNumber(options && options.scaleMin);
        const scaleMax = finiteNumber(options && options.scaleMax);
        const clampedScale = Math.max(
            scaleMin !== null ? scaleMin : 0.2,
            Math.min(scaleMax !== null ? scaleMax : 5, placeableScale !== null ? placeableScale : 1)
        );
        const selectedAnchorY = finiteNumber(options && options.anchorY);
        const effectiveAnchorY = category === "windows" ? 0.5 : (selectedAnchorY !== null ? selectedAnchorY : 1);
        const objectWidth = finiteNumber(options && options.width) || clampedScale;
        const objectHeight = finiteNumber(options && options.height) || clampedScale;
        if (!(objectWidth > 0) || !(objectHeight > 0)) return null;

        const mouseScreen = options && options.mouseScreen;
        const toScreenPoint = typeof (options && options.toScreenPoint) === "function"
            ? options.toScreenPoint
            : null;
        const worldToScreenFn = typeof (options && options.worldToScreenFn) === "function"
            ? options.worldToScreenFn
            : null;
        const viewscale = finiteNumber(options && options.viewscale) || 1;
        const xyratio = finiteNumber(options && options.xyratio) || 0.66;
        const mapRef = (options && options.mapRef) || null;
        if (!mouseScreen || !Number.isFinite(Number(mouseScreen.x)) || !Number.isFinite(Number(mouseScreen.y))) return null;
        if (!toScreenPoint && !worldToScreenFn) return null;
        if (!section.startPoint || !section.endPoint) return null;
        if (typeof section.getWallProfile !== "function") return null;
        const profile = section.getWallProfile();
        if (!profile) return null;

        const wallHeight = Math.max(0, Number(section.height) || 0);
        const wallBottomZ = Number.isFinite(Number(section.bottomZ)) ? Number(section.bottomZ) : 0;
        const wallTopZ = wallBottomZ + wallHeight;
        const halfT = Math.max(0.001, Number(section.thickness) || 0.001) * 0.5;

        const sx = finiteNumber(section.startPoint.x);
        const sy = finiteNumber(section.startPoint.y);
        const ex = finiteNumber(section.endPoint.x);
        const ey = finiteNumber(section.endPoint.y);
        if (sx === null || sy === null || ex === null || ey === null) return null;

        const dx = ex - sx;
        const dy = ey - sy;
        const len = Math.hypot(dx, dy);
        if (!(len > 1e-6)) return null;

        const ux = dx / len;
        const uy = dy / len;
        const vx = -uy;
        const vy = ux;
        const { aLeft, aRight, bLeft, bRight } = profile;

        const toScreen = (pt, z) => {
            if (toScreenPoint) return toScreenPoint(pt, z);
            const s = worldToScreenFn(pt);
            return { x: s.x, y: s.y - z * viewscale * xyratio };
        };

        const longFaceA = [toScreen(aLeft, wallBottomZ), toScreen(bLeft, wallBottomZ), toScreen(bLeft, wallTopZ), toScreen(aLeft, wallTopZ)];
        const longFaceB = [toScreen(aRight, wallBottomZ), toScreen(bRight, wallBottomZ), toScreen(bRight, wallTopZ), toScreen(aRight, wallTopZ)];
        const faceDepth = pts => pts.reduce((sum, p) => sum + Number(p.y), 0) / pts.length;
        const longAFront = faceDepth(longFaceA) >= faceDepth(longFaceB);
        const frontFace = longAFront ? longFaceA : longFaceB;
        const facingSign = longAFront ? 1 : -1;

        const sectionStartScreen = facingSign > 0 ? longFaceA[0] : longFaceB[0];
        const sectionEndScreen = facingSign > 0 ? longFaceA[1] : longFaceB[1];
        const sdx = Number(sectionEndScreen.x) - Number(sectionStartScreen.x);
        const sdy = Number(sectionEndScreen.y) - Number(sectionStartScreen.y);
        const sLen2 = sdx * sdx + sdy * sdy;
        if (!(sLen2 > 1e-6)) return null;

        const wallPosition = typeof section.getWallPositionAtScreenPoint === "function"
            ? section.getWallPositionAtScreenPoint(
                Number(mouseScreen.x),
                Number(mouseScreen.y),
                {
                    worldX,
                    worldY,
                    toScreenPoint,
                    worldToScreenFn: toScreenPoint || worldToScreenFn,
                    viewscale,
                    xyratio
                }
            )
            : null;
        const mouseRelX = Number(mouseScreen.x) - Number(sectionStartScreen.x);
        const mouseRelY = Number(mouseScreen.y) - Number(sectionStartScreen.y);
        const fallbackProjT = Math.max(0, Math.min(1, (mouseRelX * sdx + mouseRelY * sdy) / sLen2));
        const sectionProjT = Number.isFinite(wallPosition)
            ? Math.max(0, Math.min(1, Number(wallPosition)))
            : fallbackProjT;

        const halfWidth = objectWidth * 0.5;
        const fitsLength = len + 1e-6 >= objectWidth;
        const fitsHeight = objectHeight <= wallHeight + 1e-6;

        let along = sectionProjT * len;
        along = fitsLength
            ? Math.max(halfWidth, Math.min(len - halfWidth, along))
            : Math.max(0, Math.min(len, along));

        const sectionCenterAlong = len * 0.5;
        const sectionCenterWorld = {
            x: sx + ux * sectionCenterAlong + vx * halfT * facingSign,
            y: sy + uy * sectionCenterAlong + vy * halfT * facingSign
        };
        const centerSnapPx = Number.isFinite(Number(options && options.centerSnapPx))
            ? Number(options.centerSnapPx)
            : 10;
        const snapPointsPerSection = normalizeSnapPointsPerSection(options && options.snapPointsPerSection);
        const projectedScreenT = Math.max(0, Math.min(1, (mouseRelX * sdx + mouseRelY * sdy) / sLen2));
        const nearestSectionSnapT = nearestSnapT(projectedScreenT, snapPointsPerSection);
        const centerDistPx = Math.abs(projectedScreenT - nearestSectionSnapT) * Math.sqrt(sLen2);
        let centerSnapActive = false;
        if (Number.isFinite(centerDistPx) && centerDistPx <= centerSnapPx) {
            const sectionSnapAlong = len * nearestSectionSnapT;
            along = fitsLength
                ? Math.max(halfWidth, Math.min(len - halfWidth, sectionSnapAlong))
                : Math.max(0, Math.min(len, sectionSnapAlong));
            centerSnapActive = true;
        }

        const rotDeg = Math.atan2(uy, ux) * (180 / Math.PI);
        const isDoorPlacement = category === "doors";
        const hitboxHalfT = isDoorPlacement ? halfT * 1.1 : halfT;

        let centerX = sx + ux * along;
        let centerY = sy + uy * along;
        let wallFaceCenterX = centerX + vx * halfT * facingSign;
        let wallFaceCenterY = centerY + vy * halfT * facingSign;
        if (mapRef && typeof mapRef.wrapWorldX === "function") {
            centerX = mapRef.wrapWorldX(centerX);
            wallFaceCenterX = mapRef.wrapWorldX(wallFaceCenterX);
        }
        if (mapRef && typeof mapRef.wrapWorldY === "function") {
            centerY = mapRef.wrapWorldY(centerY);
            wallFaceCenterY = mapRef.wrapWorldY(wallFaceCenterY);
        }

        let wallAnchorZ = category === "windows" ? wallHeight * 0.5 : 0;
        let verticalCenterSnapActive = false;
        let verticalPeerSnapActive = false;
        let verticalSnapKind = null;
        let verticalSnapTarget = null;
        if (category === "windows") {
            const wallT = len > 0 ? along / len : 0.5;
            const bottomAtT = {
                x: Number(frontFace[0].x) + (Number(frontFace[1].x) - Number(frontFace[0].x)) * wallT,
                y: Number(frontFace[0].y) + (Number(frontFace[1].y) - Number(frontFace[0].y)) * wallT
            };
            const topAtT = {
                x: Number(frontFace[3].x) + (Number(frontFace[2].x) - Number(frontFace[3].x)) * wallT,
                y: Number(frontFace[3].y) + (Number(frontFace[2].y) - Number(frontFace[3].y)) * wallT
            };
            const verticalScreenX = topAtT.x - bottomAtT.x;
            const verticalScreenY = topAtT.y - bottomAtT.y;
            const verticalLen2 = verticalScreenX * verticalScreenX + verticalScreenY * verticalScreenY;
            let verticalT = 0.5;
            if (verticalLen2 > 1e-6) {
                verticalT = (
                    ((Number(mouseScreen.x) - bottomAtT.x) * verticalScreenX) +
                    ((Number(mouseScreen.y) - bottomAtT.y) * verticalScreenY)
                ) / verticalLen2;
                verticalT = Math.max(0, Math.min(1, verticalT));
            }
            wallAnchorZ = verticalT * wallHeight;

            const minAnchorZ = (1 - effectiveAnchorY) * objectHeight;
            const maxAnchorZ = wallHeight - effectiveAnchorY * objectHeight;
            const canClampInsideWall = Number.isFinite(minAnchorZ) && Number.isFinite(maxAnchorZ) && minAnchorZ <= maxAnchorZ;
            if (canClampInsideWall) {
                wallAnchorZ = Math.max(minAnchorZ, Math.min(maxAnchorZ, wallAnchorZ));
            } else {
                wallAnchorZ = Math.max(0, Math.min(wallHeight, wallAnchorZ));
            }

            const wallCenterAnchorZ = canClampInsideWall
                ? Math.max(minAnchorZ, Math.min(maxAnchorZ, wallHeight * 0.5))
                : Math.max(0, Math.min(wallHeight, wallHeight * 0.5));
            if (verticalLen2 > 1e-6 && wallHeight > 1e-6) {
                const verticalLen = Math.sqrt(verticalLen2);
                const snapCandidates = [{
                    kind: "wallCenter",
                    anchorZ: wallCenterAnchorZ,
                    absoluteZ: wallBottomZ + wallCenterAnchorZ,
                    target: null
                }];
                const verticalTargets = Array.isArray(options && options.verticalSnapTargets)
                    ? options.verticalSnapTargets
                    : [];
                verticalTargets.forEach((target, targetIndex) => {
                    const targetAbsoluteZ = finiteNumber(
                        (target && target.absoluteZ) ??
                        (target && target.snappedZ) ??
                        (target && target.z)
                    );
                    const targetAnchorZ = targetAbsoluteZ !== null
                        ? targetAbsoluteZ - wallBottomZ
                        : finiteNumber(target && target.wallAnchorZ);
                    if (targetAbsoluteZ === null && targetAnchorZ === null) {
                        throw new Error(`vertical window snap target ${targetIndex} requires a finite height`);
                    }
                    const anchorZ = targetAnchorZ;
                    if (!Number.isFinite(anchorZ)) {
                        throw new Error(`vertical window snap target ${targetIndex} resolved to a non-finite wall height`);
                    }
                    const targetMinZ = canClampInsideWall ? minAnchorZ : 0;
                    const targetMaxZ = canClampInsideWall ? maxAnchorZ : wallHeight;
                    if (anchorZ < targetMinZ - 1e-6 || anchorZ > targetMaxZ + 1e-6) return;
                    const clampedAnchorZ = Math.max(targetMinZ, Math.min(targetMaxZ, anchorZ));
                    snapCandidates.push({
                        kind: "matchingWindow",
                        anchorZ: clampedAnchorZ,
                        absoluteZ: wallBottomZ + clampedAnchorZ,
                        target
                    });
                });
                let bestSnap = null;
                snapCandidates.forEach((candidate) => {
                    const candidateT = candidate.anchorZ / wallHeight;
                    const distancePx = Math.abs((verticalT - candidateT) * verticalLen);
                    if (distancePx > centerSnapPx) return;
                    if (
                        !bestSnap ||
                        distancePx < bestSnap.distancePx - 0.001 ||
                        (Math.abs(distancePx - bestSnap.distancePx) <= 0.001 && candidate.kind === "matchingWindow")
                    ) {
                        bestSnap = { ...candidate, distancePx };
                    }
                });
                if (bestSnap) {
                    wallAnchorZ = bestSnap.anchorZ;
                    verticalCenterSnapActive = bestSnap.kind === "wallCenter";
                    verticalPeerSnapActive = bestSnap.kind === "matchingWindow";
                    verticalSnapKind = bestSnap.kind;
                    verticalSnapTarget = bestSnap.target;
                }
            }
        }

        const normalBias = category === "windows" ? 0.001 : 0;
        const desiredBaseX = wallFaceCenterX + vx * normalBias * facingSign;
        const desiredBaseY = wallFaceCenterY + vy * normalBias * facingSign;
        const verticalOffset = (1 - effectiveAnchorY) * objectHeight;
        let snappedX = desiredBaseX;
        let snappedY = isDoorPlacement ? (desiredBaseY - verticalOffset) : desiredBaseY;
        const snappedZ = category === "windows" ? (wallBottomZ + wallAnchorZ) : 0;
        if (mapRef && typeof mapRef.wrapWorldX === "function") snappedX = mapRef.wrapWorldX(snappedX);
        if (mapRef && typeof mapRef.wrapWorldY === "function") snappedY = mapRef.wrapWorldY(snappedY);

        const p1 = { x: centerX - ux * halfWidth + vx * hitboxHalfT, y: centerY - uy * halfWidth + vy * hitboxHalfT };
        const p2 = { x: centerX + ux * halfWidth + vx * hitboxHalfT, y: centerY + uy * halfWidth + vy * hitboxHalfT };
        const p3 = { x: centerX + ux * halfWidth - vx * hitboxHalfT, y: centerY + uy * halfWidth - vy * hitboxHalfT };
        const p4 = { x: centerX - ux * halfWidth - vx * hitboxHalfT, y: centerY - uy * halfWidth - vy * hitboxHalfT };

        return {
            valid: fitsLength && fitsHeight,
            reason: !fitsLength
                ? (isDoorPlacement ? "Door is wider than this wall section." : "Window is wider than this wall section.")
                : (!fitsHeight
                    ? (isDoorPlacement ? "Door is taller than this wall." : "Window is taller than this wall.")
                    : null),
            targetWall: section,
            mountedWallLineGroupId: section.id,
            mountedSectionId: section.id,
            mountedWallSectionUnitId: section.id,
            mountedWallFacingSign: facingSign,
            snappedX,
            snappedY,
            snappedZ,
            snappedRotationDeg: rotDeg,
            wallShadowBoxPoints: [wrapPoint(mapRef, p1), wrapPoint(mapRef, p2), wrapPoint(mapRef, p3), wrapPoint(mapRef, p4)],
            wallHeight,
            wallBottomZ,
            wallAnchorZ,
            wallThickness: halfT * 2,
            centerSnapActive,
            verticalCenterSnapActive,
            verticalPeerSnapActive,
            verticalSnapKind,
            verticalSnapTarget,
            sectionCenterX: wrapPoint(mapRef, sectionCenterWorld).x,
            sectionCenterY: wrapPoint(mapRef, sectionCenterWorld).y,
            sectionFacingSign: facingSign,
            sectionNormalX: vx,
            sectionNormalY: vy,
            sectionDirX: ux,
            sectionDirY: uy,
            wallFaceCenterX,
            wallFaceCenterY,
            placementHalfWidth: halfWidth,
            placementCenterX: desiredBaseX,
            placementCenterY: desiredBaseY,
            wallT: len > 0 ? along / len : 0.5,
            wallCenterX: centerX,
            wallCenterY: centerY
        };
    }

    globalThis.PlaceObjectPlacement = {
        resolveWallMountedPlacementCandidate
    };
})();
