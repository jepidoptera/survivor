(function installFloorSupport(globalScope) {
    "use strict";

    function nonEmptyString(value) {
        return typeof value === "string" && value.length > 0 ? value : "";
    }

    function ownerSignature(owner) {
        return owner && owner.type && owner.id ? `${owner.type}:${owner.id}` : "";
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

    function createFloorSupport(data = {}) {
        const fragment = data.fragment && typeof data.fragment === "object" ? data.fragment : null;
        const layer = Number.isFinite(data.layer)
            ? Math.round(Number(data.layer))
            : (Number.isFinite(fragment && fragment.level) ? Math.round(Number(fragment.level)) : 0);
        const baseZ = Number.isFinite(data.baseZ)
            ? Number(data.baseZ)
            : (Number.isFinite(fragment && fragment.nodeBaseZ) ? Number(fragment.nodeBaseZ) : layer * 3);
        const owner = getFragmentOwner(fragment) || normalizeOwner(data.ownerType, data.ownerId, data.sectionKey);
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
            node: data.node || null
        };
    }

    function isPrototypeBuildingPlacementFloorFragment(fragment) {
        const owner = getFragmentOwner(fragment);
        return !!(owner && owner.type === "building" && fragment && fragment.renderedByBuildingCutaway === true);
    }

    const api = {
        createFloorSupport,
        getEntityOwner,
        getEntityOwnerSignature,
        getFragmentFromSupport,
        getFragmentOwner,
        getPlacementTargetFragment,
        getSupportOwner,
        isPrototypeBuildingPlacementFloorFragment,
        normalizeOwner,
        ownerSignature
    };

    globalScope.FloorSupport = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : global);
