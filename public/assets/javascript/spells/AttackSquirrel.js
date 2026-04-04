(function(global) {
    if (global && global.console && typeof global.console.log === "function") {
        global.console.log("[AttackSquirrelLoad] begin", {
            spellType: typeof (global && global.Spell),
            squirrelType: typeof (global && global.Squirrel)
        });
    }
    try {
        class AttackSquirrel extends global.Spell {
        static debugLog(eventName, payload = {}) {
            if (!(global && global.console && typeof global.console.log === "function")) return;
            global.console.log("[AttackSquirrel]", eventName, payload);
        }

        constructor(x, y) {
            super(x, y);
            this.image = document.createElement("img");
            this.image.src = "./assets/images/animals/squirrel.png";
            this.speed = 7;
            this.range = 9999;
            this.gravity = 0;
            this.size = 0;
            this.apparentSize = 0;
            this.bounces = 0;
            this.delayTime = 0.2;
            this.radius = 0;
            this.visible = false;
            this.hideProjectileSprite = true;
        }

        cast(targetX, targetY) {
            const caster = global.wizard || null;
            if (!caster) return this;
            AttackSquirrel.debugLog("cast", {
                casterX: Number(caster.x),
                casterY: Number(caster.y),
                targetX: Number(targetX),
                targetY: Number(targetY),
                animalsLength: Array.isArray(global.animals) ? global.animals.length : null
            });
            this.spawnSummonedSquirrel(targetX, targetY);
            this.gone = true;
            return this;
        }

        spawnSummonedSquirrel(targetX, targetY) {
            const caster = global.wizard || null;
            const mapRef = caster && caster.map;
            if (!mapRef || typeof mapRef.worldToNode !== "function") {
                AttackSquirrel.debugLog("spawn-abort-no-map", {
                    hasCaster: !!caster,
                    hasMap: !!mapRef,
                    hasWorldToNode: !!(mapRef && typeof mapRef.worldToNode === "function")
                });
                return null;
            }

            const casterX = Number.isFinite(caster.x) ? Number(caster.x) : 0;
            const casterY = Number.isFinite(caster.y) ? Number(caster.y) : 0;
            let worldX = Number.isFinite(targetX) ? Number(targetX) : casterX;
            let worldY = Number.isFinite(targetY) ? Number(targetY) : casterY;
            if (typeof mapRef.wrapWorldX === "function") worldX = mapRef.wrapWorldX(worldX);
            if (typeof mapRef.wrapWorldY === "function") worldY = mapRef.wrapWorldY(worldY);

            let launchDx = typeof mapRef.shortestDeltaX === "function"
                ? mapRef.shortestDeltaX(casterX, worldX)
                : (worldX - casterX);
            let launchDy = typeof mapRef.shortestDeltaY === "function"
                ? mapRef.shortestDeltaY(casterY, worldY)
                : (worldY - casterY);
            const launchDistance = Math.hypot(launchDx, launchDy);
            if (launchDistance < 1e-6) {
                launchDx = Number(caster.direction && caster.direction.x) || 1;
                launchDy = Number(caster.direction && caster.direction.y) || 0;
            }
            const launchLength = Math.max(1e-6, Math.hypot(launchDx, launchDy));
            let startX = casterX + (launchDx / launchLength) * 0.65;
            let startY = casterY + (launchDy / launchLength) * 0.65;
            if (typeof mapRef.wrapWorldX === "function") startX = mapRef.wrapWorldX(startX);
            if (typeof mapRef.wrapWorldY === "function") startY = mapRef.wrapWorldY(startY);

            const spawnNode = mapRef.worldToNode(startX, startY);
            if (!spawnNode || typeof global.Squirrel !== "function") {
                AttackSquirrel.debugLog("spawn-abort-no-node-or-class", {
                    startX,
                    startY,
                    targetX: worldX,
                    targetY: worldY,
                    hasSpawnNode: !!spawnNode,
                    squirrelCtorType: typeof global.Squirrel
                });
                return null;
            }

            const squirrel = new global.Squirrel(spawnNode, mapRef);
            squirrel.x = startX;
            squirrel.y = startY;
            squirrel._attackSquirrelDebugId = `sq-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            if (typeof squirrel.configureAsPlayerSummon === "function") {
                squirrel.configureAsPlayerSummon({
                    caster,
                    durationMs: AttackSquirrel.SUMMON_DURATION_MS
                });
            }
            if (typeof squirrel.launchAsPlayerSummon === "function") {
                squirrel.launchAsPlayerSummon({
                    startX,
                    startY,
                    targetX: worldX,
                    targetY: worldY,
                    speed: this.speed
                });
            }
            if (typeof squirrel.updateHitboxes === "function") {
                squirrel.updateHitboxes();
            }
            if (Array.isArray(global.animals) && global.animals.indexOf(squirrel) < 0) {
                global.animals.push(squirrel);
            }
            if (typeof mapRef.rebuildGameObjectRegistry === "function") {
                mapRef.rebuildGameObjectRegistry();
            }
            AttackSquirrel.debugLog("spawned", {
                id: squirrel._attackSquirrelDebugId,
                startX,
                startY,
                targetX: worldX,
                targetY: worldY,
                nodeX: spawnNode && spawnNode.xindex,
                nodeY: spawnNode && spawnNode.yindex,
                animalsLength: Array.isArray(global.animals) ? global.animals.length : null,
                width: squirrel.width,
                height: squirrel.height,
                size: squirrel.size
            });
            return squirrel;
        }
        }

        AttackSquirrel.SUMMON_DURATION_MS = 20000;
        global.AttackSquirrel = AttackSquirrel;
        if (global && global.console && typeof global.console.log === "function") {
            global.console.log("[AttackSquirrelLoad] complete", {
                ctorType: typeof global.AttackSquirrel
            });
        }
    } catch (error) {
        if (global && global.console && typeof global.console.error === "function") {
            global.console.error("[AttackSquirrelLoad] failed", error);
        }
        throw error;
    }
})(typeof window !== "undefined" ? window : globalThis);