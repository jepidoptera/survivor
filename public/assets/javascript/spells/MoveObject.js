class MoveObject extends globalThis.Spell {
	static supportsObjectTargeting = true;

	static isValidObjectTarget(target, wizardRef = null) {
		if (!target || target.gone || target.vanishing) return false;
		if (target === wizardRef || target === globalThis.wizard) return false;

		const type = (typeof target.type === "string")
			? target.type.trim().toLowerCase()
			: "";
		if (type === "wallsection" || type === "roof") return false;

		if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
			return true;
		}

		return !!(
			(target.type === "triggerArea" || target.isTriggerArea === true) &&
			Array.isArray(target.polygonPoints) &&
			target.polygonPoints.length >= 3
		);
	}
}

globalThis.MoveObject = MoveObject;
