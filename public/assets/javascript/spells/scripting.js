(function attachScriptingRuntime(global) {
    let doorRuntimeIdCounter = 1;
    let objectTouchRuntimeIdCounter = 1;
    const PLAYER_TOUCH_EVENT_NAME = "playerTouches";
    const LEGACY_PLAYER_TOUCH_EVENT_NAME = "playerTouch";
    const PLAYER_UNTOUCH_EVENT_NAME = "playerUntouches";
    const LEGACY_PLAYER_UNTOUCH_EVENT_NAME = "playerLeaves";
    const SCRIPT_INIT_KEY = "__init";
    const SCRIPT_EDITOR_PANEL_ID = "scriptEditorPanel";
    const SCRIPT_EDITOR_TEXTAREA_ID = "scriptEditorTextarea";
    const SCRIPT_EDITOR_NAME_LABEL_ID = "scriptEditorNameLabel";
    const SCRIPT_EDITOR_NAME_INPUT_ID = "scriptEditorNameInput";
    const SCRIPT_EDITOR_TARGET_LABEL_ID = "scriptEditorTargetLabel";
    const SCRIPT_EDITOR_HELP_PANEL_ID = "scriptEditorHelpPanel";
    const SCRIPT_EDITOR_BACKDROP_ID = "scriptEditorBackdrop";
    const SCRIPT_EDITOR_COMPLETION_PANEL_ID = "scriptEditorCompletionPanel";
    const SCRIPT_EDITOR_INDENT = "   ";
    const SCRIPT_EDITOR_DEFAULT_TEMPLATE = [
        "playerExits {",
        `${SCRIPT_EDITOR_INDENT}mazeMode=true`,
        "}",
        "",
        "playerEnters {",
        `${SCRIPT_EDITOR_INDENT}mazeMode=false`,
        "}"
    ].join("\n");
    const eventListenersByName = new Map();
    const commandHandlersByName = new Map();
    const assignmentHandlersByPath = new Map();
    const namedObjectsByName = new Map();
    let namedObjectRuntimeIdCounter = 1;
    const SCRIPT_BRIGHTNESS_FILTER_KEY = "__scriptBrightnessFilter";
    let scriptEditorTargetObject = null;
    let scriptEditorCompletionState = {
        active: false,
        replacementStart: 0,
        replacementEnd: 0,
        prefix: "",
        selectedIndex: 0,
        items: []
    };
    const PLAYER_COMMAND_REGISTRY = Object.freeze([
        Object.freeze({
            name: "inventory.set",
            syntax: "wizard.inventory.set(\"spellCredits\", 3)",
            description: "set an inventory item quantity",
            handler(args, context) {
                const wizardRef = (context && context.wizard) || global.wizard || null;
                if (!wizardRef || typeof wizardRef.getInventory !== "function") return false;
                const itemName = String(args[0] || "").trim();
                if (!itemName.length) return false;
                const quantity = Number(args[1]);
                if (!Number.isFinite(quantity)) return false;
                wizardRef.getInventory().set(itemName, quantity);
                return true;
            }
        }),
        Object.freeze({
            name: "inventory.add",
            syntax: "wizard.inventory.add(\"gold\", 10)",
            description: "add to an inventory item quantity",
            handler(args, context) {
                const wizardRef = (context && context.wizard) || global.wizard || null;
                if (!wizardRef || typeof wizardRef.getInventory !== "function") return false;
                const itemName = String(args[0] || "").trim();
                if (!itemName.length) return false;
                const quantity = (typeof args[1] === "undefined") ? 1 : Number(args[1]);
                if (!Number.isFinite(quantity)) return false;
                wizardRef.getInventory().add(itemName, quantity);
                return true;
            }
        }),
        Object.freeze({
            name: "inventory.remove",
            syntax: "wizard.inventory.remove(\"gold\", 5)",
            description: "remove from an inventory item quantity if enough are available",
            handler(args, context) {
                const wizardRef = (context && context.wizard) || global.wizard || null;
                if (!wizardRef || typeof wizardRef.getInventory !== "function") return false;
                const itemName = String(args[0] || "").trim();
                if (!itemName.length) return false;
                const quantity = (typeof args[1] === "undefined") ? 1 : Number(args[1]);
                if (!Number.isFinite(quantity)) return false;
                return wizardRef.getInventory().remove(itemName, quantity);
            }
        })
    ]);
    const PLAYER_COMMAND_API_ENTRIES = Object.freeze(
        PLAYER_COMMAND_REGISTRY.map(entry => Object.freeze({
            name: entry.name,
            syntax: entry.syntax,
            description: entry.description
        }))
    );
    const EVENT_API_ENTRIES = Object.freeze([
        Object.freeze({ name: "newGame", description: "fires once when a new game starts from a template", appliesTo: "scripted objects" }),
        Object.freeze({ name: "playerEnters", description: "fires when player crosses the door one way", appliesTo: "doors, trigger areas" }),
        Object.freeze({ name: "playerExits", description: "fires when player crosses the opposite way", appliesTo: "doors, trigger areas" }),
        Object.freeze({ name: "playerTouches", description: "fires once per contact", appliesTo: "objects, doors, trigger areas" }),
        Object.freeze({ name: "playerUntouches", description: "fires when contact is broken", appliesTo: "objects, doors, trigger areas" }),
        Object.freeze({ name: "seePlayer", description: "fires once when the animal gains line of sight to the player", appliesTo: "animals" }),
        Object.freeze({ name: "die", description: "fires once when the scripted target dies", appliesTo: "animals" })
    ]);
    const GLOBAL_ASSIGNMENT_REGISTRY = Object.freeze([
        Object.freeze({ name: "mazeMode", syntax: "mazeMode=true", description: "toggles maze mode" }),
        Object.freeze({ name: "time.speed", syntax: "time.speed=0.5", description: "set non-wizard simulation speed from 0 to 6; 0 stops and 1 restores normal time" })
    ]);
    const PLAYER_ASSIGNMENT_REGISTRY = Object.freeze([
        Object.freeze({ name: "difficulty", syntax: "player.difficulty=3", description: "set player difficulty from 1 to 3" }),
        Object.freeze({ name: "speed", syntax: "player.speed=3", description: "set player movement speed" }),
        Object.freeze({ name: "magicRegenPerSecond", syntax: "player.magicRegenPerSecond=12", description: "set player magic recharge per second" }),
        Object.freeze({ name: "magicRechargeRate", syntax: "player.magicRechargeRate=12", description: "alias for magicRegenPerSecond" })
    ]);
    const GLOBAL_COMMAND_REGISTRY = Object.freeze([
        Object.freeze({ name: "transport", syntax: "transport(x, y)", description: "teleport the player" }),
        Object.freeze({ name: "healPlayer", syntax: "healPlayer(hp)", description: "restore player HP" }),
        Object.freeze({ name: "hurtPlayer", syntax: "hurtPlayer(hp)", description: "damage the player" }),
        Object.freeze({ name: "player.hurt", syntax: "player.hurt(hp)", description: "damage the player" }),
        Object.freeze({ name: "gainMagic", syntax: "gainMagic(amount)", description: "restore player magic" }),
        Object.freeze({ name: "drainMagic", syntax: "drainMagic(amount)", description: "drain player magic" }),
        Object.freeze({ name: "addSpell", syntax: "addSpell(name)", description: "unlock magic by name" }),
        Object.freeze({ name: "addMagic", syntax: "addMagic(name)", description: "unlock magic by name" }),
        Object.freeze({ name: "unlockMagic", syntax: "unlockMagic(name)", description: "unlock magic by name" }),
        Object.freeze({ name: "unlockSpell", syntax: "unlockSpell(name)", description: "unlock magic by name" }),
        Object.freeze({ name: "trade", syntax: "trade(title=\"merchant\", currency=\"gold\", entries=[{\"type\":\"inventoryItem\",\"id\":\"grenades\",\"buy\":5,\"sell\":3}])", description: "open a trade modal and wait for the player to close it" }),
        Object.freeze({ name: "spawnCreature", syntax: "spawnCreature(type=\"bear\", size=1, x=2, y=-1)", description: "spawn a creature relative to the scripted object" }),
        Object.freeze({ name: "drop", syntax: "drop(type=\"gold_coin\", size=1, distance=3, height=0, x=0, y=0, count=1)", description: "drop a powerup relative to the scripted object or player; distance sets the drop radius in map units and height sets spawn z" }),
        Object.freeze({ name: "camera.zoom", syntax: "camera.zoom(target=1.5, seconds=1)", description: "zoom the camera to a target level over time" }),
        Object.freeze({ name: "camera.pan", syntax: "camera.pan(x=4, y=-2, target=tree1, seconds=1)", description: "pan the camera relative to the player or a named object" }),
        Object.freeze({ name: "camera.reset", syntax: "camera.reset(seconds=1)", description: "return the camera to its normal framing" }),
        Object.freeze({ name: "pause", syntax: "pause(seconds)", description: "wait before running the next script statement" }),
        Object.freeze({ name: "scrollMessage", syntax: "scrollMessage(text, title=\"chapter 1\")", description: "show a scroll popup with an optional title and ok button" }),
        Object.freeze({ name: "savegame", syntax: "savegame(name)", description: "save the game to localStorage" }),
        Object.freeze({ name: "time.stop", syntax: "time.stop()", description: "stop non-wizard simulation time" }),
        Object.freeze({ name: "time.restore", syntax: "time.restore()", description: "restore non-wizard simulation time to normal speed" })
    ]);
    const TARGET_MEMBER_REGISTRY = Object.freeze({
        common: Object.freeze([
            Object.freeze({ name: "activate", kind: "method", syntax: "this.activate()", description: "re-enable script events" }),
            Object.freeze({ name: "brightness", kind: "property", syntax: "this.brightness=100", description: "set brightness from -100 to 100" }),
            Object.freeze({ name: "deactivate", kind: "method", syntax: "this.deactivate()", description: "disable further script events" }),
            Object.freeze({ name: "delete", kind: "method", syntax: "this.delete()", description: "remove the target object" }),
            Object.freeze({ name: "fall", kind: "method", syntax: "this.fall(direction=\"away\", targetName=\"tree1\")", description: "make a tree or door fall toward or away from a named object" }),
            Object.freeze({ name: "drop", kind: "method", syntax: "this.drop(type=\"gold_coin\", size=1, distance=3, height=0, count=1)", description: "drop a powerup relative to this object; distance sets the drop radius in map units and height sets spawn z" }),
            Object.freeze({ name: "height", kind: "property", syntax: "this.height=2", description: "set object or wall-section height" }),
            Object.freeze({ name: "hp", kind: "property", syntax: "this.hp=12", description: "set current HP; raises max HP if needed" }),
            Object.freeze({ name: "isOnFire", kind: "property", syntax: "this.isOnFire=true", description: "alias for onfire" }),
            Object.freeze({ name: "maxHp", kind: "property", syntax: "this.maxHp=20", description: "set max HP" }),
            Object.freeze({ name: "maxHP", kind: "property", syntax: "this.maxHP=20", description: "alias for maxHp" }),
            Object.freeze({ name: "message", kind: "method", syntax: "this.message(text=\"Hello\", x=0, y=-1, color=\"#ffffff\", fontsize=14)", description: "show hovering text; x/y are relative map-unit offsets; empty text clears messages" }),
            Object.freeze({ name: "onfire", kind: "property", syntax: "this.onfire=true", description: "ignite or extinguish the object" }),
            Object.freeze({ name: "rise", kind: "method", syntax: "this.rise(seconds)", description: "raise a previously sunk object back up over time" }),
            Object.freeze({ name: "sink", kind: "method", syntax: "this.sink(seconds)", description: "sink the object into the ground over time" }),
            Object.freeze({ name: "size", kind: "property", syntax: "this.size=2", description: "resize the object" }),
            Object.freeze({ name: "thickness", kind: "property", syntax: "this.thickness=0.5", description: "set thickness, especially for wall sections" }),
            Object.freeze({ name: "tint", kind: "property", syntax: "this.tint=\"#ff8800\"", description: "set tint color" }),
            Object.freeze({ name: "unFreeze", kind: "method", syntax: "this.unFreeze()", description: "clear a script freeze immediately" }),
                Object.freeze({ name: "forceVisible", kind: "property", syntax: "this.forceVisible=true", description: "keep the object visible through line-of-sight occlusion" }),
            Object.freeze({ name: "visible", kind: "property", syntax: "this.visible=false", description: "show or hide the object" })
        ]),
        animal: Object.freeze([
            Object.freeze({ name: "chaseRadius", kind: "property", syntax: "this.chaseRadius=8", description: "set chase radius" }),
            Object.freeze({ name: "disengageRadius", kind: "property", syntax: "this.disengageRadius=20", description: "set disengage radius" }),
            Object.freeze({ name: "freeze", kind: "method", syntax: "this.freeze(seconds?)", description: "pause movement and AI; omit seconds to freeze indefinitely" }),
            Object.freeze({ name: "maxMp", kind: "property", syntax: "this.maxMp=20", description: "set max MP" }),
            Object.freeze({ name: "maxMP", kind: "property", syntax: "this.maxMP=20", description: "alias for maxMp" }),
            Object.freeze({ name: "mp", kind: "property", syntax: "this.mp=12", description: "set current MP; raises max MP if needed" }),
            Object.freeze({ name: "retreatDuration", kind: "property", syntax: "this.retreatDuration=2", description: "set retreat time in seconds" }),
            Object.freeze({ name: "retreatThreshold", kind: "property", syntax: "this.retreatThreshold=0.3", description: "set retreat threshold" }),
            Object.freeze({ name: "runSpeed", kind: "property", syntax: "this.runSpeed=4", description: "set run speed" }),
            Object.freeze({ name: "tracePath", kind: "method", syntax: "this.tracePath(seconds)", description: "draw a purple trail along the creature's visited nodes" })
        ]),
        door: Object.freeze([
            Object.freeze({ name: "lock", kind: "method", syntax: "this.lock()", description: "lock the door" }),
            Object.freeze({ name: "unlock", kind: "method", syntax: "this.unlock()", description: "unlock the door" }),
            Object.freeze({ name: "open", kind: "method", syntax: "this.open()", description: "open the door so all creatures can pass" }),
            Object.freeze({ name: "close", kind: "method", syntax: "this.close()", description: "close the door" })
        ]),
        window: Object.freeze([
            Object.freeze({ name: "open", kind: "method", syntax: "this.open()", description: "open the window so it no longer blocks line of sight" }),
            Object.freeze({ name: "close", kind: "method", syntax: "this.close()", description: "close the window so it blocks line of sight" })
        ]),
        wallSection: Object.freeze([
            Object.freeze({ name: "crumble", kind: "method", syntax: "this.crumble(x=1, y=0)", description: "break the wall section into fragments" })
        ])
    });
    const SCRIPTING_API_SCHEMA = Object.freeze({
        events: EVENT_API_ENTRIES,
        globalAssignments: GLOBAL_ASSIGNMENT_REGISTRY,
        playerAssignments: PLAYER_ASSIGNMENT_REGISTRY,
        playerCommands: PLAYER_COMMAND_API_ENTRIES,
        globalCommands: GLOBAL_COMMAND_REGISTRY,
        targetMembers: TARGET_MEMBER_REGISTRY
    });
    const SCRIPTING_NAME_PATTERN = /^[A-Za-z_$][\w$]*$/;
    global.SCRIPTING_API_SCHEMA = SCRIPTING_API_SCHEMA;

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

    function isWindowPlacedObject(obj) {
        if (!obj || obj.gone) return false;
        const category = (typeof obj.category === "string") ? obj.category.trim().toLowerCase() : "";
        return !!(
            (obj.isPlacedObject || obj.objectType === "placedObject" || obj.type === "placedObject" || obj.type === "window") &&
            (category === "windows" || obj.type === "window" || (typeof obj.texturePath === "string" && obj.texturePath.includes("/windows/")))
        );
    }

    function isTriggerAreaObject(obj) {
        if (!obj || obj.gone) return false;
        if (obj.isTriggerArea === true) return true;
        if (obj.objectType === "triggerArea" || obj.type === "triggerArea") return true;
        return false;
    }

    function isDoorLocked(door) {
        if (!isDoorPlacedObject(door)) return false;
        if (door._scriptDoorLocked === true) return true;
        return door.isPassable === false;
    }

    function notifyDoorTraversalStateChanged(door) {
        if (!isDoorPlacedObject(door)) return false;
        if (typeof door.notifyMountedWallStateChanged === "function") {
            door.notifyMountedWallStateChanged();
        }
        return true;
    }

    function notifyWindowLosStateChanged(windowObj) {
        if (!isWindowPlacedObject(windowObj)) return false;
        if (typeof windowObj.notifyMountedWallStateChanged === "function") {
            windowObj.notifyMountedWallStateChanged();
        }
        return true;
    }

    function markPrototypeScriptTargetDirty(target) {
        if (!target || typeof target !== "object" || target.gone) return false;
        const mapRef = target.map || global.map || null;
        if (!mapRef || !mapRef._prototypeSectionState) return false;
        if (target._prototypeRuntimeRecord !== true) {
            return false;
        }
        target._prototypeDirty = true;
        const objectState = mapRef._prototypeObjectState;
        if (objectState && target._prototypeObjectManaged === true) {
            if (!(objectState.dirtyRuntimeObjects instanceof Set)) {
                objectState.dirtyRuntimeObjects = new Set();
            }
            objectState.dirtyRuntimeObjects.add(target);
            objectState.captureScanNeeded = true;
        }
        return true;
    }

    function setDoorLockedState(door, locked) {
        if (!isDoorPlacedObject(door)) return false;
        const nextLocked = !!locked;
        door._scriptDoorLocked = nextLocked;
        if (nextLocked) {
            door.isPassable = false;
        } else if (door.isOpen || door._doorLockedOpen || door.isFallenDoorEffect) {
            door.blocksTile = false;
            door.isPassable = true;
            door.castsLosShadows = false;
        } else {
            door.isPassable = true;
        }
        notifyDoorTraversalStateChanged(door);
        return true;
    }

    function openDoorForTraversal(door) {
        if (!isDoorPlacedObject(door)) return false;
        door._scriptDoorLocked = false;
        door.isOpen = true;
        door.blocksTile = false;
        door.isPassable = true;
        door.castsLosShadows = false;
        notifyDoorTraversalStateChanged(door);
        return true;
    }

    function setWindowOpenState(windowObj, open) {
        if (!isWindowPlacedObject(windowObj)) return false;
        const nextOpen = !!open;
        windowObj.isOpen = nextOpen;
        windowObj.castsLosShadows = !nextOpen;
        notifyWindowLosStateChanged(windowObj);
        return true;
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

    function getTriggerTraversalStateId(obj) {
        if (!obj || typeof obj !== "object") return "trigger:invalid";
        const explicitId = Number(
            Number.isInteger(Number(obj.id))
                ? Number(obj.id)
                : (Number.isInteger(Number(obj._prototypeRecordId)) ? Number(obj._prototypeRecordId) : NaN)
        );
        if (Number.isInteger(explicitId)) {
            return `trigger:${explicitId}`;
        }
        return getObjectTouchRuntimeId(obj);
    }

    function getNamedObjectRuntimeId(obj) {
        if (!obj || typeof obj !== "object") return "named:invalid";
        if (!obj._scriptNamedObjectRuntimeId) {
            obj._scriptNamedObjectRuntimeId = `named:${namedObjectRuntimeIdCounter++}`;
        }
        return obj._scriptNamedObjectRuntimeId;
    }

    function isValidScriptingName(name) {
        return SCRIPTING_NAME_PATTERN.test(String(name || "").trim());
    }

    function getObjectScriptingName(target) {
        if (!target || typeof target !== "object") return "";
        const raw = (typeof target.scriptingName === "string")
            ? target.scriptingName
            : ((typeof target.scriptName === "string") ? target.scriptName : "");
        const trimmed = String(raw || "").trim();
        return isValidScriptingName(trimmed) ? trimmed : "";
    }

    function getDefaultScriptingNameBase(target) {
        if (!target || typeof target !== "object") return "object";
        const raw = (typeof target.type === "string" && target.type.trim().length > 0)
            ? target.type
            : ((typeof target.category === "string" && target.category.trim().length > 0) ? target.category : "object");
        let base = String(raw).trim().toLowerCase().replace(/[^a-z0-9_$]+/g, "");
        if (!base.length) base = "object";
        if (!/^[A-Za-z_$]/.test(base)) {
            base = `obj${base}`;
        }
        return base;
    }

    function generateUniqueScriptingName(baseName, usedNames) {
        const safeBase = isValidScriptingName(baseName) ? baseName : "object";
        let idx = 1;
        let candidate = `${safeBase}${idx}`;
        while (usedNames.has(candidate)) {
            idx += 1;
            candidate = `${safeBase}${idx}`;
        }
        return candidate;
    }

    function getScriptingContextMap(context = null) {
        const candidates = [
            (context && context.map) || null,
            (context && context.wizard && context.wizard.map) || null,
            (context && context.target && context.target.map) || null,
            (context && context.source && context.source.map) || null,
            (context && context.actor && context.actor.map) || null,
            global.map || null
        ];
        for (let i = 0; i < candidates.length; i++) {
            if (candidates[i]) return candidates[i];
        }
        return null;
    }

    function getPrototypeNamingSectionKey(target, context = null) {
        const mapRef = getScriptingContextMap(context);
        if (!mapRef || !mapRef._prototypeSectionState) return "";
        if (context && typeof context.targetSectionKey === "string" && context.targetSectionKey.length > 0) {
            return context.targetSectionKey;
        }
        if (target && typeof target._prototypeOwnerSectionKey === "string" && target._prototypeOwnerSectionKey.length > 0) {
            return target._prototypeOwnerSectionKey;
        }
        if (target && Number.isFinite(target.x) && Number.isFinite(target.y) && typeof mapRef.getPrototypeSectionKeyForWorldPoint === "function") {
            return mapRef.getPrototypeSectionKeyForWorldPoint(target.x, target.y) || "";
        }
        return "";
    }

    function getPrototypeBubbleCenterSectionKey(context = null) {
        const mapRef = getScriptingContextMap(context);
        if (!mapRef || !mapRef._prototypeSectionState) return "";
        if (context && typeof context.targetSectionKey === "string" && context.targetSectionKey.length > 0) {
            return context.targetSectionKey;
        }
        if (context && context.target && typeof context.target._prototypeOwnerSectionKey === "string" && context.target._prototypeOwnerSectionKey.length > 0) {
            return context.target._prototypeOwnerSectionKey;
        }
        if (context && Number.isFinite(context.x) && Number.isFinite(context.y) && typeof mapRef.getPrototypeSectionKeyForWorldPoint === "function") {
            return mapRef.getPrototypeSectionKeyForWorldPoint(context.x, context.y) || "";
        }
        return (mapRef._prototypeSectionState && typeof mapRef._prototypeSectionState.activeCenterKey === "string")
            ? mapRef._prototypeSectionState.activeCenterKey
            : "";
    }

    function getPrototypeNamedObjectByName(name, context = null) {
        const normalized = String(name || "").trim();
        if (!isValidScriptingName(normalized)) return null;
        const mapRef = getScriptingContextMap(context);
        if (!mapRef || !mapRef._prototypeSectionState || typeof mapRef.findPrototypeNamedObjectInBubble !== "function") {
            return null;
        }
        const centerSectionKey = getPrototypeBubbleCenterSectionKey(context);
        return mapRef.findPrototypeNamedObjectInBubble(normalized, centerSectionKey) || null;
    }

    function getPrototypeNamedObjectEntries(context = null) {
        const mapRef = getScriptingContextMap(context);
        if (!mapRef || !mapRef._prototypeSectionState) return [];
        const bubbleKeys = (typeof mapRef.getPrototypeBubbleSectionKeys === "function")
            ? mapRef.getPrototypeBubbleSectionKeys(getPrototypeBubbleCenterSectionKey(context))
            : null;
        if (!(bubbleKeys instanceof Set) || bubbleKeys.size === 0) return [];
        const out = [];
        const seenNames = new Set();
        bubbleKeys.forEach((sectionKey) => {
            const asset = (typeof mapRef.getPrototypeSectionAsset === "function")
                ? mapRef.getPrototypeSectionAsset(sectionKey)
                : null;
            if (!asset) return;
            const recordLists = [asset.objects, asset.animals, asset.powerups];
            for (let listIndex = 0; listIndex < recordLists.length; listIndex++) {
                const records = recordLists[listIndex];
                if (!Array.isArray(records)) continue;
                for (let i = 0; i < records.length; i++) {
                    const record = records[i];
                    const name = getObjectScriptingName(record);
                    if (!name || seenNames.has(name)) continue;
                    const obj = getPrototypeNamedObjectByName(name, Object.assign({}, context || {}, {
                        targetSectionKey: getPrototypeBubbleCenterSectionKey(context)
                    }));
                    if (!obj || obj.gone) continue;
                    seenNames.add(name);
                    out.push([name, obj]);
                }
            }
        });
        out.sort((a, b) => a[0].localeCompare(b[0]));
        return out;
    }

    function ensureObjectScriptingName(target, context = null) {
        if (!target || typeof target !== "object") return "";

        const mapRef = getScriptingContextMap(context);
        const prototypeSectionKey = getPrototypeNamingSectionKey(target, context);
        if (
            mapRef &&
            mapRef._prototypeSectionState &&
            typeof mapRef.generatePrototypeObjectScriptingName === "function" &&
            prototypeSectionKey
        ) {
            const existingPrototypeName = getObjectScriptingName(target);
            if (existingPrototypeName) {
                return existingPrototypeName;
            }
            const generated = mapRef.generatePrototypeObjectScriptingName(
                getDefaultScriptingNameBase(target),
                prototypeSectionKey,
                { ignoreRuntimeObj: target }
            );
            target.scriptingName = generated;
            return generated;
        }

        const existing = getObjectScriptingName(target);
        if (existing) {
            const owner = namedObjectsByName.get(existing) || null;
            if (!owner || owner === target || owner.gone) {
                unregisterNamedObject(target);
                namedObjectsByName.set(existing, target);
                return existing;
            }
        }

        unregisterNamedObject(target);
        const usedNames = new Set();
        const seedFromRuntime = namedObjectsByName.size === 0;

        const rememberName = (name, obj) => {
            if (!name || !obj || obj === target || obj.gone) return;
            if (usedNames.has(name)) return;
            usedNames.add(name);
            namedObjectsByName.set(name, obj);
        };

        if (seedFromRuntime) {
            const objects = getKnownScriptRuntimeObjects(context);
            for (let i = 0; i < objects.length; i++) {
                const obj = objects[i];
                if (!obj || obj === target) continue;
                rememberName(getObjectScriptingName(obj), obj);
            }
        } else {
            for (const [registeredName, obj] of namedObjectsByName.entries()) {
                if (!obj || obj.gone || obj === target) continue;
                const normalizedName = getObjectScriptingName(obj);
                if (!normalizedName) continue;
                if (normalizedName !== registeredName) {
                    namedObjectsByName.delete(registeredName);
                }
                rememberName(normalizedName, obj);
            }
        }

        const generated = generateUniqueScriptingName(getDefaultScriptingNameBase(target), usedNames);
        target.scriptingName = generated;
        namedObjectsByName.set(generated, target);
        return generated;
    }

    function getKnownScriptRuntimeObjects(context = null) {
        const out = [];
        const seen = new Set();
        const addObject = (obj) => {
            if (!obj || obj.gone || (typeof obj !== "object" && typeof obj !== "function")) return;
            const objectId = getNamedObjectRuntimeId(obj);
            if (seen.has(objectId)) return;
            seen.add(objectId);
            out.push(obj);
        };

        const mapCandidates = [
            (context && context.map) || null,
            (context && context.wizard && context.wizard.map) || null,
            global.map || null
        ];
        for (let i = 0; i < mapCandidates.length; i++) {
            const mapRef = mapCandidates[i];
            if (!mapRef) continue;
            if (Array.isArray(mapRef.gameObjects) && mapRef.gameObjects.length > 0) {
                const gameObjects = mapRef.gameObjects;
                if (Array.isArray(gameObjects)) {
                    for (let j = 0; j < gameObjects.length; j++) {
                        addObject(gameObjects[j]);
                    }
                }
            }
            if (Array.isArray(mapRef.objects)) {
                for (let j = 0; j < mapRef.objects.length; j++) {
                    addObject(mapRef.objects[j]);
                }
            }
            if (typeof mapRef.getAllPrototypeNodes === "function") {
                const prototypeNodes = mapRef.getAllPrototypeNodes();
                if (Array.isArray(prototypeNodes)) {
                    for (let j = 0; j < prototypeNodes.length; j++) {
                        const node = prototypeNodes[j];
                        if (!node || !Array.isArray(node.objects)) continue;
                        for (let k = 0; k < node.objects.length; k++) {
                            addObject(node.objects[k]);
                        }
                    }
                }
            }
        }

        const wallCtor = (typeof globalThis !== "undefined" && globalThis.WallSectionUnit)
            ? globalThis.WallSectionUnit
            : null;
        if (wallCtor && wallCtor._allSections instanceof Map) {
            for (const section of wallCtor._allSections.values()) {
                addObject(section);
            }
        }

        const roofsList = (typeof globalThis !== "undefined" && Array.isArray(globalThis.roofs))
            ? globalThis.roofs
            : ((typeof roofs !== "undefined" && Array.isArray(roofs)) ? roofs : null);
        if (Array.isArray(roofsList)) {
            for (let i = 0; i < roofsList.length; i++) {
                addObject(roofsList[i]);
            }
        }

        const animalsList = (typeof globalThis !== "undefined" && Array.isArray(globalThis.animals))
            ? globalThis.animals
            : ((typeof animals !== "undefined" && Array.isArray(animals)) ? animals : null);
        if (Array.isArray(animalsList)) {
            for (let i = 0; i < animalsList.length; i++) {
                addObject(animalsList[i]);
            }
        }

        const powerupsList = (typeof globalThis !== "undefined" && Array.isArray(globalThis.powerups))
            ? globalThis.powerups
            : ((typeof powerups !== "undefined" && Array.isArray(powerups)) ? powerups : null);
        if (Array.isArray(powerupsList)) {
            for (let i = 0; i < powerupsList.length; i++) {
                addObject(powerupsList[i]);
            }
        }

        const wizardRef = (typeof globalThis !== "undefined" && globalThis.wizard)
            ? globalThis.wizard
            : ((typeof wizard !== "undefined") ? wizard : null);
        if (wizardRef) {
            addObject(wizardRef);
        }

        return out;
    }

    function rebuildNamedObjectRegistry(context = null) {
        namedObjectsByName.clear();
        const objects = getKnownScriptRuntimeObjects(context);
        const usedNames = new Set();

        // Pass 1: reserve existing valid names.
        for (let i = 0; i < objects.length; i++) {
            const obj = objects[i];
            const name = getObjectScriptingName(obj);
            if (!name) continue;
            if (!usedNames.has(name)) {
                usedNames.add(name);
                namedObjectsByName.set(name, obj);
            }
        }

        // Pass 2: auto-name unnamed objects.
        for (let i = 0; i < objects.length; i++) {
            const obj = objects[i];
            const existing = getObjectScriptingName(obj);
            if (existing) continue;
            const generated = ensureObjectScriptingName(obj, context);
            if (!generated) continue;
            usedNames.add(generated);
        }
    }

    function getNamedObjectByName(name, context = null) {
        const normalized = String(name || "").trim();
        if (!isValidScriptingName(normalized)) return null;
        const prototypeTarget = getPrototypeNamedObjectByName(normalized, context);
        if (prototypeTarget && !prototypeTarget.gone) return prototypeTarget;
        const existing = namedObjectsByName.get(normalized) || null;
        if (existing && !existing.gone) return existing;
        rebuildNamedObjectRegistry(context);
        const rebuiltPrototypeTarget = getPrototypeNamedObjectByName(normalized, context);
        if (rebuiltPrototypeTarget && !rebuiltPrototypeTarget.gone) return rebuiltPrototypeTarget;
        const rebuilt = namedObjectsByName.get(normalized) || null;
        return (rebuilt && !rebuilt.gone) ? rebuilt : null;
    }

    function unregisterNamedObject(target) {
        if (!target || typeof target !== "object") return;
        for (const [name, obj] of namedObjectsByName.entries()) {
            if (obj === target) {
                namedObjectsByName.delete(name);
                break;
            }
        }
    }

    function setObjectScriptingName(target, rawName, context = null) {
        if (!target || typeof target !== "object") return false;
        const nextName = String(rawName || "").trim();
        const restoreFromSave = !!(context && context.restoreFromSave === true);
        const mapRef = getScriptingContextMap(context);
        if (
            mapRef &&
            mapRef._prototypeSectionState &&
            typeof mapRef.setPrototypeRuntimeObjectScriptingName === "function"
        ) {
            return mapRef.setPrototypeRuntimeObjectScriptingName(target, nextName, {
                restoreFromSave,
                targetSectionKey: getPrototypeNamingSectionKey(target, context),
                skipBubbleEnsureOnRestore: !!(context && context.skipBubbleEnsureOnRestore === true)
            });
        }
        unregisterNamedObject(target);
        if (!nextName.length) {
            target.scriptingName = "";
            return true;
        }
        if (!isValidScriptingName(nextName)) return false;
        const existingTarget = restoreFromSave
            ? (namedObjectsByName.get(nextName) || null)
            : getNamedObjectByName(nextName, context);
        if (existingTarget && existingTarget !== target) return false;
        target.scriptingName = nextName;
        namedObjectsByName.set(nextName, target);
        return true;
    }

    function getNamedObjectEntries(context = null) {
        const prototypeEntries = getPrototypeNamedObjectEntries(context);
        rebuildNamedObjectRegistry(context);
        const out = [];
        const seenNames = new Set();
        for (let i = 0; i < prototypeEntries.length; i++) {
            const entry = prototypeEntries[i];
            if (!entry || !entry[0] || !entry[1] || entry[1].gone) continue;
            seenNames.add(entry[0]);
            out.push(entry);
        }
        for (const [name, obj] of namedObjectsByName.entries()) {
            if (!obj || obj.gone) continue;
            if (seenNames.has(name)) continue;
            out.push([name, obj]);
        }
        out.sort((a, b) => a[0].localeCompare(b[0]));
        return out;
    }

    function getNamedObjectNames(context = null) {
        return getNamedObjectEntries(context).map(entry => entry[0]);
    }

    function getConsoleGameObject(name, context = null) {
        return getNamedObjectByName(name, context);
    }

    function getConsoleGameObjectState(name, context = null) {
        const target = getNamedObjectByName(name, context);
        if (!target) return null;
        const state = {
            scriptingName: getObjectScriptingName(target),
            type: (typeof target.type === "string" && target.type.trim().length > 0)
                ? target.type
                : ((typeof target.objectType === "string" && target.objectType.trim().length > 0)
                    ? target.objectType
                    : ((target.constructor && target.constructor.name) ? target.constructor.name : "object")),
            category: (typeof target.category === "string" && target.category.trim().length > 0)
                ? target.category
                : "",
            x: Number.isFinite(target.x) ? target.x : null,
            y: Number.isFinite(target.y) ? target.y : null,
            z: Number.isFinite(target.z) ? target.z : null,
            hp: Number.isFinite(target.hp) ? target.hp : null,
            maxHp: Number.isFinite(target.maxHp)
                ? target.maxHp
                : (Number.isFinite(target.maxHP) ? target.maxHP : null),
                forceVisible: target.forceVisible === true,
            visible: target.visible !== false,
            gone: target.gone === true,
            onfire: target.onfire === true || target.isOnFire === true,
            object: target
        };
        return state;
    }

    function getTargetPointRelativeToObject(source, other, mapRef = null) {
        if (!source || !other) return null;
        const sourceX = Number(source.x);
        const sourceY = Number(source.y);
        const otherX = Number(other.x);
        const otherY = Number(other.y);
        if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY) || !Number.isFinite(otherX) || !Number.isFinite(otherY)) {
            return null;
        }
        const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(sourceX, otherX)
            : (otherX - sourceX);
        const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(sourceY, otherY)
            : (otherY - sourceY);
        return {
            x: sourceX + dx,
            y: sourceY + dy,
            dx,
            dy
        };
    }

    function setTreeFallDirectionFromTarget(tree, relation, otherTarget, mapRef = null) {
        if (!tree || tree.type !== "tree" || !otherTarget) return false;
        const relative = getTargetPointRelativeToObject(tree, otherTarget, mapRef);
        if (!relative) return false;
        let desiredDx = Number(relative.dx);
        if (Math.abs(desiredDx) < 1e-6) {
            desiredDx = 1;
        }
        if (relation === "away") desiredDx *= -1;
        tree.fallDirection = desiredDx >= 0 ? "left" : "right";
        tree.hp = 0;
        if (typeof globalThis !== "undefined" && globalThis.activeSimObjects instanceof Set) {
            globalThis.activeSimObjects.add(tree);
        }
        return true;
    }

    function triggerDoorFallFromTarget(door, relation, otherTarget, mapRef = null) {
        if (!door || !isDoorPlacedObject(door) || !otherTarget) return false;
        const relative = getTargetPointRelativeToObject(door, otherTarget, mapRef);
        if (!relative) return false;
        if (relation === "towards") {
            if (typeof door.setDoorFallTowardPoint === "function") {
                door.setDoorFallTowardPoint(relative.x, relative.y);
            } else if (typeof door.setDoorFallAwayFromPoint === "function") {
                door.setDoorFallAwayFromPoint(relative.x, relative.y);
                if (typeof door._doorFallSide === "string") {
                    door._doorFallSide = door._doorFallSide === "front" ? "back" : "front";
                } else if (Number.isFinite(door._doorFallNormalSign)) {
                    door._doorFallNormalSign *= -1;
                }
            } else {
                return false;
            }
        } else {
            if (typeof door.setDoorFallAwayFromPoint !== "function") return false;
            door.setDoorFallAwayFromPoint(relative.x, relative.y);
        }
        door.hp = 0;
        if (typeof globalThis !== "undefined" && globalThis.activeSimObjects instanceof Set) {
            globalThis.activeSimObjects.add(door);
        }
        return true;
    }

    function getNamedObjectCommandTarget(commandName, context = null) {
        const name = String(commandName || "").trim();
        if (!name.length || !name.includes(".")) return null;
        const parts = name.split(".").map(part => part.trim()).filter(Boolean);
        if (parts.length < 2) return null;
        let namedTarget = null;
        if (parts[0] === "this") {
            namedTarget = (context && context.target && typeof context.target === "object")
                ? context.target
                : null;
        } else {
            namedTarget = getNamedObjectByName(parts[0], context);
        }
        if (!namedTarget) return null;
        return {
            target: namedTarget,
            objectName: parts[0],
            pathSegments: parts.slice(1)
        };
    }

    function resolveCommandFunctionTarget(rootTarget, pathSegments) {
        if (!rootTarget || !Array.isArray(pathSegments) || pathSegments.length === 0) return null;
        let cursor = rootTarget;
        for (let i = 0; i < pathSegments.length - 1; i++) {
            const segment = pathSegments[i];
            if (!segment || segment.startsWith("_")) return null;
            if (!cursor || (typeof cursor !== "object" && typeof cursor !== "function")) return null;
            cursor = cursor[segment];
        }
        const methodName = pathSegments[pathSegments.length - 1];
        if (!methodName || methodName.startsWith("_")) return null;
        const fn = cursor && cursor[methodName];
        if (typeof fn !== "function") return null;
        return { receiver: cursor, fn, methodName };
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

    /**
     * Lazily compute and cache which side of the door's traversal normal faces
     * the interior of a closed wall loop.  Returns +1, -1, or 0 (unknown).
     * The result is cached on `door._interiorNormalSign` and only recomputed
     * when the mounted wall section changes.
     */
    function computeDoorInteriorSign(door, mapRef) {
        if (!door) return 0;

        // Check whether the cached value is still valid.
        const currentMountId = Number.isInteger(door.mountedWallSectionUnitId)
            ? door.mountedWallSectionUnitId
            : (Number.isInteger(door.mountedWallLineGroupId)
                ? door.mountedWallLineGroupId : null);
        if (door._interiorNormalSign !== undefined &&
            door._interiorSignMountedId === currentMountId) {
            return door._interiorNormalSign;
        }

        // Default: unknown – callers fall back to the legacy convention.
        door._interiorNormalSign = 0;
        door._interiorSignMountedId = currentMountId;
        if (currentMountId === null) return 0;

        const wallCtor = (typeof globalThis !== "undefined" && globalThis.WallSectionUnit) || null;
        const roofApi  = (typeof globalThis !== "undefined" && globalThis.Roof) || null;
        if (!wallCtor || !wallCtor._allSections ||
            !roofApi  || typeof roofApi.findConvexWallLoopFromStartSection !== "function") {
            return 0;
        }

        const mountedSection = wallCtor._allSections.get(currentMountId);
        if (!mountedSection) return 0;

        const loopSections = roofApi.findConvexWallLoopFromStartSection(
            mountedSection, mapRef, wallCtor, null);
        if (!Array.isArray(loopSections) || loopSections.length < 3) return 0;

        // Compute centroid of the loop vertices (one startPoint per section).
        let sumX = 0, sumY = 0, count = 0;
        let baseX = null, baseY = null;
        for (let i = 0; i < loopSections.length; i++) {
            const sec = loopSections[i];
            if (!sec || !sec.startPoint) continue;
            const px = Number(sec.startPoint.x);
            const py = Number(sec.startPoint.y);
            if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
            if (baseX === null) {
                baseX = px; baseY = py;
                sumX += px;  sumY += py;
            } else {
                const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(baseX, px) : (px - baseX);
                const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(baseY, py) : (py - baseY);
                sumX += baseX + dx;
                sumY += baseY + dy;
            }
            count++;
        }
        if (count < 3) return 0;

        let centroidX = sumX / count;
        let centroidY = sumY / count;
        if (mapRef && typeof mapRef.wrapWorldX === "function") centroidX = mapRef.wrapWorldX(centroidX);
        if (mapRef && typeof mapRef.wrapWorldY === "function") centroidY = mapRef.wrapWorldY(centroidY);

        // Which side of the door's normal is the loop interior on?
        const hitbox = door.groundPlaneHitbox || door.visualHitbox || door.hitbox || null;
        const sign = getDoorTraversalSide(door, hitbox, centroidX, centroidY, mapRef);
        door._interiorNormalSign = sign;
        return sign;
    }

    function refreshDoorEnterExitConvention(door, mapRef = null) {
        if (!isDoorPlacedObject(door)) return 0;
        delete door._interiorNormalSign;
        delete door._interiorSignMountedId;
        const resolvedMap = mapRef || door.map || global.map || null;
        const interiorSign = computeDoorInteriorSign(door, resolvedMap);
        if (interiorSign === 1 || interiorSign === -1) {
            door._learnedEnterSign = interiorSign;
        }
        return interiorSign;
    }

    /**
     * Resolve whether a traversal from one side to the other is
     * "playerEnters" or "playerExits".
     *
     * Priority:
     *   1. Closed-wall-loop interior detection  (computeDoorInteriorSign)
     *   2. Learned convention from a previous traversal  (door._learnedEnterSign)
     *   3. First-traversal rule: the very first crossing is always "entering"
     *
     * `destinationSide` is the side the player ends up on (+1 or -1).
     */
    function resolveDoorEventName(door, destinationSide, mapRef) {
        if (!destinationSide) return "playerEnters"; // degenerate, shouldn't happen

        // 1. Wall-loop detection (also teaches the door for future use).
        const interiorSign = computeDoorInteriorSign(door, mapRef);
        if (interiorSign !== 0) {
            door._learnedEnterSign = interiorSign;
            return destinationSide === interiorSign ? "playerEnters" : "playerExits";
        }

        // 2. Previously learned convention.
        if (door._learnedEnterSign === 1 || door._learnedEnterSign === -1) {
            return destinationSide === door._learnedEnterSign ? "playerEnters" : "playerExits";
        }

        // 3. First traversal — this crossing defines "entering".
        door._learnedEnterSign = destinationSide;
        return "playerEnters";
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

    function stringifyScriptInterpolationValue(value) {
        if (value === null || typeof value === "undefined") return "";
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
            return String(value);
        }
        try {
            return JSON.stringify(value);
        } catch (_) {
            return String(value);
        }
    }

    function interpolateScriptStringContent(content, context = null) {
        const source = String(content || "");
        if (!source.includes("{")) return source;

        let out = "";
        let segmentStart = 0;
        let index = 0;
        while (index < source.length) {
            if (source[index] !== "{") {
                index += 1;
                continue;
            }

            let cursor = index + 1;
            let depth = 1;
            let inQuote = null;
            let escapeNext = false;
            while (cursor < source.length) {
                const ch = source[cursor];
                if (escapeNext) {
                    escapeNext = false;
                    cursor += 1;
                    continue;
                }
                if (ch === "\\") {
                    escapeNext = true;
                    cursor += 1;
                    continue;
                }
                if (inQuote) {
                    if (ch === inQuote) inQuote = null;
                    cursor += 1;
                    continue;
                }
                if (ch === '"' || ch === "'") {
                    inQuote = ch;
                    cursor += 1;
                    continue;
                }
                if (ch === "{") {
                    depth += 1;
                } else if (ch === "}") {
                    depth -= 1;
                    if (depth === 0) break;
                }
                cursor += 1;
            }

            if (depth !== 0 || cursor >= source.length) {
                throw new Error("Unclosed string interpolation expression.");
            }

            out += source.slice(segmentStart, index);
            const expressionText = source.slice(index + 1, cursor).trim();
            if (!expressionText.length) {
                throw new Error("Empty string interpolation expression.");
            }
            const expressionValue = evaluateScriptExpression(expressionText, context);
            out += stringifyScriptInterpolationValue(expressionValue);
            index = cursor + 1;
            segmentStart = index;
        }

        out += source.slice(segmentStart);
        return out;
    }

    function interpolateScriptStructuredValue(value, context = null) {
        if (typeof value === "string") {
            return interpolateScriptStringContent(value, context);
        }
        if (Array.isArray(value)) {
            return value.map(entry => interpolateScriptStructuredValue(entry, context));
        }
        if (value && typeof value === "object") {
            const out = {};
            const entries = Object.entries(value);
            for (let i = 0; i < entries.length; i++) {
                const [key, entryValue] = entries[i];
                out[key] = interpolateScriptStructuredValue(entryValue, context);
            }
            return out;
        }
        return value;
    }

    function parseScriptStructuredLiteral(text, context = null) {
        return interpolateScriptStructuredValue(JSON.parse(text), context);
    }

    function parseScriptStringLiteral(text, context = null) {
        const normalized = text.startsWith("'")
            ? `\"${text.slice(1, -1).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"")}\"`
            : text;
        try {
            return interpolateScriptStringContent(JSON.parse(normalized), context);
        } catch (_) {
            return interpolateScriptStringContent(text.slice(1, -1), context);
        }
    }

    function hasScriptLocal(context, name) {
        const locals = context && context.locals;
        if (!locals || (typeof locals !== "object" && typeof locals !== "function")) return false;
        return name in locals;
    }

    function getScriptLocalValue(context, name) {
        return hasScriptLocal(context, name)
            ? context.locals[name]
            : undefined;
    }

    function resolveScriptExpressionPath(path, context = null) {
        const normalized = String(path || "").trim();
        if (!normalized.length) {
            return { ok: false, value: undefined };
        }
        const segments = normalized.split(".").map(segment => segment.trim()).filter(Boolean);
        if (segments.length === 0) {
            return { ok: false, value: undefined };
        }

        let cursor = null;
        if (segments[0] === "this") {
            cursor = (context && context.target && typeof context.target === "object")
                ? context.target
                : null;
        } else if (segments[0] === "player" || segments[0] === "wizard") {
            cursor = (context && (context.wizard || context.player)) || global.wizard || null;
        } else if (hasScriptLocal(context, segments[0])) {
            cursor = getScriptLocalValue(context, segments[0]);
        } else if (isValidScriptingName(segments[0])) {
            cursor = getNamedObjectByName(segments[0], context);
        }
        if (cursor === null || typeof cursor === "undefined") {
            return { ok: false, value: undefined };
        }

        for (let i = 1; i < segments.length; i++) {
            const key = segments[i];
            if (!key || key.startsWith("_")) {
                return { ok: false, value: undefined };
            }
            if (!cursor || (typeof cursor !== "object" && typeof cursor !== "function")) {
                return { ok: false, value: undefined };
            }
            cursor = cursor[key];
            if (typeof cursor === "undefined") {
                return { ok: false, value: undefined };
            }
        }

        return { ok: true, value: cursor };
    }

    function readDelimitedScriptSection(sourceText, startIndex, opener, closer) {
        const source = String(sourceText || "");
        if (source[startIndex] !== opener) return null;
        let index = startIndex + 1;
        let depth = 1;
        let inQuote = null;
        let escapeNext = false;
        while (index < source.length) {
            const ch = source[index];
            if (escapeNext) {
                escapeNext = false;
                index += 1;
                continue;
            }
            if (ch === "\\") {
                if (inQuote) escapeNext = true;
                index += 1;
                continue;
            }
            if (inQuote) {
                if (ch === inQuote) inQuote = null;
                index += 1;
                continue;
            }
            if (ch === '"' || ch === "'") {
                inQuote = ch;
                index += 1;
                continue;
            }
            if (ch === opener) {
                depth += 1;
            } else if (ch === closer) {
                depth -= 1;
                if (depth === 0) {
                    return {
                        content: source.slice(startIndex + 1, index),
                        endIndex: index
                    };
                }
            }
            index += 1;
        }
        return null;
    }

    function parseIfStatement(statement) {
        const text = String(statement || "").trim();
        if (!text.startsWith("if")) return null;
        const nextChar = text[2];
        if (nextChar && /[A-Za-z0-9_$]/.test(nextChar)) return null;

        let index = 2;
        while (index < text.length && /\s/.test(text[index])) index += 1;
        if (text[index] !== "(") return null;

        const conditionSection = readDelimitedScriptSection(text, index, "(", ")");
        if (!conditionSection) return null;
        index = conditionSection.endIndex + 1;
        while (index < text.length && /\s/.test(text[index])) index += 1;
        if (text[index] !== "{") return null;

        const bodySection = readDelimitedScriptSection(text, index, "{", "}");
        if (!bodySection) return null;
        index = bodySection.endIndex + 1;
        while (index < text.length && /\s/.test(text[index])) index += 1;
        if (index !== text.length) return null;

        return {
            type: "if",
            condition: conditionSection.content.trim(),
            body: bodySection.content.trim()
        };
    }

    function parseForInStatement(statement) {
        const text = String(statement || "").trim();
        if (!text.startsWith("for")) return null;
        const nextChar = text[3];
        if (nextChar && /[A-Za-z0-9_$]/.test(nextChar)) return null;

        let index = 3;
        while (index < text.length && /\s/.test(text[index])) index += 1;
        if (text[index] !== "(") return null;

        const headerSection = readDelimitedScriptSection(text, index, "(", ")");
        if (!headerSection) return null;
        const headerMatch = headerSection.content.match(/^\s*([A-Za-z_$][\w$]*)\s+in\s+([\s\S]+?)\s*$/);
        if (!headerMatch) return null;
        index = headerSection.endIndex + 1;
        while (index < text.length && /\s/.test(text[index])) index += 1;
        if (text[index] !== "{") return null;

        const bodySection = readDelimitedScriptSection(text, index, "{", "}");
        if (!bodySection) return null;
        index = bodySection.endIndex + 1;
        while (index < text.length && /\s/.test(text[index])) index += 1;
        if (index !== text.length) return null;

        return {
            type: "forIn",
            variableName: headerMatch[1],
            iterableExpression: headerMatch[2].trim(),
            body: bodySection.content.trim()
        };
    }

    function parseBreakStatement(statement) {
        return String(statement || "").trim() === "break";
    }

    function createScriptChildContext(baseContext = null, extraLocals = null) {
        const base = (baseContext && typeof baseContext === "object") ? baseContext : {};
        const nextLocals = {
            ...((base.locals && typeof base.locals === "object") ? base.locals : {})
        };
        if (extraLocals && typeof extraLocals === "object") {
            Object.assign(nextLocals, extraLocals);
        }
        return {
            ...base,
            locals: nextLocals
        };
    }

    function normalizeScriptIterable(value) {
        if (Array.isArray(value)) return value.slice();
        if (typeof value === "string") return Array.from(value);
        if (value && typeof value !== "string" && typeof value[Symbol.iterator] === "function") {
            try {
                return Array.from(value);
            } catch (_) {
                return null;
            }
        }
        return null;
    }

    function getScriptUnlockedMagicNames(wizardRef) {
        if (!wizardRef) return [];
        const normalized = Array.isArray(wizardRef.unlockedMagic)
            ? wizardRef.unlockedMagic
                .map(name => String(name || "").trim().toLowerCase())
                .filter(Boolean)
            : [];
        return Array.from(new Set(normalized));
    }

    function scriptHasMagicUnlock(wizardRef, magicName) {
        if (!wizardRef || typeof magicName !== "string") return false;
        const normalizedName = magicName.trim().toLowerCase();
        if (!normalizedName.length) return false;
        return getScriptUnlockedMagicNames(wizardRef).includes(normalizedName);
    }

    function shuffleScriptArray(source) {
        const out = Array.isArray(source) ? source.slice() : [];
        for (let i = out.length - 1; i > 0; i--) {
            const swapIndex = Math.floor(Math.random() * (i + 1));
            const tmp = out[i];
            out[i] = out[swapIndex];
            out[swapIndex] = tmp;
        }
        return out;
    }

    function normalizeScriptMagicName(rawName) {
        const normalized = String(rawName || "").trim().toLowerCase();
        if (normalized === "iceball") return "freeze";
        return normalized;
    }

    function getScriptMagicIconPath(magicName) {
        const normalizedName = normalizeScriptMagicName(magicName);
        if (!normalizedName.length) return "";
        if (
            typeof global.SpellSystem !== "undefined" &&
            global.SpellSystem &&
            typeof global.SpellSystem.getMagicIconPath === "function"
        ) {
            const iconPath = global.SpellSystem.getMagicIconPath(normalizedName);
            if (typeof iconPath === "string" && iconPath.trim().length > 0) {
                return iconPath.trim();
            }
        }
        const fallbackIcons = {
            fireball: "/assets/images/thumbnails/fireball.png",
            freeze: "/assets/images/magic/iceball.png",
            lightning: "/assets/images/magic/lightning.png",
            spikes: "/assets/images/magic/spike.png",
            maze: "/assets/images/thumbnails/maze.png",
            vanish: "/assets/images/thumbnails/vanish.png",
            teleport: "/assets/images/magic/teleport.png",
            shield: "/assets/images/thumbnails/aura.png",
            omnivision: "/assets/images/thumbnails/eye.png",
            speed: "/assets/images/thumbnails/speed.png",
            healing: "/assets/images/thumbnails/cross.png",
            invisibility: "/assets/images/magic/invisible.png"
        };
        return fallbackIcons[normalizedName] || "";
    }

    function normalizeScriptImagePath(rawPath) {
        let path = String(rawPath || "").trim();
        if (!path.length) return "";
        if (!/^https?:\/\//i.test(path)) {
            if (path.startsWith("images/")) {
                path = `/assets/${path}`;
            } else if (path.startsWith("assets/")) {
                path = `/${path}`;
            } else if (!path.startsWith("/")) {
                path = `/${path}`;
            }
            if (!/[./][A-Za-z0-9]+(?:[?#].*)?$/.test(path)) {
                path += ".png";
            }
        }
        return path;
    }

    function createScriptImageContent(imagePath, options = {}) {
        const resolvedPath = normalizeScriptImagePath(imagePath);
        if (!resolvedPath.length) return "";
        return function buildScriptImageContent() {
            if (typeof document === "undefined") return resolvedPath;
            const img = document.createElement("img");
            img.src = resolvedPath;
            img.alt = String(options.alt || "").trim() || "image";
            img.className = String(options.className || "").trim();
            img.style.display = "block";
            img.style.maxWidth = String(options.maxWidth || "96px");
            img.style.maxHeight = String(options.maxHeight || "96px");
            img.style.margin = String(options.margin || "10px auto 0 auto");
            img.style.objectFit = "contain";
            return img;
        };
    }

    function callScriptExpressionFunction(name, args, context = null) {
        const normalizedName = String(name || "").trim();
        if (!normalizedName.length) {
            throw new Error("Missing function name.");
        }

        if (normalizedName === "shuffle") {
            if (!Array.isArray(args[0])) {
                throw new Error("shuffle() expects an array.");
            }
            return shuffleScriptArray(args[0]);
        }

        if (normalizedName === "hasMagic" || normalizedName === "magicUnlocked") {
            const wizardRef = (context && (context.wizard || context.player)) || global.wizard || null;
            return scriptHasMagicUnlock(wizardRef, String(args[0] || ""));
        }

        if (normalizedName === "player.hasMagic" || normalizedName === "wizard.hasMagic") {
            const wizardRef = (context && (context.wizard || context.player)) || global.wizard || null;
            return scriptHasMagicUnlock(wizardRef, String(args[0] || ""));
        }

        if (normalizedName === "magicIcon") {
            return getScriptMagicIconPath(args[0]);
        }

        if (normalizedName === "image") {
            const imagePath = args[0];
            const options = (args[1] && typeof args[1] === "object" && !Array.isArray(args[1])) ? args[1] : {};
            return createScriptImageContent(imagePath, options);
        }

        const resolved = resolveScriptExpressionPath(normalizedName, context);
        if (resolved.ok && typeof resolved.value === "function") {
            return resolved.value.apply(null, args);
        }

        throw new Error(`Unknown function: ${normalizedName}`);
    }

    function evaluateScriptExpression(rawExpression, context = null) {
        const source = String(rawExpression || "");
        let index = 0;

        const isIdentStart = ch => /[A-Za-z_$]/.test(ch);
        const isIdentPart = ch => /[A-Za-z0-9_$]/.test(ch);

        const skipWhitespace = () => {
            while (index < source.length && /\s/.test(source[index])) index += 1;
        };

        const readNumber = () => {
            const match = source.slice(index).match(/^0[xX][0-9A-Fa-f]+|^\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/);
            if (!match) return null;
            index += match[0].length;
            return Number(match[0]);
        };

        const readIdentifierPath = () => {
            if (!isIdentStart(source[index])) return "";
            const start = index;
            index += 1;
            while (index < source.length && isIdentPart(source[index])) index += 1;
            while (source[index] === ".") {
                const dotIndex = index;
                index += 1;
                if (!isIdentStart(source[index])) {
                    index = dotIndex;
                    break;
                }
                index += 1;
                while (index < source.length && isIdentPart(source[index])) index += 1;
            }
            return source.slice(start, index);
        };

        const parseCallArguments = () => {
            const args = [];
            skipWhitespace();
            if (source[index] === ")") {
                return args;
            }
            while (index < source.length) {
                args.push(parseLogicalOr());
                skipWhitespace();
                if (source[index] === ",") {
                    index += 1;
                    skipWhitespace();
                    continue;
                }
                break;
            }
            return args;
        };

        const toNumericValue = (value, operator) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) {
                throw new Error(`Operator '${operator}' requires numeric operands.`);
            }
            return numeric;
        };

        const parsePrimary = () => {
            skipWhitespace();
            if (index >= source.length) {
                throw new Error("Unexpected end of expression.");
            }

            const ch = source[index];
            if (ch === "(") {
                index += 1;
                const value = parseLogicalOr();
                skipWhitespace();
                if (source[index] !== ")") {
                    throw new Error("Missing closing ')'.");
                }
                index += 1;
                return value;
            }

            if (ch === "[") {
                const section = readDelimitedScriptSection(source, index, "[", "]");
                if (!section) {
                    throw new Error("Unterminated array literal.");
                }
                const literalText = source.slice(index, section.endIndex + 1);
                index = section.endIndex + 1;
                try {
                    return parseScriptStructuredLiteral(literalText, context);
                } catch (_) {
                    throw new Error("Invalid array literal.");
                }
            }

            if (ch === "{") {
                const section = readDelimitedScriptSection(source, index, "{", "}");
                if (!section) {
                    throw new Error("Unterminated object literal.");
                }
                const literalText = source.slice(index, section.endIndex + 1);
                index = section.endIndex + 1;
                try {
                    return parseScriptStructuredLiteral(literalText, context);
                } catch (_) {
                    throw new Error("Invalid object literal.");
                }
            }

            if (ch === '"' || ch === "'") {
                const quote = ch;
                const start = index;
                index += 1;
                let escapeNext = false;
                while (index < source.length) {
                    const current = source[index];
                    if (escapeNext) {
                        escapeNext = false;
                        index += 1;
                        continue;
                    }
                    if (current === "\\") {
                        escapeNext = true;
                        index += 1;
                        continue;
                    }
                    if (current === quote) {
                        index += 1;
                        return parseScriptStringLiteral(source.slice(start, index), context);
                    }
                    index += 1;
                }
                throw new Error("Unterminated string literal.");
            }

            if (/\d/.test(ch)) {
                return readNumber();
            }

            if (isIdentStart(ch)) {
                const identifierPath = readIdentifierPath();
                if (identifierPath === "true") return true;
                if (identifierPath === "false") return false;
                if (identifierPath === "null") return null;
                skipWhitespace();
                if (source[index] === "(") {
                    index += 1;
                    const args = parseCallArguments();
                    skipWhitespace();
                    if (source[index] !== ")") {
                        throw new Error("Missing closing ')' after function call.");
                    }
                    index += 1;
                    return callScriptExpressionFunction(identifierPath, args, context);
                }
                const resolved = resolveScriptExpressionPath(identifierPath, context);
                if (!resolved.ok) {
                    throw new Error(`Unknown expression value: ${identifierPath}`);
                }
                return resolved.value;
            }

            throw new Error(`Unexpected token: ${ch}`);
        };

        const parseUnary = () => {
            skipWhitespace();
            const ch = source[index];
            if (ch === "+") {
                index += 1;
                return toNumericValue(parseUnary(), "+");
            }
            if (ch === "-") {
                index += 1;
                return -toNumericValue(parseUnary(), "-");
            }
            if (ch === "!") {
                index += 1;
                return !parseUnary();
            }
            return parsePrimary();
        };

        const parseMultiplicative = () => {
            let value = parseUnary();
            while (true) {
                skipWhitespace();
                const operator = source[index];
                if (operator !== "*" && operator !== "/" && operator !== "%") break;
                index += 1;
                const rhs = parseUnary();
                const left = toNumericValue(value, operator);
                const right = toNumericValue(rhs, operator);
                if (operator === "*") value = left * right;
                else if (operator === "/") value = left / right;
                else value = left % right;
            }
            return value;
        };

        const parseAdditive = () => {
            let value = parseMultiplicative();
            while (true) {
                skipWhitespace();
                const operator = source[index];
                if (operator !== "+" && operator !== "-") break;
                index += 1;
                const rhs = parseMultiplicative();
                if (operator === "+") {
                    value = (typeof value === "string" || typeof rhs === "string")
                        ? `${value}${rhs}`
                        : toNumericValue(value, operator) + toNumericValue(rhs, operator);
                } else {
                    value = toNumericValue(value, operator) - toNumericValue(rhs, operator);
                }
            }
            return value;
        };

        const parseRelational = () => {
            let value = parseAdditive();
            while (true) {
                skipWhitespace();
                let operator = "";
                if (source.startsWith("<=", index)) operator = "<=";
                else if (source.startsWith(">=", index)) operator = ">=";
                else if (source[index] === "<") operator = "<";
                else if (source[index] === ">") operator = ">";
                if (!operator) break;
                index += operator.length;
                const rhs = parseAdditive();
                if (operator === "<") value = value < rhs;
                else if (operator === ">") value = value > rhs;
                else if (operator === "<=") value = value <= rhs;
                else value = value >= rhs;
            }
            return value;
        };

        const parseEquality = () => {
            let value = parseRelational();
            while (true) {
                skipWhitespace();
                let operator = "";
                if (source.startsWith("===", index)) operator = "===";
                else if (source.startsWith("!==", index)) operator = "!==";
                else if (source.startsWith("==", index)) operator = "==";
                else if (source.startsWith("!=", index)) operator = "!=";
                if (!operator) break;
                index += operator.length;
                const rhs = parseRelational();
                if (operator === "==") value = value == rhs; // eslint-disable-line eqeqeq
                else if (operator === "!=") value = value != rhs; // eslint-disable-line eqeqeq
                else if (operator === "===") value = value === rhs;
                else value = value !== rhs;
            }
            return value;
        };

        const parseLogicalAnd = () => {
            let value = parseEquality();
            while (true) {
                skipWhitespace();
                if (!source.startsWith("&&", index)) break;
                index += 2;
                value = !!value && !!parseEquality();
            }
            return value;
        };

        const parseLogicalOr = () => {
            let value = parseLogicalAnd();
            while (true) {
                skipWhitespace();
                if (!source.startsWith("||", index)) break;
                index += 2;
                value = !!value || !!parseLogicalAnd();
            }
            return value;
        };

        const value = parseLogicalOr();
        skipWhitespace();
        if (index < source.length) {
            throw new Error(`Unexpected token: ${source[index]}`);
        }
        return value;
    }

    function isLegacyBareScriptWord(text) {
        return /^[A-Za-z_$][\w$]*$/.test(String(text || "").trim());
    }

    function isLegacyBareHexColor(text) {
        const value = String(text || "").trim();
        return /^(?=.*[A-Fa-f])[0-9A-Fa-f]{3,8}$/.test(value);
    }

    function createScriptValidationWizardStub() {
        return {
            hp: 100,
            maxHp: 100,
            magic: 100,
            maxMagic: 100,
            difficulty: 1,
            speed: 2,
            magicRegenPerSecond: 10,
            magicRechargeRate: 10,
            x: 0,
            y: 0,
            unlockedMagic: [],
            heal(amount) {
                const hpDelta = Number(amount);
                if (!Number.isFinite(hpDelta) || hpDelta <= 0) return 0;
                const maxHp = Number.isFinite(this.maxHp) ? Number(this.maxHp) : 100;
                const currentHp = Number.isFinite(this.hp) ? Number(this.hp) : maxHp;
                const nextHp = Math.max(0, Math.min(maxHp, currentHp + hpDelta));
                this.hp = nextHp;
                return Math.max(0, nextHp - currentHp);
            }
        };
    }

    function parseScriptValue(rawValue, context = null) {
        const text = String(rawValue || "").trim();
        if (!text.length) return "";
        if (text === "true") return true;
        if (text === "false") return false;
        if (text === "null") return null;
        if (/^[-+]?(?:0[xX][0-9A-Fa-f]+|\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)$/.test(text)) return Number(text);
        if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
            return parseScriptStringLiteral(text, context);
        }
        if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
            try {
                return parseScriptStructuredLiteral(text, context);
            } catch (_) {
                return text;
            }
        }
        try {
            return evaluateScriptExpression(text, context);
        } catch (error) {
            // Preserve legacy behavior for bare words like fireball or tree1.
            // Preserve legacy unquoted hex colors like 4488ff used in existing save data.
            if (!isLegacyBareScriptWord(text) && !isLegacyBareHexColor(text)) {
                throw error;
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

    function parseCommandStatement(statement, context = null) {
        const text = String(statement || "").trim();
        if (!text.length) return null;
        const match = text.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(([\s\S]*)\)$/);
        if (!match) return null;
        const commandName = match[1];
        const argsSource = String(match[2] || "").trim();
        const positionalArgs = [];
        const namedArgs = {};

        if (argsSource.length > 0) {
            const rawArgs = splitTopLevel(argsSource, ",");
            for (let i = 0; i < rawArgs.length; i++) {
                const rawArg = String(rawArgs[i] || "").trim();
                if (!rawArg.length) continue;
                const namedMatch = rawArg.match(/^([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/);
                if (namedMatch) {
                    namedArgs[namedMatch[1]] = parseScriptValue(namedMatch[2], context);
                } else {
                    positionalArgs.push(parseScriptValue(rawArg, context));
                }
            }
        }

        return { commandName, args: positionalArgs, namedArgs };
    }

    function evaluateScriptCondition(rawCondition, context = null) {
        return !!evaluateScriptExpression(rawCondition, context);
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

    function resolveScriptAssignmentTarget(path, context = null) {
        const trimmedPath = String(path || "").trim();
        if (!trimmedPath.length) return null;
        const segments = trimmedPath.split(".").map(s => s.trim()).filter(Boolean);
        if (segments.length < 2) return null;

        let target = null;
        if (segments[0] === "this") {
            target = (context && context.target && typeof context.target === "object")
                ? context.target
                : null;
        } else if (isValidScriptingName(segments[0])) {
            target = getNamedObjectByName(segments[0], context);
        }
        if (!target) return null;

        return {
            target,
            pathSegments: segments.slice(1),
            assignmentHandlerPath: `this.${segments.slice(1).join(".")}`
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

    function setObjectPathValue(rootTarget, pathSegments, value) {
        if (!rootTarget || !Array.isArray(pathSegments) || pathSegments.length === 0) return false;
        let cursor = rootTarget;
        for (let i = 0; i < pathSegments.length - 1; i++) {
            const key = pathSegments[i];
            if (!key || key.startsWith("_")) return false;
            if (!cursor || (typeof cursor !== "object" && typeof cursor !== "function")) return false;
            if (!Object.prototype.hasOwnProperty.call(cursor, key) || cursor[key] === null || typeof cursor[key] !== "object") {
                cursor[key] = {};
            }
            cursor = cursor[key];
        }
        const leafKey = pathSegments[pathSegments.length - 1];
        if (!leafKey || leafKey.startsWith("_")) return false;
        if (!cursor || (typeof cursor !== "object" && typeof cursor !== "function")) return false;
        cursor[leafKey] = value;
        return true;
    }

    function getScriptPathValue(path, wizardRef = null) {
        const trimmedPath = String(path || "").trim();
        if (!trimmedPath.length) return undefined;
        const segments = trimmedPath.split(".").map(s => s.trim()).filter(Boolean);
        if (segments.length === 0) return undefined;

        let root = global;
        let startIdx = 0;
        if ((segments[0] === "wizard" || segments[0] === "player") && wizardRef && typeof wizardRef === "object") {
            root = wizardRef;
            startIdx = 1;
        }
        if (startIdx >= segments.length) return undefined;

        let cursor = root;
        for (let i = startIdx; i < segments.length; i++) {
            if (!cursor || (typeof cursor !== "object" && typeof cursor !== "function")) return undefined;
            cursor = cursor[segments[i]];
            if (cursor === undefined || cursor === null) {
                if (i < segments.length - 1) return undefined;
            }
        }
        return cursor;
    }

    function getObjectPathValue(rootTarget, pathSegments) {
        if (!rootTarget || !Array.isArray(pathSegments) || pathSegments.length === 0) return undefined;
        let cursor = rootTarget;
        for (let i = 0; i < pathSegments.length; i++) {
            const key = pathSegments[i];
            if (!key || key.startsWith("_")) return undefined;
            if (!cursor || (typeof cursor !== "object" && typeof cursor !== "function")) return undefined;
            cursor = cursor[key];
            if (cursor === undefined || cursor === null) {
                if (i < pathSegments.length - 1) return undefined;
            }
        }
        return cursor;
    }

    function resolveAssignmentValue(path, operator, rhsRaw, context = null) {
        const rhs = parseScriptValue(rhsRaw, context);
        if (operator !== "+=") return { ok: true, value: rhs };

        const wizardRef = context && context.wizard ? context.wizard : null;
        const objectAssignment = resolveScriptAssignmentTarget(path, context);
        const currentValue = objectAssignment
            ? getObjectPathValue(objectAssignment.target, objectAssignment.pathSegments)
            : getScriptPathValue(path, wizardRef);
        const baseValue = Number(currentValue);
        const deltaValue = Number(rhs);
        if (!Number.isFinite(baseValue) || !Number.isFinite(deltaValue)) {
            return { ok: false, value: rhs };
        }
        return { ok: true, value: baseValue + deltaValue };
    }

    function buildDirectAssignmentContext(path, context = null) {
        const baseContext = (context && typeof context === "object") ? context : {};
        const trimmedPath = String(path || "").trim();
        if (!trimmedPath.length) return baseContext;
        const segments = trimmedPath.split(".").map(s => s.trim()).filter(Boolean);
        if (segments.length < 2) return baseContext;
        if (segments[0] === "player" || segments[0] === "wizard") {
            const wizardRef = baseContext.wizard || baseContext.player || global.wizard || null;
            if (wizardRef && typeof wizardRef === "object") {
                return {
                    ...baseContext,
                    target: wizardRef,
                    wizard: wizardRef,
                    player: wizardRef,
                    map: (wizardRef && wizardRef.map) || baseContext.map || null
                };
            }
        }
        return baseContext;
    }

    function executeAssignmentStatement(lhs, rhsRaw, context = null, operator = "=") {
        const path = String(lhs || "").trim();
        if (!path.length) return false;
        let resolvedValue = null;
        try {
            resolvedValue = resolveAssignmentValue(path, operator, rhsRaw, context);
        } catch (error) {
            console.error(`Scripting assignment '${path}' failed to parse value:`, error);
            return false;
        }
        if (!resolvedValue.ok) return false;
        const rhs = resolvedValue.value;
        const wizardRef = context && context.wizard ? context.wizard : null;
        const directAssignmentHandler = assignmentHandlersByPath.get(path) || null;
        if (directAssignmentHandler) {
            try {
                const changedByHandler = directAssignmentHandler(rhs, buildDirectAssignmentContext(path, context));
                if (changedByHandler) {
                    markPrototypeScriptTargetDirty(context && context.target ? context.target : null);
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

        const objectAssignment = resolveScriptAssignmentTarget(path, context);
        const objectAssignmentHandler = objectAssignment
            ? (assignmentHandlersByPath.get(objectAssignment.assignmentHandlerPath) || null)
            : null;
        if (objectAssignmentHandler) {
            try {
                const changedByHandler = objectAssignmentHandler(rhs, {
                    ...(context && typeof context === "object" ? context : {}),
                    target: objectAssignment.target
                });
                if (changedByHandler) {
                    markPrototypeScriptTargetDirty(objectAssignment.target);
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

        if (objectAssignment && setObjectPathValue(objectAssignment.target, objectAssignment.pathSegments, rhs)) {
            markPrototypeScriptTargetDirty(objectAssignment.target);
            emit("script:assignmentApplied", {
                path,
                value: rhs,
                rawValue: rhsRaw,
                wizard: wizardRef
            });
            return true;
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

    function resolveScriptCommand(commandName, context = null) {
        const name = String(commandName || "").trim();
        if (!name.length) return { kind: "invalid", name };

        const directHandler = commandHandlersByName.get(name);
        if (typeof directHandler === "function") {
            return {
                kind: "handler",
                name,
                handler: directHandler,
                context: (context && typeof context === "object") ? context : {}
            };
        }

        const hasDot = name.includes(".");
        const rootName = hasDot
            ? String(name.split(".")[0] || "").trim()
            : "";
        const namedCommand = getNamedObjectCommandTarget(name, context);
        if (!namedCommand) {
            if (hasDot && isValidScriptingName(rootName) && !getNamedObjectByName(rootName, context)) {
                return { kind: "unknownObject", name, objectName: rootName };
            }
            return { kind: "unknownCommand", name };
        }

        const methodPath = namedCommand.pathSegments.join(".");
        const thisScopedHandler = commandHandlersByName.get(`this.${methodPath}`);
        if (typeof thisScopedHandler === "function") {
            return {
                kind: "handler",
                name: `this.${methodPath}`,
                handler: thisScopedHandler,
                context: {
                    ...(context && typeof context === "object" ? context : {}),
                    target: namedCommand.target
                }
            };
        }

        if (methodPath === "delete" || methodPath === "remove" || methodPath === "removeFromGame") {
            return { kind: "removeTarget", name, target: namedCommand.target };
        }
        if (methodPath === "lock") {
            return { kind: "lockTarget", name, target: namedCommand.target };
        }
        if (methodPath === "unlock") {
            return { kind: "unlockTarget", name, target: namedCommand.target };
        }
        if (methodPath === "open") {
            return { kind: "openTarget", name, target: namedCommand.target };
        }
        if (methodPath === "close") {
            return { kind: "closeTarget", name, target: namedCommand.target };
        }
        if (methodPath === "deactivate") {
            return { kind: "deactivateTarget", name, target: namedCommand.target };
        }
        if (methodPath === "activate") {
            return { kind: "activateTarget", name, target: namedCommand.target };
        }
        if (methodPath === "crumble") {
            return { kind: "crumbleTarget", name, target: namedCommand.target };
        }

        const resolved = resolveCommandFunctionTarget(namedCommand.target, namedCommand.pathSegments);
        if (resolved) {
            return {
                kind: "namedMethod",
                name,
                resolved,
                namedCommand
            };
        }

        return { kind: "unknownCommand", name };
    }

    function executeCommandStatement(commandName, args, namedArgs, context = null) {
        const name = String(commandName || "").trim();
        if (!name.length) return false;
        const resolvedCommand = resolveScriptCommand(name, context);
        const mutationTarget = (() => {
            if (resolvedCommand && resolvedCommand.target) return resolvedCommand.target;
            if (resolvedCommand && resolvedCommand.context && resolvedCommand.context.target) {
                return resolvedCommand.context.target;
            }
            if (resolvedCommand && resolvedCommand.resolved) {
                const receiver = resolvedCommand.resolved.receiver;
                if (receiver && typeof receiver === "object") return receiver;
            }
            if (context && context.target && typeof context.target === "object") return context.target;
            return null;
        })();
        const finalizeMutationResult = (result) => {
            const didChange = !!result;
            if (didChange) {
                markPrototypeScriptTargetDirty(mutationTarget);
            }
            return didChange;
        };
        try {
            const normalizedNamedArgs = (namedArgs && typeof namedArgs === "object")
                ? namedArgs
                : {};
            const callArgs = Array.isArray(args) ? args : [];
            if (resolvedCommand.kind === "handler" && typeof resolvedCommand.handler === "function") {
                const result = resolvedCommand.handler(callArgs, resolvedCommand.context || null, normalizedNamedArgs);
                return isPromiseLike(result)
                    ? Promise.resolve(result).then(finalizeMutationResult)
                    : finalizeMutationResult(result);
            }
            if (resolvedCommand.kind === "removeTarget") {
                return finalizeMutationResult(removeTargetObject(resolvedCommand.target));
            }
            if (resolvedCommand.kind === "lockTarget") {
                return finalizeMutationResult(setDoorLockedState(resolvedCommand.target, true));
            }
            if (resolvedCommand.kind === "unlockTarget") {
                return finalizeMutationResult(setDoorLockedState(resolvedCommand.target, false));
            }
            if (resolvedCommand.kind === "openTarget") {
                const target = resolvedCommand.target;
                return finalizeMutationResult(
                    isDoorPlacedObject(target)
                        ? openDoorForTraversal(target)
                        : setWindowOpenState(target, true)
                );
            }
            if (resolvedCommand.kind === "closeTarget") {
                const target = resolvedCommand.target;
                return finalizeMutationResult(
                    isDoorPlacedObject(target)
                        ? setDoorLockedState(target, true)
                        : setWindowOpenState(target, false)
                );
            }
            if (resolvedCommand.kind === "deactivateTarget") {
                resolvedCommand.target._scriptDeactivated = true;
                return finalizeMutationResult(true);
            }
            if (resolvedCommand.kind === "activateTarget") {
                resolvedCommand.target._scriptDeactivated = false;
                return finalizeMutationResult(true);
            }
            if (resolvedCommand.kind === "crumbleTarget") {
                const result = performCrumble(resolvedCommand.target, callArgs, normalizedNamedArgs);
                return isPromiseLike(result)
                    ? Promise.resolve(result).then(finalizeMutationResult)
                    : finalizeMutationResult(result);
            }
            if (resolvedCommand.kind === "namedMethod" && resolvedCommand.resolved) {
                const result = resolvedCommand.resolved.fn.apply(resolvedCommand.resolved.receiver, callArgs);
                return isPromiseLike(result)
                    ? Promise.resolve(result).then((value) => finalizeMutationResult(value !== false))
                    : finalizeMutationResult(result !== false);
            }
            return false;
        } catch (error) {
            console.error(`Scripting command '${name}' failed:`, error);
            return false;
        }
    }

    function isPromiseLike(value) {
        return !!value && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
    }

    function createScriptRunResult(changed, promise = null, control = null) {
        return {
            changed: !!changed,
            promise: isPromiseLike(promise) ? promise : null,
            control: control || null
        };
    }

    function runScript(script, context = null) {
        if (typeof script !== "string") return false;
        const statements = splitTopLevel(script, [";", "\n", "\r"]);
        if (statements.length === 0) return false;

        let changed = false;
        let pending = null;
        let control = null;
        for (let i = 0; i < statements.length; i++) {
            if (control) break;
            const statement = statements[i];
            if (parseBreakStatement(statement)) {
                control = "break";
                if (pending) {
                    pending = pending.then(() => {
                        control = "break";
                    });
                }
                break;
            }
            const forStatement = parseForInStatement(statement);
            if (forStatement) {
                const runForStatement = () => {
                    let iterableValue = null;
                    try {
                        iterableValue = parseScriptValue(forStatement.iterableExpression, context);
                    } catch (error) {
                        console.error("Scripting for-loop iterable failed:", error);
                        return createScriptRunResult(false);
                    }
                    const iterableEntries = normalizeScriptIterable(iterableValue);
                    if (!iterableEntries) {
                        console.error("Scripting for-loop iterable is not iterable:", iterableValue);
                        return createScriptRunResult(false);
                    }

                    let loopChanged = false;
                    let loopControl = null;

                    const applyLoopRunResult = (loopRun) => {
                        loopChanged = !!(loopRun && loopRun.changed) || loopChanged;
                        if (loopRun && loopRun.control === "break") {
                            loopControl = "break";
                        }
                    };

                    const runLoopEntry = (entryIndex) => {
                        if (entryIndex >= iterableEntries.length || loopControl === "break") {
                            return createScriptRunResult(loopChanged, null, null);
                        }

                        const loopValue = iterableEntries[entryIndex];
                        const loopContext = createScriptChildContext(context, {
                            [forStatement.variableName]: loopValue
                        });
                        const loopRun = runScript(forStatement.body, loopContext);
                        if (loopRun && isPromiseLike(loopRun.promise)) {
                            loopChanged = !!loopRun.changed || loopChanged;
                            return createScriptRunResult(
                                loopChanged,
                                Promise.resolve(loopRun.promise).then(() => {
                                    applyLoopRunResult(loopRun);
                                    const nextRun = runLoopEntry(entryIndex + 1);
                                    if (nextRun && isPromiseLike(nextRun.promise)) {
                                        return nextRun.promise;
                                    }
                                }),
                                null
                            );
                        }
                        applyLoopRunResult(loopRun);
                        return runLoopEntry(entryIndex + 1);
                    };

                    return runLoopEntry(0);
                };

                if (pending) {
                    pending = pending.then(() => {
                        if (control) return;
                        const forRun = runForStatement();
                        if (forRun && isPromiseLike(forRun.promise)) {
                            changed = !!forRun.changed || changed;
                            return Promise.resolve(forRun.promise).then(() => {
                                changed = !!forRun.changed || changed;
                                if (forRun.control) {
                                    control = forRun.control;
                                }
                            });
                        }
                        changed = !!(forRun && forRun.changed) || changed;
                        if (forRun && forRun.control) {
                            control = forRun.control;
                        }
                    });
                } else {
                    const forRun = runForStatement();
                    if (forRun && isPromiseLike(forRun.promise)) {
                        changed = !!forRun.changed || changed;
                        if (forRun.control) {
                            control = forRun.control;
                        }
                        pending = Promise.resolve(forRun.promise).then(() => {
                            changed = !!forRun.changed || changed;
                            if (forRun.control) {
                                control = forRun.control;
                            }
                        });
                    } else {
                        changed = !!(forRun && forRun.changed) || changed;
                        if (forRun && forRun.control) {
                            control = forRun.control;
                        }
                    }
                }
                continue;
            }
            const ifStatement = parseIfStatement(statement);
            if (ifStatement) {
                const runIfStatement = () => {
                    try {
                        if (!evaluateScriptCondition(ifStatement.condition, context)) {
                            return createScriptRunResult(false);
                        }
                    } catch (error) {
                        console.error(`Scripting if-condition failed:`, error);
                        return createScriptRunResult(false);
                    }
                    return runScript(ifStatement.body, context);
                };

                if (pending) {
                    pending = pending.then(() => {
                        if (control) return;
                        const ifRun = runIfStatement();
                        if (ifRun && isPromiseLike(ifRun.promise)) {
                            changed = !!ifRun.changed || changed;
                            return Promise.resolve(ifRun.promise).then(() => {
                                changed = !!ifRun.changed || changed;
                                if (ifRun.control) {
                                    control = ifRun.control;
                                }
                            });
                        }
                        changed = !!(ifRun && ifRun.changed) || changed;
                        if (ifRun && ifRun.control) {
                            control = ifRun.control;
                        }
                    });
                } else {
                    const ifRun = runIfStatement();
                    if (ifRun && isPromiseLike(ifRun.promise)) {
                        changed = !!ifRun.changed || changed;
                        if (ifRun.control) {
                            control = ifRun.control;
                        }
                        pending = Promise.resolve(ifRun.promise).then(() => {
                            changed = !!ifRun.changed || changed;
                            if (ifRun.control) {
                                control = ifRun.control;
                            }
                        });
                    } else {
                        changed = !!(ifRun && ifRun.changed) || changed;
                        if (ifRun && ifRun.control) {
                            control = ifRun.control;
                        }
                    }
                }
                continue;
            }
            const assignmentMatch = statement.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(\+=|=)\s*(.+)$/);
            if (assignmentMatch) {
                if (pending) {
                    pending = pending.then(() => {
                        if (control) return;
                        const didAssign = executeAssignmentStatement(assignmentMatch[1], assignmentMatch[3], context, assignmentMatch[2]);
                        changed = didAssign || changed;
                    });
                } else {
                    const didAssign = executeAssignmentStatement(assignmentMatch[1], assignmentMatch[3], context, assignmentMatch[2]);
                    changed = didAssign || changed;
                }
                continue;
            }
            let command = null;
            try {
                command = parseCommandStatement(statement, context);
            } catch (error) {
                console.error("Scripting command parse failed:", error);
                continue;
            }
            if (command) {
                if (pending) {
                    pending = pending.then(() => {
                        if (control) return;
                        const didRun = executeCommandStatement(command.commandName, command.args, command.namedArgs, context);
                        if (isPromiseLike(didRun)) {
                            return Promise.resolve(didRun).then(result => {
                                changed = !!result || changed;
                            });
                        }
                        changed = !!didRun || changed;
                    });
                    continue;
                }
                const didRun = executeCommandStatement(command.commandName, command.args, command.namedArgs, context);
                if (isPromiseLike(didRun)) {
                    changed = true;
                    pending = Promise.resolve(didRun).then(result => {
                        changed = !!result || changed;
                    });
                } else {
                    changed = !!didRun || changed;
                }
            }
        }
        return pending ? createScriptRunResult(changed, pending, control) : createScriptRunResult(changed, null, control);
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

    function getInitScriptForTarget(target) {
        if (!target) return "";
        const scriptTag = target.script;
        if (scriptTag && typeof scriptTag === "object") {
            const initScript = scriptTag[SCRIPT_INIT_KEY];
            if (typeof initScript === "string" && initScript.trim().length > 0) {
                return initScript.trim();
            }
        }
        return "";
    }

    function hasEventScriptForTarget(target, eventName) {
        return getEventScriptForTarget(target, eventName).trim().length > 0;
    }

    function fireObjectScriptEvent(target, eventName, wizardRef = null, context = null) {
        if (!target || !eventName) return false;
        if (target._scriptDeactivated) return false;
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
        const scriptRun = runScript(script, execContext);
        const finalizeExecutedPayload = (changed) => {
            const executedPayload = {
                ...payload,
                changed: !!changed
            };
            emit("script:executed", executedPayload);
            if (isDoorPlacedObject(target)) {
                emit("door:scriptExecuted", executedPayload);
            }
        };
        if (scriptRun && isPromiseLike(scriptRun.promise)) {
            scriptRun.promise
                .then(() => finalizeExecutedPayload(scriptRun.changed))
                .catch(error => console.error("Scripting async event failed:", error));
        } else {
            finalizeExecutedPayload(scriptRun && scriptRun.changed);
        }
        return !!(scriptRun && (scriptRun.changed || scriptRun.promise));
    }

    function fireDoorTraversalEvent(door, eventName, wizardRef = null, context = null) {
        return fireObjectScriptEvent(door, eventName, wizardRef, context);
    }

    function runObjectInitScript(target, wizardRef = null, context = null) {
        if (!target || target.gone) return false;
        const initScript = getInitScriptForTarget(target);
        if (!initScript) return false;
        const execContext = {
            wizard: wizardRef || null,
            player: wizardRef || null,
            map: (wizardRef && wizardRef.map) || (target && target.map) || null,
            target,
            eventName: SCRIPT_INIT_KEY,
            payload: context || null
        };
        const scriptRun = runScript(initScript, execContext);
        if (scriptRun && isPromiseLike(scriptRun.promise)) {
            scriptRun.promise.catch(error => console.error("Scripting async init failed:", error));
        }
        return !!(scriptRun && (scriptRun.changed || scriptRun.promise));
    }

    function processObjectTouchEvents(wizardRef, nearbyEntries, radius = 0, options = null) {
        if (!wizardRef) return;
        const touchedByObjectId = (wizardRef._scriptTouchedObjectsById instanceof Map)
            ? wizardRef._scriptTouchedObjectsById
            : new Map();
        wizardRef._scriptTouchedObjectsById = touchedByObjectId;
        const suppressTouchEvents = !!(options && options.suppressTouchEvents === true);

        const wizardX = Number(wizardRef.x);
        const wizardY = Number(wizardRef.y);
        // Tiny epsilon avoids missing transitions when the sampled position
        // lands exactly on a polygon edge.
        const touchRadius = Math.max(0.02, Number(radius) || 0);
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
                if (isTriggerAreaObject(obj)) continue;
                if (!hasEventScriptForTarget(obj, PLAYER_TOUCH_EVENT_NAME) &&
                    !hasEventScriptForTarget(obj, PLAYER_UNTOUCH_EVENT_NAME)) continue;

                const objectId = getObjectTouchRuntimeId(obj);
                const inside = forceTouch || isPointInDoorHitbox(hitbox, wizardX, wizardY, touchRadius);
                if (!inside) continue;

                currentlyTouchingIds.add(objectId);
                if (!touchedByObjectId.has(objectId) &&
                    !suppressTouchEvents &&
                    hasEventScriptForTarget(obj, PLAYER_TOUCH_EVENT_NAME)) {
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

        const resolvedDoorEntries = [];
        const resolvedDoorIds = new Set();
        const appendDoorEntry = (door, hitbox) => {
            if (!isDoorPlacedObject(door) || !hitbox) return;
            const doorId = getDoorRuntimeId(door);
            if (resolvedDoorIds.has(doorId)) return;
            resolvedDoorIds.add(doorId);
            resolvedDoorEntries.push({ obj: door, hitbox, doorId });
        };

        if (Array.isArray(nearbyDoors)) {
            for (let i = 0; i < nearbyDoors.length; i++) {
                const entry = nearbyDoors[i];
                appendDoorEntry(entry && entry.obj, entry && entry.hitbox);
            }
        }

        for (const [doorId, state] of stateByDoorId.entries()) {
            if (!state || (!state.inside && !state.touching) || resolvedDoorIds.has(doorId)) continue;
            const trackedDoor = state.door;
            if (!isDoorPlacedObject(trackedDoor) || trackedDoor.gone || trackedDoor.vanishing) {
                stateByDoorId.delete(doorId);
                continue;
            }
            const trackedHitbox = trackedDoor.groundPlaneHitbox || trackedDoor.visualHitbox || trackedDoor.hitbox || state.hitbox || null;
            if (!trackedHitbox) continue;
            appendDoorEntry(trackedDoor, trackedHitbox);
        }

        if (resolvedDoorEntries.length === 0) {
            for (const [doorId, state] of stateByDoorId.entries()) {
                if (!state || !state.inside) {
                    stateByDoorId.delete(doorId);
                }
            }
            return;
        }

        const activeIds = new Set();
        for (let i = 0; i < resolvedDoorEntries.length; i++) {
            const entry = resolvedDoorEntries[i];
            const door = entry && entry.obj;
            const hitbox = entry && entry.hitbox;
            if (!isDoorPlacedObject(door) || !hitbox) continue;

            const doorId = entry && entry.doorId ? entry.doorId : getDoorRuntimeId(door);
            activeIds.add(doorId);
            const state = stateByDoorId.get(doorId) || { inside: false, touching: false, entrySide: 0, lastSide: 0 };
            state.door = door;
            state.hitbox = hitbox;

            const insideFrom = isPointInDoorHitbox(hitbox, fromX, fromY, radius);
            const insideTo = isPointInDoorHitbox(hitbox, toX, toY, radius);
            const sideFrom = getDoorTraversalSide(door, hitbox, fromX, fromY, wizardRef.map || null);
            const sideTo = getDoorTraversalSide(door, hitbox, toX, toY, wizardRef.map || null);
            const locked = isDoorLocked(door);

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

            if (locked) {
                state.inside = false;
                state.entrySide = 0;
                if (sideTo !== 0) {
                    state.lastSide = sideTo;
                }
                stateByDoorId.set(doorId, state);
                continue;
            }

            if (state.inside && !insideTo) {
                const exitSide = sideTo !== 0 ? sideTo : sideFrom;
                if (state.entrySide !== 0 && exitSide !== 0 && exitSide !== state.entrySide) {
                    const eventName = resolveDoorEventName(door, exitSide, wizardRef.map || null);
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
                state.inside = false;
                state.entrySide = 0;
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

    function processTriggerAreaTraversalEvents(wizardRef, fromX, fromY, toX, toY, nearbyEntries, radius = 0, options = null) {
        if (!wizardRef) return;
        const stateById = (wizardRef._triggerAreaTraversalStateById instanceof Map)
            ? wizardRef._triggerAreaTraversalStateById
            : new Map();
        wizardRef._triggerAreaTraversalStateById = stateById;
        const treatInitialOverlapAsEnter = !!(options && options.treatInitialOverlapAsEnter === true);

        // Match object-touch behavior: a tiny probe radius avoids missing enter/exit
        // transitions when the sampled position lands exactly on a polygon edge.
        const touchRadius = Math.max(0.02, Number(radius) || 0);
        const activeIds = new Set();
        if (Array.isArray(nearbyEntries) && nearbyEntries.length > 0) {
            for (let i = 0; i < nearbyEntries.length; i++) {
                const entry = nearbyEntries[i];
                const area = entry && entry.obj;
                const hitbox = entry && entry.hitbox;
                if (!isTriggerAreaObject(area) || !hitbox) continue;
                if (
                    !hasEventScriptForTarget(area, "playerTouches") &&
                    !hasEventScriptForTarget(area, "playerUntouches") &&
                    !hasEventScriptForTarget(area, "playerEnters") &&
                    !hasEventScriptForTarget(area, "playerExits")
                ) {
                    continue;
                }
                const areaId = getTriggerTraversalStateId(area);
                activeIds.add(areaId);
                const sampledPrevInside = isPointInDoorHitbox(hitbox, fromX, fromY, touchRadius);
                const priorState = stateById.get(areaId) || null;
                const prevInside = (priorState && typeof priorState.inside === "boolean")
                    ? priorState.inside
                    : sampledPrevInside;
                const nextInside = isPointInDoorHitbox(hitbox, toX, toY, touchRadius);
                const shouldTreatInitialOverlapAsEnter = (
                    treatInitialOverlapAsEnter &&
                    !priorState &&
                    nextInside
                );
                if (shouldTreatInitialOverlapAsEnter) {
                    const preferredEventName = hasEventScriptForTarget(area, "playerEnters")
                        ? "playerEnters"
                        : "playerTouches";
                    fireObjectScriptEvent(area, preferredEventName, wizardRef, {
                        areaId,
                        fromX,
                        fromY,
                        toX,
                        toY,
                        insideFrom: false,
                        insideTo: true,
                        reason: "load-enter"
                    });
                    stateById.set(areaId, { inside: true });
                    continue;
                }
                if (prevInside === nextInside) {
                    stateById.set(areaId, { inside: nextInside });
                    continue;
                }
                const preferredEventName = nextInside
                    ? (hasEventScriptForTarget(area, "playerEnters") ? "playerEnters" : "playerTouches")
                    : (hasEventScriptForTarget(area, "playerExits") ? "playerExits" : "playerUntouches");
                fireObjectScriptEvent(area, preferredEventName, wizardRef, {
                    areaId,
                    fromX,
                    fromY,
                    toX,
                    toY,
                    insideFrom: prevInside,
                    insideTo: nextInside
                });
                stateById.set(areaId, { inside: nextInside });
            }
        }

        for (const [areaId, state] of stateById.entries()) {
            if (activeIds.has(areaId)) continue;
            if (!state || !state.inside) {
                stateById.delete(areaId);
            }
        }
    }

    function normalizeScriptSpellName(rawName) {
        const name = String(rawName || "").trim().toLowerCase();
        return name;
    }

    function parseRelativeOffset(rawLocation) {
        const parsed = { x: null, y: null };
        const parseCoord = (value) => {
            const n = Number(value);
            return Number.isFinite(n) ? n : null;
        };

        if (rawLocation && typeof rawLocation === "object") {
            if (Array.isArray(rawLocation)) {
                parsed.x = parseCoord(rawLocation[0]);
                parsed.y = parseCoord(rawLocation[1]);
            } else {
                parsed.x = parseCoord(rawLocation.x);
                parsed.y = parseCoord(rawLocation.y);
            }
        } else if (typeof rawLocation === "string") {
            const trimmed = rawLocation.trim();
            if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                try {
                    const strictJson = trimmed.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
                    const parsedObj = JSON.parse(strictJson);
                    parsed.x = parseCoord(parsedObj && parsedObj.x);
                    parsed.y = parseCoord(parsedObj && parsedObj.y);
                } catch (_) {
                    // Fall through to simple parsing below.
                }
            }
            if (parsed.x === null || parsed.y === null) {
                const parts = rawLocation.split(",").map(part => parseCoord(part.trim()));
                if (parts.length >= 2) {
                    if (parsed.x === null) parsed.x = parts[0];
                    if (parsed.y === null) parsed.y = parts[1];
                }
            }
        }

        return {
            x: (parsed.x === null) ? 0 : parsed.x,
            y: (parsed.y === null) ? 0 : parsed.y
        };
    }

    function resolveScriptCameraTarget(rawTarget, context = null) {
        if (rawTarget && typeof rawTarget === "object") {
            return rawTarget;
        }

        const targetName = String(rawTarget || "").trim();
        if (!targetName.length || targetName === "player" || targetName === "wizard") {
            return (context && context.wizard) || global.wizard || null;
        }

        return getNamedObjectByName(targetName, context);
    }

    function getCreatureCtor(typeName) {
        const type = String(typeName || "").trim().toLowerCase();
        switch (type) {
            case "squirrel":
                return (typeof Squirrel === "function") ? Squirrel : global.Squirrel || null;
            case "deer":
                return (typeof Deer === "function") ? Deer : global.Deer || null;
            case "bear":
                return (typeof Bear === "function") ? Bear : global.Bear || null;
            case "eagleman":
                return (typeof Eagleman === "function") ? Eagleman : global.Eagleman || null;
            case "scorpion":
                return (typeof Scorpion === "function") ? Scorpion : global.Scorpion || null;
            case "armadillo":
                return (typeof Armadillo === "function") ? Armadillo : global.Armadillo || null;
            case "coyote":
                return (typeof Coyote === "function") ? Coyote : global.Coyote || null;
            case "goat":
                return (typeof Goat === "function") ? Goat : global.Goat || null;
            case "porcupine":
                return (typeof Porcupine === "function") ? Porcupine : global.Porcupine || null;
            case "yeti":
                return (typeof Yeti === "function") ? Yeti : global.Yeti || null;
            default:
                return null;
        }
    }

    function applyCreatureSizeScale(creature, sizeScaleRaw) {
        const sizeScale = Number(sizeScaleRaw);
        if (!Number.isFinite(sizeScale) || sizeScale <= 0 || Math.abs(sizeScale - 1) < 1e-6) return;
        const baseSize = Number(creature && creature.size);
        if (!Number.isFinite(baseSize) || baseSize <= 0) return;
        const newSize = baseSize * sizeScale;
        creature.size = newSize;

        const scaledProps = ["width", "height", "radius", "lungeRadius", "strikeRange", "damage", "groundRadius", "visualRadius"];
        for (let i = 0; i < scaledProps.length; i++) {
            const prop = scaledProps[i];
            if (!Number.isFinite(creature[prop])) continue;
            creature[prop] = (Number(creature[prop]) / baseSize) * newSize;
        }
        if (typeof creature.updateHitboxes === "function") {
            creature.updateHitboxes();
        }
    }

    function refreshWallSectionTarget(target, options = {}) {
        if (!target || target.type !== "wallSection") return false;
        const refreshBlocking = !!options.refreshBlocking;
        if (Array.isArray(target.attachedObjects)) {
            for (let i = 0; i < target.attachedObjects.length; i++) {
                const entry = target.attachedObjects[i];
                const obj = entry && entry.object;
                if (!obj || obj.gone) continue;
                if (typeof obj.refreshMountedWallPlacement === "function") {
                    obj.refreshMountedWallPlacement();
                    continue;
                }
                if (typeof obj.snapToMountedWall === "function") {
                    obj.snapToMountedWall();
                }
            }
        }
        if (refreshBlocking && typeof target.addToMapNodes === "function") {
            target.addToMapNodes();
        }
        if (refreshBlocking && typeof target.handleJoineryOnPlacement === "function") {
            target.handleJoineryOnPlacement();
            return true;
        }
        if (typeof target.rebuildMesh3d === "function") target.rebuildMesh3d();
        if (typeof target.draw === "function") target.draw();

        if (target.connections instanceof Map) {
            for (const payload of target.connections.values()) {
                const section = payload && payload.section;
                if (!section || section === target || section.gone) continue;
                if (typeof section.rebuildMesh3d === "function") section.rebuildMesh3d();
                if (typeof section.draw === "function") section.draw();
            }
        }
        return true;
    }

    function removeTargetObject(target) {
        if (!target || target.gone) return false;
        if (typeof target.delete === "function") {
            target.delete();
            unregisterNamedObject(target);
            return true;
        }
        if (typeof target.remove === "function") {
            target.remove();
            unregisterNamedObject(target);
            return true;
        }
        if (typeof target.removeFromGame === "function") {
            target.removeFromGame();
            unregisterNamedObject(target);
            return true;
        }
        target.gone = true;
        unregisterNamedObject(target);
        return true;
    }

    // Script brightness is a color-grade control in percentage terms:
    //   0    => unchanged
    //   100  => fully white
    //  -100  => fully black
    // Values outside [-100, 100] are clamped.
    function buildScriptBrightnessMatrix(rawBrightness) {
        const percent = Math.max(-100, Math.min(100, Number(rawBrightness)));
        const normalized = percent / 100;
        const lumaR = 0.2126;
        const lumaG = 0.7152;
        const lumaB = 0.0722;
        const saturationToMatrix = (saturation) => {
            const inv = 1 - saturation;
            return {
                rr: inv * lumaR + saturation,
                rg: inv * lumaG,
                rb: inv * lumaB,
                gr: inv * lumaR,
                gg: inv * lumaG + saturation,
                gb: inv * lumaB,
                br: inv * lumaR,
                bg: inv * lumaG,
                bb: inv * lumaB + saturation
            };
        };

        if (normalized >= 0) {
            // Punchy profile: faster ramp with stronger saturation lift.
            const t = Math.pow(normalized, 1.35);
            const saturation = 1 + (0.75 * t);
            const whiteMix = 0.55 * t;
            const scale = 1 - whiteMix;
            const sat = saturationToMatrix(saturation);
            return [
                scale * sat.rr, scale * sat.rg, scale * sat.rb, 0, whiteMix,
                scale * sat.gr, scale * sat.gg, scale * sat.gb, 0, whiteMix,
                scale * sat.br, scale * sat.bg, scale * sat.bb, 0, whiteMix,
                0, 0, 0, 1, 0
            ];
        }

        const t = Math.pow(Math.abs(normalized), 1.35);
        const scale = 1 - t;
        const saturation = 1 - (0.25 * t);
        const sat = saturationToMatrix(saturation);
        return [
            scale * sat.rr, scale * sat.rg, scale * sat.rb, 0, 0,
            scale * sat.gr, scale * sat.gg, scale * sat.gb, 0, 0,
            scale * sat.br, scale * sat.bg, scale * sat.bb, 0, 0,
            0, 0, 0, 1, 0
        ];
    }

    function applyBrightnessToDisplayObject(displayObj, rawBrightness) {
        if (!displayObj || typeof displayObj !== "object") return;
        const pixiScope = (typeof PIXI !== "undefined" && PIXI) ? PIXI : global.PIXI;
        const ColorMatrixFilterCtor = pixiScope && pixiScope.filters && pixiScope.filters.ColorMatrixFilter;
        if (typeof ColorMatrixFilterCtor !== "function") return;
        const SpriteCtor = pixiScope && pixiScope.Sprite;

        const hasBrightness = Number.isFinite(rawBrightness) && Math.abs(Number(rawBrightness)) > 1e-6;
        const currentFilters = Array.isArray(displayObj.filters)
            ? displayObj.filters.filter(Boolean)
            : [];
        const existingFilter = displayObj[SCRIPT_BRIGHTNESS_FILTER_KEY];
        const retainedFilters = currentFilters.filter(filter => filter !== existingFilter);
        const isSprite = (typeof SpriteCtor === "function") && (displayObj instanceof SpriteCtor);

        // Avoid applying PIXI filters to mesh/container depth paths; those can
        // distort world-space billboards. Depth meshes handle brightness via shader.
        if (!isSprite) {
            displayObj[SCRIPT_BRIGHTNESS_FILTER_KEY] = null;
            displayObj.filters = retainedFilters.length > 0 ? retainedFilters : null;
            return;
        }

        if (!hasBrightness) {
            displayObj[SCRIPT_BRIGHTNESS_FILTER_KEY] = null;
            displayObj.filters = retainedFilters.length > 0 ? retainedFilters : null;
            return;
        }

        const filter = (existingFilter instanceof ColorMatrixFilterCtor)
            ? existingFilter
            : new ColorMatrixFilterCtor();
        filter.matrix = buildScriptBrightnessMatrix(rawBrightness);
        displayObj[SCRIPT_BRIGHTNESS_FILTER_KEY] = filter;
        retainedFilters.push(filter);
        displayObj.filters = retainedFilters;
    }

    function applyTargetBrightness(target, preferredDisplayObj = null) {
        if (!target || typeof target !== "object") return false;
        const brightnessPercent = Number(target.brightness);
        const hasBrightness = Number.isFinite(brightnessPercent) && Math.abs(brightnessPercent) > 1e-6;
        const displayObjects = new Set();
        if (preferredDisplayObj && typeof preferredDisplayObj === "object") {
            displayObjects.add(preferredDisplayObj);
        }
        const maybeDisplayObjects = [
            target.pixiSprite,
            target.pixiMesh,
            target._renderingDepthMesh,
            target._depthDisplayMesh,
            target._renderingDisplayObject
        ];
        for (let i = 0; i < maybeDisplayObjects.length; i++) {
            const displayObj = maybeDisplayObjects[i];
            if (!displayObj || typeof displayObj !== "object") continue;
            displayObjects.add(displayObj);
        }
        displayObjects.forEach(displayObj => applyBrightnessToDisplayObject(displayObj, hasBrightness ? brightnessPercent : null));
        return true;
    }

    function showScriptEditorMessage(text) {
        if (typeof global.message === "function") {
            global.message(String(text || ""));
        }
    }

    function getUniqueScriptApiTargetMembers(kind) {
        const out = [];
        const seen = new Set();
        const groups = Object.keys(TARGET_MEMBER_REGISTRY);
        for (let i = 0; i < groups.length; i++) {
            const groupName = groups[i];
            const entries = TARGET_MEMBER_REGISTRY[groupName] || [];
            for (let j = 0; j < entries.length; j++) {
                const entry = entries[j];
                if (!entry || entry.kind !== kind || seen.has(entry.name)) continue;
                seen.add(entry.name);
                out.push(entry);
            }
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }

    function getScriptApiTargetKinds(target) {
        const kinds = ["common"];
        if (!target || typeof target !== "object") return kinds;

        const isWizardTarget = (
            (typeof global.Wizard === "function" && target instanceof global.Wizard) ||
            (typeof Wizard === "function" && target instanceof Wizard) ||
            Number.isFinite(target.magicRegenPerSecond) ||
            Number.isFinite(target.roadSpeedMultiplier)
        );
        if (isWizardTarget) kinds.push("player");

        const isAnimalTarget = (
            (typeof global.Animal === "function" && target instanceof global.Animal) ||
            (typeof Animal === "function" && target instanceof Animal) ||
            Number.isFinite(target.chaseRadius) ||
            Number.isFinite(target.retreatThreshold) ||
            Number.isFinite(target.runSpeed)
        );
        if (isAnimalTarget) kinds.push("animal");
        if (isDoorPlacedObject(target)) kinds.push("door");
        if (isWindowPlacedObject(target)) kinds.push("window");
        if (target.type === "wallSection") kinds.push("wallSection");
        return kinds;
    }

    function getScriptApiMembersForTarget(target) {
        const members = [];
        const seen = new Set();
        const pushEntry = (entry) => {
            if (!entry || seen.has(entry.name)) return;
            seen.add(entry.name);
            members.push(entry);
        };
        const kinds = getScriptApiTargetKinds(target);
        for (let i = 0; i < kinds.length; i++) {
            const kind = kinds[i];
            const entries = (kind === "player")
                ? [
                    ...PLAYER_ASSIGNMENT_REGISTRY.map(entry => ({
                        ...entry,
                        kind: "property"
                    })),
                    ...PLAYER_COMMAND_API_ENTRIES.map(entry => ({
                        ...entry,
                        kind: "method"
                    }))
                ]
                : (TARGET_MEMBER_REGISTRY[kind] || []);
            for (let j = 0; j < entries.length; j++) {
                pushEntry(entries[j]);
            }
        }
        return members.sort((a, b) => a.name.localeCompare(b.name));
    }

    function getScriptEditorHelpMarkup() {
        const renderList = (entries, formatter) => [
            "<ul style='margin:6px 0 10px 20px;padding:0;'>",
            ...entries.map(entry => `<li>${formatter(entry)}</li>`),
            "</ul>"
        ].join("");

        return [
            "<div style='font-weight:bold;font-size:16px;margin-bottom:8px;'>Script Help</div>",
            "<div style='margin-bottom:10px;'>Write scripts in block format. Scripts are saved as JSON internally.</div>",
            "<div style='font-weight:bold;margin-top:8px;'>Event Blocks</div>",
            `<pre style='white-space:pre-wrap;margin:6px 0 10px 0;'>newGame {\n${SCRIPT_EDITOR_INDENT}this.lock()\n}\n\nplayerExits {\n${SCRIPT_EDITOR_INDENT}mazeMode=true\n}\n\nplayerEnters {\n${SCRIPT_EDITOR_INDENT}mazeMode=false\n}\n\nplayerTouches {\n${SCRIPT_EDITOR_INDENT}healPlayer(5)\n}\n\nplayerUntouches {\n${SCRIPT_EDITOR_INDENT}drainMagic(10)\n}\n\ndie {\n${SCRIPT_EDITOR_INDENT}spawnCreature(type="squirrel", size=1)\n}</pre>`,
            "<div style='font-weight:bold;margin-top:8px;'>Statement Syntax</div>",
            renderList([
                { html: "Assignments: <code>mazeMode=true</code>" },
                { html: "Numeric properties also support <code>+=</code>, for example <code>player.speed += 1</code>." },
                { html: "Use <code>player.</code>, <code>wizard.</code>, <code>this.</code>, or a named object like <code>bear1.</code> for members." },
                { html: "Semicolons are optional; newline also ends a statement." },
                { html: "Top-level statements outside any event block run on script save and on fresh object creation (not on load)." },
                { html: "Use <code>newGame { ... }</code> for one-time template setup that should only happen when starting a brand new game." }
            ], entry => entry.html),
            "<div style='font-weight:bold;margin-top:8px;'>Built-in Events</div>",
            renderList(SCRIPTING_API_SCHEMA.events, entry =>
                `<code>${entry.name}</code>: ${entry.description}${entry.appliesTo ? ` (${entry.appliesTo})` : ""}.`
            ),
            "<div style='font-weight:bold;margin-top:8px;'>Player Members</div>",
            renderList(SCRIPTING_API_SCHEMA.playerAssignments, entry =>
                `<code>${entry.syntax}</code>: ${entry.description}.`
            ),
            "<div style='font-weight:bold;margin-top:8px;'>Player Commands</div>",
            renderList(SCRIPTING_API_SCHEMA.playerCommands, entry =>
                `<code>${entry.syntax}</code>: ${entry.description}.`
            ),
            "<div style='font-weight:bold;margin-top:8px;'>Global Commands</div>",
            renderList(SCRIPTING_API_SCHEMA.globalCommands, entry =>
                `<code>${entry.syntax}</code>${entry.description ? `: ${entry.description}.` : ""}`
            ),
            "<div style='font-weight:bold;margin-top:8px;'>Object Members</div>",
            "<div style='margin:6px 0 0 0;font-weight:bold;'>All scripted objects</div>",
            renderList(SCRIPTING_API_SCHEMA.targetMembers.common, entry =>
                `<code>${entry.syntax}</code>: ${entry.description}.`
            ),
            "<div style='margin:6px 0 0 0;font-weight:bold;'>Animals</div>",
            renderList(SCRIPTING_API_SCHEMA.targetMembers.animal, entry =>
                `<code>${entry.syntax}</code>: ${entry.description}.`
            ),
            "<div style='margin:6px 0 0 0;font-weight:bold;'>Doors</div>",
            renderList(SCRIPTING_API_SCHEMA.targetMembers.door, entry =>
                `<code>${entry.syntax}</code>: ${entry.description}.`
            ),
            "<div style='margin:6px 0 0 0;font-weight:bold;'>Wall sections</div>",
            renderList(SCRIPTING_API_SCHEMA.targetMembers.wallSection, entry =>
                `<code>${entry.syntax}</code>: ${entry.description}.`
            )
        ].join("");
    }

    function getScriptEditorHelpPanel() {
        let $panel = $(`#${SCRIPT_EDITOR_HELP_PANEL_ID}`);
        if ($panel.length) return $panel;

        $panel = $("<div>")
            .attr("id", SCRIPT_EDITOR_HELP_PANEL_ID)
            .css({
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "min(760px, 84vw)",
                height: "min(560px, 74vh)",
                display: "none",
                "z-index": 200200,
                background: "rgba(12,12,12,0.98)",
                border: "1px solid #ffd700",
                "border-radius": "8px",
                padding: "12px",
                "box-sizing": "border-box",
                color: "#fff"
            })
            .on("mousedown click keydown keyup", event => {
                event.stopPropagation();
            });

        const $content = $("<div>")
            .html(getScriptEditorHelpMarkup())
            .css({
                height: "calc(100% - 44px)",
                overflow: "auto",
                "padding-right": "4px",
                "line-height": "1.35"
            });

        const $actions = $("<div>")
            .css({
                display: "flex",
                "justify-content": "flex-end",
                gap: "8px",
                "margin-top": "10px"
            });

        const $close = $("<button>")
            .text("Close")
            .css({
                padding: "6px 12px",
                color: "#111",
                background: "#ffd700",
                border: "1px solid #caa700",
                "border-radius": "4px",
                cursor: "pointer",
                "font-weight": "bold"
            })
            .on("click", () => closeScriptEditorHelpPanel());

        $actions.append($close);
        $panel.append($content, $actions);
        $(document.body).append($panel);
        return $panel;
    }

    function openScriptEditorHelpPanel() {
        getScriptEditorHelpPanel().show();
    }

    function closeScriptEditorHelpPanel() {
        $(`#${SCRIPT_EDITOR_HELP_PANEL_ID}`).hide();
    }

    function scriptEditorEscapeHtml(text) {
        return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function lineEndsWithScriptBlockStarter(text) {
        const trimmed = String(text || "").replace(/[ \t]+$/, "");
        if (!trimmed.length) return false;
        const trailingIndex = trimmed.length - 1;
        const delimiterErrors = collectUnterminatedDelimiterErrors(trimmed, 0);
        return delimiterErrors.some(error => error.start === trailingIndex && error.end === trailingIndex + 1);
    }

    function lineStartsWithScriptBlockCloser(text) {
        const trimmed = String(text || "").replace(/^[ \t]+/, "");
        return !!trimmed && (trimmed[0] === "}" || trimmed[0] === "]" || trimmed[0] === ")");
    }

    function collectUnterminatedDelimiterErrors(text, startOffset = 0) {
        const source = String(text || "");
        const errors = [];
        const openers = [];
        let inQuote = null;
        let quoteStart = -1;
        let escapeNext = false;
        const matchingOpeners = {
            "}": "{",
            "]": "[",
            ")": "("
        };

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
                    quoteStart = -1;
                }
                continue;
            }
            if (ch === "\"" || ch === "'") {
                inQuote = ch;
                quoteStart = i;
                continue;
            }
            if (ch === "{" || ch === "[" || ch === "(") {
                openers.push({ char: ch, index: i });
                continue;
            }
            if (matchingOpeners[ch]) {
                const expected = matchingOpeners[ch];
                if (openers.length > 0 && openers[openers.length - 1].char === expected) {
                    openers.pop();
                }
            }
        }

        for (let i = 0; i < openers.length; i++) {
            const opener = openers[i];
            const label = opener.char === "{"
                ? "brace"
                : (opener.char === "[" ? "bracket" : "parenthesis");
            errors.push({
                start: startOffset + opener.index,
                end: startOffset + opener.index + 1,
                message: `Unclosed ${label}`
            });
        }
        if (inQuote === "\"") {
            errors.push({
                start: startOffset + quoteStart,
                end: startOffset + quoteStart + 1,
                message: "Unclosed double quote"
            });
        }
        return errors;
    }

    function updateScriptEditorHighlights() {
        const $ta = $(`#${SCRIPT_EDITOR_TEXTAREA_ID}`);
        const $bd = $(`#${SCRIPT_EDITOR_BACKDROP_ID}`);
        if (!$ta.length || !$bd.length) return;
        const text = String($ta.val() || "");
        const errs = validateScript(text);
        if (errs.length === 0) {
            $bd.html(scriptEditorEscapeHtml(text) + "\n");
            return;
        }
        errs.sort((a, b) => a.start - b.start);
        let html = "";
        let pos = 0;
        for (let i = 0; i < errs.length; i++) {
            const e = errs[i];
            if (e.start < pos) continue;
            if (e.start > pos) html += scriptEditorEscapeHtml(text.slice(pos, e.start));
            html += `<span style="text-decoration:underline wavy red;text-decoration-skip-ink:none;" title="${scriptEditorEscapeHtml(e.message)}">`;
            html += scriptEditorEscapeHtml(text.slice(e.start, e.end));
            html += "</span>";
            pos = e.end;
        }
        if (pos < text.length) html += scriptEditorEscapeHtml(text.slice(pos));
        $bd.html(html + "\n");
    }

    function parseScriptEditorMixedFormat(rawText) {
        const text = String(rawText || "");
        let index = 0;
        const len = text.length;
        const out = {};
        const initStatements = [];
        let parsedAny = false;

        const isIdentStart = ch => /[A-Za-z_$]/.test(ch);
        const isIdentPart = ch => /[A-Za-z0-9_$]/.test(ch);
        const skipWhitespace = () => {
            while (index < len && /\s/.test(text[index])) index += 1;
        };

        while (index < len) {
            skipWhitespace();
            if (index >= len) break;

            const statementStart = index;
            if (isIdentStart(text[index])) {
                const identStart = index;
                index += 1;
                while (index < len && isIdentPart(text[index])) index += 1;
                const ident = text.slice(identStart, index).trim();
                let lookahead = index;
                while (lookahead < len && /\s/.test(text[lookahead])) lookahead += 1;
                if (ident && text[lookahead] === "{") {
                    index = lookahead + 1;
                    const bodyStart = index;
                    let depth = 1;
                    let inQuote = null;
                    let escapeNext = false;
                    while (index < len) {
                        const ch = text[index];
                        if (escapeNext) {
                            escapeNext = false;
                            index += 1;
                            continue;
                        }
                        if (ch === "\\") {
                            if (inQuote) escapeNext = true;
                            index += 1;
                            continue;
                        }
                        if (inQuote) {
                            if (ch === inQuote) inQuote = null;
                            index += 1;
                            continue;
                        }
                        if (ch === '"' || ch === "'") {
                            inQuote = ch;
                            index += 1;
                            continue;
                        }
                        if (ch === "{") depth += 1;
                        else if (ch === "}") {
                            depth -= 1;
                            if (depth === 0) break;
                        }
                        index += 1;
                    }
                    if (depth !== 0 || index >= len) return null;
                    out[ident] = text.slice(bodyStart, index).trim();
                    parsedAny = true;
                    index += 1;
                    continue;
                }
                index = statementStart;
            }

            let inQuote = null;
            let escapeNext = false;
            let depthParen = 0;
            let depthBrace = 0;
            let depthBracket = 0;
            while (index < len) {
                const ch = text[index];
                if (escapeNext) {
                    escapeNext = false;
                    index += 1;
                    continue;
                }
                if (ch === "\\") {
                    if (inQuote) escapeNext = true;
                    index += 1;
                    continue;
                }
                if (inQuote) {
                    if (ch === inQuote) inQuote = null;
                    index += 1;
                    continue;
                }
                if (ch === '"' || ch === "'") {
                    inQuote = ch;
                    index += 1;
                    continue;
                }
                if (ch === "(") depthParen += 1;
                else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
                else if (ch === "{") depthBrace += 1;
                else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);
                else if (ch === "[") depthBracket += 1;
                else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
                if (depthParen === 0 && depthBrace === 0 && depthBracket === 0 && (ch === ";" || ch === "\n" || ch === "\r")) {
                    break;
                }
                index += 1;
            }

            const statement = text.slice(statementStart, index).trim();
            if (statement.length > 0) {
                initStatements.push(statement);
            }
            while (index < len && (text[index] === ";" || text[index] === "\n" || text[index] === "\r")) index += 1;
        }

        if (initStatements.length > 0) {
            out[SCRIPT_INIT_KEY] = initStatements.join(";\n");
            parsedAny = true;
        }
        return parsedAny ? out : null;
    }

    function parseScriptEditorInput(rawText) {
        const text = String(rawText || "").trim();
        if (text.length === 0) return { ok: true, value: {} };
        const parsedScript = parseScriptEditorMixedFormat(text);
        if (parsedScript && typeof parsedScript === "object") {
            return { ok: true, value: parsedScript };
        }
        return { ok: false, error: new Error("Invalid script format") };
    }

    function formatObjectScriptForEditor(target) {
        if (!target) return "";
        const source = target.script;
        if (source === undefined || source === null) return "";

        const formatScriptObjectAsBlocks = (scriptObj) => {
            if (!scriptObj || typeof scriptObj !== "object" || Array.isArray(scriptObj)) return null;
            const eventNames = Object.keys(scriptObj).filter(eventName => eventName !== SCRIPT_INIT_KEY);
            const sections = [];

            // Format a single statement with proper indentation.
            // Multi-line statements (e.g. function calls spanning multiple lines)
            // get their inner lines indented one extra level.
            const formatStmt = (stmt, baseIndent) => {
                const trimmed = stmt.trim();
                if (!trimmed) return "";
                if (!trimmed.includes("\n")) return baseIndent + trimmed + ";";
                const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
                let relativeIndentLevel = 0;
                let previousLine = "";
                return lines.map((line, idx) => {
                    if (idx === 0) {
                        previousLine = line;
                        return baseIndent + line;
                    }
                    if (lineStartsWithScriptBlockCloser(line)) {
                        relativeIndentLevel = Math.max(0, relativeIndentLevel - 1);
                    } else if (lineEndsWithScriptBlockStarter(previousLine)) {
                        relativeIndentLevel += 1;
                    }
                    const formattedLine = baseIndent + SCRIPT_EDITOR_INDENT.repeat(relativeIndentLevel) + line;
                    previousLine = line;
                    return formattedLine;
                }).join("\n") + ";";
            };

            const rawInit = scriptObj[SCRIPT_INIT_KEY];
            const initParts = splitTopLevel(
                String(rawInit === undefined || rawInit === null ? "" : rawInit),
                [";", "\n", "\r"]
            );
            if (initParts.length > 0) {
                sections.push(initParts.map(part => formatStmt(part, "")).join("\n"));
            }

            eventNames.forEach(eventName => {
                const rawBody = scriptObj[eventName];
                const parts = splitTopLevel(
                    String(rawBody === undefined || rawBody === null ? "" : rawBody),
                    [";", "\n", "\r"]
                );
                const body = parts.length > 0
                    ? `\n${parts.map(part => formatStmt(part, SCRIPT_EDITOR_INDENT)).join("\n")}\n`
                    : "\n";
                sections.push(`${eventName} {${body}}`);
            });
            return sections.join("\n\n");
        };

        if (typeof source === "string") {
            const text = source.trim();
            if (!text.length) return "";
            const blockParsed = parseScriptEditorMixedFormat(text);
            if (blockParsed) {
                const formattedBlocks = formatScriptObjectAsBlocks(blockParsed);
                return formattedBlocks !== null ? formattedBlocks : text;
            }
            try {
                const parsed = (text.startsWith("{") || text.startsWith("["))
                    ? JSON.parse(text)
                    : JSON.parse(`{${text}}`);
                const formattedBlocks = formatScriptObjectAsBlocks(parsed);
                return formattedBlocks !== null ? formattedBlocks : text;
            } catch (_err) {
                return source;
            }
        }

        if (source && typeof source === "object" && !Array.isArray(source)) {
            const formattedBlocks = formatScriptObjectAsBlocks(source);
            if (formattedBlocks !== null) return formattedBlocks;
        }

        try {
            return JSON.stringify(source, null, 2);
        } catch (_err) {
            return String(source);
        }
    }

    function describeScriptTarget(target) {
        if (!target) return "Unknown object";
        const parts = [];
        if (typeof target.type === "string" && target.type.length > 0) {
            parts.push(target.type);
        }
        if (typeof target.category === "string" && target.category.length > 0) {
            parts.push(`(${target.category})`);
        }
        if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
            parts.push(`@ ${Number(target.x).toFixed(2)}, ${Number(target.y).toFixed(2)}`);
        }
        return parts.join(" ");
    }

    function getScriptEditorTextareaElement() {
        return document.getElementById(SCRIPT_EDITOR_TEXTAREA_ID);
    }

    function resetScriptEditorCompletionState() {
        scriptEditorCompletionState = {
            active: false,
            replacementStart: 0,
            replacementEnd: 0,
            prefix: "",
            selectedIndex: 0,
            items: []
        };
    }

    function getScriptEditorCompletionPanel() {
        let panel = document.getElementById(SCRIPT_EDITOR_COMPLETION_PANEL_ID);
        if (panel) return panel;
        panel = document.createElement("div");
        panel.id = SCRIPT_EDITOR_COMPLETION_PANEL_ID;
        Object.assign(panel.style, {
            position: "fixed",
            display: "none",
            minWidth: "220px",
            maxWidth: "340px",
            maxHeight: "220px",
            overflowY: "auto",
            zIndex: "200250",
            background: "rgba(8,8,8,0.98)",
            border: "1px solid #caa700",
            borderRadius: "6px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
            fontFamily: "monospace",
            fontSize: "13px",
            lineHeight: "1.35",
            padding: "4px 0"
        });
        document.body.appendChild(panel);
        return panel;
    }

    function hideScriptEditorCompletions() {
        resetScriptEditorCompletionState();
        const panel = document.getElementById(SCRIPT_EDITOR_COMPLETION_PANEL_ID);
        if (panel) {
            panel.style.display = "none";
            panel.innerHTML = "";
        }
    }

    function getScriptEditorContextForLookup() {
        return {
            map: (scriptEditorTargetObject && scriptEditorTargetObject.map) || global.map || null,
            wizard: global.wizard || null,
            target: scriptEditorTargetObject || null
        };
    }

    function resolveScriptCompletionBaseTarget(basePath, context = null) {
        const normalized = String(basePath || "").trim();
        if (!normalized.length) return null;
        const segments = normalized.split(".").map(segment => segment.trim()).filter(Boolean);
        if (segments.length === 0) return null;

        let cursor = null;
        if (segments[0] === "this") {
            cursor = (context && context.target) || null;
        } else if ((segments[0] === "player" || segments[0] === "wizard")) {
            cursor = (context && context.wizard) || global.wizard || null;
        } else if (isValidScriptingName(segments[0])) {
            cursor = getNamedObjectByName(segments[0], context);
        }
        if (!cursor) return null;

        for (let i = 1; i < segments.length; i++) {
            const segment = segments[i];
            if (!segment || segment.startsWith("_")) return null;
            if (!cursor || (typeof cursor !== "object" && typeof cursor !== "function")) return null;
            cursor = cursor[segment];
            if (cursor === undefined || cursor === null) return null;
        }
        return cursor;
    }

    function getScriptCompletionItemsForTarget(target) {
        return getScriptApiMembersForTarget(target).map(entry => ({
            name: entry.name,
            kind: entry.kind
        }));
    }

    function getScriptEditorCompletionContext(text, cursorIndex) {
        const source = String(text || "");
        const cursor = Number.isFinite(cursorIndex) ? cursorIndex : source.length;
        const beforeCursor = source.slice(0, cursor);
        const match = beforeCursor.match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.([A-Za-z_$][\w$]*)?$/);
        if (!match) return null;
        const basePath = match[1];
        const typedPrefix = match[2] || "";
        const baseTarget = resolveScriptCompletionBaseTarget(basePath, getScriptEditorContextForLookup());
        if (!baseTarget) return null;
        const completionItems = getScriptCompletionItemsForTarget(baseTarget).filter(item =>
            item.name.toLowerCase().startsWith(typedPrefix.toLowerCase())
        );
        if (completionItems.length === 0) return null;
        return {
            basePath,
            typedPrefix,
            replacementStart: cursor - typedPrefix.length,
            replacementEnd: cursor,
            items: completionItems
        };
    }

    function getTextareaCaretClientPosition(textarea, cursorIndex) {
        if (!textarea || typeof window === "undefined" || typeof document === "undefined") {
            return null;
        }
        const computed = window.getComputedStyle(textarea);
        const div = document.createElement("div");
        const properties = [
            "boxSizing",
            "width",
            "height",
            "overflowX",
            "overflowY",
            "borderTopWidth",
            "borderRightWidth",
            "borderBottomWidth",
            "borderLeftWidth",
            "paddingTop",
            "paddingRight",
            "paddingBottom",
            "paddingLeft",
            "fontStyle",
            "fontVariant",
            "fontWeight",
            "fontStretch",
            "fontSize",
            "fontSizeAdjust",
            "lineHeight",
            "fontFamily",
            "textAlign",
            "textTransform",
            "textIndent",
            "textDecoration",
            "letterSpacing",
            "wordSpacing",
            "tabSize"
        ];
        div.setAttribute("aria-hidden", "true");
        Object.assign(div.style, {
            position: "absolute",
            visibility: "hidden",
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
            overflow: "hidden",
            top: "0",
            left: "-9999px"
        });
        for (let i = 0; i < properties.length; i++) {
            const prop = properties[i];
            div.style[prop] = computed[prop];
        }
        div.textContent = textarea.value.slice(0, cursorIndex);
        const marker = document.createElement("span");
        marker.textContent = textarea.value.slice(cursorIndex) || ".";
        div.appendChild(marker);
        document.body.appendChild(div);
        const rect = textarea.getBoundingClientRect();
        const markerRect = marker.getBoundingClientRect();
        const left = rect.left + (markerRect.left - div.getBoundingClientRect().left) - textarea.scrollLeft;
        const top = rect.top + (markerRect.top - div.getBoundingClientRect().top) - textarea.scrollTop;
        const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) || 16;
        document.body.removeChild(div);
        return {
            left,
            top,
            height: Math.max(16, lineHeight)
        };
    }

    function renderScriptEditorCompletions(anchorPosition) {
        const panel = getScriptEditorCompletionPanel();
        const items = Array.isArray(scriptEditorCompletionState.items)
            ? scriptEditorCompletionState.items
            : [];
        if (!scriptEditorCompletionState.active || items.length === 0 || !anchorPosition) {
            panel.style.display = "none";
            panel.innerHTML = "";
            return;
        }

        panel.innerHTML = items.map((item, index) => {
            const isSelected = index === scriptEditorCompletionState.selectedIndex;
            const kindLabel = item.kind === "method" ? "fn" : "prop";
            return [
                `<div data-completion-index="${index}" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 10px;cursor:pointer;`,
                isSelected ? "background:#ffd700;color:#111;" : "background:transparent;color:#fff;",
                `">`,
                `<span>${scriptEditorEscapeHtml(item.name)}</span>`,
                `<span style="font-size:11px;opacity:0.7;">${kindLabel}</span>`,
                "</div>"
            ].join("");
        }).join("");

        const viewportWidth = window.innerWidth || 0;
        const viewportHeight = window.innerHeight || 0;
        panel.style.display = "block";
        panel.style.left = `${Math.max(8, Math.min(anchorPosition.left, viewportWidth - 360))}px`;
        panel.style.top = `${Math.max(8, Math.min(anchorPosition.top + anchorPosition.height + 4, viewportHeight - 240))}px`;

        const selectedNode = panel.querySelector(`[data-completion-index="${scriptEditorCompletionState.selectedIndex}"]`);
        if (selectedNode && typeof selectedNode.scrollIntoView === "function") {
            selectedNode.scrollIntoView({ block: "nearest" });
        }

        const nodes = panel.querySelectorAll("[data-completion-index]");
        nodes.forEach(node => {
            node.addEventListener("mousedown", event => {
                event.preventDefault();
                event.stopPropagation();
                const index = Number(node.getAttribute("data-completion-index"));
                if (Number.isFinite(index)) {
                    scriptEditorCompletionState.selectedIndex = index;
                    acceptScriptEditorCompletion();
                }
            });
        });
    }

    function updateScriptEditorCompletions(options = {}) {
        const textarea = getScriptEditorTextareaElement();
        if (!textarea) {
            hideScriptEditorCompletions();
            return;
        }
        const selectionStart = Number(textarea.selectionStart);
        const selectionEnd = Number(textarea.selectionEnd);
        if (!options.force && selectionStart !== selectionEnd) {
            hideScriptEditorCompletions();
            return;
        }

        const completionContext = getScriptEditorCompletionContext(textarea.value, selectionStart);
        if (!completionContext) {
            hideScriptEditorCompletions();
            return;
        }

        scriptEditorCompletionState.active = true;
        scriptEditorCompletionState.replacementStart = completionContext.replacementStart;
        scriptEditorCompletionState.replacementEnd = completionContext.replacementEnd;
        scriptEditorCompletionState.prefix = completionContext.typedPrefix;
        scriptEditorCompletionState.items = completionContext.items;
        scriptEditorCompletionState.selectedIndex = Math.max(
            0,
            Math.min(scriptEditorCompletionState.selectedIndex, completionContext.items.length - 1)
        );
        const caretPosition = getTextareaCaretClientPosition(textarea, selectionStart);
        renderScriptEditorCompletions(caretPosition);
    }

    function moveScriptEditorCompletionSelection(delta) {
        if (!scriptEditorCompletionState.active || !scriptEditorCompletionState.items.length) return false;
        const itemCount = scriptEditorCompletionState.items.length;
        const nextIndex = (scriptEditorCompletionState.selectedIndex + delta + itemCount) % itemCount;
        scriptEditorCompletionState.selectedIndex = nextIndex;
        const textarea = getScriptEditorTextareaElement();
        const caretPosition = textarea
            ? getTextareaCaretClientPosition(textarea, textarea.selectionStart)
            : null;
        renderScriptEditorCompletions(caretPosition);
        return true;
    }

    function acceptScriptEditorCompletion() {
        if (!scriptEditorCompletionState.active || !scriptEditorCompletionState.items.length) return false;
        const textarea = getScriptEditorTextareaElement();
        if (!textarea) return false;
        const selected = scriptEditorCompletionState.items[scriptEditorCompletionState.selectedIndex] || null;
        if (!selected) return false;
        const value = textarea.value;
        const start = scriptEditorCompletionState.replacementStart;
        const end = scriptEditorCompletionState.replacementEnd;
        textarea.value = value.slice(0, start) + selected.name + value.slice(end);
        const nextCaret = start + selected.name.length;
        textarea.selectionStart = textarea.selectionEnd = nextCaret;
        updateScriptEditorHighlights();
        hideScriptEditorCompletions();
        textarea.focus();
        return true;
    }

    function closeScriptEditorPanel() {
        scriptEditorTargetObject = null;
        hideScriptEditorCompletions();
        closeScriptEditorHelpPanel();
        $(`#${SCRIPT_EDITOR_PANEL_ID}`).hide();
    }

    function saveScriptEditorPanel() {
        if (!scriptEditorTargetObject) {
            closeScriptEditorPanel();
            return;
        }
        const text = $(`#${SCRIPT_EDITOR_TEXTAREA_ID}`).val();
        const rawName = String($(`#${SCRIPT_EDITOR_NAME_INPUT_ID}`).val() || "").trim();
        if (rawName.length > 0 && !isValidScriptingName(rawName)) {
            showScriptEditorMessage("Invalid scripting name. Use letters, numbers, _ or $, and start with a letter/_/$.");
            return;
        }
        if (rawName.length > 0) {
            const existingTarget = getNamedObjectByName(rawName, {
                map: (scriptEditorTargetObject && scriptEditorTargetObject.map) || null,
                wizard: global.wizard || null
            });
            const sameRecordId = Number.isInteger(Number(scriptEditorTargetObject && scriptEditorTargetObject._prototypeRecordId)) &&
                Number(existingTarget._prototypeRecordId) === Number(scriptEditorTargetObject._prototypeRecordId);
            if (existingTarget && existingTarget !== scriptEditorTargetObject && !sameRecordId) {
                showScriptEditorMessage(`Name '${rawName}' is already in use.`);
                return;
            }
        }
        const parsed = parseScriptEditorInput(text);
        if (!parsed.ok) {
            showScriptEditorMessage("Script is not valid. Use statements and/or event blocks.");
            return;
        }
        scriptEditorTargetObject.script = parsed.value;
        markPrototypeScriptTargetDirty(scriptEditorTargetObject);
        setObjectScriptingName(scriptEditorTargetObject, rawName, {
            map: (scriptEditorTargetObject && scriptEditorTargetObject.map) || null,
            wizard: global.wizard || null
        });
        const scriptSaveMapRef = scriptEditorTargetObject && scriptEditorTargetObject.map;
        if (scriptSaveMapRef && typeof scriptSaveMapRef.capturePendingPrototypeObjects === "function") {
            scriptSaveMapRef.capturePendingPrototypeObjects();
        }
        refreshDoorEnterExitConvention(scriptEditorTargetObject, (scriptEditorTargetObject && scriptEditorTargetObject.map) || null);
        runObjectInitScript(scriptEditorTargetObject, global.wizard || null, { reason: "scriptSaved" });
        showScriptEditorMessage("Object script saved.");
        closeScriptEditorPanel();
    }

    function ensureScriptEditorNameRow($panel) {
        if (!$panel || !$panel.length) return;
        if ($panel.find(`#${SCRIPT_EDITOR_NAME_INPUT_ID}`).length > 0) return;
        const $target = $panel.find(`#${SCRIPT_EDITOR_TARGET_LABEL_ID}`).first();
        const $editorContainer = $panel.find(`#${SCRIPT_EDITOR_TEXTAREA_ID}`).first().closest("div");
        if (!$target.length || !$editorContainer.length) return;

        const $nameRow = $("<label>")
            .attr("id", SCRIPT_EDITOR_NAME_LABEL_ID)
            .attr("for", SCRIPT_EDITOR_NAME_INPUT_ID)
            .css({
                display: "block",
                "font-size": "12px",
                color: "#ddd",
                "margin-bottom": "8px"
            })
            .text("scripting name:");
        const $nameInput = $("<input>")
            .attr("id", SCRIPT_EDITOR_NAME_INPUT_ID)
            .attr("type", "text")
            .attr("placeholder", "bear1")
            .attr("spellcheck", "false")
            .attr("autocorrect", "off")
            .attr("autocapitalize", "off")
            .attr("autocomplete", "off")
            .css({
                width: "100%",
                "box-sizing": "border-box",
                padding: "6px 8px",
                margin: "4px 0 0 0",
                border: "1px solid #666",
                "border-radius": "4px",
                background: "#0b0b0b",
                color: "#fff",
                "font-family": "monospace",
                "font-size": "13px"
            });
        $nameRow.append($nameInput);
        $editorContainer.css({ height: "calc(100% - 126px)" });
        $target.after($nameRow);
    }

    function getScriptEditorPanel() {
        let $panel = $(`#${SCRIPT_EDITOR_PANEL_ID}`);
        if ($panel.length) {
            ensureScriptEditorNameRow($panel);
            return $panel;
        }

        $panel = $("<div>")
            .attr("id", SCRIPT_EDITOR_PANEL_ID)
            .css({
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "min(820px, 85vw)",
                height: "min(540px, 72vh)",
                display: "none",
                "z-index": 200100,
                background: "rgba(15,15,15,0.96)",
                border: "1px solid #ffd700",
                "border-radius": "8px",
                padding: "12px",
                "box-sizing": "border-box",
                color: "#fff"
            })
            .on("mousedown click keydown keyup", event => {
                event.stopPropagation();
            });

        const $help = $("<button>")
            .attr("type", "button")
            .text("?")
            .css({
                width: "24px",
                height: "24px",
                padding: "0",
                color: "#111",
                background: "#ffd700",
                border: "1px solid #caa700",
                "border-radius": "50%",
                cursor: "pointer",
                "font-weight": "bold",
                "line-height": "1"
            })
            .on("click", () => openScriptEditorHelpPanel());
        const $header = $("<div>")
            .css({
                display: "flex",
                "align-items": "center",
                "justify-content": "flex-end",
                "margin-bottom": "6px"
            })
            .append($help);
        const $target = $("<div>")
            .attr("id", SCRIPT_EDITOR_TARGET_LABEL_ID)
            .text("No target selected")
            .css({ "font-size": "12px", color: "#ddd", "margin-bottom": "8px" });
        $target.hide();

        const scriptEditorFontCss = {
            "font-family": "monospace",
            "font-size": "13px",
            "line-height": "1.4",
            "letter-spacing": "normal",
            "word-spacing": "normal",
            "tab-size": "3",
            "-moz-tab-size": "3"
        };
        const $nameRow = $("<label>")
            .attr("id", SCRIPT_EDITOR_NAME_LABEL_ID)
            .attr("for", SCRIPT_EDITOR_NAME_INPUT_ID)
            .css({
                display: "block",
                "font-size": "12px",
                color: "#ddd",
                "margin-bottom": "8px"
            })
            .text("scripting name:");
        const $nameInput = $("<input>")
            .attr("id", SCRIPT_EDITOR_NAME_INPUT_ID)
            .attr("type", "text")
            .attr("placeholder", "bear1")
            .attr("spellcheck", "false")
            .attr("autocorrect", "off")
            .attr("autocapitalize", "off")
            .attr("autocomplete", "off")
            .css({
                width: "100%",
                "box-sizing": "border-box",
                padding: "6px 8px",
                margin: "4px 0 0 0",
                border: "1px solid #666",
                "border-radius": "4px",
                background: "#0b0b0b",
                color: "#fff",
                "font-family": "monospace",
                "font-size": "13px"
            });
        $nameRow.append($nameInput);

        const $editorContainer = $("<div>").css({ position: "relative", width: "100%", height: "calc(100% - 126px)" });
        const $backdrop = $("<div>")
            .attr("id", SCRIPT_EDITOR_BACKDROP_ID)
            .css(Object.assign({
                position: "absolute",
                top: 0, left: 0, right: 0, bottom: 0,
                overflow: "hidden",
                "pointer-events": "none",
                "border-radius": "6px",
                border: "1px solid transparent",
                padding: "10px",
                "box-sizing": "border-box",
                margin: 0,
                "white-space": "pre-wrap",
                "word-wrap": "break-word",
                "overflow-wrap": "break-word",
                color: "transparent",
                background: "#0b0b0b"
            }, scriptEditorFontCss));
        const $textarea = $("<textarea>")
            .attr("id", SCRIPT_EDITOR_TEXTAREA_ID)
            .attr("placeholder", SCRIPT_EDITOR_DEFAULT_TEMPLATE)
            .attr("spellcheck", "false")
            .attr("autocorrect", "off")
            .attr("autocapitalize", "off")
            .attr("autocomplete", "off")
            .css(Object.assign({
                position: "relative",
                width: "100%",
                height: "100%",
                "box-sizing": "border-box",
                resize: "none",
                border: "1px solid #666",
                "border-radius": "6px",
                background: "transparent",
                color: "#fff",
                "caret-color": "#fff",
                padding: "10px",
                "z-index": 1
            }, scriptEditorFontCss))
            .on("input", function () {
                updateScriptEditorHighlights();
                updateScriptEditorCompletions();
            })
            .on("click keyup focus", function () {
                updateScriptEditorCompletions();
            })
            .on("blur", function () {
                setTimeout(() => {
                    const activeEl = document.activeElement;
                    if (activeEl && activeEl.id === SCRIPT_EDITOR_TEXTAREA_ID) return;
                    hideScriptEditorCompletions();
                }, 0);
            })
            .on("scroll", function () {
                const bd = document.getElementById(SCRIPT_EDITOR_BACKDROP_ID);
                if (bd) {
                    bd.scrollTop = this.scrollTop;
                    bd.scrollLeft = this.scrollLeft;
                }
                updateScriptEditorCompletions({ force: true });
            })
            .on("keydown", function (evt) {
                const ta = this;
                let val = ta.value;
                let selStart = ta.selectionStart;
                let selEnd = ta.selectionEnd;
                if (scriptEditorCompletionState.active) {
                    if (evt.key === "ArrowDown") {
                        evt.preventDefault();
                        moveScriptEditorCompletionSelection(1);
                        return;
                    }
                    if (evt.key === "ArrowUp") {
                        evt.preventDefault();
                        moveScriptEditorCompletionSelection(-1);
                        return;
                    }
                    if (evt.key === "Tab" && !evt.shiftKey) {
                        evt.preventDefault();
                        acceptScriptEditorCompletion();
                        return;
                    }
                    if (evt.key === "Escape") {
                        evt.preventDefault();
                        hideScriptEditorCompletions();
                        return;
                    }
                }
                const closingBrackets = { "{": "}", "(": ")", "[": "]", "\"": "\"" };
                if (closingBrackets[evt.key] && selStart === selEnd) {
                    evt.preventDefault();
                    const close = closingBrackets[evt.key];
                    ta.value = val.slice(0, selStart) + evt.key + close + val.slice(selEnd);
                    ta.selectionStart = ta.selectionEnd = selStart + 1;
                    updateScriptEditorHighlights();
                    updateScriptEditorCompletions();
                    return;
                }
                if ((evt.key === "}" || evt.key === ")" || evt.key === "]" || evt.key === "\"") && selStart === selEnd && val[selStart] === evt.key) {
                    evt.preventDefault();
                    ta.selectionStart = ta.selectionEnd = selStart + 1;
                    return;
                }
                if (evt.key === "Backspace" && selStart === selEnd && selStart > 0) {
                    const charBefore = val[selStart - 1];
                    const charAfter = val[selStart];
                    if (closingBrackets[charBefore] && closingBrackets[charBefore] === charAfter) {
                        evt.preventDefault();
                        ta.value = val.slice(0, selStart - 1) + val.slice(selStart + 1);
                        ta.selectionStart = ta.selectionEnd = selStart - 1;
                        updateScriptEditorHighlights();
                        updateScriptEditorCompletions();
                        return;
                    }
                }
                if (evt.key === "Tab") {
                    evt.preventDefault();
                    const indent = SCRIPT_EDITOR_INDENT;
                    const getUnindentCount = line => {
                        if (!line) return 0;
                        if (line.startsWith("\t")) return 1;
                        const spaceMatch = line.match(/^ +/);
                        const spaceCount = spaceMatch ? spaceMatch[0].length : 0;
                        return Math.min(indent.length, spaceCount);
                    };
                    if (selStart !== selEnd) {
                        const firstLineStart = val.lastIndexOf("\n", selStart - 1) + 1;
                        let effectiveSelEnd = selEnd;
                        if (effectiveSelEnd > selStart && val[effectiveSelEnd - 1] === "\n") {
                            effectiveSelEnd -= 1;
                        }
                        const lastLineBreak = val.indexOf("\n", effectiveSelEnd);
                        const blockEnd = lastLineBreak === -1 ? val.length : lastLineBreak;
                        const selectedBlock = val.slice(firstLineStart, blockEnd);
                        const selectedLines = selectedBlock.split("\n");
                        if (evt.shiftKey) {
                            let removedBeforeStart = 0;
                            let removedTotal = 0;
                            const unindentedBlock = selectedLines.map((line, index) => {
                                const removeCount = getUnindentCount(line);
                                if (index === 0) {
                                    removedBeforeStart = removeCount;
                                }
                                removedTotal += removeCount;
                                return line.slice(removeCount);
                            }).join("\n");
                            ta.value = val.slice(0, firstLineStart) + unindentedBlock + val.slice(blockEnd);
                            ta.selectionStart = Math.max(firstLineStart, selStart - removedBeforeStart);
                            ta.selectionEnd = Math.max(ta.selectionStart, selEnd - removedTotal);
                        } else {
                            const indentedBlock = selectedLines
                                .map(line => indent + line)
                                .join("\n");
                            ta.value = val.slice(0, firstLineStart) + indentedBlock + val.slice(blockEnd);
                            ta.selectionStart = selStart + indent.length;
                            ta.selectionEnd = selEnd + indent.length * selectedLines.length;
                        }
                    } else {
                        if (evt.shiftKey) {
                            const lineStart = val.lastIndexOf("\n", selStart - 1) + 1;
                            const linePrefix = val.slice(lineStart, selStart);
                            const removeCount = getUnindentCount(linePrefix);
                            ta.value = val.slice(0, lineStart) + linePrefix.slice(removeCount) + val.slice(selStart);
                            ta.selectionStart = ta.selectionEnd = Math.max(lineStart, selStart - removeCount);
                        } else {
                            ta.value = val.slice(0, selStart) + indent + val.slice(selStart);
                            ta.selectionStart = ta.selectionEnd = selStart + indent.length;
                        }
                    }
                    updateScriptEditorHighlights();
                    updateScriptEditorCompletions();
                    return;
                }
                if (evt.key !== "Enter") return;

                const lineStart = val.lastIndexOf("\n", selStart - 1) + 1;
                let lineText = val.slice(lineStart, selStart);
                const indentMatch = lineText.match(/^(\s*)/);
                const currentIndent = indentMatch ? indentMatch[1] : "";
                let newIndent = currentIndent;
                if (lineEndsWithScriptBlockStarter(lineText)) {
                    newIndent = currentIndent + SCRIPT_EDITOR_INDENT;
                }
                const afterTrimmed = val.slice(selEnd).replace(/^[ \t]*/, "");
                const needClosingLine = lineText.trimEnd().endsWith("{") && afterTrimmed.startsWith("}");

                evt.preventDefault();
                let insertion = "\n" + newIndent;
                if (needClosingLine) {
                    insertion = "\n" + newIndent + "\n" + currentIndent;
                    ta.value = val.slice(0, selStart) + insertion + val.slice(selEnd);
                    ta.selectionStart = ta.selectionEnd = selStart + 1 + newIndent.length;
                } else {
                    ta.value = val.slice(0, selStart) + insertion + val.slice(selEnd);
                    ta.selectionStart = ta.selectionEnd = selStart + insertion.length;
                }

                updateScriptEditorHighlights();
                updateScriptEditorCompletions();
                const bd = document.getElementById(SCRIPT_EDITOR_BACKDROP_ID);
                if (bd) {
                    bd.scrollTop = ta.scrollTop;
                    bd.scrollLeft = ta.scrollLeft;
                }
            });

        $editorContainer.append($backdrop, $textarea);
        const $actions = $("<div>")
            .css({
                display: "flex",
                "justify-content": "flex-end",
                gap: "8px",
                "margin-top": "10px"
            });
        const $cancel = $("<button>")
            .text("Cancel")
            .css({
                padding: "6px 12px",
                color: "#fff",
                background: "#444",
                border: "1px solid #777",
                "border-radius": "4px",
                cursor: "pointer"
            })
            .on("click", () => closeScriptEditorPanel());
        const $save = $("<button>")
            .text("Save")
            .css({
                padding: "6px 12px",
                color: "#111",
                background: "#ffd700",
                border: "1px solid #caa700",
                "border-radius": "4px",
                cursor: "pointer",
                "font-weight": "bold"
            })
            .on("click", () => saveScriptEditorPanel());
        $actions.append($cancel, $save);
        $panel.append($header, $target, $nameRow, $editorContainer, $actions);
        $(document.body).append($panel);
        return $panel;
    }

    function openScriptEditorForTarget(target) {
        if (!target || target.gone) return false;
        const $panel = getScriptEditorPanel();
        ensureObjectScriptingName(target, {
            map: (target && target.map) || null,
            wizard: global.wizard || null,
            target
        });
        if (typeof global.releaseSpacebarCastingState === "function") {
            global.releaseSpacebarCastingState();
        } else if (global.keysPressed && typeof global.keysPressed === "object") {
            global.keysPressed[" "] = false;
        }
        const textareaEl = $(`#${SCRIPT_EDITOR_TEXTAREA_ID}`).get(0);
        if (typeof global.armSpacebarTypingGuardForElement === "function") {
            global.armSpacebarTypingGuardForElement(textareaEl);
        }
        scriptEditorTargetObject = target;
        $(`#${SCRIPT_EDITOR_NAME_INPUT_ID}`).val(getObjectScriptingName(target));
        $(`#${SCRIPT_EDITOR_TEXTAREA_ID}`).val(formatObjectScriptForEditor(target));
        updateScriptEditorHighlights();
        hideScriptEditorCompletions();
        $panel.show();
        setTimeout(() => {
            $(`#${SCRIPT_EDITOR_TEXTAREA_ID}`).trigger("focus");
        }, 0);
        return true;
    }

    function performCrumble(target, args, namedArgs) {
        if (!target || target.gone || target.vanishing) return false;

        const startPt = target.startPoint || null;
        const endPt   = target.endPoint   || null;
        if (!startPt || !endPt) return false;

        const sx = Number(startPt.x), sy = Number(startPt.y);
        const ex = Number(endPt.x),   ey = Number(endPt.y);
        if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
            !Number.isFinite(ex) || !Number.isFinite(ey)) return false;

        const dirXRaw = Object.prototype.hasOwnProperty.call(namedArgs, "x") ? namedArgs.x : args[0];
        const dirYRaw = Object.prototype.hasOwnProperty.call(namedArgs, "y") ? namedArgs.y : args[1];
        const dirX = Number(dirXRaw);
        const dirY = Number(dirYRaw);
        if (!Number.isFinite(dirX) || !Number.isFinite(dirY)) return false;

        const wallLength = Number.isFinite(target.length) && target.length > 0
            ? target.length : Math.max(0.01, Math.hypot(ex - sx, ey - sy));
        const wallHeight = Number.isFinite(target.height) && target.height > 0
            ? target.height : 1;
        const bottomZ = Number.isFinite(target.bottomZ) ? target.bottomZ : 0;

        const rawTint = Number.isFinite(target.tint) ? target.tint : 0xFFFFFF;
        let baseR, baseG, baseB;
        if (rawTint !== 0xFFFFFF) {
            baseR = (rawTint >> 16) & 0xFF;
            baseG = (rawTint >>  8) & 0xFF;
            baseB =  rawTint        & 0xFF;
        } else {
            baseR = 0x88; baseG = 0x86; baseB = 0x82;
        }

        /* global app, gameContainer, viewport, viewscale, xyratio, PIXI */
        const appRef = (typeof app !== "undefined") ? app : null;
        const renderingLayers = (global && global.Rendering && typeof global.Rendering.getLayers === "function")
            ? global.Rendering.getLayers()
            : null;
        const groundLayer = (renderingLayers && renderingLayers.ground) ? renderingLayers.ground : null;
        const containerParent = groundLayer ||
            ((typeof gameContainer !== "undefined" && gameContainer)
                ? gameContainer
                : (appRef ? appRef.stage : null));
        const vpRef = (typeof viewport  !== "undefined") ? viewport  : null;
        const getViewScale = () => ((typeof viewscale !== "undefined" && Number.isFinite(+viewscale)) ? +viewscale : 20);
        const getXyRatio = () => ((typeof xyratio !== "undefined" && Number.isFinite(+xyratio)) ? +xyratio : 0.66);
        const projectFragmentToScreen = (worldX, worldY, worldZ = 0) => {
            const scale = getViewScale();
            const ratio = getXyRatio();
            const cameraX = Number.isFinite(vpRef && vpRef.x) ? Number(vpRef.x) : 0;
            const cameraY = Number.isFinite(vpRef && vpRef.y) ? Number(vpRef.y) : 0;
            const dx = (global.map && typeof global.map.shortestDeltaX === "function")
                ? global.map.shortestDeltaX(cameraX, worldX)
                : (Number(worldX) - cameraX);
            const dy = (global.map && typeof global.map.shortestDeltaY === "function")
                ? global.map.shortestDeltaY(cameraY, worldY)
                : (Number(worldY) - cameraY);
            return {
                x: dx * scale,
                y: (dy - Number(worldZ || 0)) * scale * ratio
            };
        };
        const xyr = getXyRatio();
        if (!appRef || !containerParent || !vpRef || typeof PIXI === "undefined") return false;

        if (typeof target.removeFromGame === "function") {
            target.removeFromGame();
        } else if (typeof target.remove === "function") {
            target.remove();
        } else {
            target.gone = true;
        }

        const cols = Math.max(1, Math.ceil(wallLength * 2));
        const rows = Math.max(1, Math.ceil(wallHeight * 3));
        const cellLen = wallLength / cols;
        const cellHz  = wallHeight / rows;

        const wallDirX = (ex - sx) / wallLength;
        const wallDirY = (ey - sy) / wallLength;
        const wallAngle = Math.atan2(wallDirY * xyr, wallDirX);

        const cellWPx = cellLen * getViewScale();
        const cellHPx = cellHz  * getViewScale() * xyr;

        // Physics constants in world-space.
        // x/y from the script are total world-unit displacement over the lifetime.
        const LIFETIME = 90; // frames (~1.5 s at 60 fps) — extra time for bouncing
        const FADE_START = 60; // frame at which fade-out begins
        // Gravity in world-z: sized so a piece starting at the top of the wall
        // (z = bottomZ + wallHeight) reaches z=0 in roughly half the pre-fade window.
        const topZ = bottomZ + wallHeight;
        const fallFrames = FADE_START * 0.5;
        const GRAVITY_Z = (topZ > 0) ? (2 * topZ / (fallFrames * fallFrames)) : 0.003;
        // Per-frame x/y velocity: spread over LIFETIME so total ≈ (dirX, dirY) world units.
        const baseVX = dirX / LIFETIME;
        const baseVY = dirY / LIFETIME;
        // Jitter: up to ±40% of the directed magnitude so pieces fan out.
        const dirMag  = Math.hypot(dirX, dirY);
        const jitter  = Math.max(0.1, dirMag * 0.4) / LIFETIME;

        const container = new PIXI.Container();
        if (groundLayer) {
            container.zIndex = Number.MAX_SAFE_INTEGER;
        }
        containerParent.addChild(container);

        const fragments = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const t  = (c + 0.5) / cols;
                const hz = (r + 0.5) / rows;
                // World-space start position
                const wx0 = sx + (ex - sx) * t;
                const wy0 = sy + (ey - sy) * t;
                const wz0 = bottomZ + hz * wallHeight;

                const noise = (Math.random() - 0.5) * 28;
                const fr = Math.max(0, Math.min(255, Math.round(baseR + noise)));
                const fg = Math.max(0, Math.min(255, Math.round(baseG + noise * 0.9)));
                const fb = Math.max(0, Math.min(255, Math.round(baseB + noise * 0.8)));
                const fragColor = (fr << 16) | (fg << 8) | fb;

                const gfx = new PIXI.Graphics();
                gfx.beginFill(fragColor);
                gfx.drawRect(-cellWPx * 0.5, -cellHPx * 0.5, cellWPx, cellHPx);
                gfx.endFill();
                gfx.rotation = wallAngle;
                // Initial screen position (vpRef is a live reference so this will
                // be recalculated from world coords every tick)
                const initialScreen = projectFragmentToScreen(wx0, wy0, wz0);
                gfx.x = initialScreen.x;
                gfx.y = initialScreen.y;
                container.addChild(gfx);

                const jx = (Math.random() - 0.5) * 2 * jitter;
                const jy = (Math.random() - 0.5) * 2 * jitter;
                fragments.push({
                    gfx,
                    wx: wx0, wy: wy0, wz: wz0,   // world position (mutated each tick)
                    vwx: baseVX + jx,              // world x velocity (per frame)
                    vwy: baseVY + jy,              // world y velocity (per frame)
                    vwz: 0,                        // world z velocity (gravity pulls down)
                    bounces: 0,
                    age: 0
                });
            }
        }

        let done = false;
        const tickFn = (delta) => {
            if (done) return;
            let anyAlive = false;
            for (let i = 0; i < fragments.length; i++) {
                const frag = fragments[i];
                if (frag.age >= LIFETIME) continue;
                anyAlive = true;

                // Apply z gravity
                frag.vwz -= GRAVITY_Z * delta;
                frag.wx  += frag.vwx * delta;
                frag.wy  += frag.vwy * delta;
                frag.wz  += frag.vwz * delta;

                // Bounce off ground (z=0)
                if (frag.wz <= 0 && frag.bounces < 3) {
                    frag.wz  = 0;
                    frag.vwz = Math.abs(frag.vwz) * 0.35; // restitution
                    frag.vwx *= 0.6; // ground friction
                    frag.vwy *= 0.6;
                    frag.bounces++;
                } else if (frag.wz <= 0) {
                    // Fully settled — lock to ground, let it slide to a stop
                    frag.wz  = 0;
                    frag.vwz = 0;
                    frag.vwx *= 0.85;
                    frag.vwy *= 0.85;
                }

                // Re-project from live world coords + live viewport every frame
                const screenPos = projectFragmentToScreen(frag.wx, frag.wy, frag.wz);
                frag.gfx.x = screenPos.x;
                frag.gfx.y = screenPos.y;

                // Fade out after FADE_START
                if (frag.age >= FADE_START) {
                    frag.gfx.alpha = Math.max(0, 1 - (frag.age - FADE_START) / (LIFETIME - FADE_START));
                }
                frag.age += delta;
            }
            if (!anyAlive) {
                done = true;
                appRef.ticker.remove(tickFn);
                if (container.parent) container.parent.removeChild(container);
                container.destroy({ children: true });
            }
        };
        appRef.ticker.add(tickFn);
        return true;
    }

    function getTargetSinkBaseProperty(target) {
        if (!target || typeof target !== "object") return "z";
        if (target.type === "wallSection" || Number.isFinite(target.bottomZ)) return "bottomZ";
        return "z";
    }

    function getTargetSinkDistance(target) {
        if (!target || typeof target !== "object") return 1;
        if (Number.isFinite(target.height) && Number(target.height) > 0) {
            return Math.max(0.01, Number(target.height));
        }
        if (Number.isFinite(target.peakHeight) && Number(target.peakHeight) > 0) {
            return Math.max(0.01, Number(target.peakHeight));
        }
        if (Number.isFinite(target.midHeight) && Number(target.midHeight) > 0) {
            return Math.max(0.01, Number(target.midHeight));
        }
        return 1;
    }

    function getTargetSinkHeightProperty(target) {
        if (!target || typeof target !== "object") return "";
        if (Number.isFinite(target.height)) return "height";
        return "";
    }

    function syncTargetSinkBaseValue(target, baseProperty, value) {
        if (!target || typeof target !== "object" || typeof baseProperty !== "string") return;
        const nextValue = Number.isFinite(value) ? Number(value) : 0;
        target[baseProperty] = nextValue;
        if (baseProperty === "z") {
            if (Number.isFinite(target.prevZ) || Object.prototype.hasOwnProperty.call(target, "prevZ")) {
                target.prevZ = nextValue;
            }
            if (Number.isFinite(target.heightFromGround) || target.type === "roof") {
                target.heightFromGround = nextValue;
            }
        }
    }

    function refreshTargetSinkBlocking(target) {
        const sinkState = (target && target._scriptSinkState && typeof target._scriptSinkState === "object")
            ? target._scriptSinkState
            : null;
        if (target && sinkState) {
            if (!Object.prototype.hasOwnProperty.call(sinkState, "originalCastsLosShadows")) {
                sinkState.originalCastsLosShadows = (typeof target.castsLosShadows === "boolean")
                    ? target.castsLosShadows
                    : null;
            }
            if (sinkState.losTransparent) {
                target.castsLosShadows = false;
            } else if (sinkState.originalCastsLosShadows === null) {
                delete target.castsLosShadows;
            } else {
                target.castsLosShadows = !!sinkState.originalCastsLosShadows;
            }
        } else if (target && target.type === "wallSection") {
            delete target.castsLosShadows;
        }
        const affectedNodes = new Set();
        if (target && target.node && typeof target.node === "object") {
            affectedNodes.add(target.node);
        }
        if (target && Array.isArray(target.nodes)) {
            for (let i = 0; i < target.nodes.length; i++) {
                const node = target.nodes[i];
                if (node && typeof node === "object") affectedNodes.add(node);
            }
        }
        if (target && Array.isArray(target.blockedLinks)) {
            for (let i = 0; i < target.blockedLinks.length; i++) {
                const link = target.blockedLinks[i];
                const node = link && link.node;
                if (node && typeof node === "object") affectedNodes.add(node);
            }
        }
        affectedNodes.forEach(node => {
            if (typeof node.recountBlockingObjects === "function") {
                node.recountBlockingObjects();
            }
            if (global.map &&
                !global.map._suppressClearanceUpdates &&
                typeof global.map.updateClearanceAround === "function") {
                global.map.updateClearanceAround(node);
            }
        });
        if (typeof global.invalidateMinimap === "function") {
            global.invalidateMinimap();
        }
    }
    global.refreshTargetSinkBlocking = refreshTargetSinkBlocking;

    function restoreTargetSinkBlockingState(target, sinkState = null) {
        if (!target || typeof target !== "object") return;
        const state = (sinkState && typeof sinkState === "object")
            ? sinkState
            : ((target._scriptSinkState && typeof target._scriptSinkState === "object")
                ? target._scriptSinkState
                : null);
        if (!state) return;
        if (!Object.prototype.hasOwnProperty.call(state, "originalCastsLosShadows")) return;
        if (state.originalCastsLosShadows === null) {
            delete target.castsLosShadows;
            return;
        }
        target.castsLosShadows = !!state.originalCastsLosShadows;
    }
    global.restoreTargetSinkBlockingState = restoreTargetSinkBlockingState;

    function syncTargetSinkInteractionState(target) {
        if (!target || !target._scriptSinkState || typeof target._scriptSinkState !== "object") return null;
        const sinkState = target._scriptSinkState;
        const baseProperty = (typeof sinkState.baseProperty === "string" && sinkState.baseProperty.length > 0)
            ? sinkState.baseProperty
            : getTargetSinkBaseProperty(target);
        const heightProperty = (typeof sinkState.heightProperty === "string" && sinkState.heightProperty.length > 0)
            ? sinkState.heightProperty
            : getTargetSinkHeightProperty(target);
        const losTransparencyHeightThreshold = (target.type === "wallSection") ? 0.75 : 1e-4;
        const currentBase = Number.isFinite(target[baseProperty])
            ? Number(target[baseProperty])
            : (Number.isFinite(sinkState.currentBase) ? Number(sinkState.currentBase) : 0);
        const currentHeight = (heightProperty && Number.isFinite(target[heightProperty]))
            ? Math.max(0, Number(target[heightProperty]))
            : NaN;
        if (Number.isFinite(currentHeight)) {
            const topZ = currentBase + currentHeight;
            sinkState.losTransparent = topZ <= losTransparencyHeightThreshold;
        } else {
            const progress = Number.isFinite(sinkState.progress)
                ? Math.max(0, Math.min(1, Number(sinkState.progress)))
                : 0;
            sinkState.losTransparent = progress >= (1 - 1e-4);
        }
        sinkState.nonBlocking = sinkState.losTransparent;
        return sinkState;
    }
    global.syncTargetSinkInteractionState = syncTargetSinkInteractionState;

    function startTargetSinkTransition(target, seconds, options = {}) {
        if (!target || typeof target !== "object") return false;
        const durationSeconds = Number(seconds);
        if (!Number.isFinite(durationSeconds)) return false;
        const nowMs = Date.now();
        const existingState = (target._scriptSinkState && typeof target._scriptSinkState === "object")
            ? target._scriptSinkState
            : null;
        const originalCastsLosShadows = (existingState && Object.prototype.hasOwnProperty.call(existingState, "originalCastsLosShadows"))
            ? existingState.originalCastsLosShadows
            : ((typeof target.castsLosShadows === "boolean") ? target.castsLosShadows : null);
        const baseProperty = (existingState && typeof existingState.baseProperty === "string" && existingState.baseProperty.length > 0)
            ? existingState.baseProperty
            : getTargetSinkBaseProperty(target);
        const heightProperty = (existingState && typeof existingState.heightProperty === "string")
            ? existingState.heightProperty
            : getTargetSinkHeightProperty(target);
        const currentBase = Number.isFinite(target[baseProperty]) ? Number(target[baseProperty]) : 0;
        const currentHeight = heightProperty && Number.isFinite(target[heightProperty])
            ? Math.max(0, Number(target[heightProperty]))
            : NaN;
        const sinkDistance = getTargetSinkDistance(target);
        const durationMs = Math.max(0, durationSeconds * 1000);
        const sinking = options.direction !== "rise";
        const restBase = (existingState && Number.isFinite(existingState.restBase))
            ? Number(existingState.restBase)
            : currentBase;
        const restHeight = (existingState && Number.isFinite(existingState.restHeight))
            ? Math.max(0, Number(existingState.restHeight))
            : currentHeight;
        const targetBase = sinking ? (currentBase - sinkDistance) : restBase;
        const targetHeight = heightProperty && Number.isFinite(restHeight)
            ? (sinking ? 0 : restHeight)
            : NaN;
        const currentProgress = (existingState && Number.isFinite(existingState.progress))
            ? Math.max(0, Math.min(1, Number(existingState.progress)))
            : (
                Number.isFinite(restHeight) && restHeight > 0 && Number.isFinite(currentHeight)
                    ? Math.max(0, Math.min(1, 1 - (currentHeight / restHeight)))
                    : (Math.abs(currentBase - restBase) > 1e-6 ? 1 : 0)
            );
        const targetProgress = sinking ? 1 : 0;
        target._scriptSinkState = {
            active: durationMs > 0,
            startMs: nowMs,
            lastUpdateMs: nowMs,
            elapsedMs: 0,
            durationMs,
            direction: sinking ? "sink" : "rise",
            nonBlocking: sinking && currentProgress >= (1 - 1e-4),
            baseProperty,
            heightProperty,
            startBase: currentBase,
            targetBase,
            restBase,
            startHeight: Number.isFinite(currentHeight) ? currentHeight : NaN,
            targetHeight,
            restHeight: Number.isFinite(restHeight) ? restHeight : NaN,
            progress: currentProgress,
            startProgress: currentProgress,
            targetProgress,
            originalCastsLosShadows
        };
        if (durationMs <= 0) {
            syncTargetSinkBaseValue(target, baseProperty, targetBase);
            if (heightProperty && Number.isFinite(targetHeight)) {
                target[heightProperty] = targetHeight;
            }
            target._scriptSinkState.progress = targetProgress;
            target._scriptSinkState.active = false;
            if (!sinking) {
                syncTargetSinkInteractionState(target);
                refreshTargetSinkBlocking(target);
                restoreTargetSinkBlockingState(target);
                target._scriptSinkState = null;
                return true;
            }
        }
        syncTargetSinkInteractionState(target);
        refreshTargetSinkBlocking(target);
        return true;
    }

    function startTargetSink(target, seconds) {
        return startTargetSinkTransition(target, seconds, { direction: "sink" });
    }

    function startTargetRise(target, seconds) {
        if (!target || typeof target !== "object") return false;
        const existingState = (target._scriptSinkState && typeof target._scriptSinkState === "object")
            ? target._scriptSinkState
            : null;
        if (!existingState) return false;
        return startTargetSinkTransition(target, seconds, { direction: "rise" });
    }

    function registerBuiltinScriptHandlers() {
        const assignmentImplementations = {
            mazeMode(value) {
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
            },
            "time.speed"(value) {
                const raw = Number(value);
                if (!Number.isFinite(raw)) return false;
                const clamped = Math.max(0, Math.min(6, raw));
                if (typeof global.setSimulationTimeScale === "function") {
                    return !!global.setSimulationTimeScale(clamped);
                }
                global.simulationTimeScale = clamped;
                return true;
            },
            difficulty(value, context) {
                const target = context && context.target;
                const parsedDifficulty = Number(value);
                if (!target || !Number.isFinite(parsedDifficulty)) return false;
                const nextDifficulty = Math.max(1, Math.min(3, Math.round(parsedDifficulty)));
                if (typeof target.setDifficulty === "function") {
                    target.setDifficulty(nextDifficulty);
                } else {
                    target.difficulty = nextDifficulty;
                    if (Number.isFinite(target.magicRegenPerSecond)) {
                        target.magicRegenPerSecond = Math.max(0, 8 - nextDifficulty);
                    }
                }
                return true;
            },
            speed(value, context) {
                const target = context && context.target;
                const nextSpeed = Number(value);
                if (!target || !Number.isFinite(nextSpeed) || nextSpeed <= 0) return false;
                target.speed = nextSpeed;
                return true;
            },
            magicRegenPerSecond(value, context) {
                const target = context && context.target;
                const nextRate = Number(value);
                if (!target || !Number.isFinite(nextRate) || nextRate < 0) return false;
                target.magicRegenPerSecond = nextRate;
                return true;
            },
            magicRechargeRate(value, context) {
                return assignmentImplementations.magicRegenPerSecond(value, context);
            },
            tint(value, context) {
                const target = context && context.target;
                if (!target) return false;
                let tint = null;
                if (Number.isFinite(value)) {
                    tint = Number(value);
                } else if (typeof value === "string") {
                    const text = value.trim().toLowerCase();
                    if (/^#?[0-9a-f]{6}$/.test(text)) {
                        tint = parseInt(text.replace(/^#/, ""), 16);
                    } else if (/^0x[0-9a-f]{6}$/.test(text)) {
                        tint = parseInt(text, 16);
                    }
                }
                if (!Number.isFinite(tint)) return false;
                const normalizedTint = Math.max(0, Math.min(0xFFFFFF, Math.floor(tint)));
                target.tint = normalizedTint;
                if (target.pixiSprite) {
                    target.pixiSprite.tint = normalizedTint;
                }
                return true;
            },
            size(value, context) {
                const target = context && context.target;
                const nextSize = Number(value);
                if (!target || !Number.isFinite(nextSize) || nextSize <= 0) return false;
                if (typeof target.applySize === "function") {
                    target.applySize(nextSize);
                    return true;
                }
                const prevSize = Number(target.size);
                if (Number.isFinite(prevSize) && prevSize > 0) {
                    const ratio = nextSize / prevSize;
                    target.size = nextSize;
                    const maybeScaleProps = ["width", "height", "radius", "lungeRadius", "strikeRange", "damage", "groundRadius", "visualRadius"];
                    for (let i = 0; i < maybeScaleProps.length; i++) {
                        const prop = maybeScaleProps[i];
                        if (!Number.isFinite(target[prop])) continue;
                        target[prop] = Number(target[prop]) * ratio;
                    }
                } else {
                    target.size = nextSize;
                    if (Number.isFinite(target.width)) target.width = nextSize;
                    if (Number.isFinite(target.height)) target.height = nextSize;
                }
                if (typeof target.updateHitboxes === "function") {
                    target.updateHitboxes();
                }
                return true;
            },
            onfire(value, context) {
                const target = context && context.target;
                if (!target) return false;
                const enabled = !!value;
                if (enabled) {
                    if (typeof target.ignite === "function") target.ignite();
                    else target.isOnFire = true;
                    return true;
                }
                target.isOnFire = false;
                if (target.fireSprite) {
                    target.fireSprite.visible = false;
                }
                return true;
            },
            isOnFire(value, context) {
                return assignmentImplementations.onfire(value, context);
            },
            visible(value, context) {
                const target = context && context.target;
                if (!target) return false;
                const visible = !!value;
                target.visible = visible;
                if (target.pixiSprite) target.pixiSprite.visible = visible;
                if (target.pixiMesh) target.pixiMesh.visible = visible;
                if (target._renderingDepthMesh) target._renderingDepthMesh.visible = visible;
                if (target.fireSprite) target.fireSprite.visible = visible;
                return true;
            },
                forceVisible(value, context) {
                    const target = context && context.target;
                    if (!target) return false;
                    target.forceVisible = !!value;
                        target._forceVisible = target.forceVisible;
                    return true;
                },
            brightness(value, context) {
                const target = context && context.target;
                const brightness = Number(value);
                if (!target || !Number.isFinite(brightness)) return false;
                target.brightness = Math.max(-100, Math.min(100, brightness));
                applyTargetBrightness(target);
                return true;
            },
            chaseRadius(value, context) {
                const target = context && context.target;
                const radius = Number(value);
                if (!target || !Number.isFinite(radius)) return false;
                target.chaseRadius = radius;
                return true;
            },
            disengageRadius(value, context) {
                const target = context && context.target;
                const radius = Number(value);
                if (!target || !Number.isFinite(radius) || radius < 0) return false;
                target.disengageRadius = radius;
                return true;
            },
            retreatThreshold(value, context) {
                const target = context && context.target;
                const threshold = Number(value);
                if (!target || !Number.isFinite(threshold)) return false;
                target.retreatThreshold = Math.max(0, Math.min(1, threshold));
                return true;
            },
            retreatDuration(value, context) {
                const target = context && context.target;
                const seconds = Number(value);
                if (!target || !Number.isFinite(seconds) || seconds < 0) return false;
                target.retreatDuration = seconds;
                return true;
            },
            runSpeed(value, context) {
                const target = context && context.target;
                const nextRunSpeed = Number(value);
                if (!target || !Number.isFinite(nextRunSpeed) || nextRunSpeed <= 0) return false;
                const prevRunSpeed = Number(target.runSpeed);
                target.runSpeed = nextRunSpeed;
                if (Number.isFinite(target.speed) && Number.isFinite(prevRunSpeed) && Math.abs(target.speed - prevRunSpeed) < 1e-6) {
                    target.speed = nextRunSpeed;
                }
                return true;
            },
            maxHp(value, context) {
                const target = context && context.target;
                const nextMaxHp = Number(value);
                if (!target || !Number.isFinite(nextMaxHp) || nextMaxHp < 0) return false;
                const normalizedMaxHp = Math.max(0, nextMaxHp);
                target.maxHp = normalizedMaxHp;
                target.maxHP = normalizedMaxHp;
                if (Number.isFinite(target.hp)) {
                    target.hp = Math.max(0, Math.min(target.hp, normalizedMaxHp));
                } else {
                    target.hp = normalizedMaxHp;
                }
                return true;
            },
            maxHP(value, context) {
                return assignmentImplementations.maxHp(value, context);
            },
            maxMp(value, context) {
                const target = context && context.target;
                const nextMaxMp = Number(value);
                if (!target || !Number.isFinite(nextMaxMp) || nextMaxMp < 0) return false;
                const normalizedMaxMp = Math.max(0, nextMaxMp);
                target.maxMp = normalizedMaxMp;
                target.maxMP = normalizedMaxMp;
                if (Number.isFinite(target.mp)) {
                    target.mp = Math.max(0, Math.min(target.mp, normalizedMaxMp));
                } else {
                    target.mp = normalizedMaxMp;
                }
                return true;
            },
            maxMP(value, context) {
                return assignmentImplementations.maxMp(value, context);
            },
            height(value, context) {
                const target = context && context.target;
                const nextHeight = Number(value);
                if (!target || !Number.isFinite(nextHeight)) return false;
                if (target.type === "wallSection") {
                    target.height = Math.max(0, nextHeight);
                    return refreshWallSectionTarget(target, { refreshBlocking: false });
                }
                target.height = nextHeight;
                return true;
            },
            thickness(value, context) {
                const target = context && context.target;
                const nextThickness = Number(value);
                if (!target || !Number.isFinite(nextThickness)) return false;
                if (target.type === "wallSection") {
                    target.thickness = Math.max(0.001, nextThickness);
                    return refreshWallSectionTarget(target, { refreshBlocking: true });
                }
                target.thickness = nextThickness;
                return true;
            },
            hp(value, context) {
                const target = context && context.target;
                const nextHp = Number(value);
                if (!target || !Number.isFinite(nextHp)) return false;
                const finiteMaxHp = Number.isFinite(target.maxHp)
                    ? Number(target.maxHp)
                    : (Number.isFinite(target.maxHP) ? Number(target.maxHP) : null);
                if (Number.isFinite(finiteMaxHp)) {
                    const normalizedHp = Math.max(0, nextHp);
                    const normalizedMaxHp = Math.max(finiteMaxHp, normalizedHp);
                    target.hp = normalizedHp;
                    target.maxHp = normalizedMaxHp;
                    target.maxHP = normalizedMaxHp;
                } else {
                    target.hp = Math.max(0, nextHp);
                    target.maxHp = target.hp;
                    target.maxHP = target.hp;
                }
                return true;
            },
            mp(value, context) {
                const target = context && context.target;
                const nextMp = Number(value);
                if (!target || !Number.isFinite(nextMp)) return false;
                const finiteMaxMp = Number.isFinite(target.maxMp)
                    ? Number(target.maxMp)
                    : (Number.isFinite(target.maxMP) ? Number(target.maxMP) : null);
                if (Number.isFinite(finiteMaxMp)) {
                    const normalizedMp = Math.max(0, nextMp);
                    const normalizedMaxMp = Math.max(finiteMaxMp, normalizedMp);
                    target.mp = normalizedMp;
                    target.maxMp = normalizedMaxMp;
                    target.maxMP = normalizedMaxMp;
                } else {
                    target.mp = Math.max(0, nextMp);
                    target.maxMp = target.mp;
                    target.maxMP = target.mp;
                }
                return true;
            }
        };

        const commandImplementations = {
            transport(args, context) {
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
            },
            healPlayer(args, context) {
                const wizardRef = (context && context.wizard) || global.wizard || null;
                if (!wizardRef) return false;
                const hpDelta = Number(args[0]);
                if (!Number.isFinite(hpDelta)) return false;
                if (typeof wizardRef.heal === "function") {
                    wizardRef.heal(hpDelta);
                    return true;
                }
                const maxHp = Number.isFinite(wizardRef.maxHp) ? Number(wizardRef.maxHp)
                    : (Number.isFinite(wizardRef.maxHP) ? Number(wizardRef.maxHP) : null);
                const normalizedMaxHp = Number.isFinite(maxHp)
                    ? Math.max(0, maxHp)
                    : Math.max(0, Number.isFinite(wizardRef.hp) ? Number(wizardRef.hp) : 100);
                wizardRef.maxHp = normalizedMaxHp;
                wizardRef.maxHP = normalizedMaxHp;
                const currentHp = Number.isFinite(wizardRef.hp) ? Number(wizardRef.hp) : normalizedMaxHp;
                wizardRef.hp = Math.max(0, Math.min(normalizedMaxHp, currentHp + hpDelta));
                return true;
            },
            hurtPlayer(args, context) {
                const wizardRef = (context && context.wizard) || global.wizard || null;
                if (!wizardRef) return false;
                const damage = Number(args[0]);
                if (!Number.isFinite(damage)) return false;
                if (typeof wizardRef.takeDamage === "function") {
                    wizardRef.takeDamage(damage, { source: "script" });
                    return true;
                }
                const maxHp = Number.isFinite(wizardRef.maxHP) ? wizardRef.maxHP
                    : (Number.isFinite(wizardRef.maxHp) ? wizardRef.maxHp : 100);
                const currentHp = Number.isFinite(wizardRef.hp) ? wizardRef.hp : maxHp;
                wizardRef.hp = Math.max(0, Math.min(maxHp, currentHp - damage));
                return true;
            },
            "player.hurt"(args, context) {
                return commandImplementations.hurtPlayer(args, context);
            },
            gainMagic(args, context) {
                const wizardRef = (context && context.wizard) || global.wizard || null;
                if (!wizardRef) return false;
                const amount = Number(args[0]);
                if (!Number.isFinite(amount)) return false;
                const maxMagic = Number.isFinite(wizardRef.maxMagic) ? wizardRef.maxMagic : 100;
                const currentMagic = Number.isFinite(wizardRef.magic) ? wizardRef.magic : maxMagic;
                wizardRef.magic = Math.max(0, Math.min(maxMagic, currentMagic + amount));
                return true;
            },
            drainMagic(args, context) {
                const wizardRef = (context && context.wizard) || global.wizard || null;
                if (!wizardRef) return false;
                const amount = Number(args[0]);
                if (!Number.isFinite(amount)) return false;
                const maxMagic = Number.isFinite(wizardRef.maxMagic) ? wizardRef.maxMagic : 100;
                const currentMagic = Number.isFinite(wizardRef.magic) ? wizardRef.magic : maxMagic;
                wizardRef.magic = Math.max(0, Math.min(maxMagic, currentMagic - amount));
                return true;
            },
            addSpell(args, context) {
                const wizardRef = (context && context.wizard) || global.wizard || null;
                if (!wizardRef) return false;
                const spellName = normalizeScriptSpellName(args[0]);
                if (!spellName) return false;
                if (
                    typeof global.SpellSystem !== "undefined" &&
                    global.SpellSystem &&
                    typeof global.SpellSystem.grantMagicUnlock === "function"
                ) {
                    global.SpellSystem.grantMagicUnlock(wizardRef, spellName);
                } else {
                    const granted = Array.isArray(wizardRef.unlockedMagic) ? wizardRef.unlockedMagic : [];
                    if (!Array.isArray(wizardRef.unlockedMagic)) {
                        wizardRef.unlockedMagic = granted;
                    }
                    if (!granted.includes(spellName)) {
                        granted.push(spellName);
                    }
                }
                if (typeof global.SpellSystem !== "undefined" && global.SpellSystem) {
                    if (typeof global.SpellSystem.syncWizardUnlockState === "function") {
                        global.SpellSystem.syncWizardUnlockState(wizardRef);
                    }
                }
                return true;
            },
            addMagic(args, context) {
                return this.addSpell(args, context);
            },
            unlockMagic(args, context) {
                return commandImplementations.addSpell(args, context);
            },
            unlockSpell(args, context) {
                return commandImplementations.addSpell(args, context);
            },
            trade(args, context, namedArgs = {}) {
                const wizardRef = (context && context.wizard) || global.wizard || null;
                if (!wizardRef || !global.TradeSystem || typeof global.TradeSystem.openTrade !== "function") {
                    return false;
                }
                const configArg = (args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) ? args[0] : null;
                const config = {
                    ...(configArg || {}),
                    ...namedArgs
                };
                if (!Array.isArray(config.entries) && Array.isArray(args[1])) {
                    config.entries = args[1];
                }
                if (!config.currency && args[0] !== undefined && typeof args[0] !== "object") {
                    config.currency = args[0];
                }
                return global.TradeSystem.openTrade(config, wizardRef);
            },
            delete(_args, context) {
                const target = (context && context.target) || null;
                return removeTargetObject(target);
            },
            lock(_args, context) {
                return setDoorLockedState((context && context.target) || null, true);
            },
            unlock(_args, context) {
                return setDoorLockedState((context && context.target) || null, false);
            },
            open(_args, context) {
                const target = (context && context.target) || null;
                return isDoorPlacedObject(target)
                    ? openDoorForTraversal(target)
                    : setWindowOpenState(target, true);
            },
            close(_args, context) {
                const target = (context && context.target) || null;
                return isDoorPlacedObject(target)
                    ? setDoorLockedState(target, true)
                    : setWindowOpenState(target, false);
            },
            deactivate(_args, context) {
                const target = (context && context.target) || null;
                if (!target) return false;
                target._scriptDeactivated = true;
                return true;
            },
            activate(_args, context) {
                const target = (context && context.target) || null;
                if (!target) return false;
                target._scriptDeactivated = false;
                return true;
            },
            freeze(args, context, namedArgs = {}) {
                const target = (context && context.target) || null;
                if (!target || typeof target !== "object") return false;
                const rawSeconds = Object.prototype.hasOwnProperty.call(namedArgs, "seconds")
                    ? namedArgs.seconds
                    : args[0];
                if (!Object.prototype.hasOwnProperty.call(namedArgs, "seconds") && args.length === 0) {
                    if (typeof target.freeze === "function") {
                        target.freeze();
                    } else {
                        target._scriptFrozenUntilMs = Infinity;
                    }
                    return true;
                }
                const seconds = Number(rawSeconds);
                if (!Number.isFinite(seconds)) return false;
                if (typeof target.freeze === "function") {
                    target.freeze(seconds);
                    return true;
                }
                if (seconds <= 0) {
                    target._scriptFrozenUntilMs = 0;
                    return true;
                }
                const nowMs = Date.now();
                const existingUntilMs = Number(target._scriptFrozenUntilMs);
                const nextUntilMs = nowMs + (seconds * 1000);
                target._scriptFrozenUntilMs = existingUntilMs > 0
                    ? Math.max(existingUntilMs, nextUntilMs)
                    : nextUntilMs;
                return true;
            },
            tracePath(args, context, namedArgs = {}) {
                const target = (context && context.target) || null;
                if (!target || typeof target.tracePath !== "function") return false;
                const rawSeconds = Object.prototype.hasOwnProperty.call(namedArgs, "seconds")
                    ? namedArgs.seconds
                    : args[0];
                const seconds = Number(rawSeconds);
                if (!Number.isFinite(seconds)) return false;
                return !!target.tracePath(seconds);
            },
            sink(args, context, namedArgs = {}) {
                const target = (context && context.target) || null;
                if (!target || typeof target !== "object") return false;
                const rawSeconds = Object.prototype.hasOwnProperty.call(namedArgs, "seconds")
                    ? namedArgs.seconds
                    : args[0];
                return startTargetSink(target, rawSeconds);
            },
            rise(args, context, namedArgs = {}) {
                const target = (context && context.target) || null;
                if (!target || typeof target !== "object") return false;
                const rawSeconds = Object.prototype.hasOwnProperty.call(namedArgs, "seconds")
                    ? namedArgs.seconds
                    : args[0];
                return startTargetRise(target, rawSeconds);
            },
            fall(args, context, namedArgs = {}) {
                const target = (context && context.target) || null;
                if (!target || typeof target !== "object") return false;
                const relationRaw = Object.prototype.hasOwnProperty.call(namedArgs, "direction")
                    ? namedArgs.direction
                    : args[0];
                const targetNameRaw = Object.prototype.hasOwnProperty.call(namedArgs, "targetName")
                    ? namedArgs.targetName
                    : args[1];
                const relation = String(relationRaw || "").trim().toLowerCase();
                const targetName = String(targetNameRaw || "").trim();
                if (relation !== "towards" && relation !== "away") return false;
                if (!targetName.length) return false;
                const otherTarget = getNamedObjectByName(targetName, context);
                if (!otherTarget || otherTarget === target) return false;
                const mapRef = (context && context.map) || (target && target.map) || (otherTarget && otherTarget.map) || global.map || null;
                if (target.type === "tree") {
                    return setTreeFallDirectionFromTarget(target, relation, otherTarget, mapRef);
                }
                if (isDoorPlacedObject(target)) {
                    return triggerDoorFallFromTarget(target, relation, otherTarget, mapRef);
                }
                return false;
            },
            message(args, context, namedArgs = {}) {
                const target = (context && context.target) || null;
                if (!target) return false;
                const textValue = (Object.prototype.hasOwnProperty.call(namedArgs, "text")) ? namedArgs.text : args[0];
                const xOffset = Number(
                    (Object.prototype.hasOwnProperty.call(namedArgs, "x")) ? namedArgs.x : (args[1] !== undefined ? args[1] : 0)
                );
                const yOffset = Number(
                    (Object.prototype.hasOwnProperty.call(namedArgs, "y")) ? namedArgs.y : (args[2] !== undefined ? args[2] : 0)
                );
                const colorValue = (Object.prototype.hasOwnProperty.call(namedArgs, "color")) ? namedArgs.color : args[3];
                const fontSizeValue = (Object.prototype.hasOwnProperty.call(namedArgs, "fontsize")) ? namedArgs.fontsize : args[4];
                const text = String(textValue === undefined || textValue === null ? "" : textValue);
                if (!text.length) {
                    target._scriptMessages = [];
                    if (global._scriptMessageTargets instanceof Set) {
                        global._scriptMessageTargets.delete(target);
                    }
                    return true;
                }
                target._scriptMessages = [{
                    text,
                    x: Number.isFinite(xOffset) ? xOffset : 0,
                    y: Number.isFinite(yOffset) ? yOffset : 0,
                    color: (typeof colorValue === "string" && colorValue.trim().length > 0)
                        ? colorValue.trim()
                        : (Number.isFinite(colorValue) ? Number(colorValue) : undefined),
                    fontsize: Number.isFinite(Number(fontSizeValue)) ? Number(fontSizeValue) : undefined
                }];
                if (!(global._scriptMessageTargets instanceof Set)) {
                    global._scriptMessageTargets = new Set();
                }
                global._scriptMessageTargets.add(target);
                return true;
            },
            spawnCreature(args, context, namedArgs = {}) {
                const wizardRef = (context && context.wizard) || global.wizard || null;
                const target = (context && context.target) || null;
                const mapRef = (context && context.map) || (wizardRef && wizardRef.map) || (target && target.map) || global.map || null;
                if (!mapRef || typeof mapRef.worldToNode !== "function") return false;

                const typeValue = (Object.prototype.hasOwnProperty.call(namedArgs, "type")) ? namedArgs.type : args[0];
                const sizeValue = (Object.prototype.hasOwnProperty.call(namedArgs, "size")) ? namedArgs.size : args[1];
                const locationValue = (Object.prototype.hasOwnProperty.call(namedArgs, "location")) ? namedArgs.location : args[2];
                const layerValue = Object.prototype.hasOwnProperty.call(namedArgs, "traversalLayer")
                    ? namedArgs.traversalLayer
                    : (Object.prototype.hasOwnProperty.call(namedArgs, "level") ? namedArgs.level : undefined);
                const hasNamedLocation = Object.prototype.hasOwnProperty.call(namedArgs, "location");
                const hasNamedX = Object.prototype.hasOwnProperty.call(namedArgs, "x");
                const hasNamedY = Object.prototype.hasOwnProperty.call(namedArgs, "y");
                const positionalX = args[2];
                const positionalY = args[3];

                const typeName = String(typeValue || "squirrel").trim().toLowerCase();
                if (!typeName.length) return false;
                const relativeOffset = parseRelativeOffset(locationValue);
                if (hasNamedX || hasNamedY) {
                    const namedX = Number(namedArgs.x);
                    const namedY = Number(namedArgs.y);
                    if (Number.isFinite(namedX)) relativeOffset.x = namedX;
                    if (Number.isFinite(namedY)) relativeOffset.y = namedY;
                } else if (!hasNamedLocation && (locationValue === undefined || locationValue === null || (typeof locationValue !== "object" && typeof locationValue !== "string"))) {
                    const px = Number(positionalX);
                    const py = Number(positionalY);
                    if (Number.isFinite(px)) relativeOffset.x = px;
                    if (Number.isFinite(py)) relativeOffset.y = py;
                }
                const originX = Number.isFinite(target && target.x) ? Number(target.x) : (Number.isFinite(wizardRef && wizardRef.x) ? Number(wizardRef.x) : 0);
                const originY = Number.isFinite(target && target.y) ? Number(target.y) : (Number.isFinite(wizardRef && wizardRef.y) ? Number(wizardRef.y) : 0);
                let spawnX = originX + relativeOffset.x;
                let spawnY = originY + relativeOffset.y;
                if (typeof mapRef.wrapWorldX === "function") spawnX = mapRef.wrapWorldX(spawnX);
                if (typeof mapRef.wrapWorldY === "function") spawnY = mapRef.wrapWorldY(spawnY);

                const sourceLayer = Number.isFinite(target && target.traversalLayer)
                    ? Math.round(Number(target.traversalLayer))
                    : (Number.isFinite(target && target.currentLayer)
                        ? Math.round(Number(target.currentLayer))
                        : (Number.isFinite(wizardRef && wizardRef.traversalLayer)
                            ? Math.round(Number(wizardRef.traversalLayer))
                            : (Number.isFinite(wizardRef && wizardRef.currentLayer) ? Math.round(Number(wizardRef.currentLayer)) : 0)));
                const spawnLayer = Number.isFinite(Number(layerValue)) ? Math.round(Number(layerValue)) : sourceLayer;
                const baseNode = mapRef.worldToNode(spawnX, spawnY);
                let spawnNode = baseNode;
                if (baseNode && spawnLayer !== 0 && typeof mapRef.getFloorNodeAtLayer === "function") {
                    const sectionKey = typeof baseNode._prototypeSectionKey === "string"
                        ? baseNode._prototypeSectionKey
                        : ((typeof mapRef.getPrototypeSectionKeyForWorldPoint === "function")
                            ? mapRef.getPrototypeSectionKeyForWorldPoint(spawnX, spawnY)
                            : "");
                    spawnNode = mapRef.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, spawnLayer, {
                        sectionKey,
                        allowScan: true
                    });
                }
                if (!spawnNode) return false;

                const CreatureCtor = getCreatureCtor(typeName);
                let creature = null;
                if (typeof CreatureCtor === "function") {
                    creature = new CreatureCtor(spawnNode, mapRef);
                } else if (typeof Animal === "function") {
                    creature = new Animal(typeName, spawnNode, 0.8, mapRef);
                } else if (typeof global.Animal === "function") {
                    creature = new global.Animal(typeName, spawnNode, 0.8, mapRef);
                }
                if (!creature) return false;

                applyCreatureSizeScale(creature, Number.isFinite(Number(sizeValue)) ? Number(sizeValue) : 1);
                creature.x = spawnX;
                creature.y = spawnY;
                creature.node = spawnNode;
                if (typeof creature.syncTraversalLayerFromNode === "function") {
                    creature.syncTraversalLayerFromNode(spawnNode);
                } else {
                    creature.traversalLayer = spawnLayer;
                    creature.currentLayer = spawnLayer;
                    creature.currentLayerBaseZ = Number.isFinite(spawnNode.baseZ) ? Number(spawnNode.baseZ) : spawnLayer * 3;
                }
                creature.z = typeof creature.getNodeStandingZ === "function"
                    ? creature.getNodeStandingZ(spawnNode)
                    : (Number.isFinite(spawnNode.baseZ) ? Number(spawnNode.baseZ) : 0);
                if (typeof creature.updateHitboxes === "function") {
                    creature.updateHitboxes();
                }
                const animalList = Array.isArray(global.animals)
                    ? global.animals
                    : ((typeof animals !== "undefined" && Array.isArray(animals)) ? animals : null);
                if (Array.isArray(animalList) && !animalList.includes(creature)) {
                    animalList.push(creature);
                }
                return true;
            },
            drop(args, context, namedArgs = {}) {
                const wizardRef = (context && context.wizard) || global.wizard || null;
                const target = (context && context.target) || null;
                const source = target || wizardRef;
                if (!source || typeof global.dropPowerupNearSource !== "function") return false;

                const typeValue = Object.prototype.hasOwnProperty.call(namedArgs, "type") ? namedArgs.type : args[0];
                const sizeValue = Object.prototype.hasOwnProperty.call(namedArgs, "size") ? namedArgs.size : args[1];
                const countValue = Object.prototype.hasOwnProperty.call(namedArgs, "count") ? namedArgs.count : args[2];
                const locationValue = Object.prototype.hasOwnProperty.call(namedArgs, "location") ? namedArgs.location : args[3];
                const distanceValue = Object.prototype.hasOwnProperty.call(namedArgs, "distance") ? namedArgs.distance : undefined;
                const heightValue = Object.prototype.hasOwnProperty.call(namedArgs, "height") ? namedArgs.height : undefined;
                const relativeOffset = parseRelativeOffset(locationValue);

                if (Object.prototype.hasOwnProperty.call(namedArgs, "x")) {
                    const namedX = Number(namedArgs.x);
                    if (Number.isFinite(namedX)) relativeOffset.x = namedX;
                }
                if (Object.prototype.hasOwnProperty.call(namedArgs, "y")) {
                    const namedY = Number(namedArgs.y);
                    if (Number.isFinite(namedY)) relativeOffset.y = namedY;
                }

                const powerupType = String(typeValue || "").trim();
                if (!powerupType.length) return false;
                const size = Number.isFinite(Number(sizeValue)) ? Number(sizeValue) : 1;
                const count = Number.isFinite(Number(countValue)) ? Number(countValue) : 1;
                const distance = Number.isFinite(Number(distanceValue)) ? Number(distanceValue) : undefined;
                const height = Number.isFinite(Number(heightValue)) ? Number(heightValue) : 0;
                const dropped = global.dropPowerupNearSource(source, powerupType, {
                    size,
                    count,
                    preferredDistance: distance,
                    z: height,
                    offsetX: relativeOffset.x,
                    offsetY: relativeOffset.y
                });
                if (Array.isArray(dropped)) return dropped.length > 0;
                return !!dropped;
            },
            pause(args, context, namedArgs = {}) {
                const rawSeconds = Object.prototype.hasOwnProperty.call(namedArgs, "seconds")
                    ? namedArgs.seconds
                    : args[0];
                const seconds = Number(rawSeconds);
                if (!Number.isFinite(seconds)) return false;
                const delayMs = Math.max(0, seconds * 1000);
                return new Promise(resolve => {
                    setTimeout(() => resolve(true), delayMs);
                });
            },
            crumble(args, context, namedArgs = {}) {
                return performCrumble((context && context.target) || null, args, namedArgs);
            },
            savegame(args) {
                const name = String(args[0] || "").trim();
                if (!name.length) return false;
                if (typeof saveGameStateToLocalStorage === "function") {
                    const result = saveGameStateToLocalStorage(name);
                    if (!result || !result.ok) {
                        console.error("Scripting savegame failed:", result);
                        return false;
                    }
                    if (typeof message === "function") {
                        message("Game saved to '" + name + "'");
                    }
                    console.log("Scripting: game saved to localStorage key '" + name + "'");
                    return true;
                }
                if (typeof saveGameState !== "function") return false;
                const saveData = saveGameState();
                if (!saveData) return false;
                try {
                    localStorage.setItem(name, JSON.stringify(saveData));
                    if (typeof message === "function") {
                        message("Game saved to '" + name + "'");
                    }
                    console.log("Scripting: game saved to localStorage key '" + name + "'");
                    return true;
                } catch (e) {
                    console.error("Scripting savegame failed:", e);
                    return false;
                }
            },
            "time.stop"() {
                if (typeof global.stopSimulationTime === "function") {
                    return !!global.stopSimulationTime();
                }
                if (typeof global.setSimulationTimeScale === "function") {
                    return !!global.setSimulationTimeScale(0);
                }
                global.simulationTimeScale = 0;
                return true;
            },
            "time.restore"() {
                if (typeof global.restoreSimulationTime === "function") {
                    return !!global.restoreSimulationTime();
                }
                if (typeof global.setSimulationTimeScale === "function") {
                    return !!global.setSimulationTimeScale(1);
                }
                global.simulationTimeScale = 1;
                return true;
            },
            scrollMessage(args, context, namedArgs = {}) {
                const hasNamedText = Object.prototype.hasOwnProperty.call(namedArgs, "text");
                const hasNamedTitle = Object.prototype.hasOwnProperty.call(namedArgs, "title");
                let content = hasNamedText ? namedArgs.text : args[0];
                let titleValue = hasNamedTitle ? namedArgs.title : "";

                if (!hasNamedText && args.length > 1) {
                    if (!hasNamedTitle && args.length === 2 && typeof args[1] === "string") {
                        titleValue = args[1];
                    } else if (args.length === 2 && typeof args[1] !== "string") {
                        content = [args[0], args[1]];
                    } else if (args.length > 2) {
                        content = hasNamedTitle ? args.slice() : args.slice(0, args.length - 1);
                        if (!hasNamedTitle && typeof args[args.length - 1] === "string") {
                            titleValue = args[args.length - 1];
                        } else if (!hasNamedTitle) {
                            content = args.slice();
                        }
                    }
                }

                const title = String(titleValue === undefined || titleValue === null ? "" : titleValue);
                if (typeof global.showScrollDialog === "function") {
                    return global.showScrollDialog({
                        title,
                        bodyClass: "scrollMessageText",
                        content,
                        buttons: [{
                            text: "ok",
                            type: "submit",
                            value: true
                        }]
                    });
                }
                if (typeof global.showScrollMessage === "function" && (typeof content === "string" || typeof content === "number" || typeof content === "boolean")) {
                    return global.showScrollMessage(String(content), "ok", title);
                }
                if (typeof global.msgBox === "function") {
                    const fallbackText = Array.isArray(content)
                        ? content.map(entry => (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") ? String(entry) : "").join(" ")
                        : String(content === undefined || content === null ? "" : content);
                    return new Promise(resolve => {
                        global.msgBox(title, fallbackText, [{
                            text: "ok",
                            function: () => resolve(true)
                        }]);
                    });
                }
                return false;
            },
            "camera.zoom"(args, _context, namedArgs = {}) {
                const rawTarget = Object.prototype.hasOwnProperty.call(namedArgs, "target")
                    ? namedArgs.target
                    : args[0];
                const rawSeconds = Object.prototype.hasOwnProperty.call(namedArgs, "seconds")
                    ? namedArgs.seconds
                    : (args[1] !== undefined ? args[1] : 0);
                const targetFactor = Number(rawTarget);
                const seconds = Number(rawSeconds);
                if (!Number.isFinite(targetFactor) || !Number.isFinite(seconds)) return false;
                if (typeof global.scriptCameraZoomTo !== "function") return false;
                return !!global.scriptCameraZoomTo(targetFactor, seconds);
            },
            "camera.pan"(args, context, namedArgs = {}) {
                const rawX = Object.prototype.hasOwnProperty.call(namedArgs, "x")
                    ? namedArgs.x
                    : (args[0] !== undefined ? args[0] : 0);
                const rawY = Object.prototype.hasOwnProperty.call(namedArgs, "y")
                    ? namedArgs.y
                    : (args[1] !== undefined ? args[1] : 0);
                const hasTargetArg = Object.prototype.hasOwnProperty.call(namedArgs, "target") || args[2] !== undefined;
                const rawTarget = Object.prototype.hasOwnProperty.call(namedArgs, "target")
                    ? namedArgs.target
                    : args[2];
                const rawSeconds = Object.prototype.hasOwnProperty.call(namedArgs, "seconds")
                    ? namedArgs.seconds
                    : (args[3] !== undefined ? args[3] : 0);
                const offsetX = Number(rawX);
                const offsetY = Number(rawY);
                const seconds = Number(rawSeconds);
                if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY) || !Number.isFinite(seconds)) return false;
                const targetObject = hasTargetArg ? resolveScriptCameraTarget(rawTarget, context) : null;
                if (hasTargetArg && !targetObject) return false;
                if (typeof global.scriptCameraPanTo !== "function") return false;
                return !!global.scriptCameraPanTo({
                    x: offsetX,
                    y: offsetY,
                    target: targetObject,
                    seconds
                });
            },
            "camera.reset"(args, _context, namedArgs = {}) {
                const rawSeconds = Object.prototype.hasOwnProperty.call(namedArgs, "seconds")
                    ? namedArgs.seconds
                    : (args[0] !== undefined ? args[0] : 0);
                const seconds = Number(rawSeconds);
                if (!Number.isFinite(seconds)) return false;
                if (typeof global.scriptCameraReset !== "function") return false;
                return !!global.scriptCameraReset(seconds);
            }
        };
        for (let i = 0; i < PLAYER_COMMAND_REGISTRY.length; i++) {
            const entry = PLAYER_COMMAND_REGISTRY[i];
            if (!entry || typeof entry.name !== "string" || typeof entry.handler !== "function") continue;
            commandImplementations[entry.name] = entry.handler;
        }

        for (let i = 0; i < GLOBAL_ASSIGNMENT_REGISTRY.length; i++) {
            const entry = GLOBAL_ASSIGNMENT_REGISTRY[i];
            const handler = assignmentImplementations[entry.name];
            if (typeof handler === "function") {
                registerAssignmentHandler(entry.name, handler);
            }
        }

        for (let i = 0; i < PLAYER_ASSIGNMENT_REGISTRY.length; i++) {
            const entry = PLAYER_ASSIGNMENT_REGISTRY[i];
            const handler = assignmentImplementations[entry.name];
            if (typeof handler === "function") {
                registerAssignmentHandler(`player.${entry.name}`, handler);
                registerAssignmentHandler(`wizard.${entry.name}`, handler);
            }
        }

        for (let i = 0; i < PLAYER_COMMAND_REGISTRY.length; i++) {
            const entry = PLAYER_COMMAND_REGISTRY[i];
            const handler = commandImplementations[entry.name];
            if (typeof handler === "function") {
                registerCommand(`player.${entry.name}`, handler);
                registerCommand(`wizard.${entry.name}`, handler);
            }
        }

        const targetAssignmentEntries = getUniqueScriptApiTargetMembers("property");
        for (let i = 0; i < targetAssignmentEntries.length; i++) {
            const entry = targetAssignmentEntries[i];
            const handler = assignmentImplementations[entry.name];
            if (typeof handler === "function") {
                registerAssignmentHandler(`this.${entry.name}`, handler);
            }
        }

        for (let i = 0; i < GLOBAL_COMMAND_REGISTRY.length; i++) {
            const entry = GLOBAL_COMMAND_REGISTRY[i];
            const handler = commandImplementations[entry.name];
            if (typeof handler === "function") {
                registerCommand(entry.name, handler);
            }
        }

        const targetCommandEntries = getUniqueScriptApiTargetMembers("method");
        for (let i = 0; i < targetCommandEntries.length; i++) {
            const entry = targetCommandEntries[i];
            const handler = commandImplementations[entry.name];
            if (typeof handler === "function") {
                registerCommand(`this.${entry.name}`, handler);
            }
        }
    }

    registerBuiltinScriptHandlers();

    const VALID_EVENT_BLOCK_NAMES = new Set([
        ...SCRIPTING_API_SCHEMA.events.map(entry => entry.name),
        LEGACY_PLAYER_TOUCH_EVENT_NAME,
        LEGACY_PLAYER_UNTOUCH_EVENT_NAME
    ]);

    function validateScript(rawText) {
        const text = String(rawText || "");
        if (!text.trim().length) return [];
        const errors = [];
        const validationWizard = global.wizard || createScriptValidationWizardStub();
        const validationContext = {
            map: (scriptEditorTargetObject && scriptEditorTargetObject.map) || global.map || null,
            wizard: validationWizard,
            player: validationWizard,
            target: scriptEditorTargetObject || null
        };
        let index = 0;
        const len = text.length;

        const isIdentStartCh = (ch) => /[A-Za-z_$]/.test(ch);
        const isIdentPartCh = (ch) => /[A-Za-z0-9_$]/.test(ch);

        function skipWs() {
            while (index < len && /\s/.test(text[index])) index++;
        }

        function checkAssignmentPath(path, absStart) {
            if (path.indexOf(".") === -1) return; // bare name — always ok
            if (assignmentHandlersByPath.has(path)) return; // registered handler
                const objectAssignment = resolveScriptAssignmentTarget(path, validationContext);
                if (objectAssignment && assignmentHandlersByPath.has(objectAssignment.assignmentHandlerPath)) return;
            errors.push({ start: absStart, end: absStart + path.length, message: "Unknown property: " + path });
        }

        function checkStatement(stmt, absStart, localContext = validationContext, options = {}) {
            var allowBreak = !!options.allowBreak;
            if (!stmt.length) return;
            if (parseBreakStatement(stmt)) {
                if (!allowBreak) {
                    errors.push({ start: absStart, end: absStart + stmt.length, message: "'break' can only be used inside a loop" });
                }
                return;
            }
            var forStatement = parseForInStatement(stmt);
            if (forStatement) {
                try {
                    parseScriptValue(forStatement.iterableExpression, localContext);
                } catch (error) {
                    errors.push({
                        start: absStart,
                        end: absStart + stmt.length,
                        message: "Invalid for-loop iterable: " + error.message
                    });
                    return;
                }
                var forBodyStartInStmt = stmt.indexOf("{");
                if (forBodyStartInStmt >= 0) {
                    checkBody(
                        forStatement.body,
                        absStart + forBodyStartInStmt + 1,
                        createScriptChildContext(localContext, { [forStatement.variableName]: "" }),
                        { allowBreak: true }
                    );
                }
                return;
            }
            var ifStatement = parseIfStatement(stmt);
            if (ifStatement) {
                if (!ifStatement.condition.length) {
                    errors.push({ start: absStart, end: absStart + 2, message: "Missing if condition" });
                    return;
                }
                try {
                    evaluateScriptExpression(ifStatement.condition, localContext);
                } catch (error) {
                    errors.push({
                        start: absStart,
                        end: absStart + stmt.length,
                        message: "Invalid if condition: " + error.message
                    });
                }
                var bodyStartInStmt = stmt.indexOf("{");
                if (bodyStartInStmt >= 0) {
                    checkBody(ifStatement.body, absStart + bodyStartInStmt + 1, localContext, options);
                }
                return;
            }
            // Assignment: path = value or path += value
            var assignMatch = stmt.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(\+=|=)\s*([\s\S]+)$/);
            if (assignMatch) {
                checkAssignmentPath(assignMatch[1], absStart);
                try {
                    resolveAssignmentValue(assignMatch[1], assignMatch[2], assignMatch[3], localContext);
                } catch (error) {
                    errors.push({
                        start: absStart,
                        end: absStart + stmt.length,
                        message: "Invalid assignment value: " + error.message
                    });
                }
                return;
            }
            // Command: name(...)
            var cmdMatch = stmt.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(([\s\S]*)\)$/);
            if (cmdMatch) {
                var cmdName = cmdMatch[1];
                try {
                    parseCommandStatement(stmt, localContext);
                } catch (error) {
                    errors.push({
                        start: absStart,
                        end: absStart + stmt.length,
                        message: "Invalid command arguments: " + error.message
                    });
                    return;
                }
                var resolvedCmd = resolveScriptCommand(cmdName, localContext);
                if (resolvedCmd && resolvedCmd.kind !== "unknownCommand" && resolvedCmd.kind !== "unknownObject" && resolvedCmd.kind !== "invalid") {
                    return;
                }
                var cmdRoot = cmdName.split(".")[0];
                if (resolvedCmd && resolvedCmd.kind === "unknownObject") {
                    errors.push({ start: absStart, end: absStart + cmdRoot.length, message: "Unknown scripting object: " + cmdRoot });
                } else if (cmdName.includes(".") && isValidScriptingName(cmdRoot) && !getNamedObjectByName(cmdRoot, localContext) && !hasScriptLocal(localContext, cmdRoot)) {
                    errors.push({ start: absStart, end: absStart + cmdRoot.length, message: "Unknown scripting object: " + cmdRoot });
                } else {
                    errors.push({ start: absStart, end: absStart + cmdName.length, message: "Unknown command: " + cmdName });
                }
                return;
            }
            // Unrecognized
            errors.push({ start: absStart, end: absStart + stmt.length, message: "Unrecognized statement" });
        }

        function checkBody(bodyText, bodyOffset, localContext = validationContext, options = {}) {
            var bi = 0, bLen = bodyText.length;
            while (bi < bLen) {
                while (bi < bLen && /\s/.test(bodyText[bi])) bi++;
                if (bi >= bLen) break;
                var stStart = bi;
                var inQ = null, esc = false, dP = 0, dB = 0, dBr = 0;
                while (bi < bLen) {
                    var ch = bodyText[bi];
                    if (esc) { esc = false; bi++; continue; }
                    if (ch === "\\") { if (inQ) esc = true; bi++; continue; }
                    if (inQ) { if (ch === inQ) inQ = null; bi++; continue; }
                    if (ch === '"' || ch === "'") { inQ = ch; bi++; continue; }
                    if (ch === "(") dP++;
                    else if (ch === ")") dP = Math.max(0, dP - 1);
                    else if (ch === "{") dB++;
                    else if (ch === "}") dB = Math.max(0, dB - 1);
                    else if (ch === "[") dBr++;
                    else if (ch === "]") dBr = Math.max(0, dBr - 1);
                    if (dP === 0 && dB === 0 && dBr === 0 && (ch === ";" || ch === "\n" || ch === "\r")) break;
                    bi++;
                }
                var raw = bodyText.slice(stStart, bi);
                var trimmed = raw.trim();
                if (trimmed.length > 0) {
                    var leadWs = raw.length - raw.trimStart().length;
                    var delimiterErrors = collectUnterminatedDelimiterErrors(raw, bodyOffset + stStart);
                    if (delimiterErrors.length > 0) {
                        errors.push.apply(errors, delimiterErrors);
                    } else {
                        checkStatement(trimmed, bodyOffset + stStart + leadWs, localContext, options);
                    }
                }
                while (bi < bLen && (bodyText[bi] === ";" || bodyText[bi] === "\n" || bodyText[bi] === "\r")) bi++;
            }
        }

        // Main parse loop (mirrors parseScriptEditorMixedFormat)
        while (index < len) {
            skipWs();
            if (index >= len) break;
            var stmtStart = index;

            // Try event block: ident { body }
            if (isIdentStartCh(text[index])) {
                var identStart = index;
                index++;
                while (index < len && isIdentPartCh(text[index])) index++;
                var ident = text.slice(identStart, index);
                var look = index;
                while (look < len && /\s/.test(text[look])) look++;
                if (ident && text[look] === "{") {
                    index = look + 1;
                    var bodyStart = index;
                    var depth = 1, bInQ = null, bEsc = false;
                    while (index < len) {
                        var ch = text[index];
                        if (bEsc) { bEsc = false; index++; continue; }
                        if (ch === "\\") { if (bInQ) bEsc = true; index++; continue; }
                        if (bInQ) { if (ch === bInQ) bInQ = null; index++; continue; }
                        if (ch === '"' || ch === "'") { bInQ = ch; index++; continue; }
                        if (ch === "{") depth++;
                        else if (ch === "}") { depth--; if (depth === 0) break; }
                        index++;
                    }
                    if (depth !== 0) {
                        errors.push.apply(errors, collectUnterminatedDelimiterErrors(text.slice(look, len), look));
                        break;
                    }
                    var body = text.slice(bodyStart, index);
                    if (!VALID_EVENT_BLOCK_NAMES.has(ident)) {
                        errors.push({ start: identStart, end: identStart + ident.length, message: "Unknown event: " + ident });
                    }
                    checkBody(body, bodyStart);
                    index++;
                    continue;
                }
                index = stmtStart;
            }

            // Top-level statement
            {
                var inQ2 = null, esc2 = false, dP2 = 0, dB2 = 0, dBr2 = 0;
                while (index < len) {
                    var ch2 = text[index];
                    if (esc2) { esc2 = false; index++; continue; }
                    if (ch2 === "\\") { if (inQ2) esc2 = true; index++; continue; }
                    if (inQ2) { if (ch2 === inQ2) inQ2 = null; index++; continue; }
                    if (ch2 === '"' || ch2 === "'") { inQ2 = ch2; index++; continue; }
                    if (ch2 === "(") dP2++;
                    else if (ch2 === ")") dP2 = Math.max(0, dP2 - 1);
                    else if (ch2 === "{") dB2++;
                    else if (ch2 === "}") dB2 = Math.max(0, dB2 - 1);
                    else if (ch2 === "[") dBr2++;
                    else if (ch2 === "]") dBr2 = Math.max(0, dBr2 - 1);
                    if (dP2 === 0 && dB2 === 0 && dBr2 === 0 && (ch2 === ";" || ch2 === "\n" || ch2 === "\r")) break;
                    index++;
                }
                var raw2 = text.slice(stmtStart, index);
                var trimmed2 = raw2.trim();
                if (trimmed2.length > 0) {
                    var leadWs2 = raw2.length - raw2.trimStart().length;
                    var delimiterErrors2 = collectUnterminatedDelimiterErrors(raw2, stmtStart);
                    if (delimiterErrors2.length > 0) {
                        errors.push.apply(errors, delimiterErrors2);
                    } else {
                        checkStatement(trimmed2, stmtStart + leadWs2);
                    }
                }
                while (index < len && (text[index] === ";" || text[index] === "\n" || text[index] === "\r")) index++;
            }
        }

        return errors;
    }

    const scriptingApi = {
        on,
        off,
        once,
        emit,
        registerCommand,
        registerAssignmentHandler,
        isDoorPlacedObject,
        isDoorLocked,
        isPointInDoorHitbox,
        processDoorTraversalEvents,
        processTriggerAreaTraversalEvents,
        processObjectTouchEvents,
        hasEventScriptForTarget,
        runScript,
        runAssignmentScript,
        fireObjectScriptEvent,
        fireDoorTraversalEvent,
        runObjectInitScript,
        ensureObjectScriptingName,
        applyTargetBrightness,
        validateScript,
        openScriptEditorForTarget,
        closeScriptEditorPanel,
        getNamedObjectByName,
        getNamedObjectNames,
        setObjectScriptingName,
        rebuildNamedObjectRegistry,
        getConsoleGameObject,
        getConsoleGameObjectState
    };

    global.Scripting = scriptingApi;
    global.gameObject = getConsoleGameObject;
    global.gameObjectState = getConsoleGameObjectState;
    global.namedGameObjects = getNamedObjectNames;
})(typeof globalThis !== "undefined" ? globalThis : window);
