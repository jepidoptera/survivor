class Arrow extends globalThis.Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = `./assets/images/pointy arrow.png`;
        this.range = 12
        this.speed = 15
        this.bounces = 0
        this.gravity = .5
        this.type = "arrow"
        this.size = 50
    }
    bounce () {}
    land() {
        super.land()
        clearInterval(this.castInterval)
        animals.forEach((animal, n) => {
            let margin = animal.size
            if (animal._onScreen && !animal.dead) {
                const dist = distance(this.x, this.y, animal.center_x, animal.center_y);
                if (withinRadius(this.x, this.y, animal.center_x, animal.center_y, margin)) {
                    this.hurt(animal, 25 * (margin - dist) / margin)
                    this.x = animal.center_x
                    this.y = animal.center_y
                    if (animal.hp > 0) {
                        this.visible = false
                    }
                }
            }
        })
    }
}


globalThis.Arrow = Arrow;
