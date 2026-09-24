class DestructoBeam extends globalThis.Spell {
    static RANGE = 10;
    static CHANNEL_SECONDS = 5;
    static MAGIC_PER_SECOND = 10;

    static supportsObjectTargeting = true;

    static isValidObjectTarget(target) {
        return !!(target && target.type === "wallSection" && !target.gone && !target.vanishing);
    }

    constructor() {
        super();
        this.type = "destructoBeam";
        this.hideProjectileSprite = true;
        this.visible = true;
        this.targetWall = null;
        this.targetX = NaN;
        this.targetY = NaN;
        this.progress = 0;
        this.phaseTime = 0;
        this._lastUpdateMs = null;
        this._originalWallBrightness = null;
    }

    clearTarget() {
        if (this.targetWall && Number.isFinite(this._originalWallBrightness)) {
            this.targetWall.brightness = this._originalWallBrightness;
        }
        this.targetWall = null;
        this._originalWallBrightness = null;
        this.progress = 0;
        this._lastUpdateMs = null;
    }

    setTarget(wall, targetX, targetY, nowMs) {
        if (wall !== this.targetWall) {
            this.clearTarget();
            this.targetWall = wall;
            this._originalWallBrightness = Number.isFinite(wall.brightness) ? Number(wall.brightness) : 0;
        }
        this.targetX = Number(targetX);
        this.targetY = Number(targetY);
        this._lastUpdateMs = Number(nowMs);
    }

    updateChannel(wizardRef, wall, targetX, targetY, nowMs) {
        if (!wizardRef) throw new Error("destructo beam requires a wizard");
        const now = Number(nowMs);
        if (!Number.isFinite(now)) throw new Error("destructo beam requires a finite update time");
        this.x = Number(wizardRef.x);
        this.y = Number(wizardRef.y);
        this.visualBaseZ = globalThis.Spell.getTargetWorldBaseZ(wizardRef);
        this.phaseTime = now / 1000;

        if (!DestructoBeam.isValidObjectTarget(wall)) {
            this.clearTarget();
            return false;
        }
        const dx = wizardRef.map && typeof wizardRef.map.shortestDeltaX === "function"
            ? wizardRef.map.shortestDeltaX(wizardRef.x, targetX)
            : Number(targetX) - Number(wizardRef.x);
        const dy = wizardRef.map && typeof wizardRef.map.shortestDeltaY === "function"
            ? wizardRef.map.shortestDeltaY(wizardRef.y, targetY)
            : Number(targetY) - Number(wizardRef.y);
        if (Math.hypot(dx, dy) > DestructoBeam.RANGE) {
            this.clearTarget();
            return false;
        }

        const previousMs = wall === this.targetWall ? this._lastUpdateMs : null;
        this.setTarget(wall, targetX, targetY, now);
        if (!Number.isFinite(previousMs)) return true;
        const deltaSeconds = Math.max(0, Math.min(0.1, (now - previousMs) / 1000));
        if (deltaSeconds <= 0) return true;
        const magicCost = DestructoBeam.MAGIC_PER_SECOND * deltaSeconds;
        if (!globalThis.Spell.spendMagicCost(magicCost, wizardRef)) {
            globalThis.Spell.indicateInsufficientMagic();
            this.clearTarget();
            return false;
        }
        this.progress = Math.min(1, this.progress + (deltaSeconds / DestructoBeam.CHANNEL_SECONDS));
        wall.brightness = this._originalWallBrightness + ((100 - this._originalWallBrightness) * this.progress);
        if (this.progress < 1) return true;

        const breakX = this.targetX;
        const breakY = this.targetY;
        const breakWall = this.targetWall;
        const originalBrightness = this._originalWallBrightness;
        this.targetWall = null;
        this._originalWallBrightness = null;
        this.progress = 0;
        if (breakWall && !breakWall.gone) breakWall.brightness = originalBrightness;
        const scripting = globalThis.Scripting;
        if (!scripting || typeof scripting.crumbleWall !== "function") {
            throw new Error("destructo beam requires the canonical wall crumble operation");
        }
        const directionX = breakX - Number(wizardRef.x);
        const directionY = breakY - Number(wizardRef.y);
        scripting.crumbleWall(breakWall, directionX, directionY);
        return true;
    }

    stop() {
        this.clearTarget();
        this.gone = true;
        this.visible = false;
        if (this.beamGraphics && this.beamGraphics.parent) this.beamGraphics.parent.removeChild(this.beamGraphics);
    }
}

globalThis.DestructoBeam = DestructoBeam;
