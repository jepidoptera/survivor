(function attachScriptingRuntime(global) {
    let doorRuntimeIdCounter = 1;
    let objectTouchRuntimeIdCounter = 1;
    const PLAYER_TOUCH_EVENT_NAME = "playerTouches";
    const LEGACY_PLAYER_TOUCH_EVENT_NAME = "playerTouch";
    const PLAYER_UNTOUCH_EVENT_NAME = "playerUntouches";
    const LEGACY_PLAYER_UNTOUCH_EVENT_NAME = "playerLeaves";
    const eventListenersByName = new Map();
    const commandHandlersByName = new Map();
    const assignmentHandlersByPath = new Map();

    function getEventNameAliases(eventName) {
        const name = String(eventName || "").trim();
        if (!name) return [];
        if (name === PLAYER_TOUCH_EVENT_NAME) {
            return [PLAYER_TOUCH_EVENT_NAME, LEGACY_PLAYER_TOUCH_EVENT_NAME];
        }
        if (name === LEGACY_PLAYER_TOUCH_EVENT_NAME) {
            return [LEGACY_PLAYER_TOUCH_EVENT_NAME, PLAYER_TOUCH_EVENT_NAME];
        }
        if (name === PLAYER_UNTOUCH_EVENT_NAME) {
            return [PLAYER_UNTOUCH_EVENT_NAME, LEGACY_PLAYER_UNTOUCH_EVENT_NAME];
        }
        if (name === LEGACY_PLAYER_UNTOUCH_EVENT_NAME) {
            return [LEGACY_PLAYER_UNTOUCH_EVENT_NAME, PLAYER_UNTOUCH_EVENT_NAME];
        }
        return [name];
    }

    function on(eventName, handler) {
        if (typeof eventName !== "string" || eventName.trim().length === 0) return () => {};
        if (typeof handler !== "function") return () => {};
        const name = eventName.trim();
        const listeners = eventListenersByName.get(name) || new Set();
        listeners.add(handler);
        eventListenersByName.set(name, listeners);
        return () => off(name, handler);
    }

    function off(eventName, handler = null) {
        if (typeof eventName !== "string" || eventName.trim().length === 0) return;
        const name = eventName.trim();
        if (!eventListenersByName.has(name)) return;
        if (typeof handler !== "function") {
            eventListenersByName.delete(name);
            return;
        }
        const listeners = eventListenersByName.get(name);
        listeners.delete(handler);
        if (listeners.size === 0) {
            eventListenersByName.delete(name);
        }
    }

    function once(eventName, handler) {
        if (typeof handler !== "function") return () => {};
        let unlisten = () => {};
        const wrapped = (payload) => {
            unlisten();
            handler(payload);
        };
        unlisten = on(eventName, wrapped);
        return unlisten;
    }

    function emit(eventName, payload = null) {
        if (typeof eventName !== "string" || eventName.trim().length === 0) return;
        const name = eventName.trim();
        const listeners = eventListenersByName.get(name);
        if (!listeners || listeners.size === 0) return;
        const snapshot = Array.from(listeners);
        for (let i = 0; i < snapshot.length; i++) {
            const listener = snapshot[i];
            try {
                listener(payload);
            } catch (error) {
                console.error(`Scripting listener failed for event '${name}':`, error);
            }
        }
    }

    function isDoorPlacedObject(obj) {
        if (!obj || obj.gone) return false;
        const category = (typeof obj.category === "string") ? obj.category.trim().toLowerCase() : "";
        return !!(
            (obj.isPlacedObject || obj.objectType === "placedObject" || obj.type === "placedObject" || obj.type === "door") &&
            (category === "doors" || obj.type === "door" || (typeof obj.texturePath === "string" && obj.texturePath.includes("/doors/")))
        );
    }

    function getDoorRuntimeId(door) {
        if (!door || typeof door !== "object") return "door:invalid";
        if (!door._doorRuntimeId) {
            door._doorRuntimeId = `door:${doorRuntimeIdCounter++}`;
        }
        return door._doorRuntimeId;
    }

    function getObjectTouchRuntimeId(obj) {
        if (!obj || typeof obj !== "object") return "touch:invalid";
        if (!obj._scriptTouchRuntimeId) {
            obj._scriptTouchRuntimeId = `touch:${objectTouchRuntimeIdCounter++}`;
        }
        return obj._scriptTouchRuntimeId;
    }

    function getDoorReferencePoint(door, hitbox) {
        if (hitbox && Number.isFinite(hitbox.x) && Number.isFinite(hitbox.y)) {
            return { x: Number(hitbox.x), y: Number(hitbox.y) };
        }
        if (hitbox && Array.isArray(hitbox.points) && hitbox.points.length > 0) {
            let sumX = 0;
            let sumY = 0;
            let count = 0;
            for (let i = 0; i < hitbox.points.length; i++) {
                const p = hitbox.points[i];
                if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
                sumX += Number(p.x);
                sumY += Number(p.y);
                count += 1;
            }
            if (count > 0) {
                return { x: sumX / count, y: sumY / count };
            }
        }
        if (door && Number.isFinite(door.x) && Number.isFinite(door.y)) {
            return { x: Number(door.x), y: Number(door.y) };
        }
        return null;
    }

    function getDoorTraversalNormal(door) {
        const angleDeg = Number.isFinite(door && door.placementRotation)
            ? Number(door.placementRotation)
            : (Number.isFinite(door && door.rotation) ? Number(door.rotation) : null);
        if (!Number.isFinite(angleDeg)) return null;
        const rad = angleDeg * (Math.PI / 180);
        const tx = Math.cos(rad);
        const ty = Math.sin(rad);
        const nx = -ty;
        const ny = tx;
        const mag = Math.hypot(nx, ny);
        if (!(mag > 1e-6)) return null;
        return { x: nx / mag, y: ny / mag };
    }

    function getDoorTraversalSide(door, hitbox, px, py, mapRef = null) {
        if (!Number.isFinite(px) || !Number.isFinite(py)) return 0;
        const center = getDoorReferencePoint(door, hitbox);
        const normal = getDoorTraversalNormal(door);
        if (!center || !normal) return 0;
        const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(center.x, px)
            : (px - center.x);
        const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(center.y, py)
            : (py - center.y);
        const signed = dx * normal.x + dy * normal.y;
        const eps = 0.01;
        if (signed > eps) return 1;
        if (signed < -eps) return -1;
        return 0;
    }

    function isPointInDoorHitbox(hitbox, px, py, radius = 0) {
        if (!hitbox) return false;
        const probe = { type: "circle", x: px, y: py, radius: Math.max(0, Number(radius) || 0) };
        if (typeof hitbox.intersects === "function") {
            return !!hitbox.intersects(probe);
        }
        if (typeof hitbox.containsPoint === "function") {
            return !!hitbox.containsPoint(px, py);
        }
        return false;
    }

    function parseScriptValue(rawValue) {
        const text = String(rawValue || "").trim();
        if (!text.length) return "";
        if (text === "true") return true;
        if (text === "false") return false;
        if (text === "null") return null;
        if (/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(text)) return Number(text);
        if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
            const normalized = text.startsWith("'")
                ? `\"${text.slice(1, -1).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"")}\"`
                : text;
            try {
                return JSON.parse(normalized);
            } catch (_) {
                return text.slice(1, -1);
            }
        }
        if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
            try {
                return JSON.parse(text);
            } catch (_) {
                return text;
            }
        }
        return text;
    }

    function splitTopLevel(text, delimiter = ";") {
        const source = String(text || "");
        const delimiters = Array.isArray(delimiter) ? delimiter : [delimiter];
        const out = [];
        let start = 0;
        let inQuote = null;
        let escapeNext = false;
        let depthParen = 0;
        let depthBrace = 0;
        let depthBracket = 0;

        for (let i = 0; i < source.length; i++) {
            const ch = source[i];
            if (escapeNext) {
                escapeNext = false;
                continue;
            }
            if (ch === "\\") {
                if (inQuote) {
                    escapeNext = true;
                }
                continue;
            }
            if (inQuote) {
                if (ch === inQuote) {
                    inQuote = null;
                }
                continue;
            }
            if (ch === '"' || ch === "'") {
                inQuote = ch;
                continue;
            }
            if (ch === "(") depthParen += 1;
            else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
            else if (ch === "{") depthBrace += 1;
            else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);
            else if (ch === "[") depthBracket += 1;
            else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);

            if (
                delimiters.includes(ch) &&
                depthParen === 0 &&
                depthBrace === 0 &&
                depthBracket === 0
            ) {
                out.push(source.slice(start, i));
                start = i + 1;
            }
        }
        out.push(source.slice(start));
        return out.map(part => part.trim()).filter(Boolean);
    }

    function parseCommandStatement(statement) {
        const text = String(statement || "").trim();
        if (!text.length) return null;
        const match = text.match(/^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/);
        if (!match) return null;
        const commandName = match[1];
        const argsSource = String(match[2] || "").trim();
        const args = argsSource.length > 0
            ? splitTopLevel(argsSource, ",").map(parseScriptValue)
            : [];
        return { commandName, args };
    }

    function registerCommand(commandName, handler) {
        const name = String(commandName || "").trim();
        if (!name || typeof handler !== "function") return () => {};
        commandHandlersByName.set(name, handler);
        return () => {
            if (commandHandlersByName.get(name) === handler) {
                commandHandlersByName.delete(name);
            }
        };
    }

    function registerAssignmentHandler(path, handler) {
        const key = String(path || "").trim();
        if (!key || typeof handler !== "function") return () => {};
        assignmentHandlersByPath.set(key, handler);
        return () => {
            if (assignmentHandlersByPath.get(key) === handler) {
                assignmentHandlersByPath.delete(key);
            }
        };
    }

    function setScriptPathValue(path, value, wizardRef = null) {
        const trimmedPath = String(path || "").trim();
        if (!trimmedPath.length) return false;
        const segments = trimmedPath.split(".").map(s => s.trim()).filter(Boolean);
        if (segments.length === 0) return false;

        let root = global;
        let startIdx = 0;
        if ((segments[0] === "wizard" || segments[0] === "player") && wizardRef && typeof wizardRef === "object") {
            root = wizardRef;
            startIdx = 1;
        }
        if (startIdx >= segments.length) return false;

        let cursor = root;
        for (let i = startIdx; i < segments.length - 1; i++) {
            const key = segments[i];
            if (!cursor || (typeof cursor !== "object" && typeof cursor !== "function")) return false;
            if (!Object.prototype.hasOwnProperty.call(cursor, key) || cursor[key] === null || typeof cursor[key] !== "object") {
                cursor[key] = {};
            }
            cursor = cursor[key];
        }
        const leafKey = segments[segments.length - 1];
        if (!cursor || (typeof cursor !== "object" && typeof cursor !== "function")) return false;
        cursor[leafKey] = value;
        return true;
    }

    function executeAssignmentStatement(lhs, rhsRaw, context = null) {
        const path = String(lhs || "").trim();
        if (!path.length) return false;
        const rhs = parseScriptValue(rhsRaw);
        const wizardRef = context && context.wizard ? context.wizard : null;
        const assignmentHandler = assignmentHandlersByPath.get(path) || null;
        if (assignmentHandler) {
            try {
                const changedByHandler = assignmentHandler(rhs, context || null);
                if (changedByHandler) {
                    emit("script:assignmentApplied", {
                        path,
                        value: rhs,
                        rawValue: rhsRaw,
                        wizard: wizardRef
                    });
                }
                return !!changedByHandler;
            } catch (error) {
                console.error(`Scripting assignment handler failed for '${path}':`, error);
                return false;
            }
        }
        if (setScriptPathValue(path, rhs, wizardRef)) {
            emit("script:assignmentApplied", {
                path,
                value: rhs,
                rawValue: rhsRaw,
                wizard: wizardRef
            });
            return true;
        }
        return false;
    }

    function executeCommandStatement(commandName, args, context = null) {
        const name = String(commandName || "").trim();
        if (!name.length) return false;
        const handler = commandHandlersByName.get(name);
        if (typeof handler !== "function") return false;
        try {
            return !!handler(Array.isArray(args) ? args : [], context || null);
        } catch (error) {
            console.error(`Scripting command '${name}' failed:`, error);
            return false;
        }
    }

    function runScript(script, context = null) {
        if (typeof script !== "string") return false;
        const statements = splitTopLevel(script, [";", "\n", "\r"]);
        if (statements.length === 0) return false;

        let changed = false;
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            const assignmentMatch = statement.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*(.+)$/);
            if (assignmentMatch) {
                const didAssign = executeAssignmentStatement(assignmentMatch[1], assignmentMatch[2], context);
                changed = didAssign || changed;
                continue;
            }
            const command = parseCommandStatement(statement);
            if (command) {
                const didRun = executeCommandStatement(command.commandName, command.args, context);
                changed = didRun || changed;
            }
        }
        return changed;
    }

    function runAssignmentScript(script, wizardRef = null) {
        return runScript(script, { wizard: wizardRef || null, player: wizardRef || null, map: wizardRef && wizardRef.map ? wizardRef.map : null });
    }

    function getEventScriptForTarget(target, eventName) {
        if (!target || typeof eventName !== "string" || !eventName.trim()) return "";
        const name = eventName.trim();
        const aliases = getEventNameAliases(name);
        const scriptTag = target.script;
        if (typeof scriptTag === "string") {
            const trimmed = scriptTag.trim();
            return trimmed.length > 0 ? trimmed : "";
        }
        if (scriptTag && typeof scriptTag === "object") {
            for (let i = 0; i < aliases.length; i++) {
                const handlerScript = scriptTag[aliases[i]];
                if (typeof handlerScript === "string" && handlerScript.trim().length > 0) {
                    return handlerScript.trim();
                }
            }
        }
        for (let i = 0; i < aliases.length; i++) {
            const legacy = target[aliases[i]];
            if (typeof legacy === "string" && legacy.trim().length > 0) {
                return legacy.trim();
            }
        }
        return "";
    }

    function hasEventScriptForTarget(target, eventName) {
        return getEventScriptForTarget(target, eventName).trim().length > 0;
    }

    function fireObjectScriptEvent(target, eventName, wizardRef = null, context = null) {
        if (!target || !eventName) return false;
        const normalizedEventName = String(eventName).trim();
        const aliasEventNames = getEventNameAliases(normalizedEventName);
        const script = getEventScriptForTarget(target, normalizedEventName);
        const payload = {
            target,
            eventName: normalizedEventName,
            wizard: wizardRef || null,
            context: context || null,
            script
        };
        if (isDoorPlacedObject(target)) {
            payload.door = target;
            emit("door:traversal", payload);
            for (let i = 0; i < aliasEventNames.length; i++) {
                emit(`door:${aliasEventNames[i]}`, payload);
            }
        }
        emit("script:event", payload);
        for (let i = 0; i < aliasEventNames.length; i++) {
            emit(`script:${aliasEventNames[i]}`, payload);
        }
        if (!script) return false;

        const execContext = {
            wizard: wizardRef || null,
            player: wizardRef || null,
            map: (wizardRef && wizardRef.map) || (target && target.map) || null,
            target,
            eventName: normalizedEventName,
            payload: context || null
        };
        const changed = runScript(script, execContext);
        const executedPayload = {
            ...payload,
            changed
        };
        emit("script:executed", executedPayload);
        if (isDoorPlacedObject(target)) {
            emit("door:scriptExecuted", executedPayload);
        }
        return changed;
    }

    function fireDoorTraversalEvent(door, eventName, wizardRef = null, context = null) {
        return fireObjectScriptEvent(door, eventName, wizardRef, context);
    }

    function processObjectTouchEvents(wizardRef, nearbyEntries, radius = 0) {
        if (!wizardRef) return;
        const touchedByObjectId = (wizardRef._scriptTouchedObjectsById instanceof Map)
            ? wizardRef._scriptTouchedObjectsById
            : new Map();
        wizardRef._scriptTouchedObjectsById = touchedByObjectId;

        const wizardX = Number(wizardRef.x);
        const wizardY = Number(wizardRef.y);
        const touchRadius = Math.max(0, Number(radius) || 0);
        const detachRadius = touchRadius * 1.05;
        const currentlyTouchingIds = new Set();

        if (Array.isArray(nearbyEntries) && nearbyEntries.length > 0) {
            for (let i = 0; i < nearbyEntries.length; i++) {
                const entry = nearbyEntries[i];
                const obj = entry && entry.obj;
                const hitbox = entry && entry.hitbox;
                const forceTouch = !!(entry && entry.forceTouch);
                if (!obj || obj.gone || !hitbox) continue;
                if (isDoorPlacedObject(obj)) continue;
                if (!hasEventScriptForTarget(obj, PLAYER_TOUCH_EVENT_NAME)) continue;

                const objectId = getObjectTouchRuntimeId(obj);
                const inside = forceTouch || isPointInDoorHitbox(hitbox, wizardX, wizardY, touchRadius);
                if (!inside) continue;

                currentlyTouchingIds.add(objectId);
                if (!touchedByObjectId.has(objectId)) {
                    fireObjectScriptEvent(obj, PLAYER_TOUCH_EVENT_NAME, wizardRef, {
                        objectId,
                        x: wizardX,
                        y: wizardY,
                        radius: touchRadius
                    });
                }
                touchedByObjectId.set(objectId, { obj, hitbox });
            }
        }

        for (const [objectId, touched] of touchedByObjectId.entries()) {
            if (currentlyTouchingIds.has(objectId)) continue;

            const touchedObj = touched && touched.obj;
            if (!touchedObj || touchedObj.gone) {
                touchedByObjectId.delete(objectId);
                continue;
            }

            const latestHitbox = touchedObj.groundPlaneHitbox || touchedObj.visualHitbox || touchedObj.hitbox || (touched && touched.hitbox) || null;
            const stillWithinDetachBuffer = latestHitbox
                ? isPointInDoorHitbox(latestHitbox, wizardX, wizardY, detachRadius)
                : false;
            if (stillWithinDetachBuffer) {
                touchedByObjectId.set(objectId, { obj: touchedObj, hitbox: latestHitbox });
                continue;
            }

            touchedByObjectId.delete(objectId);
            if (hasEventScriptForTarget(touchedObj, PLAYER_UNTOUCH_EVENT_NAME)) {
                fireObjectScriptEvent(touchedObj, PLAYER_UNTOUCH_EVENT_NAME, wizardRef, {
                    objectId,
                    x: wizardX,
                    y: wizardY,
                    radius: detachRadius
                });
            }
        }
    }

    function processDoorTraversalEvents(wizardRef, fromX, fromY, toX, toY, nearbyDoors, radius = 0) {
        if (!wizardRef) return;
        const stateByDoorId = (wizardRef._doorTraversalStateById instanceof Map)
            ? wizardRef._doorTraversalStateById
            : new Map();
        wizardRef._doorTraversalStateById = stateByDoorId;

        if (!Array.isArray(nearbyDoors) || nearbyDoors.length === 0) {
            for (const [doorId, state] of stateByDoorId.entries()) {
                if (!state || !state.inside) {
                    stateByDoorId.delete(doorId);
                }
            }
            return;
        }

        const activeIds = new Set();
        for (let i = 0; i < nearbyDoors.length; i++) {
            const entry = nearbyDoors[i];
            const door = entry && entry.obj;
            const hitbox = entry && entry.hitbox;
            if (!isDoorPlacedObject(door) || !hitbox) continue;

            const doorId = getDoorRuntimeId(door);
            activeIds.add(doorId);
            const state = stateByDoorId.get(doorId) || { inside: false, touching: false, entrySide: 0, lastSide: 0 };

            const insideFrom = isPointInDoorHitbox(hitbox, fromX, fromY, radius);
            const insideTo = isPointInDoorHitbox(hitbox, toX, toY, radius);
            const sideFrom = getDoorTraversalSide(door, hitbox, fromX, fromY, wizardRef.map || null);
            const sideTo = getDoorTraversalSide(door, hitbox, toX, toY, wizardRef.map || null);

            if (!state.inside && !insideFrom && insideTo) {
                const entrySide = sideFrom !== 0 ? sideFrom : (sideTo !== 0 ? sideTo : state.lastSide);
                state.inside = true;
                state.entrySide = Number.isFinite(entrySide) ? entrySide : 0;
            }

            if (insideTo && !state.touching) {
                fireObjectScriptEvent(door, PLAYER_TOUCH_EVENT_NAME, wizardRef, {
                    doorId,
                    sideFrom,
                    sideTo,
                    insideFrom,
                    insideTo,
                    fromX,
                    fromY,
                    toX,
                    toY
                });
                state.touching = true;
            } else if (!insideTo && state.touching) {
                state.touching = false;
            }

            let fired = false;
            if (state.inside && !insideTo) {
                const exitSide = sideTo !== 0 ? sideTo : sideFrom;
                if (state.entrySide !== 0 && exitSide !== 0 && exitSide !== state.entrySide) {
                    const eventName = state.entrySide < exitSide ? "playerEnters" : "playerExits";
                        fireDoorTraversalEvent(door, eventName, wizardRef, {
                            doorId,
                            sideFrom,
                            sideTo,
                            insideFrom,
                            insideTo,
                            fromX,
                            fromY,
                            toX,
                            toY
                        });
                    fired = true;
                }
                state.inside = false;
                state.entrySide = 0;
            }

            if (!fired && !insideFrom && !insideTo && sideFrom !== 0 && sideTo !== 0 && sideFrom !== sideTo) {
                const eventName = sideFrom < sideTo ? "playerEnters" : "playerExits";
                fireDoorTraversalEvent(door, eventName, wizardRef, {
                    doorId,
                    sideFrom,
                    sideTo,
                    insideFrom,
                    insideTo,
                    fromX,
                    fromY,
                    toX,
                    toY
                });
            }

            if (insideTo) {
                state.inside = true;
            } else {
                state.touching = false;
            }
            if (sideTo !== 0) {
                state.lastSide = sideTo;
            }
            stateByDoorId.set(doorId, state);
        }

        for (const [doorId, state] of stateByDoorId.entries()) {
            if (!activeIds.has(doorId) && state && !state.inside && !state.touching) {
                stateByDoorId.delete(doorId);
            }
        }
    }

    function normalizeScriptSpellName(rawName) {
        const name = String(rawName || "").trim().toLowerCase();
        return name;
    }

    function registerBuiltinScriptHandlers() {
        registerAssignmentHandler("mazeMode", value => {
            const enabled = !!value;
            if (typeof global.setLosMazeModeEnabled === "function") {
                global.setLosMazeModeEnabled(enabled);
                return true;
            }
            if (global.losSettings && typeof global.losSettings === "object") {
                global.losSettings.mazeMode = enabled;
                return true;
            }
            return false;
        });

        registerCommand("transport", (args, context) => {
            const wizardRef = (context && context.wizard) || global.wizard || null;
            if (!wizardRef || !wizardRef.map) return false;
            const x = Number(args[0]);
            const y = Number(args[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

            let targetX = x;
            let targetY = y;
            if (typeof wizardRef.map.wrapWorldX === "function") targetX = wizardRef.map.wrapWorldX(targetX);
            if (typeof wizardRef.map.wrapWorldY === "function") targetY = wizardRef.map.wrapWorldY(targetY);
            if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;

            wizardRef.x = targetX;
            wizardRef.y = targetY;
            wizardRef.node = wizardRef.map.worldToNode(targetX, targetY) || wizardRef.node;
            wizardRef.path = [];
            wizardRef.nextNode = null;
            wizardRef.destination = null;
            wizardRef.moving = false;
            wizardRef.movementVector = { x: 0, y: 0 };
            wizardRef.prevX = targetX;
            wizardRef.prevY = targetY;
            if (typeof wizardRef.updateHitboxes === "function") {
                wizardRef.updateHitboxes();
            }
            if (typeof global.centerViewport === "function") {
                global.centerViewport(wizardRef, 0);
            }
            return true;
        });

        registerCommand("healPlayer", (args, context) => {
            const wizardRef = (context && context.wizard) || global.wizard || null;
            if (!wizardRef) return false;
            const hpDelta = Number(args[0]);
            if (!Number.isFinite(hpDelta)) return false;
            if (!Number.isFinite(wizardRef.maxHP)) {
                wizardRef.maxHP = Number.isFinite(wizardRef.hp) ? wizardRef.hp : 100;
            }
            const currentHp = Number.isFinite(wizardRef.hp) ? wizardRef.hp : wizardRef.maxHP;
            wizardRef.hp = Math.max(0, Math.min(wizardRef.maxHP, currentHp + hpDelta));
            return true;
        });

        registerCommand("addSpell", (args, context) => {
            const wizardRef = (context && context.wizard) || global.wizard || null;
            if (!wizardRef) return false;
            const spellName = normalizeScriptSpellName(args[0]);
            if (!spellName) return false;
            const granted = Array.isArray(wizardRef.unlockedSpells) ? wizardRef.unlockedSpells : [];
            if (!Array.isArray(wizardRef.unlockedSpells)) {
                wizardRef.unlockedSpells = granted;
            }
            if (!granted.includes(spellName)) {
                granted.push(spellName);
            }
            if (typeof global.SpellSystem !== "undefined" && global.SpellSystem) {
                if (typeof global.SpellSystem.refreshSpellSelector === "function") {
                    global.SpellSystem.refreshSpellSelector(wizardRef);
                }
            }
            return true;
        });
    }

    registerBuiltinScriptHandlers();

    const scriptingApi = {
        on,
        off,
        once,
        emit,
        registerCommand,
        registerAssignmentHandler,
        isDoorPlacedObject,
        isPointInDoorHitbox,
        processDoorTraversalEvents,
        processObjectTouchEvents,
        runScript,
        runAssignmentScript,
        fireObjectScriptEvent,
        fireDoorTraversalEvent
    };

    global.Scripting = scriptingApi;
})(typeof globalThis !== "undefined" ? globalThis : window);
