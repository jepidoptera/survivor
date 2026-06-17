(function installFloorSupport(globalScope) {
    "use strict";

    function nonEmptyString(value) {
        return typeof value === "string" && value.length > 0 ? value : "";
    }

    function ownerSignature(owner) {
        return owner && owner.type && owner.id ? `${owner.type}:${owner.id}` : "";
    }

    function cloneFloorMembership(membership) {
        if (!membership || typeof membership !== "object") return null;
        const owner = normalizeOwner(membership.ownerType, membership.ownerId, membership.sectionKey);
        const floorId = nonEmptyString(membership.floorId) ||
            nonEmptyString(membership.sourceFloorId) ||
            nonEmptyString(membership.fragmentId);
        if (!owner || !floorId) return null;
        const out = {
            ownerType: owner.type,
            ownerId: owner.id,
            floorId
        };
        if (Number.isFinite(Number(membership.level))) {
            out.level = Math.round(Number(membership.level));
        }
        return out;
    }

    function getSourceFloorIdFromFragment(fragment) {
        if (!fragment || typeof fragment !== "object") return "";
        const owner = getFragmentOwner(fragment);
        const fragmentId = nonEmptyString(fragment.fragmentId);
        const surfaceId = nonEmptyString(fragment.surfaceId);
        if (owner && owner.type === "building") {
            return nonEmptyString(fragment._prototypeBuildingSourceFragmentId) ||
                nonEmptyString(fragment.sourceFloorId) ||
                nonEmptyString(fragment.floorId) ||
                getSourceFloorIdFromRuntimeId(fragmentId, owner.id, "floor") ||
                getSourceFloorIdFromRuntimeId(surfaceId, owner.id, "surface") ||
                fragmentId;
        }
        return nonEmptyString(fragment._prototypeBuildingSourceFragmentId) ||
            nonEmptyString(fragment.sourceFloorId) ||
            nonEmptyString(fragment.floorId) ||
            fragmentId;
    }

    function getSourceFloorIdFromRuntimeId(value, ownerId = "", kind = "floor") {
        const text = nonEmptyString(value);
        if (!text) return "";
        const marker = kind === "surface" ? ":surface:" : ":floor:";
        const owner = nonEmptyString(ownerId);
        if (owner) {
            const prefix = `${owner}${marker}`;
            if (text.startsWith(prefix) && text.length > prefix.length) return text.slice(prefix.length);
        }
        const index = text.indexOf(marker);
        return index >= 0 && index + marker.length < text.length ? text.slice(index + marker.length) : "";
    }

    function getSourceFloorIdFromRef(ref, ownerId = "") {
        if (!ref || typeof ref !== "object") return "";
        return nonEmptyString(ref.floorId) ||
            nonEmptyString(ref.sourceFloorId) ||
            getSourceFloorIdFromRuntimeId(ref.fragmentId, ownerId, "floor") ||
            getSourceFloorIdFromRuntimeId(ref.surfaceId, ownerId, "surface") ||
            nonEmptyString(ref.fragmentId);
    }

    function createFloorMembership(data = {}) {
        const fragment = data.fragment && typeof data.fragment === "object" ? data.fragment : null;
        const owner = getFragmentOwner(fragment) || normalizeOwner(data.ownerType, data.ownerId, data.sectionKey);
        const ownerId = owner ? owner.id : nonEmptyString(data.ownerId);
        const floorId = nonEmptyString(data.floorId) ||
            nonEmptyString(data.sourceFloorId) ||
            (fragment ? getSourceFloorIdFromFragment(fragment) : "") ||
            getSourceFloorIdFromRef(data, ownerId);
        if (!owner || !floorId) return null;
        const level = Number.isFinite(Number(data.level))
            ? Math.round(Number(data.level))
            : (Number.isFinite(Number(data.layer))
                ? Math.round(Number(data.layer))
                : (Number.isFinite(Number(fragment && fragment.level)) ? Math.round(Number(fragment.level)) : null));
        const membership = {
            ownerType: owner.type,
            ownerId: owner.id,
            floorId
        };
        if (Number.isFinite(level)) membership.level = level;
        return membership;
    }

    function normalizeOwner(ownerType, ownerId, sectionKey = "") {
        const type = nonEmptyString(ownerType);
        const id = nonEmptyString(ownerId);
        const section = nonEmptyString(sectionKey);
        if (type === "building" && id) return { type: "building", id };
        if (type === "section") {
            const sectionId = id || section;
            if (sectionId) return { type: "section", id: sectionId };
        }
        if (!type && section) {
            return section.startsWith("building:")
                ? { type: "building", id: section }
                : { type: "section", id: section };
        }
        return null;
    }

    function getFragmentOwner(fragment) {
        if (!fragment || typeof fragment !== "object") return null;
        const ownerType = nonEmptyString(fragment.ownerType);
        const ownerId = nonEmptyString(fragment.ownerId);
        const sectionKey = nonEmptyString(fragment.ownerSectionKey);
        return normalizeOwner(ownerType, ownerId, sectionKey);
    }

    function getFragmentFromSupport(mapRef, support) {
        if (support && support.fragment && typeof support.fragment === "object") return support.fragment;
        const fragmentId = nonEmptyString(support && support.fragmentId);
        if (fragmentId && mapRef && mapRef.floorsById instanceof Map) {
            return mapRef.floorsById.get(fragmentId) || null;
        }
        return null;
    }

    function getPlacementTargetFragment(mapRef, placementTarget) {
        const floorTarget = placementTarget && placementTarget.floorTarget && typeof placementTarget.floorTarget === "object"
            ? placementTarget.floorTarget
            : null;
        if (floorTarget && floorTarget.fragment && typeof floorTarget.fragment === "object") {
            return floorTarget.fragment;
        }
        const fragmentId = nonEmptyString(placementTarget && placementTarget.fragmentId) ||
            nonEmptyString(floorTarget && floorTarget.fragment && floorTarget.fragment.fragmentId);
        if (fragmentId && mapRef && mapRef.floorsById instanceof Map) {
            return mapRef.floorsById.get(fragmentId) || null;
        }
        return null;
    }

    function getSupportOwner(support, mapRef = null) {
        if (!support || typeof support !== "object") return null;
        const fragmentOwner = getFragmentOwner(getFragmentFromSupport(mapRef, support));
        if (fragmentOwner) return fragmentOwner;
        const owner = normalizeOwner(support.ownerType, support.ownerId, support.sectionKey);
        if (owner) return owner;
        if (support.type === "ground") {
            const sectionKey = nonEmptyString(support.sectionKey) || nonEmptyString(support.ownerId);
            if (sectionKey) return { type: "section", id: sectionKey };
        }
        return null;
    }

    function getEntityOwner(entity, options = {}) {
        if (!entity || typeof entity !== "object") return null;
        const mapRef = options.map || entity.map || null;
        const support = entity.currentMovementSupport && typeof entity.currentMovementSupport === "object"
            ? entity.currentMovementSupport
            : null;
        const supportOwner = getSupportOwner(support, mapRef);
        if (supportOwner) return supportOwner;

        const existingOwner = normalizeOwner(entity._prototypeOwnerType, entity._prototypeOwnerId, entity._prototypeOwnerSectionKey);
        if (existingOwner) return existingOwner;

        if (typeof options.sectionKeyResolver === "function") {
            const sectionKey = options.sectionKeyResolver(entity);
            if (nonEmptyString(sectionKey)) return { type: "section", id: sectionKey };
        }
        return null;
    }

    function getEntityOwnerSignature(entity, options = {}) {
        return ownerSignature(getEntityOwner(entity, options));
    }

    function getEntityFloorMembership(entity, options = {}) {
        if (!entity || typeof entity !== "object") return null;
        const direct = cloneFloorMembership(entity._floorMembership) ||
            cloneFloorMembership(entity.floorMembership);
        if (direct) return direct;
        const record = options && options.record && typeof options.record === "object" ? options.record : null;
        const recordMembership = cloneFloorMembership(record && record.floorMembership);
        if (recordMembership) return recordMembership;
        const mapRef = options.map || entity.map || null;
        const support = entity.currentMovementSupport && typeof entity.currentMovementSupport === "object"
            ? entity.currentMovementSupport
            : null;
        const supportMembership = cloneFloorMembership(support && support.floorMembership) ||
            createFloorMembership({
                fragment: getFragmentFromSupport(mapRef, support),
                ownerType: support && support.ownerType,
                ownerId: support && support.ownerId,
                sectionKey: support && support.sectionKey,
                fragmentId: support && support.fragmentId,
                surfaceId: support && support.surfaceId,
                layer: support && support.layer
            });
        if (supportMembership) return supportMembership;
        const fragment = entity._activeFloorFragment && typeof entity._activeFloorFragment === "object"
            ? entity._activeFloorFragment
            : null;
        const owner = normalizeOwner(
            options.ownerType || entity._prototypeOwnerType,
            options.ownerId || entity._prototypeOwnerId,
            entity._prototypeOwnerSectionKey
        ) || getFragmentOwner(fragment);
        return createFloorMembership({
            fragment,
            ownerType: owner && owner.type,
            ownerId: owner && owner.id,
            fragmentId: nonEmptyString(entity.fragmentId) || nonEmptyString(record && record.fragmentId),
            surfaceId: nonEmptyString(entity.surfaceId) || nonEmptyString(record && record.surfaceId),
            layer: Number.isFinite(Number(entity.traversalLayer)) ? Number(entity.traversalLayer) : Number(record && (record.traversalLayer ?? record.level))
        });
    }

    function stampEntityFloorMembership(entity, membership) {
        const normalized = cloneFloorMembership(membership);
        if (!entity || !normalized) return null;
        entity._floorMembership = normalized;
        return normalized;
    }

    function floorMembershipMatches(a, b) {
        const left = cloneFloorMembership(a);
        const right = cloneFloorMembership(b);
        if (!left || !right) return false;
        if (left.ownerType !== right.ownerType || left.ownerId !== right.ownerId || left.floorId !== right.floorId) return false;
        if (Number.isFinite(left.level) && Number.isFinite(right.level) && left.level !== right.level) return false;
        return true;
    }

    function resolvePrototypeBuildingFloorFragment(mapRef, membership, options = {}) {
        const normalized = cloneFloorMembership(membership);
        if (!normalized || normalized.ownerType !== "building") return null;
        if (!(mapRef && mapRef.floorsById instanceof Map)) {
            throw new Error(`prototype building floor ${normalized.ownerId}:${normalized.floorId} cannot resolve without a floor registry`);
        }
        const matches = [];
        for (const candidate of mapRef.floorsById.values()) {
            if (!candidate || candidate.renderedByBuildingCutaway !== true) continue;
            if (candidate.ownerType !== "building" || candidate.ownerId !== normalized.ownerId) continue;
            const candidateFloorId = getSourceFloorIdFromFragment(candidate);
            if (candidateFloorId !== normalized.floorId) continue;
            const candidateLayer = Number.isFinite(Number(candidate.level)) ? Math.round(Number(candidate.level)) : null;
            if (Number.isFinite(normalized.level) && candidateLayer !== normalized.level) continue;
            matches.push(candidate);
        }
        if (matches.length === 1) return matches[0];
        const label = `${normalized.ownerId}:${normalized.floorId}`;
        if (matches.length === 0) {
            if (options.required === false) return null;
            throw new Error(`prototype building floor membership ${label} has no loaded floor fragment`);
        }
        throw new Error(`prototype building floor membership ${label} matched multiple loaded floor fragments`);
    }

    function createFloorSupport(data = {}) {
        const fragment = data.fragment && typeof data.fragment === "object" ? data.fragment : null;
        const layer = Number.isFinite(data.layer)
            ? Math.round(Number(data.layer))
            : (Number.isFinite(fragment && fragment.level) ? Math.round(Number(fragment.level)) : 0);
        const baseZ = Number.isFinite(data.baseZ)
            ? Number(data.baseZ)
            : (Number.isFinite(fragment && fragment.nodeBaseZ) ? Number(fragment.nodeBaseZ) : layer * 3);
        const owner = getFragmentOwner(fragment) || normalizeOwner(data.ownerType, data.ownerId, data.sectionKey);
        const floorMembership = createFloorMembership({
            ...data,
            fragment,
            ownerType: owner && owner.type,
            ownerId: owner && owner.id,
            layer
        });
        return {
            type: "floor",
            layer,
            baseZ,
            fragment,
            fragmentId: nonEmptyString(data.fragmentId) || nonEmptyString(fragment && fragment.fragmentId),
            surfaceId: nonEmptyString(data.surfaceId) || nonEmptyString(fragment && fragment.surfaceId),
            ownerType: owner ? owner.type : "",
            ownerId: owner ? owner.id : "",
            sectionKey: nonEmptyString(data.sectionKey) || nonEmptyString(fragment && fragment.ownerSectionKey),
            floorMembership,
            node: data.node || null
        };
    }

    function isPrototypeBuildingPlacementFloorFragment(fragment) {
        const owner = getFragmentOwner(fragment);
        return !!(owner && owner.type === "building" && fragment && fragment.renderedByBuildingCutaway === true);
    }

    const api = {
        createFloorSupport,
        createFloorMembership,
        floorMembershipMatches,
        getEntityOwner,
        getEntityFloorMembership,
        getEntityOwnerSignature,
        getFragmentFromSupport,
        getFragmentOwner,
        getPlacementTargetFragment,
        getSupportOwner,
        getSourceFloorIdFromFragment,
        getSourceFloorIdFromRef,
        resolvePrototypeBuildingFloorFragment,
        isPrototypeBuildingPlacementFloorFragment,
        normalizeOwner,
        ownerSignature,
        stampEntityFloorMembership
    };

    globalScope.FloorSupport = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : global);
