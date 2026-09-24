class TriggerAreaSpell extends globalThis.Spell {
    static supportsObjectTargeting = true;

    static isValidObjectTarget(target, _wizardRef = null) {
        return !!(
            target &&
            !target.gone &&
            !target.vanishing &&
            (target.type === "triggerArea" || target.isTriggerArea === true)
        );
    }

    constructor(x, y) {
        super(x, y);
        this.gravity = 0;
        this.speed = 0;
        this.range = 0;
        this.bounces = 0;
        this.apparentSize = 0;
        this.delayTime = 0;
        this.radius = 0;
    }

    cast(_targetX, _targetY) {
        this.visible = false;
        this.detachPixiSprite();
        return this;
    }
}

globalThis.TriggerAreaSpell = TriggerAreaSpell;
