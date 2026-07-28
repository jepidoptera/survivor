(function () {
    "use strict";

    const STRIDE = 18;
    const OUT_STRIDE = 15;
    const WALL_STRIDE = 8;
    const WALL_X1 = 0;
    const WALL_Y1 = 1;
    const WALL_X2 = 2;
    const WALL_Y2 = 3;
    const WALL_LABEL_CODE = 4;
    const WALL_LABEL_SIDE = 5;
    const WALL_LABEL_MANUAL_TOOL = 1;
    const WALL_LABEL_ARENA_BOUNDARY = 2;
    const WALL_LABEL_ROOM_BOUNDARY = 10;
    const WALL_LABEL_ROOM_HALL_GAP = 11;
    const WALL_LABEL_ROOM_OUTSIDE_DOOR_GAP = 12;
    const WALL_LABEL_ROOM_POCKET_OVERRIDE = 13;
    const WALL_LABEL_ROOM_POCKET_OVERRIDE_HALL_GAP = 14;
    const WALL_LABEL_ROOM_POCKET_CONNECTOR = 15;
    const WALL_LABEL_SQUARE_SIDE_PARALLEL = 20;
    const WALL_LABEL_SQUARE_SIDE_PERPENDICULAR = 21;
    const WALL_LABEL_SQUARE_SIDE_PERPENDICULAR_FULL = 22;
    const WALL_LABEL_HALLWAY_SIDE_HALF = 30;
    const WALL_LABEL_HALLWAY_SIDE_FULL = 31;
    const PATH_SNAPSHOT_NODE_STRIDE = 9;
    const PATH_SNAPSHOT_EDGE_STRIDE = 4;
    const STATE_MILLING = 1;
    const STATE_ATTACKING = 3;
    const STATE_BLOCKED = 6;
    const STATE_SEEKING = 7;
    const STATE_HOLDING = 8;
    const STATE_RECOVERING = 9;
    const STATE_VACATING = 10;
    const PHASE_MILLING = 0;
    const PHASE_VACATING = 5;
    const AGENT_RADIUS = 0.42;
    const TARGET_RADIUS = AGENT_RADIUS;
    const COMBAT_RING_RADIUS = 1.6;
    const TARGET_KEYBOARD_MOVE_SPEED = 5.67;
    const TARGET_KEYBOARD_FAST_MOVE_SPEED = 14.49;
    const TARGET_KEYBOARD_SIDEWAYS_SPEED_MULTIPLIER = 2 / 3;
    const TARGET_KEYBOARD_FORWARD_DIAGONAL_SPEED_MULTIPLIER = 5 / 6;
    const TARGET_KEYBOARD_BACKWARD_SPEED_MULTIPLIER = 1 / 2;
    const TARGET_KEYBOARD_BACKWARD_DIAGONAL_SPEED_MULTIPLIER = 7 / 12;
    const TARGET_PROJECTED_CURSOR_DISTANCE = 3;
    const TARGET_IDLE_FACE_CURSOR_SECONDS = 1;
    const TARGET_CURSOR_DISTANCE_RETURN_SECONDS = 1;
    const TARGET_TURN_SPEED_MULTIPLIER = 1.3;
    const TARGET_PROJECTED_CURSOR_MIN_DISTANCE = 1;
    const TARGET_PROJECTED_CURSOR_MAX_DISTANCE = 10;
    const TARGET_PROJECTED_CURSOR_MIN_TURN_RADIUS = 0.5;
    const TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET = Math.PI / 2;
    const TARGET_PROJECTED_CURSOR_ANGLE_SPEED = TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET;
    const TARGET_PROJECTED_CURSOR_RETURN_ANGLE_SPEED_MULTIPLIER = 2.5;
    const TARGET_PROJECTED_CURSOR_OUTWARD_ANGLE_SPEED_MIN_MULTIPLIER = 0.2;
    const TARGET_PROJECTED_CURSOR_MOVING_TURN_ACCEL_SECONDS = 0.5;
    const TARGET_PROJECTED_CURSOR_MOVING_MAX_TURN_ACCEL_MULTIPLIER = 2;
    const TARGET_PROJECTED_CURSOR_IDLE_TURN_ACCEL_SECONDS = 0.75;
    const TARGET_PROJECTED_CURSOR_IDLE_MAX_TURN_ACCEL_MULTIPLIER = 4;
    const TARGET_PROJECTED_CURSOR_IDLE_TURN_RATE_MULTIPLIER = 2 / 3;
    const TARGET_PROJECTED_CURSOR_MAX_SPEED_BONUS = 0.5;
    const TARGET_PROJECTED_CURSOR_DISTANCE_SPEED = TARGET_PROJECTED_CURSOR_DISTANCE * 2;
    const TARGET_PROJECTED_CURSOR_RETURN_DISTANCE_SPEED = Math.max(
        TARGET_PROJECTED_CURSOR_MAX_DISTANCE - TARGET_PROJECTED_CURSOR_DISTANCE,
        TARGET_PROJECTED_CURSOR_DISTANCE - TARGET_PROJECTED_CURSOR_MIN_DISTANCE
    ) / TARGET_CURSOR_DISTANCE_RETURN_SECONDS;
    const SPELL_COOLDOWN_RING_RADIUS = 13;
    const SPELL_COOLDOWN_RING_CIRCUMFERENCE = 2 * Math.PI * SPELL_COOLDOWN_RING_RADIUS;
    const FIREBALL_EXPLOSION_VISUAL_SECONDS = 0.16;
    const FIRE_DEATH_VISUAL_SECONDS = 1.275;
    const FIRE_DEATH_FLAME_COUNT = 3;
    const FIREBALL_ANIMATION_TEXTURE_PATH = "/wizard-of-flatland/hi-fi-fireball.png";
    const FIREBALL_ICON_PATH = "/assets/images/thumbnails/fireball.png";
    const SPIKE_ICON_PATH = "/assets/images/magic/spike.png";
    const FREEZE_ICON_PATH = "/assets/images/magic/iceball.png";
    const FREEZE_PARTICLES_PER_SECOND_AT_LEVEL_ONE = 132;
    const FREEZE_PARTICLE_COUNT_MULTIPLIER_PER_LEVEL = 1.25;
    const FREEZE_CONE_START_WIDTH = 1;
    const FREEZE_PARTICLE_MIN_LIFETIME = 0.18;
    const FREEZE_PARTICLE_MAX_LIFETIME = 0.52;
    const FREEZE_DEATH_PARTICLE_COUNT = 60;
    const FREEZE_DEATH_PARTICLE_MAX_DISTANCE = 4;
    const ENEMY_TEMPERATURE_RECOVERY_PER_SECOND = 1;
    const FREEZE_TEMPERATURE_DROP_DEGREES = 10;
    const FREEZE_DAMAGE_FRACTION_PER_TEMPERATURE_DROP = 1 / 4;
    const TROPHY_TEXTURE_PATH = "/wizard-of-flatland/chalice.png";
    const FIREBALL_ANIMATION_FRAME_COLUMNS = 5;
    const FIREBALL_ANIMATION_FRAME_ROWS = 2;
    const FIREBALL_ANIMATION_FRAME_COUNT = FIREBALL_ANIMATION_FRAME_COLUMNS * FIREBALL_ANIMATION_FRAME_ROWS;
    const FIREBALL_IMPACT_ANIMATION_SPEED_MULTIPLIER = 10;
    const FIREBALL_SELF_DAMAGE_SCALE = 0.25;
    const FIREBALL_WALL_HIT_RADIUS_SCALE = 0.5;
    const FIREBALL_HALF_DAMAGE_OUTER_RADIUS = 1;
    const SPIKE_PROJECTILE_RADIUS = 0.18;
    const SPIKE_BOUNCE_MAX_SPIN_HZ = 5;
    const SPIKE_BOUNCE_MAX_DAMAGE_LOSS_RATIO = 0.75;
    const SPIKE_BOUNCE_MAX_SPEED_LOSS_RATIO = 0.5;
    const SPIKE_BOUNCE_MAX_SCATTER_RADIANS = 22 * Math.PI / 180;
    const SPIKE_BOUNCE_WALL_EXIT_EPSILON = 0.003;
    const SPIKE_SHATTER_VISUAL_SECONDS = 0.5;
    const SPIKE_SHATTER_MAX_OFFSET_RADIUS = 0.5;
    const SPIKE_SHATTER_MAX_ROTATION = 30 * Math.PI / 180;
    const ENEMY_MAX_HEALTH = 20;
    const WIZARD_MAX_HEALTH = 100;
    const WIZARD_NEW_GAME_STARTING_HEALTH = 10;
    const WIZARD_MAX_MAGIC = 100;
    const WIZARD_MAX_EXP = 80;
    const WIZARD_LEVEL_EXP_INCREMENT = 20;
    const WIZARD_MAGIC_RECHARGE_SECONDS_LEVEL_0 = 14;
    const ENEMY_HIT_DAMAGE = 10;
    const WALL_BREAK_HITPOINTS = 150;
    const WALL_BREAK_SECTION_LENGTH = 3;
    const WALL_SHATTER_VISUAL_SECONDS = 0.42;
    const WALL_SHATTER_FRAGMENT_COUNT = 14;
    const ENEMY_DEATH_PATH_COST = 10;
    const ENEMY_DEATH_PATH_COST_SECONDS = 60;
    const ENEMY_DEATH_PATH_COST_TILE_COUNT = 7;
    const LIVE_ENEMY_PATH_COST = 3;
    const LIVE_ENEMY_PATH_COST_TILE_COUNT = 7;
    const ENEMY_DEATH_BLOCKER_RADIUS = 1;
    const ENEMY_DEATH_BLOCKER_SECONDS = 5;
    const ENEMY_DEATH_BLOCKER_LOS_LUNGE_BYPASS_RADIUS_SCALE = 1.25;
    const ENEMY_SCALE_RING_INTERVAL = 7;
    const ENEMY_SCALE_INCREMENT = 0.1;
    const ENEMY_DAMAGE_BASE_SCALE = 0.75;
    const ENEMY_DAMAGE_ZONE_MULTIPLIER = 1.25;
    const SPELL_LEVEL_DATA_URL = "/wizard-of-flatland/spell-levels.json";
    const SPELL_LEVEL_MIN = 0;
    const SPELL_LEVEL_MAX = 7;
    const SPELL_LEVEL_STAT_LABELS = [
        ["manaCost", "Mana cost"],
        ["costPerSecond", "Cost per second"],
        ["power", "Power"],
        ["damage", "Damage"],
        ["coneAngleDegrees", "Cone angle"],
        ["healthPerSecond", "Health per second"],
        ["secondsToFullHealth", "Seconds to full health"],
        ["secondsToFullMagic", "Seconds to full magic"],
        ["range", "Range"],
        ["explosionRadius", "Explosion radius"],
        ["projectileRadius", "Projectile radius"],
        ["castDelay", "Cooldown"],
        ["projectileSpeed", "Projectile speed"],
        ["duration", "Duration"]
    ];
    const SPEED_SCALE_MIN = 0.05;
    const SPEED_SCALE_MAX = 0.8;
    const SPEED_SCALE_DEFAULT = 0.2;
    const SOLVER_STEP_DT_MAX = 0.05;
    const TARGET_NPC_CONTACTS_ENABLED = true;
    const TARGET_NPC_PUSH_ITERATIONS = 24;
    const TARGET_NPC_PUSH_SLOP = 0.0005;
    const TARGET_NPC_PUSH_PLAYER_SHARE = 0.69;
    const NPC_NPC_PUSH_SHARE = 0.5;
    const VACATING_CONTACT_PUSH_FORCE = 10;
    const TARGET_NPC_PUSH_MIN_AXIS = 0.0001;
    const NPC_CONTACT_GRID_PADDING = TARGET_NPC_PUSH_SLOP * 8;
    const HEX_GRID_ROW_STEP = 1;
    const HEX_GRID_COL_STEP = 0.866;
    const HEX_GRID_WIDTH = 1 / HEX_GRID_COL_STEP;
    const HEX_GRID_HEIGHT = 1;
    const HEX_GRID_PADDING = 2;
    const PATH_NODE_LAYER_PADDING = 4;
    const WALL_WORLD_THICKNESS = 0.3;
    const WALL_WORLD_HALF_THICKNESS = WALL_WORLD_THICKNESS * 0.5;
    const PATH_NODE_WALL_THICKNESS = WALL_WORLD_THICKNESS;
    const PATH_NODE_WALL_FACE_EXTEND = 0.501;
    const PATH_NODE_X = 0;
    const PATH_NODE_Y = 1;
    const PATH_NODE_BLOCKED = 2;
    const PATH_NODE_CLEARANCE = 3;
    const PATH_NODE_XINDEX = 4;
    const PATH_NODE_YINDEX = 5;
    const PATH_NODE_HAS_UNBLOCKED_NEIGHBOR = 6;
    const PATH_NODE_BLOCKED_NEIGHBOR_COUNT = 7;
    const PATH_NODE_TEMPORARY_COST = 8;
    const PATH_EDGE_FROM = 0;
    const PATH_EDGE_TO = 1;
    const PATH_EDGE_DIRECTION = 2;
    const PATH_EDGE_WALL_BLOCKED = 3;
    const MAZE_CHUNK_MIN_SIZE = 28;
    const MAZE_CHUNK_MAX_SIZE = 72;
    const MAZE_SECTION_CACHE_LIMIT = 15;
    const MAZE_SECTION_NEARBY_LOAD_COUNT = 2;
    const MAZE_WORKER_STATUS_PREFIX = "maze";
    const MAZE_LOOKAHEAD_DISTANCE = 20;
    const MAZE_LOOKAHEAD_REFRESH_INTERVAL_MS = 1000;
    const MAZE_ROOM_EMPTY_ENEMY_CHANCE = 0;
    const MAZE_ROOM_MAX_ENEMY_CHANCE = 1 / 100;
    const MAZE_ROOM_EARLY_ENEMY_CAPS = Object.freeze([0, 1, 2, 4, 8]);
    const MAZE_ROOM_ENEMY_DISTRIBUTION_POWER = 3.25;
    const MAZE_ROOM_ENEMY_SAFE_RADIUS_SCALE = 0.56;
    const MAZE_COIN_AVERAGE_COUNT = 10;
    const MAZE_COIN_MIN_COUNT = 7;
    const MAZE_COIN_MAX_COUNT = 13;
    const MAZE_PYRAMID_COIN_COUNT = 14;
    const MAZE_COIN_ZONE_MULTIPLIER = 1.17;
    const MAZE_COIN_RADIUS = 0.16;
    const MAZE_TROPHY_RADIUS = MAZE_COIN_RADIUS * 2;
    const MAZE_TROPHY_IMAGE_SCALE = 3.28125;
    const MAZE_COIN_VALUE = 1;
    const MAZE_TROPHY_VALUE = 10;
    const MAZE_COIN_OWNING_WALL_DISTANCE = 2;
    const MAZE_COIN_OTHER_WALL_MIN_DISTANCE = 1;
    const MAZE_COIN_ATTRACT_DISTANCE = 2;
    const MAZE_COIN_RUSH_SPEED = 11;
    const ENEMY_COIN_DROP_MAX_LANDING_RADIUS = 0.33 * 1.5;
    const ENEMY_COIN_DROP_POP_SECONDS = 0.38 * Math.sqrt(1.5);
    const ENEMY_COIN_DROP_POP_HEIGHT = 0.22 * 1.5;
    const ENEMY_COIN_BASE_AVERAGE = 0.5;
    const ENEMY_COIN_ZONE_MULTIPLIER = 1.37;
    const ENEMY_COIN_DROP_PROBABILITIES_BY_ZONE = [
        Object.freeze([0.5, 0.5]),
        Object.freeze([0.5034762222952899, 0.3080475554094202, 0.1884762222952898]),
        Object.freeze([0.3645822204994026, 0.3323855590011948, 0.3030322204994025]),
        Object.freeze([0.3180518192639351, 0.2675502542533287, 0.2250675337015369, 0.1893303927811992]),
        Object.freeze([0.2506503634023054, 0.2222946936727986, 0.1971468549429952, 0.1748439504863917, 0.1550641374955091]),
        Object.freeze([0.1793318725870614, 0.1740639542332288, 0.168950782291076, 0.1639878110462771, 0.1591706283159952, 0.1544949515263614]),
        Object.freeze([0.1417821816537188, 0.1366292460130837, 0.1316635888118605, 0.1268784035971233, 0.1222671312898647, 0.1178234511944313, 0.1135412723347122, 0.1094147251052053]),
        Object.freeze([0.1138869672033338, 0.1086253465605445, 0.1036068147668875, 0.09882014102626696, 0.09425461340958337, 0.08990001488288316, 0.08574660044301737, 0.08178507530964124, 0.07800657412475155, 0.0744026411132133, 0.07096521115987733]),
        Object.freeze([0.08017273180223554, 0.07872836746837439, 0.07731002430507877, 0.07591723352389847, 0.07454953478191462, 0.07320647602958785, 0.07188761336134772, 0.07059251086887364, 0.06932074049701932, 0.06807188190233256, 0.06684552231412409, 0.06564125639803929, 0.0644586861220877, 0.06329742062508617]),
        Object.freeze([0.06089734054774924, 0.05989053969497008, 0.05890038403470736, 0.05792659837605998, 0.05696891207779077, 0.05602705897310801, 0.0551007772956905, 0.05418980960693572, 0.05329390272441062, 0.05241280765148548, 0.05154627950813101, 0.05069407746285963, 0.0498559646657919, 0.04903170818282956, 0.04822107893091691, 0.04742385161437241, 0.04663980466227299, 0.04586872016687354, 0.04511038382304441]),
        Object.freeze([0.04335457055886811, 0.04306026180134361, 0.0427679509333989, 0.04247762439253314, 0.04218926870831332, 0.04190287050174935, 0.04161841648467324, 0.04133589345912258, 0.04105528831672818, 0.0407765880381059, 0.04049977969225253, 0.04022485043594591, 0.03995178751314894, 0.0396805782544178, 0.03941121007631409, 0.03914367048082099, 0.03887794705476338, 0.03861402746923193, 0.03835189947901103, 0.03809155092201066, 0.0378329697187021, 0.03757614387155746, 0.03732106146449306, 0.03706771066231648, 0.03681607971017752])
    ];
    const MAZE_COIN_SECTION_EDGE_EPSILON = 0.02;
    const MAZE_COIN_PLACEMENT_ATTEMPTS_PER_COIN = 160;
    const MAZE_COIN_WALL_ENDPOINT_MARGIN = 0.25;
    const TALISMAN_STORAGE_KEY = "wizardOfFlatland.checkpoint.v1";
    const TALISMAN_STORAGE_KEY_PREFIX = `${TALISMAN_STORAGE_KEY}:`;
    const TALISMAN_SAVE_INDEX_KEY = "wizardOfFlatland.checkpoint.index.v1";
    const PYRAMID_FIRST_ROOM_DISTANCE = 8;
    const PYRAMID_ROOM_DISTANCE_STEP = 7;
    const TALISMAN_RADIUS = TARGET_RADIUS * 4.6;
    const TALISMAN_TOUCH_DISTANCE = TARGET_RADIUS + TALISMAN_RADIUS * 0.75;
    const TALISMAN_ACTIVATION_FLASH_SECONDS = 0.42;
    const TALISMAN_BLOCKED_FLASH_SECONDS = 0.25;
    const TALISMAN_GAME_SAVED_PROMPT_SECONDS = 3;
    const TALISMAN_INITIAL_WIZARD_DISTANCE = 4;
    const MAZE_SECTION_DIRECTIONS = [
        { q: 1, r: 0 },
        { q: 0, r: 1 },
        { q: -1, r: 1 },
        { q: -1, r: 0 },
        { q: 0, r: -1 },
        { q: 1, r: -1 }
    ];
    const PATH_MODE_DIRECT = 0;
    const PATH_MODE_WORKER = 1;
    const PATH_REQUEST_INTERVAL_SECONDS = 0.22;
    const PATH_REQUESTS_PER_FRAME = 8;
    const PATH_NODE_FAST_SEARCH_RADIUS = 8;
    const PATH_WAYPOINT_REACHED_PADDING = WALL_WORLD_HALF_THICKNESS + 0.12;
    const HEADING_GLITCH_TURN_THRESHOLD = Math.PI / 5;
    const HEADING_GLITCH_RETURN_THRESHOLD = Math.PI / 10;
    const TARGET_CURSOR_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
    const TARGET_FORWARD_KEYS = {
        KeyW: 1,
        KeyS: -1
    };
    const TARGET_SIDEWAYS_KEYS = {
        KeyA: -1,
        KeyD: 1
    };
    const DEFAULT_SCENARIO = "proceduralMaze";
    const DEFAULT_AGENT_COUNT = 0;
    const DEFAULT_SEPARATION_STRENGTH = 7;
    const DEFAULT_MAZE_SEED = "hex-maze-1";
    const DEFAULT_MAZE_CHUNK_SIZE = 44;
    const DEFAULT_MAZE_ROOM_SCALE = 0.56;
    const DEFAULT_MAZE_TWISTINESS = 0.62;
    const WIZARD_POSITION_STORAGE_KEY = "wizardOfFlatland.savedWizardPosition.v1";
    const WIZARD_FILL_COLOR = "#008000";
    const WIZARD_OUTLINE_COLOR = "#44ff44";
    const WIZARD_HAT_TOP_DOWN_BRIM_WIDTH = 1.34;
    const WIZARD_HAT_TOP_DOWN_BRIM_HEIGHT = 2.25;
    const WIZARD_HAT_TOP_DOWN_BRIM_DROP = 0.12;
    const WIZARD_HAT_TOP_DOWN_CONE_HEIGHT = 0.8112;
    const FLOOR_CENTER_COLOR = "#303030";
    const FLOOR_EDGE_COLOR = "#4c2424";
    const FLOOR_MID_OUTER_COLOR = "#193524";
    const FLOOR_FAR_OUTER_COLOR = "#352951";
    const FLOOR_OUTER_COLOR = "#3d2e00";
    const FLOOR_ZONE_COLORS = [
        FLOOR_CENTER_COLOR,
        FLOOR_EDGE_COLOR,
        FLOOR_MID_OUTER_COLOR,
        FLOOR_FAR_OUTER_COLOR,
        FLOOR_OUTER_COLOR
    ];
    const FLOOR_GRADIENT_SECTION_DISTANCE = 7;
    const FLOOR_GRADIENT_MID_OUTER_SECTION_DISTANCE = FLOOR_GRADIENT_SECTION_DISTANCE * 2;
    const FLOOR_GRADIENT_FAR_OUTER_SECTION_DISTANCE = FLOOR_GRADIENT_SECTION_DISTANCE * 3;
    const FLOOR_GRADIENT_OUTER_SECTION_DISTANCE = FLOOR_GRADIENT_SECTION_DISTANCE * 4;
    const FLOOR_HOME_BASE_LIGHT_SECTION_DISTANCE = 7;
    const FLOOR_HOME_BASE_LIGHT_BRIGHTNESS = 0.5;
    const FLOOR_HOME_BASE_LIGHT_MIN_VIEWPORT_EXAGGERATION_SECTIONS = 1;
    const FLOOR_HOME_BASE_LIGHT_MAX_VIEWPORT_EXAGGERATION_SECTIONS = 3;
    const FLOOR_INACTIVE_PYRAMID_DARKNESS_SECTION_DISTANCE = 3;
    const FLOOR_INACTIVE_PYRAMID_DARKNESS = 0.5;
    const MAZE_RING_BOUNDARY_INTERVAL = 7;
    const MAZE_RING_BOUNDARY_COLOR = "rgba(255,255,255,0.52)";
    const VIEW_ZOOM_MIN = 0.45;
    const VIEW_ZOOM_MAX = 3.2;
    const VIEW_ZOOM_WHEEL_STEP = 0.0015;

    const canvas = document.getElementById("solverCanvas");
    const ctx = canvas.getContext("2d");
    const playButton = document.getElementById("playButton");
    const stepButton = document.getElementById("stepButton");
    const resetButton = document.getElementById("resetButton");
    const scenarioSelect = document.getElementById("scenarioSelect");
    const agentCountInput = document.getElementById("agentCount");
    const separationInput = document.getElementById("separationStrength");
    const speedScaleInput = document.getElementById("speedScale");
    const mazeSeedInput = document.getElementById("mazeSeed");
    const mazeChunkSizeInput = document.getElementById("mazeChunkSize");
    const mazeRoomScaleInput = document.getElementById("mazeRoomScale");
    const mazeTwistinessInput = document.getElementById("mazeTwistiness");
    const healthBar = document.getElementById("healthBar");
    const magicBar = document.getElementById("magicBar");
    const expBar = document.getElementById("expBar");
    const expCounter = document.getElementById("expCounter");
    const expLevelUpButton = document.getElementById("expLevelUpButton");
    const fireballCooldownRing = document.getElementById("fireballCooldownRing");
    const fireballCooldownRingOutline = document.getElementById("fireballCooldownRingOutline");
    const fireballCooldownRingArc = document.getElementById("fireballCooldownRingArc");
    const spellStatusIconImage = document.querySelector("#fireballStatusIcon img");
    const levelUpAnnouncement = document.getElementById("levelUpAnnouncement");
    const spellLevelPanel = document.getElementById("spellLevelPanel");
    const spellLevelHeader = document.getElementById("spellLevelHeader");
    const spellLevelCloseButton = document.getElementById("spellLevelCloseButton");
    const spellLevelList = document.getElementById("spellLevelList");
    const spellLevelDetails = document.getElementById("spellLevelDetails");
    const startupMenu = document.getElementById("startupMenu");
    const startupModeView = document.getElementById("startupModeView");
    const startupNewButton = document.getElementById("startupNewButton");
    const startupLoadButton = document.getElementById("startupLoadButton");
    const startupNewForm = document.getElementById("startupNewForm");
    const startupLoadForm = document.getElementById("startupLoadForm");
    const startupNewNameInput = document.getElementById("startupNewName");
    const startupLoadList = document.getElementById("startupLoadList");
    const startupLoadEmpty = document.getElementById("startupLoadEmpty");
    const startupLoadSubmitButton = document.getElementById("startupLoadSubmitButton");
    const startupNewValidation = document.getElementById("startupNewValidation");
    const startupLoadValidation = document.getElementById("startupLoadValidation");
    const startupNewBackButton = document.getElementById("startupNewBackButton");
    const startupLoadBackButton = document.getElementById("startupLoadBackButton");
    let spellCooldownHudVisible = null;
    let spellCooldownHudProgress = NaN;
    const fireballAnimationImage = new Image();
    let fireballAnimationLoadError = null;
    fireballAnimationImage.addEventListener("error", () => {
        fireballAnimationLoadError = new Error(`Wizard of Flatland failed to load fireball animation texture: ${FIREBALL_ANIMATION_TEXTURE_PATH}`);
        console.error(fireballAnimationLoadError);
    });
    fireballAnimationImage.src = FIREBALL_ANIMATION_TEXTURE_PATH;
    const trophyImage = new Image();
    let trophyImageLoadError = null;
    trophyImage.addEventListener("error", () => {
        trophyImageLoadError = new Error(`Wizard of Flatland failed to load trophy texture: ${TROPHY_TEXTURE_PATH}`);
        console.error(trophyImageLoadError);
    });
    trophyImage.src = TROPHY_TEXTURE_PATH;

    const labels = {
        agentCount: document.getElementById("agentCountValue"),
        separationStrength: document.getElementById("separationStrengthValue"),
        speedScale: document.getElementById("speedScaleValue"),
        mazeChunkSize: document.getElementById("mazeChunkSizeValue"),
        mazeRoomScale: document.getElementById("mazeRoomScaleValue"),
        mazeTwistiness: document.getElementById("mazeTwistinessValue"),
        workerStatus: document.getElementById("workerStatus"),
        solveMs: document.getElementById("solveMs"),
        pairChecks: document.getElementById("pairChecks"),
        movingCount: document.getElementById("movingCount"),
        seekingCount: document.getElementById("seekingCount"),
        waitingCount: document.getElementById("waitingCount"),
        attackingCount: document.getElementById("attackingCount"),
        retreatingCount: document.getElementById("retreatingCount"),
        blockedCount: document.getElementById("blockedCount"),
        wallLeaks: document.getElementById("wallLeaks"),
        profilerSummary: document.getElementById("profilerSummary"),
        profilerRows: document.getElementById("profilerRows")
    };
    const wallBufferApi = getWizardFlatlandWallBufferApi();
    const createEmptyWallBuffer = wallBufferApi.createEmptyWallBuffer;
    const getWallCount = wallBufferApi.getWallCount;
    const validateWallBuffer = wallBufferApi.validateWallBuffer;
    const appendWallSegment = wallBufferApi.appendWallSegment;
    const concatWallBuffers = wallBufferApi.concatWallBuffers;
    const cloneWallBuffer = wallBufferApi.cloneWallBuffer;
    const wallLabelSystem = getWizardFlatlandWallLabelsApi().createWallLabelSystem({
        validateWallBuffer,
        constants: {
            WALL_STRIDE,
            WALL_LABEL_CODE,
            WALL_LABEL_SIDE,
            WALL_LABEL_MANUAL_TOOL,
            WALL_LABEL_ARENA_BOUNDARY,
            WALL_LABEL_ROOM_BOUNDARY,
            WALL_LABEL_ROOM_HALL_GAP,
            WALL_LABEL_ROOM_OUTSIDE_DOOR_GAP,
            WALL_LABEL_ROOM_POCKET_OVERRIDE,
            WALL_LABEL_ROOM_POCKET_OVERRIDE_HALL_GAP,
            WALL_LABEL_ROOM_POCKET_CONNECTOR,
            WALL_LABEL_SQUARE_SIDE_PARALLEL,
            WALL_LABEL_SQUARE_SIDE_PERPENDICULAR,
            WALL_LABEL_SQUARE_SIDE_PERPENDICULAR_FULL,
            WALL_LABEL_HALLWAY_SIDE_HALF,
            WALL_LABEL_HALLWAY_SIDE_FULL
        }
    });
    const validateWallLabelBuffer = wallLabelSystem.validateWallLabelBuffer;
    const getWallDebugLabel = wallLabelSystem.getWallDebugLabel;
    const losApi = getWizardFlatlandLosApi();
    const computeLosVisibilityPolygon = losApi.computeVisibilityPolygon;
    const explorationSystem = getWizardFlatlandExplorationApi().createExplorationSystem({
        cellSize: 0.25
    });
    const explorationWallLayout = Object.freeze({
        stride: WALL_STRIDE,
        x1: WALL_X1,
        y1: WALL_Y1,
        x2: WALL_X2,
        y2: WALL_Y2,
        labelCode: WALL_LABEL_CODE,
        sideCode: WALL_LABEL_SIDE
    });
    const saveStore = getWizardFlatlandSaveStoreApi().createSaveStore();
    const mathApi = getWizardFlatlandMathApi();
    const hashString = mathApi.hashString;
    const seededRandom = mathApi.seededRandom;
    const getHexCornersWorld = mathApi.getHexCornersWorld;
    const isEvenGridColumn = mathApi.isEvenGridColumn;
    const moveToward = mathApi.moveToward;
    const normalizeAngle = mathApi.normalizeAngle;
    const shortestAngleDelta = mathApi.shortestAngleDelta;
    const squareDistance = mathApi.squareDistance;
    const rotatePoint = mathApi.rotatePoint;
    const segmentIntersectionParameters = mathApi.segmentIntersectionParameters;
    const pointProjectionParameter = mathApi.pointProjectionParameter;
    const pointSegmentDistance = mathApi.pointSegmentDistance;
    const segmentRepulsionNormal = mathApi.segmentRepulsionNormal;
    const mazeSectionSystem = getWizardFlatlandMazeSectionsApi().createMazeSectionSystem({
        constants: {
            MAZE_SECTION_DIRECTIONS,
            PYRAMID_FIRST_ROOM_DISTANCE,
            PYRAMID_ROOM_DISTANCE_STEP
        },
        math: {
            getHexCornersWorld
        }
    });
    const getMazeSectionRadius = mazeSectionSystem.getMazeSectionRadius;
    const mazeSectionKey = mazeSectionSystem.mazeSectionKey;
    const isMazeInitialSafeSectionKey = mazeSectionSystem.isMazeInitialSafeSectionKey;
    const isMazePyramidRoomSectionKey = mazeSectionSystem.isMazePyramidRoomSectionKey;
    const getMazePyramidRoomDistance = mazeSectionSystem.getMazePyramidRoomDistance;
    const parseMazeSectionKey = mazeSectionSystem.parseMazeSectionKey;
    const mazeSectionCenter = mazeSectionSystem.mazeSectionCenter;
    const worldToMazeSectionCoord = mazeSectionSystem.worldToMazeSectionCoord;
    const getMazeSectionRing = mazeSectionSystem.getMazeSectionRing;
    const getMazeSectionPolygonForCoord = mazeSectionSystem.getMazeSectionPolygonForCoord;
    const state = {
        running: true,
        gameStarted: false,
        startupMenuOpen: true,
        initialSpellChoiceRequired: false,
        playerName: "",
        mazeSeed: DEFAULT_MAZE_SEED,
        startupSelectedLoadName: "",
        requestId: 1,
        waitingForWorker: false,
        pendingSolverDt: 0,
        solverWallVersion: 0,
        pathfindingRequestId: 1,
        pathfindingSnapshotVersion: 0,
        worldVersion: 1,
        temporaryPathCostsByNodeKey: new Map(),
        liveEnemyPathCostsByNodeKey: new Map(),
        liveEnemyPathCostSignature: "",
        temporaryDeathBlockersByKey: new Map(),
        lastTime: performance.now(),
        agents: [],
        fireballs: [],
        fireballExplosions: [],
        fireDeathEffects: [],
        freezeParticles: [],
        spikeShatterEffects: [],
        wallShatterEffects: [],
        brokenWallGaps: [],
        coins: [],
        collectedCoinKeys: new Set(),
        collectedCoinSectionKeysByCoinKey: new Map(),
        droppedCoinsByKey: new Map(),
        nextDroppedCoinId: 1,
        talismans: [],
        activatedTalismanSectionKeys: new Set(),
        homeBaseTalismanSectionKey: "",
        visitedMazeSectionKeys: new Set(),
        walls: createEmptyWallBuffer(),
        manualWalls: createEmptyWallBuffer(),
        generatedMazeWalls: createEmptyWallBuffer(),
        generatedMazeChunkKeys: new Set(),
        generatedMazeInstalledChunkKeys: new Set(),
        generatedMazeSignature: "",
        generatedMazeRequestId: 1,
        generatedMazeActiveRequestId: 0,
        generatedMazePendingSignature: "",
        generatedMazeLoading: false,
        generatedMazeLookaheadKeys: [],
        generatedMazeLookaheadNextRefreshAt: 0,
        generatedMazeInitialEnemySpawnBudgetsBySectionKey: new Map(),
        sectionSnapshotsByKey: new Map(),
        restoredSectionSnapshotKeys: new Set(),
        lastCheckpointSnapshot: null,
        target: { x: 0, y: 0, heading: -Math.PI / 2 },
        los: {
            enabled: true,
            bins: 3600,
            maxDistance: 34,
            opacity: 1,
            lastMetrics: null,
            lastResult: null
        },
        exploredWallRenderCache: {
            path: null,
            explorationVersion: -1,
            worldVersion: -1
        },
        wizardVitals: {
            health: WIZARD_MAX_HEALTH,
            maxHealth: WIZARD_MAX_HEALTH,
            magic: WIZARD_MAX_MAGIC,
            maxMagic: WIZARD_MAX_MAGIC,
            exp: 0,
            maxExp: WIZARD_MAX_EXP
        },
        selectedSpell: "fireball",
        spellLevels: {
            fireball: 1,
            freeze: 0,
            spikes: 0,
            healing: 0,
            magicrecharge: 0
        },
        spellCooldownRemaining: 0,
        spellCooldownDuration: 0,
        levelPoints: 0,
        targetTravelVector: { x: 0, y: 0 },
        lastSentTarget: { x: 0, y: 0 },
        targetFlashTime: 0,
        targetPushes: 0,
        projectedCursor: {
            angleOffset: 0,
            distance: TARGET_PROJECTED_CURSOR_DISTANCE
        },
        projectedCursorMouseMode: {
            active: false,
            clientX: NaN,
            clientY: NaN,
            bendDirection: 0,
            distanceDirection: 0
        },
        projectedCursorBendHold: {
            direction: 0,
            seconds: 0
        },
        pressedMovementKeys: Object.create(null),
        spaceHeld: false,
        zoomHeld: false,
        fastMovementHeld: false,
        stats: null,
        debug: createWizardOfFlatlandDebugState(),
        wallTool: {
            active: false,
            dragging: false,
            pointerId: null,
            startNode: null,
            hoverNode: null
        },
        view: { width: 0, height: 0, dpr: 1, scale: 1, baseScale: 1, zoom: 1, offsetX: 0, offsetY: 0, centerX: 0, centerY: 0 },
        hexGridLayer: {
            canvas: document.createElement("canvas"),
            ctx: null,
            width: 0,
            height: 0,
            scale: 0,
            offsetX: 0,
            offsetY: 0,
            centerX: NaN,
            centerY: NaN,
            dirty: true
        },
        nodeLayer: {
            nodes: new Float32Array(0),
            snapshotNodes: new Float32Array(0),
            edges: new Int32Array(0),
            blockedEdges: new Int32Array(0),
            indexByKey: new Map(),
            nodeStride: PATH_SNAPSHOT_NODE_STRIDE,
            edgeStride: PATH_SNAPSHOT_EDGE_STRIDE,
            version: 0,
            canvas: document.createElement("canvas"),
            ctx: null,
            width: 0,
            height: 0,
            scale: 0,
            offsetX: 0,
            offsetY: 0,
            centerX: NaN,
            centerY: NaN,
            renderedVersion: -1,
            renderedShowPathBlockedEdges: false,
            pathCenterX: NaN,
            pathCenterY: NaN,
            targetNodeCache: null,
            dirty: true
        }
    };
    let checkpointWriteChain = Promise.resolve();
    state.hexGridLayer.ctx = state.hexGridLayer.canvas.getContext("2d");
    state.nodeLayer.ctx = state.nodeLayer.canvas.getContext("2d");
    const mazePopulationSystem = getWizardFlatlandMazePopulationApi().createMazePopulationSystem({
        state,
        constants: {
            WALL_STRIDE,
            WALL_X1,
            WALL_Y1,
            WALL_X2,
            WALL_Y2,
            MAZE_ROOM_EMPTY_ENEMY_CHANCE,
            MAZE_ROOM_MAX_ENEMY_CHANCE,
            MAZE_ROOM_EARLY_ENEMY_CAPS,
            MAZE_ROOM_ENEMY_DISTRIBUTION_POWER,
            ENEMY_SCALE_RING_INTERVAL,
            ENEMY_SCALE_INCREMENT,
            ENEMY_DAMAGE_BASE_SCALE,
            ENEMY_DAMAGE_ZONE_MULTIPLIER,
            MAZE_COIN_AVERAGE_COUNT,
            MAZE_COIN_MIN_COUNT,
            MAZE_COIN_MAX_COUNT,
            MAZE_PYRAMID_COIN_COUNT,
            MAZE_COIN_ZONE_MULTIPLIER,
            MAZE_RING_BOUNDARY_INTERVAL,
            MAZE_COIN_RADIUS,
            MAZE_TROPHY_RADIUS,
            MAZE_COIN_VALUE,
            MAZE_TROPHY_VALUE,
            MAZE_COIN_OWNING_WALL_DISTANCE,
            MAZE_COIN_OTHER_WALL_MIN_DISTANCE,
            MAZE_COIN_SECTION_EDGE_EPSILON,
            MAZE_COIN_PLACEMENT_ATTEMPTS_PER_COIN,
            MAZE_COIN_WALL_ENDPOINT_MARGIN,
            TALISMAN_RADIUS
        },
        math: {
            hashString,
            seededRandom,
            pointSegmentDistance
        },
        mazeSections: {
            isMazePyramidRoomSectionKey,
            isMazeInitialSafeSectionKey,
            getMazePyramidRoomDistance,
            parseMazeSectionKey,
            getMazeSectionRing,
            mazeSectionCenter,
            getMazeSectionPolygonForCoord
        },
        geometry: {
            isPointInOrNearPolygon
        }
    });
    const validateMazeRoomEnemyBudgetSectionKey = mazePopulationSystem.validateMazeRoomEnemyBudgetSectionKey;
    const getMazeRoomEnemyCount = mazePopulationSystem.getMazeRoomEnemyCount;
    const getMazeRoomMaxEnemyCount = mazePopulationSystem.getMazeRoomMaxEnemyCount;
    const getEnemyScaleForMazeSectionKey = mazePopulationSystem.getEnemyScaleForMazeSectionKey;
    const getEnemyDamageScaleForMazeSectionKey = mazePopulationSystem.getEnemyDamageScaleForMazeSectionKey;
    const createMazeCoinsForSection = mazePopulationSystem.createMazeCoinsForSection;
    const createMazeTalismanForSection = mazePopulationSystem.createMazeTalismanForSection;
    const spellDataSystem = getWizardFlatlandSpellDataApi().createSpellDataSystem({
        state,
        constants: {
            SPELL_LEVEL_DATA_URL,
            SPELL_LEVEL_MIN,
            SPELL_LEVEL_MAX,
            WIZARD_MAGIC_RECHARGE_SECONDS_LEVEL_0
        }
    });
    const clampSpellLevel = spellDataSystem.clampSpellLevel;
    const normalizeWizardSpellLevels = spellDataSystem.normalizeWizardSpellLevels;
    const fetchSpellLevelDefinitions = spellDataSystem.fetchSpellLevelDefinitions;
    const getSpellLevelDefinitions = spellDataSystem.getSpellLevelDefinitions;
    const getWizardSpellLevel = spellDataSystem.getWizardSpellLevel;
    const getActiveFireballStats = spellDataSystem.getActiveFireballStats;
    const getActiveSpikeStats = spellDataSystem.getActiveSpikeStats;
    const getActiveFreezeStats = spellDataSystem.getActiveFreezeStats;
    const getActiveHealingStats = spellDataSystem.getActiveHealingStats;
    const getMagicRechargeStats = spellDataSystem.getMagicRechargeStats;
    let spellLevelPanelSystem = null;
    const refreshSpellLevelPanel = () => spellLevelPanelSystem.refreshSpellLevelPanel();
    const playLevelUpAnnouncement = () => {
        if (!levelUpAnnouncement) throw new Error("Wizard of Flatland level-up announcement is missing");
        levelUpAnnouncement.classList.remove("active");
        void levelUpAnnouncement.offsetWidth;
        levelUpAnnouncement.classList.add("active");
    };
    const canRechargeMagic = () => {
        if (!Number.isFinite(state.spellCooldownRemaining)) {
            throw new Error("Wizard of Flatland magic recharge requires finite spell cooldown");
        }
        return state.spellCooldownRemaining <= 0 && !(state.selectedSpell === "freeze" && state.spaceHeld);
    };
    const wizardVitalsSystem = getWizardFlatlandVitalsApi().createWizardVitalsSystem({
        state,
        constants: {
            WIZARD_MAX_HEALTH,
            WIZARD_MAX_MAGIC,
            WIZARD_MAX_EXP,
            WIZARD_LEVEL_EXP_INCREMENT
        },
        callbacks: {
            updateStatusBars,
            refreshSpellLevelPanel,
            playLevelUpAnnouncement,
            canRechargeMagic,
            getMagicRechargeSecondsToFull: () => getMagicRechargeStats().secondsToFullMagic,
            respawnWizardAfterDeath: () => {
                void respawnWizardAfterDeath().catch((error) => {
                    setLabelText(labels.workerStatus, "checkpoint load failed");
                    console.error("[wizard of flatland respawn]", error);
                });
            }
        }
    });
    const validateWizardVitals = wizardVitalsSystem.validateWizardVitals;
    const validateWizardLevelPoints = wizardVitalsSystem.validateWizardLevelPoints;
    const resetWizardVitals = wizardVitalsSystem.resetWizardVitals;
    const regenerateWizardVitals = wizardVitalsSystem.regenerateWizardVitals;
    const damageWizard = wizardVitalsSystem.damageWizard;
    const healWizard = wizardVitalsSystem.healWizard;
    const spendWizardMagic = wizardVitalsSystem.spendWizardMagic;
    const gainWizardExp = wizardVitalsSystem.gainWizardExp;
    const levelUpWizardSpell = (spellId) => {
        validateWizardLevelPoints();
        const currentLevel = getWizardSpellLevel(spellId);
        if (currentLevel >= SPELL_LEVEL_MAX) return currentLevel;
        if (state.levelPoints <= 0) {
            spellLevelPanelSystem.renderSpellLevelPanel();
            return currentLevel;
        }
        state.levelPoints -= 1;
        const nextLevel = setWizardSpellLevel(spellId, currentLevel + 1);
        updateStatusBars();
        if (state.initialSpellChoiceRequired) {
            state.initialSpellChoiceRequired = false;
            if (isSelectableSpellId(spellId)) setSelectedSpell(spellId);
            hideSpellLevelPanel();
            closeStartupMenu();
        }
        return nextLevel;
    };
    spellLevelPanelSystem = getWizardFlatlandSpellLevelPanelApi().createSpellLevelPanelSystem({
        state,
        elements: {
            spellLevelPanel,
            spellLevelHeader,
            spellLevelList,
            spellLevelDetails
        },
        constants: {
            SPELL_LEVEL_MAX,
            SPELL_LEVEL_STAT_LABELS
        },
        api: {
            fetchSpellLevelDefinitions,
            getSpellLevelDefinitions,
            getWizardSpellLevel,
            normalizeWizardSpellLevels,
            validateWizardLevelPoints,
            levelUpWizardSpell
        }
    });
    const showSpellLevelPanel = spellLevelPanelSystem.showSpellLevelPanel;
    const hideSpellLevelPanel = spellLevelPanelSystem.hideSpellLevelPanel;
    const controlSystem = getWizardFlatlandControlsApi().createControlSystem({
        state,
        labels,
        elements: {
            agentCountInput,
            separationInput,
            speedScaleInput,
            scenarioSelect,
            mazeSeedInput,
            mazeChunkSizeInput,
            mazeRoomScaleInput,
            mazeTwistinessInput
        },
        constants: {
            SPEED_SCALE_MIN,
            SPEED_SCALE_MAX,
            DEFAULT_AGENT_COUNT,
            DEFAULT_SEPARATION_STRENGTH,
            DEFAULT_SCENARIO,
            MAZE_CHUNK_MIN_SIZE,
            MAZE_CHUNK_MAX_SIZE,
            DEFAULT_MAZE_CHUNK_SIZE,
            DEFAULT_MAZE_SEED,
            DEFAULT_MAZE_ROOM_SCALE,
            DEFAULT_MAZE_TWISTINESS
        },
        setLabelText
    });
    const updateControlLabels = controlSystem.updateControlLabels;
    const getSpeedScale = controlSystem.getSpeedScale;
    const setSpeedScaleValue = controlSystem.setSpeedScaleValue;
    const getAgentCount = controlSystem.getAgentCount;
    const getSeparationStrength = controlSystem.getSeparationStrength;
    const getScenarioValue = controlSystem.getScenarioValue;
    const getMazeChunkSize = controlSystem.getMazeChunkSize;
    const getMazeSeed = controlSystem.getMazeSeed;
    const getMazeRoomScale = controlSystem.getMazeRoomScale;
    const getMazeTwistiness = controlSystem.getMazeTwistiness;
    const getMazeOptions = controlSystem.getMazeOptions;
    const isProceduralMazeScenario = controlSystem.isProceduralMazeScenario;
    const profiler = getWizardFlatlandProfilerApi().createWizardOfFlatlandProfiler({ state, labels });
    attachWizardOfFlatlandDebugGlobals(state, profiler);

    const worker = new Worker("/wizard-of-flatland/solverWorker.js?v=wizard-of-flatland-88");
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", (event) => {
        setLabelText(labels.workerStatus, event.message || "failed");
    });

    const pathfindingWorker = new Worker("/wizard-of-flatland/pathfindingWorker.js?v=wizard-of-flatland-4");
    const pathfindingClientSystem = getWizardFlatlandPathfindingClientApi().createPathfindingClientSystem({
        state,
        worker: pathfindingWorker,
        callbacks: {
            getPathfindingNodeKey,
            getPathfindingNodeX,
            getPathfindingNodeY,
            isValidPathfindingNodeIndex,
            getPathfindingNodeIndexForKey,
            getPathfindingBlockedEdgeWallIndex,
            advanceAgentPathCursor,
            getAgentPathWaypoint
        }
    });
    const requestAgentPath = pathfindingClientSystem.requestAgentPath;
    pathfindingWorker.addEventListener("message", pathfindingClientSystem.handlePathfindingWorkerMessage);
    pathfindingWorker.addEventListener("error", (event) => {
        setLabelText(labels.workerStatus, event.message || "pathfinding failed");
    });

    const mazeWorker = new Worker("/wizard-of-flatland/mazeSectionWorker.js?v=wizard-of-flatland-30");
    const mazeStreamingSystem = getWizardFlatlandMazeStreamingApi().createMazeStreamingSystem({
        state,
        worker: mazeWorker,
        constants: {
            MAZE_SECTION_CACHE_LIMIT,
            MAZE_WORKER_STATUS_PREFIX,
            TARGET_RADIUS,
            WALL_STRIDE
        },
        wallBuffer: {
            cloneWallBuffer
        },
        profiler,
        callbacks: {
            isProceduralMazeScenario,
            getMazeOptions,
            getRequiredMazeSectionKeys,
            removeFurthestGeneratedMazeSection,
            getPathfindingLayerBounds,
            getSavedSectionWallOverrides,
            setWorkerStatus: (text) => setLabelText(labels.workerStatus, text),
            installGeneratedMazeWorkerResult
        }
    });
    const getMazeSignature = mazeStreamingSystem.getMazeSignature;
    const refreshGeneratedMazeIfNeeded = mazeStreamingSystem.refreshGeneratedMazeIfNeeded;
    const requestGeneratedMazeRefresh = mazeStreamingSystem.requestGeneratedMazeRefresh;
    mazeWorker.addEventListener("message", mazeStreamingSystem.handleMazeWorkerMessage);
    mazeWorker.addEventListener("error", mazeStreamingSystem.handleMazeWorkerError);

    function setLabelText(label, text) {
        if (label) label.textContent = text;
    }

    function getWizardFlatlandWallBufferApi() {
        const api = window.WizardFlatlandWallBuffer;
        if (
            !api ||
            typeof api.createEmptyWallBuffer !== "function" ||
            typeof api.getWallCount !== "function" ||
            typeof api.validateWallBuffer !== "function" ||
            typeof api.appendWallSegment !== "function" ||
            typeof api.concatWallBuffers !== "function" ||
            typeof api.cloneWallBuffer !== "function"
        ) {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/wallBuffer.js");
        }
        return api;
    }

    function getWizardFlatlandExplorationApi() {
        const factory = window.getWizardFlatlandExplorationApi;
        const api = typeof factory === "function" ? factory() : null;
        if (!api || typeof api.createExplorationSystem !== "function") {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/exploration.js");
        }
        return api;
    }

    function getWizardFlatlandSaveStoreApi() {
        const factory = window.getWizardFlatlandSaveStoreApi;
        const api = typeof factory === "function" ? factory() : null;
        if (!api || typeof api.createSaveStore !== "function") {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/saveStore.js");
        }
        return api;
    }

    function getWizardFlatlandMathApi() {
        const api = window.WizardFlatlandMath;
        if (
            !api ||
            typeof api.hashString !== "function" ||
            typeof api.seededRandom !== "function" ||
            typeof api.getHexCornersWorld !== "function" ||
            typeof api.isEvenGridColumn !== "function" ||
            typeof api.moveToward !== "function" ||
            typeof api.normalizeAngle !== "function" ||
            typeof api.shortestAngleDelta !== "function" ||
            typeof api.squareDistance !== "function" ||
            typeof api.rotatePoint !== "function" ||
            typeof api.segmentIntersectionParameters !== "function" ||
            typeof api.pointProjectionParameter !== "function" ||
            typeof api.pointSegmentDistance !== "function" ||
            typeof api.segmentRepulsionNormal !== "function"
        ) {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/flatlandMath.js");
        }
        return api;
    }

    function getWizardFlatlandWallLabelsApi() {
        const api = window.WizardFlatlandWallLabels;
        if (!api || typeof api.createWallLabelSystem !== "function") {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/wallLabels.js");
        }
        return api;
    }

    function getWizardFlatlandMazeSectionsApi() {
        const api = window.WizardFlatlandMazeSections;
        if (!api || typeof api.createMazeSectionSystem !== "function") {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/mazeSections.js");
        }
        return api;
    }

    function getWizardFlatlandMazePopulationApi() {
        const api = window.WizardFlatlandMazePopulation;
        if (!api || typeof api.createMazePopulationSystem !== "function") {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/mazePopulation.js");
        }
        return api;
    }

    function getWizardFlatlandMazeStreamingApi() {
        const api = window.WizardFlatlandMazeStreaming;
        if (!api || typeof api.createMazeStreamingSystem !== "function") {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/mazeStreaming.js");
        }
        return api;
    }

    function getWizardFlatlandPathfindingClientApi() {
        const api = window.WizardFlatlandPathfindingClient;
        if (!api || typeof api.createPathfindingClientSystem !== "function") {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/pathfindingClient.js");
        }
        return api;
    }

    function getWizardFlatlandControlsApi() {
        const api = window.WizardFlatlandControls;
        if (!api || typeof api.createControlSystem !== "function") {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/controls.js");
        }
        return api;
    }

    function getWizardFlatlandSpellDataApi() {
        const api = window.WizardFlatlandSpellData;
        if (!api || typeof api.createSpellDataSystem !== "function") {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/spellData.js");
        }
        return api;
    }

    function getWizardFlatlandSpellLevelPanelApi() {
        const api = window.WizardFlatlandSpellLevelPanel;
        if (!api || typeof api.createSpellLevelPanelSystem !== "function") {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/spellLevelPanel.js");
        }
        return api;
    }

    function getWizardFlatlandVitalsApi() {
        const api = window.WizardFlatlandVitals;
        if (!api || typeof api.createWizardVitalsSystem !== "function") {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/wizardVitals.js");
        }
        return api;
    }

    function getWizardFlatlandProfilerApi() {
        const api = window.WizardFlatlandProfiler;
        if (!api || typeof api.createWizardOfFlatlandProfiler !== "function") {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/profiler.js");
        }
        return api;
    }

    function updateStatusBars() {
        validateWizardVitals();
        validateWizardLevelPoints();
        if (!healthBar) throw new Error("Wizard of Flatland health bar is missing");
        if (!magicBar) throw new Error("Wizard of Flatland magic bar is missing");
        if (!expBar) throw new Error("Wizard of Flatland exp bar is missing");
        if (!expCounter) throw new Error("Wizard of Flatland exp counter is missing");
        if (!expLevelUpButton) throw new Error("Wizard of Flatland exp level-up button is missing");
        if (!levelUpAnnouncement) throw new Error("Wizard of Flatland level-up announcement is missing");
        const healthRatio = Math.max(0, Math.min(1, state.wizardVitals.health / state.wizardVitals.maxHealth));
        const magicRatio = Math.max(0, Math.min(1, state.wizardVitals.magic / state.wizardVitals.maxMagic));
        const expRatio = Math.max(0, Math.min(1, state.wizardVitals.exp / state.wizardVitals.maxExp));
        healthBar.style.width = `${healthRatio * 100}%`;
        magicBar.style.width = `${magicRatio * 100}%`;
        healthBar.classList.toggle("lowHealthWarning", healthRatio < 0.2);
        expBar.style.width = `${expRatio * 100}%`;
        expCounter.textContent = `${Math.floor(state.wizardVitals.exp)}/${state.wizardVitals.maxExp}`;
        const spellLevels = normalizeWizardSpellLevels();
        const hasSpellBelowMaxLevel = Object.values(spellLevels)
            .some((level) => level < SPELL_LEVEL_MAX);
        const hasAvailableSpellUpgrade = state.levelPoints > 0 && hasSpellBelowMaxLevel;
        expLevelUpButton.classList.remove("hidden");
        expLevelUpButton.classList.toggle("unavailable", !hasAvailableSpellUpgrade);
        expLevelUpButton.setAttribute(
            "aria-label",
            hasAvailableSpellUpgrade ? "Upgrade spells" : "View spell levels"
        );
    }

    function validateSpellCooldownHud() {
        if (!fireballCooldownRing || !fireballCooldownRingOutline || !fireballCooldownRingArc) {
            throw new Error("Wizard of Flatland spell cooldown ring DOM is missing");
        }
    }

    function setSpellCooldownRingProgress(ratio) {
        const progress = Number(ratio);
        if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
            throw new Error("Wizard of Flatland spell cooldown ring requires a normalized progress");
        }
        const dashOffset = SPELL_COOLDOWN_RING_CIRCUMFERENCE * (1 - progress);
        for (const circle of [fireballCooldownRingOutline, fireballCooldownRingArc]) {
            circle.style.strokeDasharray = `${SPELL_COOLDOWN_RING_CIRCUMFERENCE}`;
            circle.style.strokeDashoffset = `${dashOffset}`;
        }
    }

    function updateSpellCooldownHud() {
        validateSpellCooldownHud();
        if (!Number.isFinite(state.spellCooldownRemaining)) {
            throw new Error("Wizard of Flatland spell cooldown HUD requires finite remaining time");
        }
        if (state.spellCooldownRemaining <= 0) {
            state.spellCooldownRemaining = 0;
            state.spellCooldownDuration = 0;
            if (spellCooldownHudVisible === false && spellCooldownHudProgress === 0) return;
            setSpellCooldownRingProgress(0);
            fireballCooldownRing.classList.add("hidden");
            spellCooldownHudVisible = false;
            spellCooldownHudProgress = 0;
            return;
        }
        if (!(state.spellCooldownDuration > 0)) {
            throw new Error("Wizard of Flatland spell cooldown HUD requires a positive duration while cooling down");
        }
        const ratio = Math.max(0, Math.min(1, state.spellCooldownRemaining / state.spellCooldownDuration));
        if (spellCooldownHudVisible !== true) {
            fireballCooldownRing.classList.remove("hidden");
        }
        if (spellCooldownHudVisible !== true || Math.abs(ratio - spellCooldownHudProgress) > 0.0001) {
            setSpellCooldownRingProgress(ratio);
        }
        spellCooldownHudVisible = true;
        spellCooldownHudProgress = ratio;
    }

    function setWizardSpellLevel(spellId, level) {
        if (typeof spellId !== "string") return 0;
        const id = spellId.trim().toLowerCase();
        if (!id) return 0;
        const nextLevel = clampSpellLevel(level);
        normalizeWizardSpellLevels()[id] = nextLevel;
        spellLevelPanelSystem.renderSpellLevelPanel();
        return nextLevel;
    }

    function setSelectedSpell(spellId) {
        const id = typeof spellId === "string" ? spellId.trim().toLowerCase() : "";
        if (!isSelectableSpellId(id)) {
            throw new Error(`Wizard of Flatland cannot select unknown spell: ${spellId}`);
        }
        if (getWizardSpellLevel(id) < 1) return false;
        state.selectedSpell = id;
        updateSelectedSpellHud();
        refreshSpellLevelPanel();
        return true;
    }

    function updateSelectedSpellHud() {
        if (!spellStatusIconImage) throw new Error("Wizard of Flatland selected spell HUD icon is missing");
        if (state.selectedSpell === "fireball") {
            spellStatusIconImage.src = FIREBALL_ICON_PATH;
            return;
        }
        if (state.selectedSpell === "spikes") {
            spellStatusIconImage.src = SPIKE_ICON_PATH;
            return;
        }
        if (state.selectedSpell === "freeze") {
            spellStatusIconImage.src = FREEZE_ICON_PATH;
            return;
        }
        throw new Error(`Wizard of Flatland selected spell HUD cannot display unknown spell: ${state.selectedSpell}`);
    }

    function getStartingSpellLevels() {
        return {
            fireball: 1,
            freeze: 0,
            spikes: 0,
            healing: 0,
            magicrecharge: 0
        };
    }

    function isSelectableSpellId(spellId) {
        return spellId === "fireball" || spellId === "freeze" || spellId === "spikes";
    }

    function getWizardOfFlatlandDebugApi() {
        if (typeof window === "undefined" || !window.WizardOfFlatlandDebug) {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/debug.js");
        }
        return window.WizardOfFlatlandDebug;
    }

    function createWizardOfFlatlandDebugState() {
        const api = getWizardOfFlatlandDebugApi();
        if (typeof api.createDebugState !== "function") {
            throw new Error("Wizard of Flatland debug.js requires createDebugState");
        }
        return api.createDebugState();
    }

    function attachWizardOfFlatlandDebugGlobals(stateRef, profilerRef) {
        const api = getWizardOfFlatlandDebugApi();
        if (typeof api.attachDebugGlobals !== "function") {
            throw new Error("Wizard of Flatland debug.js requires attachDebugGlobals");
        }
        return api.attachDebugGlobals(stateRef, profilerRef);
    }

    function normalizeStartupPlayerName(name) {
        return String(name || "").trim();
    }

    function validateStartupPlayerName(name, context) {
        const normalized = normalizeStartupPlayerName(name);
        if (normalized.length === 0) {
            throw new Error(`Wizard of Flatland ${context} requires a player name`);
        }
        return normalized;
    }

    function getWizardCheckpointStorageKeyForPlayer(name) {
        const playerName = validateStartupPlayerName(name, "checkpoint slot");
        return `${TALISMAN_STORAGE_KEY_PREFIX}${encodeURIComponent(playerName)}`;
    }

    function parseWizardCheckpointSaveIndex(text) {
        if (text === null) return [];
        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            throw new Error(`Wizard of Flatland checkpoint index is invalid JSON: ${error.message}`);
        }
        if (!Array.isArray(parsed)) {
            throw new Error("Wizard of Flatland checkpoint index must be an array");
        }
        return parsed.map((name) => validateStartupPlayerName(name, "checkpoint index entry"));
    }

    async function migrateLegacyWizardCheckpoints() {
        const storage = getWizardCheckpointStorage();
        const legacyNames = parseWizardCheckpointSaveIndex(storage.getItem(TALISMAN_SAVE_INDEX_KEY));
        if (legacyNames.length === 0) return 0;
        const existingNames = new Set((await saveStore.listSaves()).map((save) => save.playerName));
        let migrated = 0;
        for (const name of legacyNames) {
            const key = getWizardCheckpointStorageKeyForPlayer(name);
            if (!existingNames.has(name)) {
                const text = storage.getItem(key);
                if (text === null) continue;
                const snapshot = parseWizardCheckpointSnapshot(text);
                snapshot.playerName = name;
                await saveStore.putSave(snapshot, []);
                migrated++;
            }
            storage.removeItem(key);
        }
        storage.removeItem(TALISMAN_SAVE_INDEX_KEY);
        return migrated;
    }

    async function getWizardCheckpointSaveEntries() {
        const saves = await saveStore.listSaves();
        return saves.map((snapshot) => {
            const name = validateStartupPlayerName(snapshot.playerName, "save index entry");
            return {
                name,
                savedAt: typeof snapshot.savedAt === "string" ? snapshot.savedAt : "",
                seed: snapshot.maze && typeof snapshot.maze.seed === "string" ? snapshot.maze.seed : ""
            };
        }).sort((a, b) => {
            if (a.savedAt && b.savedAt && a.savedAt !== b.savedAt) return b.savedAt.localeCompare(a.savedAt);
            return a.name.localeCompare(b.name);
        });
    }

    function setStartupValidation(element, message) {
        if (!element) return;
        element.textContent = String(message || "");
        element.classList.toggle("hidden", !message);
    }

    function setStartupView(view) {
        if (!startupModeView || !startupNewForm || !startupLoadForm) {
            throw new Error("Wizard of Flatland startup menu is missing required views");
        }
        startupModeView.classList.toggle("hidden", view !== "mode");
        startupNewForm.classList.toggle("hidden", view !== "new");
        startupLoadForm.classList.toggle("hidden", view !== "load");
        setStartupValidation(startupNewValidation, "");
        setStartupValidation(startupLoadValidation, "");
        if (view === "new" && startupNewNameInput) startupNewNameInput.focus();
        if (view === "load") void refreshStartupSaveNameOptions().catch(showStartupPersistenceError);
    }

    async function refreshStartupSaveNameOptions() {
        if (!startupLoadList || !startupLoadEmpty || !startupLoadSubmitButton) {
            throw new Error("Wizard of Flatland load menu is missing required elements");
        }
        const entries = await getWizardCheckpointSaveEntries();
        const selectedNameIsValid = entries.some((entry) => entry.name === state.startupSelectedLoadName);
        if (!selectedNameIsValid) state.startupSelectedLoadName = entries.length > 0 ? entries[0].name : "";
        const saveButtons = [];
        for (const entry of entries) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "startupLoadSaveButton";
            button.setAttribute("role", "option");
            button.setAttribute("aria-selected", entry.name === state.startupSelectedLoadName ? "true" : "false");
            button.classList.toggle("selected", entry.name === state.startupSelectedLoadName);
            button.dataset.saveName = entry.name;

            const nameElement = document.createElement("div");
            nameElement.className = "startupLoadSaveName";
            nameElement.textContent = entry.name;
            const metaElement = document.createElement("div");
            metaElement.className = "startupLoadSaveMeta";
            metaElement.textContent = formatStartupSaveMeta(entry);
            button.append(nameElement, metaElement);
            button.addEventListener("click", () => {
                state.startupSelectedLoadName = entry.name;
                setStartupValidation(startupLoadValidation, "");
                void refreshStartupSaveNameOptions().catch(showStartupPersistenceError);
            });
            saveButtons.push(button);
        }
        startupLoadList.replaceChildren(...saveButtons);
        startupLoadEmpty.classList.toggle("hidden", entries.length > 0);
        startupLoadSubmitButton.disabled = entries.length === 0;
    }

    function showStartupPersistenceError(error) {
        const message = error && error.message ? error.message : String(error);
        setStartupValidation(startupLoadValidation, message);
        console.error("[wizard of flatland saves]", error);
    }

    function formatStartupSaveMeta(entry) {
        const parts = [];
        if (entry.savedAt) parts.push(new Date(entry.savedAt).toLocaleString());
        if (entry.seed) parts.push(`seed ${entry.seed}`);
        return parts.length > 0 ? parts.join(" | ") : "talisman checkpoint";
    }

    function closeStartupMenu() {
        if (!startupMenu) {
            throw new Error("Wizard of Flatland startup menu is missing");
        }
        if (state.initialSpellChoiceRequired) {
            throw new Error("Wizard of Flatland cannot start a new game before choosing a first spell");
        }
        const shouldStartLoop = !state.gameStarted;
        startupMenu.classList.remove("choosingInitialSpell");
        spellLevelPanel.classList.remove("initialSpellChoice");
        startupMenu.classList.add("hidden");
        state.startupMenuOpen = false;
        state.gameStarted = true;
        state.lastTime = performance.now();
        if (shouldStartLoop) requestAnimationFrame(tick);
    }

    async function startNewWizardGame(playerName) {
        const normalizedName = validateStartupPlayerName(playerName, "new game");
        state.playerName = normalizedName;
        state.mazeSeed = normalizedName;
        if (mazeSeedInput) mazeSeedInput.value = normalizedName;
        await saveStore.deleteSave(normalizedName);
        state.spellLevels = Object.fromEntries(
            Object.keys(getStartingSpellLevels()).map((spellId) => [spellId, 0])
        );
        state.selectedSpell = "fireball";
        updateControlLabels();
        createScenario();
        state.wizardVitals.health = WIZARD_NEW_GAME_STARTING_HEALTH;
        state.levelPoints = 1;
        updateStatusBars();
        updateStats();
        state.initialSpellChoiceRequired = true;
        startupMenu.classList.add("choosingInitialSpell");
        spellLevelPanel.classList.add("initialSpellChoice");
        showSpellLevelPanel();
        console.log("Wizard of Flatland new game awaiting first spell choice", { playerName: normalizedName, seed: getMazeSeed() });
    }

    async function loadWizardGame(playerName) {
        const normalizedName = validateStartupPlayerName(playerName, "load game");
        const snapshot = await saveStore.getSave(normalizedName);
        if (!snapshot) {
            throw new Error(`No talisman checkpoint save exists for "${normalizedName}"`);
        }
        state.playerName = normalizedName;
        validateWizardCheckpointSnapshot(snapshot);
        if (typeof snapshot.playerName === "string" && snapshot.playerName !== normalizedName) {
            throw new Error(`Saved checkpoint belongs to "${snapshot.playerName}", not "${normalizedName}"`);
        }
        const sectionRecords = await saveStore.getSections(normalizedName);
        state.sectionSnapshotsByKey = new Map(sectionRecords.map((record) => {
            validateMazeSectionSnapshot(record, record.sectionKey);
            return [record.sectionKey, record];
        }));
        state.restoredSectionSnapshotKeys = new Set();
        applyWizardCheckpointSnapshot(snapshot);
        updateStats();
        closeStartupMenu();
        console.log("Wizard of Flatland game loaded", { playerName: normalizedName, checkpoint: snapshot });
    }

    async function setupStartupMenu() {
        if (!startupMenu) {
            throw new Error("Wizard of Flatland startup menu is missing");
        }
        await migrateLegacyWizardCheckpoints();
        await refreshStartupSaveNameOptions();
        setStartupView("mode");
        if (startupNewButton) startupNewButton.addEventListener("click", () => setStartupView("new"));
        if (startupLoadButton) startupLoadButton.addEventListener("click", () => {
            setStartupView("load");
        });
        if (startupNewBackButton) startupNewBackButton.addEventListener("click", () => setStartupView("mode"));
        if (startupLoadBackButton) startupLoadBackButton.addEventListener("click", () => setStartupView("mode"));
        if (startupNewNameInput) startupNewNameInput.addEventListener("input", () => setStartupValidation(startupNewValidation, ""));
        if (startupNewForm) startupNewForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                await startNewWizardGame(startupNewNameInput ? startupNewNameInput.value : "");
            } catch (error) {
                setStartupValidation(startupNewValidation, error && error.message ? error.message : String(error));
            }
        });
        if (startupLoadForm) startupLoadForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                await loadWizardGame(state.startupSelectedLoadName);
            } catch (error) {
                setStartupValidation(startupLoadValidation, error && error.message ? error.message : String(error));
            }
        });
    }

    function isUsableWallSegment(ax, ay, bx, by) {
        if (Math.hypot(bx - ax, by - ay) <= 0.001) return null;
        return true;
    }

    function getMazeStartPoint() {
        const talismanCenter = mazeSectionCenter(0, 0, getMazeOptions());
        return {
            x: talismanCenter.x,
            y: talismanCenter.y + TALISMAN_INITIAL_WIZARD_DISTANCE
        };
    }

    function rememberVisitedMazeSections(sectionKeys) {
        if (!(state.visitedMazeSectionKeys instanceof Set)) {
            throw new Error("Wizard of Flatland visited section tracking is missing");
        }
        if (!sectionKeys || typeof sectionKeys[Symbol.iterator] !== "function") {
            throw new Error("Wizard of Flatland visited section update requires iterable section keys");
        }
        for (const sectionKey of sectionKeys) {
            if (typeof sectionKey !== "string" || sectionKey.length === 0) {
                throw new Error("Wizard of Flatland visited section update received invalid section key");
            }
            state.visitedMazeSectionKeys.add(sectionKey);
        }
    }

    function getRequiredMazeSectionKeys(options) {
        const current = worldToMazeSectionCoord(state.target.x, state.target.y, options);
        const currentKey = mazeSectionKey(current.q, current.r);
        const keys = [currentKey];
        const viewportKeys = computeMazeViewportSectionKeys(options);
        for (const key of viewportKeys) {
            if (!keys.includes(key)) keys.push(key);
        }
        const neighbors = [];
        for (let i = 0; i < MAZE_SECTION_DIRECTIONS.length; i++) {
            const dir = MAZE_SECTION_DIRECTIONS[i];
            const q = current.q + dir.q;
            const r = current.r + dir.r;
            const center = mazeSectionCenter(q, r, options);
            neighbors.push({
                key: mazeSectionKey(q, r),
                distance: Math.hypot(center.x - state.target.x, center.y - state.target.y)
            });
        }
        neighbors.sort((a, b) => a.distance - b.distance);
        for (const entry of neighbors.slice(0, MAZE_SECTION_NEARBY_LOAD_COUNT)) {
            if (!keys.includes(entry.key)) keys.push(entry.key);
        }
        const lookaheadKeys = getMazeLookaheadSectionKeys(options);
        for (const key of lookaheadKeys) {
            if (keys.length >= MAZE_SECTION_CACHE_LIMIT) break;
            if (!keys.includes(key)) keys.push(key);
        }
        return keys;
    }

    function computeMazeViewportSectionKeys(options) {
        const rect = getCurrentMazeViewportRect();
        if (!rect) return [];
        return computeMazeSectionKeysIntersectingRect(options, rect);
    }

    function getMazeLookaheadSectionKeys(options) {
        const now = performance.now();
        if (Array.isArray(state.generatedMazeLookaheadKeys) && now < state.generatedMazeLookaheadNextRefreshAt) {
            return state.generatedMazeLookaheadKeys;
        }
        const keys = computeMazeLookaheadSectionKeys(options);
        state.generatedMazeLookaheadKeys = keys;
        state.generatedMazeLookaheadNextRefreshAt = now + MAZE_LOOKAHEAD_REFRESH_INTERVAL_MS;
        return keys;
    }

    function computeMazeLookaheadSectionKeys(options) {
        const rect = getProjectedMazeViewportRect();
        if (!rect) return [];
        return computeMazeSectionKeysIntersectingRect(options, rect);
    }

    function computeMazeSectionKeysIntersectingRect(options, rect) {
        const center = {
            x: (rect.minX + rect.maxX) * 0.5,
            y: (rect.minY + rect.maxY) * 0.5
        };
        const centerCoord = worldToMazeSectionCoord(center.x, center.y, options);
        const sectionRadius = getMazeSectionRadius(options);
        const halfDiagonal = Math.hypot(rect.maxX - rect.minX, rect.maxY - rect.minY) * 0.5;
        const searchRadius = Math.max(1, Math.ceil((halfDiagonal + sectionRadius) / sectionRadius) + 1);
        const hits = [];
        for (let dq = -searchRadius; dq <= searchRadius; dq++) {
            for (let dr = -searchRadius; dr <= searchRadius; dr++) {
                const q = centerCoord.q + dq;
                const r = centerCoord.r + dr;
                const sectionCenter = mazeSectionCenter(q, r, options);
                const polygon = getHexCornersWorld(sectionCenter.x, sectionCenter.y, sectionRadius);
                if (!polygonIntersectsAxisAlignedRect(polygon, rect)) continue;
                hits.push({
                    key: mazeSectionKey(q, r),
                    distance: Math.hypot(sectionCenter.x - state.target.x, sectionCenter.y - state.target.y)
                });
            }
        }
        hits.sort((a, b) => a.distance - b.distance);
        return hits.map((entry) => entry.key);
    }

    function getCurrentMazeViewportRect() {
        const view = state.view;
        if (!view || !(view.width > 0 && view.height > 0 && view.scale > 0)) return null;
        const halfWidth = view.width / view.scale * 0.5;
        const halfHeight = view.height / view.scale * 0.5;
        return {
            minX: state.target.x - halfWidth,
            minY: state.target.y - halfHeight,
            maxX: state.target.x + halfWidth,
            maxY: state.target.y + halfHeight
        };
    }

    function getProjectedMazeViewportRect() {
        const view = state.view;
        if (!view || !(view.width > 0 && view.height > 0 && view.scale > 0)) return null;
        const dx = Math.cos(state.target.heading) * MAZE_LOOKAHEAD_DISTANCE;
        const dy = Math.sin(state.target.heading) * MAZE_LOOKAHEAD_DISTANCE;
        const halfWidth = view.width / view.scale * 0.5;
        const halfHeight = view.height / view.scale * 0.5;
        return {
            minX: state.target.x + dx - halfWidth,
            minY: state.target.y + dy - halfHeight,
            maxX: state.target.x + dx + halfWidth,
            maxY: state.target.y + dy + halfHeight
        };
    }

    function invalidateMazeLookaheadCache() {
        state.generatedMazeLookaheadKeys = [];
        state.generatedMazeLookaheadNextRefreshAt = 0;
    }

    function polygonIntersectsAxisAlignedRect(polygon, rect) {
        if (!Array.isArray(polygon) || polygon.length < 3) {
            throw new Error("Wizard of Flatland maze lookahead requires a section polygon");
        }
        if (!rect || !Number.isFinite(rect.minX) || !Number.isFinite(rect.minY) || !Number.isFinite(rect.maxX) || !Number.isFinite(rect.maxY)) {
            throw new Error("Wizard of Flatland maze lookahead requires a finite viewport rectangle");
        }
        for (const point of polygon) {
            if (point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY) return true;
        }
        const corners = [
            { x: rect.minX, y: rect.minY },
            { x: rect.maxX, y: rect.minY },
            { x: rect.maxX, y: rect.maxY },
            { x: rect.minX, y: rect.maxY }
        ];
        for (const corner of corners) {
            if (pointInPolygon(corner.x, corner.y, polygon)) return true;
        }
        const edges = [
            [corners[0], corners[1]],
            [corners[1], corners[2]],
            [corners[2], corners[3]],
            [corners[3], corners[0]]
        ];
        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i];
            const b = polygon[(i + 1) % polygon.length];
            for (const edge of edges) {
                if (segmentIntersectionParameters(a.x, a.y, b.x, b.y, edge[0].x, edge[0].y, edge[1].x, edge[1].y)) {
                    return true;
                }
            }
        }
        return false;
    }

    function installGeneratedMazeWorkerResult(message) {
        if (!message || typeof message.signature !== "string" || !message.nodeLayer) {
            throw new Error("Wizard of Flatland maze worker result is malformed");
        }
        profiler.span("validate wall buffers", () => {
            validateWallBuffer(message.generatedWalls, "generated maze walls");
            validateWallBuffer(message.allWalls, "maze pathfinding walls");
            validateWallLabelBuffer(message.generatedWalls, "generated maze wall labels");
            validateWallLabelBuffer(message.allWalls, "maze pathfinding wall labels");
        });
        let generatedWalls = message.generatedWalls;
        let allWalls = message.allWalls;
        const manualOffset = generatedWalls.length;
        if (allWalls.length !== generatedWalls.length + state.manualWalls.length) {
            throw new Error("Wizard of Flatland maze worker wall count does not match active manual walls");
        }
        profiler.span("validate manual wall echo", () => {
            for (let i = 0; i < state.manualWalls.length; i++) {
                if (Math.abs(state.manualWalls[i] - allWalls[manualOffset + i]) > 0.0001) {
                    throw new Error("Wizard of Flatland maze worker result is stale for manual walls");
                }
            }
        });
        profiler.span("apply broken wall gaps", () => {
            if (Array.isArray(state.brokenWallGaps) && state.brokenWallGaps.length > 0) {
                generatedWalls = applyBrokenWallGapsToBuffer(generatedWalls, state.brokenWallGaps, "generated maze walls");
                allWalls = concatWallBuffers(generatedWalls, state.manualWalls);
            }
        });

        profiler.span("install wall buffers and section keys", () => {
            state.generatedMazeWalls = generatedWalls;
            state.walls = allWalls;
            state.generatedMazeSignature = message.signature;
            state.generatedMazePendingSignature = "";
            state.generatedMazeLoading = false;
            state.generatedMazeActiveRequestId = 0;
            state.generatedMazeInstalledChunkKeys = new Set(state.generatedMazeChunkKeys);
            rememberVisitedMazeSections(state.generatedMazeInstalledChunkKeys);
            state.worldVersion += 1;
            clearWallBreakTrackingForAllAgents();
        });
        profiler.span("restore wall exploration", () => {
            for (const sectionKey of state.generatedMazeInstalledChunkKeys) {
                const snapshot = state.sectionSnapshotsByKey.get(sectionKey);
                if (snapshot) explorationSystem.importWalls(snapshot.wallExploration);
            }
        });
        profiler.span("populate maze coins", () => populateGeneratedMazeCoins(getMazeOptions()));
        profiler.span("populate maze talismans", () => populateGeneratedMazeTalismans(getMazeOptions()));
        profiler.span("populate maze rooms", () => populateGeneratedMazeRooms(getMazeOptions()));
        profiler.span("install pathfinding node layer", () => {
            installPathfindingNodeLayerFromWorker(message.nodeLayer);
        });
        profiler.span("constrain target to walls", () => constrainTargetToWalls());
        profiler.span("constrain or freeze agents", () => {
            for (const agent of state.agents) {
                if (isAgentInInstalledMazeSection(agent)) {
                    constrainAgentToWalls(agent);
                } else {
                    freezeAgentForUnloadedSection(agent);
                }
            }
        });
        profiler.span("resolve target npc contacts", () => resolveTargetNpcContacts());
        setLabelText(labels.workerStatus, "ready");
        profiler.completeLoad({
            sections: state.generatedMazeInstalledChunkKeys.size,
            walls: getWallCount(state.walls),
            generatedWalls: getWallCount(state.generatedMazeWalls),
            manualWalls: getWallCount(state.manualWalls),
            nodes: getPathfindingNodeCount(),
            blockedEdges: getPathfindingBlockedEdgeCount()
        });
    }

    function clearAgentPathRequestsForMapRebuild() {
        for (const agent of state.agents) {
            agent.pathMode = PATH_MODE_DIRECT;
            agent.pathRequestPending = false;
            agent.pathRequestId = 0;
            agent.pathRequestedWorldVersion = 0;
            agent.pathRequestedRawStartKey = "";
            agent.pathRequestedStartKey = "";
            agent.pathRequestedGoalKey = "";
            agent.pathNodeKeys = [];
            agent.pathWaypoints = [];
            agent.pathCursor = 0;
            agent.pathGoalX = agent.x;
            agent.pathGoalY = agent.y;
            agent.pathGoalWallBlocked = false;
            agent.wallBreakTargetEdgeKey = "";
            agent.wallBreakTargetWallIndex = -1;
            agent.wallBreakDamageByEdge = new Map();
        }
    }

    function clearWallBreakTrackingForAllAgents() {
        for (const agent of state.agents) {
            agent.wallBreakTargetEdgeKey = "";
            agent.wallBreakTargetWallIndex = -1;
            agent.wallBreakDamageByEdge = new Map();
        }
    }

    function installPathfindingNodeLayerFromWorker(workerLayer) {
        const packedNodes = workerLayer.nodes;
        const snapshotNodes = workerLayer.snapshotNodes;
        const packedEdges = workerLayer.edges;
        const packedBlockedEdges = workerLayer.blockedEdges;
        if (!(packedNodes instanceof Float32Array) || packedNodes.length % PATH_SNAPSHOT_NODE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland maze worker nodes are malformed");
        }
        if (!(snapshotNodes instanceof Float32Array) || snapshotNodes.length !== packedNodes.length) {
            throw new Error("Wizard of Flatland maze worker snapshot nodes are malformed");
        }
        if (!(packedEdges instanceof Int32Array) || packedEdges.length % PATH_SNAPSHOT_EDGE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland maze worker path edges are malformed");
        }
        if (!(packedBlockedEdges instanceof Int32Array) || packedBlockedEdges.length % PATH_SNAPSHOT_EDGE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland maze worker blocked edges are malformed");
        }

        state.nodeLayer.pathCenterX = Number(workerLayer.pathCenterX);
        state.nodeLayer.pathCenterY = Number(workerLayer.pathCenterY);
        if (!Number.isFinite(state.nodeLayer.pathCenterX) || !Number.isFinite(state.nodeLayer.pathCenterY)) {
            throw new Error("Wizard of Flatland maze worker path center is invalid");
        }
        state.nodeLayer.nodes = packedNodes;
        state.nodeLayer.snapshotNodes = snapshotNodes;
        state.nodeLayer.edges = packedEdges;
        state.nodeLayer.blockedEdges = packedBlockedEdges;
        state.nodeLayer.indexByKey = buildPathfindingNodeIndexByKey(packedNodes);
        applyTemporaryPathfindingModifiersToNodes();
        state.nodeLayer.nodeStride = PATH_SNAPSHOT_NODE_STRIDE;
        state.nodeLayer.edgeStride = PATH_SNAPSHOT_EDGE_STRIDE;
        state.nodeLayer.version += 1;
        state.nodeLayer.targetNodeCache = null;
        state.nodeLayer.dirty = true;
        profiler.span("publish pathfinding snapshot", () => publishPathfindingSnapshot());
    }

    function buildPathfindingNodeIndexByKey(packedNodes) {
        if (!(packedNodes instanceof Float32Array) || packedNodes.length % PATH_SNAPSHOT_NODE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland path node key index requires packed nodes");
        }
        const indexByKey = new Map();
        const count = packedNodes.length / PATH_SNAPSHOT_NODE_STRIDE;
        for (let pathIndex = 0; pathIndex < count; pathIndex++) {
            const base = pathIndex * PATH_SNAPSHOT_NODE_STRIDE;
            if (!Number.isFinite(packedNodes[base + PATH_NODE_XINDEX]) || !Number.isFinite(packedNodes[base + PATH_NODE_YINDEX])) {
                throw new Error(`Wizard of Flatland path node key index found invalid node coordinates at index ${pathIndex}`);
            }
            const xindex = Math.round(packedNodes[base + PATH_NODE_XINDEX]);
            const yindex = Math.round(packedNodes[base + PATH_NODE_YINDEX]);
            const key = pathfindingNodeKey(xindex, yindex);
            if (indexByKey.has(key)) {
                throw new Error(`Wizard of Flatland path node key index found duplicate node key ${key}`);
            }
            indexByKey.set(key, pathIndex);
        }
        return indexByKey;
    }

    function removeFurthestGeneratedMazeSection(options, protectedKeys) {
        let furthest = null;
        for (const key of state.generatedMazeChunkKeys) {
            if (protectedKeys.has(key)) continue;
            const coord = parseMazeSectionKey(key);
            const center = mazeSectionCenter(coord.q, coord.r, options);
            const distance = Math.hypot(center.x - state.target.x, center.y - state.target.y);
            if (!furthest || distance > furthest.distance) furthest = { key, distance };
        }
        if (!furthest) return false;
        captureMazeSectionSnapshot(furthest.key);
        state.generatedMazeChunkKeys.delete(furthest.key);
        freezeAgentsInMazeSection(furthest.key, options);
        return true;
    }

    function getSavedSectionWallOverrides(sectionKeys) {
        if (!Array.isArray(sectionKeys)) throw new Error("Wizard of Flatland saved wall override lookup requires section keys");
        if (!(state.sectionSnapshotsByKey instanceof Map)) {
            throw new Error("Wizard of Flatland saved wall override lookup requires section snapshots");
        }
        const overrides = [];
        for (const sectionKey of sectionKeys) {
            const snapshot = state.sectionSnapshotsByKey.get(sectionKey);
            if (!snapshot) continue;
            validateMazeSectionSnapshot(snapshot, sectionKey);
            overrides.push({ sectionKey, walls: snapshot.walls.slice() });
        }
        return overrides;
    }

    function getWallsOwnedByMazeSection(sectionKey, options = getMazeOptions()) {
        validateMazeRoomEnemyBudgetSectionKey(sectionKey);
        validateWallBuffer(state.walls, "section snapshot walls");
        const values = [];
        for (let base = 0; base < state.walls.length; base += WALL_STRIDE) {
            const midpointX = (state.walls[base + WALL_X1] + state.walls[base + WALL_X2]) * 0.5;
            const midpointY = (state.walls[base + WALL_Y1] + state.walls[base + WALL_Y2]) * 0.5;
            const coord = worldToMazeSectionCoord(midpointX, midpointY, options);
            if (mazeSectionKey(coord.q, coord.r) !== sectionKey) continue;
            for (let field = 0; field < WALL_STRIDE; field++) values.push(state.walls[base + field]);
        }
        return Float32Array.from(values);
    }

    function captureMazeSectionSnapshot(sectionKey) {
        if (!(state.generatedMazeInstalledChunkKeys instanceof Set) || !state.generatedMazeInstalledChunkKeys.has(sectionKey)) {
            throw new Error(`Wizard of Flatland cannot snapshot unloaded section ${sectionKey}`);
        }
        const walls = getWallsOwnedByMazeSection(sectionKey);
        const coins = state.coins
            .filter((coin) => coin.sectionKey === sectionKey)
            .map((coin) => ({ ...coin }));
        const enemies = state.agents
            .filter((agent) => getActorMazeSectionKey(agent) === sectionKey)
            .map((agent) => createAgentCheckpointSnapshot(agent, sectionKey, getAgentHomeSectionKey(agent)));
        const previous = state.sectionSnapshotsByKey.get(sectionKey);
        const snapshot = {
            version: 1,
            playerName: validateStartupPlayerName(state.playerName, "section snapshot"),
            sectionKey,
            revision: previous ? previous.revision + 1 : 1,
            savedAt: new Date().toISOString(),
            walls,
            wallExploration: explorationSystem.exportWalls(walls, explorationWallLayout),
            coins,
            enemies,
            obstacles: [],
            constructs: [],
            scenery: []
        };
        validateMazeSectionSnapshot(snapshot, sectionKey);
        state.sectionSnapshotsByKey.set(sectionKey, snapshot);
        state.restoredSectionSnapshotKeys.add(sectionKey);
        return snapshot;
    }

    function captureActiveMazeSectionSnapshots() {
        if (!(state.generatedMazeInstalledChunkKeys instanceof Set)) {
            throw new Error("Wizard of Flatland active section snapshot requires installed sections");
        }
        for (const sectionKey of state.generatedMazeInstalledChunkKeys) captureMazeSectionSnapshot(sectionKey);
        return Array.from(state.sectionSnapshotsByKey.values());
    }

    function validateMazeSectionSnapshot(snapshot, expectedSectionKey = snapshot && snapshot.sectionKey) {
        if (!snapshot || snapshot.version !== 1) throw new Error("Wizard of Flatland section snapshot version is unsupported");
        if (snapshot.sectionKey !== expectedSectionKey) {
            throw new Error(`Wizard of Flatland section snapshot key mismatch: expected ${expectedSectionKey}, got ${snapshot.sectionKey}`);
        }
        if (!(snapshot.walls instanceof Float32Array) || snapshot.walls.length % WALL_STRIDE !== 0) {
            throw new Error(`Wizard of Flatland section ${expectedSectionKey} snapshot has invalid walls`);
        }
        if (!Array.isArray(snapshot.wallExploration) || !Array.isArray(snapshot.coins) || !Array.isArray(snapshot.enemies)) {
            throw new Error(`Wizard of Flatland section ${expectedSectionKey} snapshot arrays are malformed`);
        }
        for (const collection of ["obstacles", "constructs", "scenery"]) {
            if (!Array.isArray(snapshot[collection])) {
                throw new Error(`Wizard of Flatland section ${expectedSectionKey} snapshot requires ${collection}`);
            }
        }
        return snapshot;
    }

    function resetGeneratedMazeCoinPopulation() {
        state.coins = [];
        state.collectedCoinKeys = new Set();
        state.collectedCoinSectionKeysByCoinKey = new Map();
        state.droppedCoinsByKey = new Map();
        state.nextDroppedCoinId = 1;
    }

    function populateGeneratedMazeCoins(options) {
        if (!isProceduralMazeScenario()) {
            state.coins = getVisibleDroppedMazeCoins(options);
            validateVisibleMazeCoinKeysAreUnique("maze coin population", state.coins);
            return;
        }
        if (!(state.generatedMazeInstalledChunkKeys instanceof Set)) {
            throw new Error("Wizard of Flatland coin population requires installed section tracking");
        }
        if (!(state.collectedCoinKeys instanceof Set)) {
            throw new Error("Wizard of Flatland coin population requires collected coin tracking");
        }
        if (!(state.droppedCoinsByKey instanceof Map)) {
            throw new Error("Wizard of Flatland coin population requires dropped coin tracking");
        }
        validateWallBuffer(state.generatedMazeWalls, "generated maze coin placement walls");
        validateWallBuffer(state.walls, "coin placement walls");
        const diagnosticBefore = captureMazeCoinDiagnosticSnapshot("before-populate", options);
        const placedCoins = [];
        const keys = Array.from(state.generatedMazeInstalledChunkKeys).sort();
        for (const sectionKey of keys) {
            const snapshot = state.sectionSnapshotsByKey.get(sectionKey);
            if (snapshot) {
                validateMazeSectionSnapshot(snapshot, sectionKey);
                placedCoins.push(...snapshot.coins.map((coin) => ({ ...coin })));
            } else {
                placedCoins.push(...createMazeCoinsForSection(sectionKey, options, placedCoins));
            }
        }
        const existingCoinsByKey = new Map(state.coins.map((coin) => [coin.key, coin]));
        const placedCoinKeys = new Set(placedCoins.map((coin) => coin.key));
        const visiblePlacedCoins = placedCoins
            .filter((coin) => !state.collectedCoinKeys.has(coin.key))
            .map((coin) => preserveVisibleMazeCoinState(coin, existingCoinsByKey.get(coin.key)));
        const visibleDroppedCoins = excludeDroppedCoinsRestoredBySectionSnapshots(
            getVisibleDroppedMazeCoins(options, existingCoinsByKey),
            placedCoinKeys
        );
        const visibleDroppedCoinKeys = new Set(visibleDroppedCoins.map((coin) => coin.key));
        const retainedEdgeCoins = state.coins.filter((coin) => {
            validateCoin(coin);
            return !placedCoinKeys.has(coin.key) &&
                !visibleDroppedCoinKeys.has(coin.key) &&
                !state.collectedCoinKeys.has(coin.key) &&
                isPointInAnyInstalledMazeSection(coin.homeX, coin.homeY, options);
        });
        state.coins = visiblePlacedCoins.concat(visibleDroppedCoins, retainedEdgeCoins);
        validateVisibleMazeCoinKeysAreUnique("maze coin population", state.coins);
        recordMazeCoinPopulationDiagnostic(diagnosticBefore, options, {
            placedCoins,
            visiblePlacedCoins,
            visibleDroppedCoins,
            retainedEdgeCoins
        });
    }

    function excludeDroppedCoinsRestoredBySectionSnapshots(droppedCoins, restoredCoinKeys) {
        if (!Array.isArray(droppedCoins)) {
            throw new Error("Wizard of Flatland dropped coin reconciliation requires dropped coins");
        }
        if (!(restoredCoinKeys instanceof Set)) {
            throw new Error("Wizard of Flatland dropped coin reconciliation requires restored coin keys");
        }
        return droppedCoins.filter((coin) => {
            if (!coin || typeof coin.key !== "string" || coin.key.length === 0) {
                throw new Error("Wizard of Flatland dropped coin reconciliation found an invalid coin");
            }
            return !restoredCoinKeys.has(coin.key);
        });
    }

    function getVisibleDroppedMazeCoins(options = getMazeOptions(), existingCoinsByKey = new Map()) {
        if (!(state.collectedCoinKeys instanceof Set)) {
            throw new Error("Wizard of Flatland dropped coin visibility requires collected coin tracking");
        }
        if (!(state.droppedCoinsByKey instanceof Map)) {
            throw new Error("Wizard of Flatland dropped coin visibility requires dropped coin tracking");
        }
        if (!(existingCoinsByKey instanceof Map)) {
            throw new Error("Wizard of Flatland dropped coin visibility requires existing coin lookup");
        }
        const visible = [];
        for (const coin of state.droppedCoinsByKey.values()) {
            validateCoin(coin);
            if (state.collectedCoinKeys.has(coin.key)) continue;
            if (isProceduralMazeScenario() && !isDroppedCoinInInstalledMazeSection(coin, options)) continue;
            const previousCoin = existingCoinsByKey.get(coin.key);
            if (previousCoin) {
                validateCoin(previousCoin);
                coin.x = previousCoin.x;
                coin.y = previousCoin.y;
                coin.rushing = previousCoin.rushing === true;
                coin.phase = previousCoin.phase;
            }
            visible.push(coin);
        }
        return visible;
    }

    function isDroppedCoinInInstalledMazeSection(coin, options) {
        validateCoin(coin);
        if (!(state.generatedMazeInstalledChunkKeys instanceof Set) || !(state.generatedMazeChunkKeys instanceof Set)) {
            throw new Error("Wizard of Flatland dropped coin section visibility requires installed section tracking");
        }
        const coord = worldToMazeSectionCoord(coin.homeX, coin.homeY, options);
        const sectionKey = mazeSectionKey(coord.q, coord.r);
        if (coin.sectionKey !== sectionKey) {
            throw new Error(`Wizard of Flatland dropped coin ${coin.key} section key does not match its world position`);
        }
        return state.generatedMazeInstalledChunkKeys.has(sectionKey) && state.generatedMazeChunkKeys.has(sectionKey);
    }

    function addVisibleMazeCoin(coin, context) {
        validateCoin(coin);
        if (!Array.isArray(state.coins)) {
            throw new Error(`Wizard of Flatland ${context} requires a visible coin list`);
        }
        if (state.collectedCoinKeys instanceof Set && state.collectedCoinKeys.has(coin.key)) {
            throw new Error(`Wizard of Flatland ${context} tried to show collected coin ${coin.key}`);
        }
        for (const visibleCoin of state.coins) {
            validateCoin(visibleCoin);
            if (visibleCoin.key === coin.key) {
                throw new Error(`Wizard of Flatland ${context} duplicated visible coin ${coin.key}`);
            }
        }
        state.coins.push(coin);
    }

    function validateVisibleMazeCoinKeysAreUnique(context, coins = state.coins) {
        if (!Array.isArray(coins)) {
            throw new Error(`Wizard of Flatland ${context} requires a visible coin list`);
        }
        const seen = new Set();
        for (const coin of coins) {
            validateCoin(coin);
            if (seen.has(coin.key)) {
                throw new Error(`Wizard of Flatland ${context} duplicated visible coin ${coin.key}`);
            }
            seen.add(coin.key);
        }
    }

    function isMazeCoinDiagnosticsEnabled() {
        return !!(state.debug && state.debug.coinDiagnosticsEnabled);
    }

    function captureMazeCoinDiagnosticSnapshot(stage, options) {
        if (!isMazeCoinDiagnosticsEnabled()) return null;
        return createMazeCoinDiagnosticSnapshot(stage, options, state.coins);
    }

    function createMazeCoinDiagnosticSnapshot(stage, options, coins) {
        if (!Array.isArray(coins)) {
            throw new Error("Wizard of Flatland coin diagnostics require a coin array");
        }
        const installedKeys = state.generatedMazeInstalledChunkKeys instanceof Set
            ? Array.from(state.generatedMazeInstalledChunkKeys).sort()
            : [];
        const chunkKeys = state.generatedMazeChunkKeys instanceof Set
            ? Array.from(state.generatedMazeChunkKeys).sort()
            : [];
        const collectedKeys = state.collectedCoinKeys instanceof Set
            ? Array.from(state.collectedCoinKeys).sort()
            : [];
        return {
            stage,
            at: performance.now(),
            signature: state.generatedMazeSignature,
            pendingSignature: state.generatedMazePendingSignature,
            worldVersion: state.worldVersion,
            installedKeys,
            chunkKeys,
            collectedCount: collectedKeys.length,
            target: { x: state.target.x, y: state.target.y },
            coins: coins.map((coin) => createMazeCoinDiagnosticEntry(coin, options))
        };
    }

    function createMazeCoinDiagnosticEntry(coin, options) {
        validateCoin(coin);
        const homeCoord = worldToMazeSectionCoord(coin.homeX, coin.homeY, options);
        return {
            key: coin.key,
            sectionKey: coin.sectionKey,
            homeSectionKey: mazeSectionKey(homeCoord.q, homeCoord.r),
            kind: coin.kind,
            value: coin.value,
            wallIndex: coin.wallIndex,
            x: roundDiagnosticNumber(coin.x),
            y: roundDiagnosticNumber(coin.y),
            homeX: roundDiagnosticNumber(coin.homeX),
            homeY: roundDiagnosticNumber(coin.homeY),
            rushing: coin.rushing === true,
            targetDistance: roundDiagnosticNumber(Math.hypot(coin.x - state.target.x, coin.y - state.target.y))
        };
    }

    function recordMazeCoinPopulationDiagnostic(before, options, details) {
        if (!isMazeCoinDiagnosticsEnabled()) return;
        const after = createMazeCoinDiagnosticSnapshot("after-populate", options, state.coins);
        const placed = Array.isArray(details && details.placedCoins) ? details.placedCoins : [];
        const visiblePlaced = Array.isArray(details && details.visiblePlacedCoins) ? details.visiblePlacedCoins : [];
        const retainedEdge = Array.isArray(details && details.retainedEdgeCoins) ? details.retainedEdgeCoins : [];
        const changes = diffMazeCoinDiagnosticSnapshots(before, after);
        const record = {
            at: after.at,
            signature: after.signature,
            pendingSignature: after.pendingSignature,
            worldVersion: after.worldVersion,
            before,
            after,
            counts: {
                before: before ? before.coins.length : 0,
                after: after.coins.length,
                placed: placed.length,
                visiblePlaced: visiblePlaced.length,
                retainedEdge: retainedEdge.length,
                collected: after.collectedCount
            },
            changes
        };
        pushMazeCoinDiagnosticRecord(record);
        if (changes.appeared.length > 0 || changes.disappeared.length > 0 || changes.homeMoved.length > 0) {
            logMazeCoinDiagnosticRecord(record);
        }
    }

    function diffMazeCoinDiagnosticSnapshots(before, after) {
        const beforeByKey = new Map((before ? before.coins : []).map((coin) => [coin.key, coin]));
        const afterByKey = new Map(after.coins.map((coin) => [coin.key, coin]));
        const appeared = [];
        const disappeared = [];
        const homeMoved = [];
        for (const coin of after.coins) {
            const previous = beforeByKey.get(coin.key);
            if (!previous) {
                appeared.push(coin);
                continue;
            }
            const homeMoveDistance = Math.hypot(coin.homeX - previous.homeX, coin.homeY - previous.homeY);
            if (homeMoveDistance > 0.001) {
                homeMoved.push({
                    key: coin.key,
                    sectionKey: coin.sectionKey,
                    before: previous,
                    after: coin,
                    homeMoveDistance: roundDiagnosticNumber(homeMoveDistance)
                });
            }
        }
        for (const coin of beforeByKey.values()) {
            if (!afterByKey.has(coin.key)) disappeared.push(coin);
        }
        return { appeared, disappeared, homeMoved };
    }

    function pushMazeCoinDiagnosticRecord(record) {
        if (!state.debug || typeof state.debug !== "object") {
            throw new Error("Wizard of Flatland coin diagnostics require debug state");
        }
        if (!Array.isArray(state.debug.coinDiagnostics)) state.debug.coinDiagnostics = [];
        state.debug.coinDiagnostics.push(record);
        while (state.debug.coinDiagnostics.length > 40) state.debug.coinDiagnostics.shift();
    }

    function logMazeCoinDiagnosticRecord(record) {
        if (typeof console === "undefined") return;
        console.groupCollapsed(
            `Wizard of Flatland coin population changed: +${record.changes.appeared.length} `
                + `-${record.changes.disappeared.length} moved ${record.changes.homeMoved.length}`
        );
        console.log(record);
        if (record.changes.appeared.length > 0) console.table(record.changes.appeared);
        if (record.changes.disappeared.length > 0) console.table(record.changes.disappeared);
        if (record.changes.homeMoved.length > 0) {
            console.table(record.changes.homeMoved.map((entry) => ({
                key: entry.key,
                sectionKey: entry.sectionKey,
                homeMoveDistance: entry.homeMoveDistance,
                beforeHomeX: entry.before.homeX,
                beforeHomeY: entry.before.homeY,
                afterHomeX: entry.after.homeX,
                afterHomeY: entry.after.homeY,
                beforeWallIndex: entry.before.wallIndex,
                afterWallIndex: entry.after.wallIndex
            })));
        }
        console.groupEnd();
    }

    function roundDiagnosticNumber(value) {
        return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value;
    }

    function preserveVisibleMazeCoinState(coin, previousCoin) {
        if (!previousCoin) return coin;
        validateCoin(previousCoin);
        if (
            Math.abs(previousCoin.homeX - coin.homeX) > 0.001 ||
            Math.abs(previousCoin.homeY - coin.homeY) > 0.001
        ) {
            return coin;
        }
        return {
            ...coin,
            x: previousCoin.x,
            y: previousCoin.y,
            rushing: previousCoin.rushing === true,
            phase: previousCoin.phase
        };
    }

    function populateGeneratedMazeTalismans(options) {
        if (!isProceduralMazeScenario()) {
            state.talismans = [];
            return;
        }
        if (!(state.generatedMazeInstalledChunkKeys instanceof Set)) {
            throw new Error("Wizard of Flatland talisman population requires installed section tracking");
        }
        if (!(state.activatedTalismanSectionKeys instanceof Set)) {
            throw new Error("Wizard of Flatland talisman population requires activated talisman tracking");
        }
        const talismans = [];
        const keys = Array.from(state.generatedMazeInstalledChunkKeys).sort();
        const homeBaseSectionKey = getHomeBaseTalismanSectionKey();
        for (const sectionKey of keys) {
            const talisman = createMazeTalismanForSection(sectionKey, options, homeBaseSectionKey);
            if (talisman) talismans.push(talisman);
        }
        state.talismans = talismans;
    }

    function isPointInAnyInstalledMazeSection(x, y, options) {
        if (!(state.generatedMazeInstalledChunkKeys instanceof Set)) {
            throw new Error("Wizard of Flatland coin section validation requires installed section tracking");
        }
        for (const sectionKey of state.generatedMazeInstalledChunkKeys) {
            const coord = parseMazeSectionKey(sectionKey);
            const center = mazeSectionCenter(coord.q, coord.r, options);
            const polygon = getHexCornersWorld(center.x, center.y, getMazeSectionRadius(options));
            if (isPointInOrNearPolygon(x, y, polygon, MAZE_COIN_SECTION_EDGE_EPSILON)) return true;
        }
        return false;
    }

    function isPointInOrNearPolygon(x, y, polygon, epsilon) {
        if (!Array.isArray(polygon) || polygon.length < 3) {
            throw new Error("Wizard of Flatland polygon edge test requires a polygon");
        }
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(epsilon)) {
            throw new Error("Wizard of Flatland polygon edge test requires finite inputs");
        }
        if (pointInPolygon(x, y, polygon)) return true;
        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i];
            const b = polygon[(i + 1) % polygon.length];
            if (pointSegmentDistance(x, y, a.x, a.y, b.x, b.y) <= epsilon) return true;
        }
        return false;
    }

    function resetGeneratedMazeEnemyPopulation() {
        state.agents = state.agents.filter((agent) => typeof agent.autoSpawnSectionKey !== "string");
        state.generatedMazeInitialEnemySpawnBudgetsBySectionKey = new Map();
    }

    function resetGeneratedMazeTalismanState() {
        state.talismans = [];
        state.activatedTalismanSectionKeys = new Set();
        state.homeBaseTalismanSectionKey = "";
        state.visitedMazeSectionKeys = new Set();
    }

    function freezeAgentsInMazeSection(sectionKey, options) {
        for (const agent of state.agents) {
            if (getActorMazeSectionKey(agent, options) !== sectionKey) continue;
            freezeAgentForUnloadedSection(agent);
        }
    }

    function freezeAgentForUnloadedSection(agent) {
        agent.vx = 0;
        agent.vy = 0;
        agent.wallClamps = 0;
        agent.pathMode = PATH_MODE_DIRECT;
        agent.pathRequestPending = false;
        agent.pathRequestId = 0;
        agent.pathNodeKeys = [];
        agent.pathWaypoints = [];
        agent.pathCursor = 0;
        agent.pathGoalX = agent.x;
        agent.pathGoalY = agent.y;
        agent.pathGoalWallBlocked = false;
        agent.wallBreakTargetEdgeKey = "";
        agent.wallBreakTargetWallIndex = -1;
        agent.wallBreakDamageByEdge = new Map();
    }

    function getActorMazeSectionKey(actor, options = getMazeOptions()) {
        const coord = worldToMazeSectionCoord(actor.x, actor.y, options);
        return mazeSectionKey(coord.q, coord.r);
    }

    function isAgentInInstalledMazeSection(agent) {
        if (!isProceduralMazeScenario()) return true;
        if (!(state.generatedMazeInstalledChunkKeys instanceof Set)) {
            throw new Error("Wizard of Flatland procedural maze requires installed section tracking");
        }
        const sectionKey = getActorMazeSectionKey(agent);
        return state.generatedMazeInstalledChunkKeys.has(sectionKey) && state.generatedMazeChunkKeys.has(sectionKey);
    }

    function refreshMazePathBoundsIfNeeded() {
        if (!isProceduralMazeScenario()) return false;
        if (state.generatedMazeLoading) return false;
        const radius = getMazeSectionRadius(getMazeOptions());
        const dx = state.target.x - state.nodeLayer.pathCenterX;
        const dy = state.target.y - state.nodeLayer.pathCenterY;
        if (Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) < radius * 0.35) return false;
        const options = getMazeOptions();
        const keys = Array.from(state.generatedMazeChunkKeys).sort();
        if (keys.length === 0) {
            refreshGeneratedMazeIfNeeded(true);
            return true;
        }
        requestGeneratedMazeRefresh(options, keys, getMazeSignature(options, keys));
        return true;
    }

    function addSegmentWall(ax, ay, bx, by) {
        if (!isUsableWallSegment(ax, ay, bx, by)) return false;
        if (isProceduralMazeScenario()) {
            state.manualWalls = appendWallSegment(state.manualWalls, ax, ay, bx, by, WALL_LABEL_MANUAL_TOOL);
            state.walls = concatWallBuffers(state.generatedMazeWalls, state.manualWalls);
            state.generatedMazeSignature = "";
            refreshGeneratedMazeIfNeeded(true);
        } else {
            state.walls = appendWallSegment(state.walls, ax, ay, bx, by, WALL_LABEL_MANUAL_TOOL);
            state.worldVersion += 1;
            rebuildPathfindingNodeLayer();
        }
        constrainTargetToWalls();
        for (const agent of state.agents) {
            constrainAgentToWalls(agent);
        }
        resolveTargetNpcContacts();
        return true;
    }

    function createScenario() {
        state.worldVersion += 1;
        state.temporaryPathCostsByNodeKey = new Map();
        state.liveEnemyPathCostsByNodeKey = new Map();
        state.liveEnemyPathCostSignature = "";
        state.temporaryDeathBlockersByKey = new Map();
        state.agents = [];
        state.fireballs = [];
        state.fireballExplosions = [];
        state.fireDeathEffects = [];
        state.freezeParticles = [];
        state.spikeShatterEffects = [];
        state.wallShatterEffects = [];
        state.brokenWallGaps = [];
        state.spellCooldownRemaining = 0;
        state.spellCooldownDuration = 0;
        resetWizardVitals();
        state.coins = [];
        state.collectedCoinKeys = new Set();
        state.collectedCoinSectionKeysByCoinKey = new Map();
        state.droppedCoinsByKey = new Map();
        state.nextDroppedCoinId = 1;
        state.talismans = [];
        state.activatedTalismanSectionKeys = new Set();
        state.homeBaseTalismanSectionKey = "";
        state.visitedMazeSectionKeys = new Set();
        explorationSystem.reset();
        state.los.lastResult = null;
        state.walls = createEmptyWallBuffer();
        state.manualWalls = createEmptyWallBuffer();
        state.generatedMazeWalls = createEmptyWallBuffer();
        state.generatedMazeChunkKeys = new Set();
        state.generatedMazeInstalledChunkKeys = new Set();
        state.generatedMazeSignature = "";
        state.generatedMazePendingSignature = "";
        state.generatedMazeLoading = false;
        state.generatedMazeInitialEnemySpawnBudgetsBySectionKey = new Map();
        state.sectionSnapshotsByKey = new Map();
        state.restoredSectionSnapshotKeys = new Set();
        state.lastCheckpointSnapshot = null;
        state.pendingSolverDt = 0;
        invalidateMazeLookaheadCache();
        clearPathfindingNodeLayer();
        const count = getAgentCount();
        const scenario = getScenarioValue();
        if (scenario === "openArena") {
            state.target = { x: 0, y: 0, heading: -Math.PI / 2 };
            addRoomWalls(-18, -12, 18, 12);
            spawnRing(count, 10, 3.5);
        } else if (scenario === "crowdedArena") {
            state.target = { x: 0, y: 0, heading: -Math.PI / 2 };
            addRoomWalls(-10, -7.5, 10, 7.5);
            spawnCluster(count, -4.2, 0, 4.4, 10);
        } else if (scenario === "proceduralMaze") {
            const start = getMazeStartPoint();
            state.target = { x: start.x, y: start.y, heading: -Math.PI / 2 };
            refreshGeneratedMazeIfNeeded(true);
        } else {
            state.target = { x: 0, y: 0, heading: -Math.PI / 2 };
            addRoomWalls(-8, -6, 8, 6);
            addRoomWalls(-18, -12, 18, 12);
            spawnCluster(count, 0, 0.8, 4.8, 5);
        }
        state.lastSentTarget = { x: state.target.x, y: state.target.y };
        clearTargetTravelVector();
        if (!isProceduralMazeScenario()) {
            rebuildPathfindingNodeLayer();
            enforceInitialWallConstraints();
        }
    }

    function getWizardPositionStorage() {
        if (typeof window === "undefined" || !window.localStorage) {
            throw new Error("Wizard of Flatland position save requires window.localStorage");
        }
        return window.localStorage;
    }

    function getWizardCheckpointStorage() {
        if (typeof window === "undefined" || !window.localStorage) {
            throw new Error("Wizard of Flatland checkpoint save requires window.localStorage");
        }
        return window.localStorage;
    }

    async function respawnWizardAfterDeath() {
        const playerName = validateStartupPlayerName(state.playerName, "death checkpoint");
        const savedCheckpoint = await saveStore.getSave(playerName);
        if (!savedCheckpoint) {
            console.log("Wizard of Flatland death: no checkpoint found; reloading scenario from scratch");
            createScenario();
            return { source: "fresh-scenario" };
        }
        const sections = await saveStore.getSections(playerName);
        state.sectionSnapshotsByKey = new Map(sections.map((section) => [section.sectionKey, validateMazeSectionSnapshot(section)]));
        const applied = applyWizardCheckpointSnapshot(savedCheckpoint);
        console.log("Wizard of Flatland death: respawned from checkpoint", applied);
        return { source: "checkpoint", checkpoint: applied };
    }

    function getWizardCheckpointSnapshot() {
        if (!isProceduralMazeScenario()) {
            throw new Error("Wizard of Flatland checkpoints require the procedural maze scenario");
        }
        validateWizardPositionTarget(state.target, "current wizard checkpoint position");
        validateWizardVitals();
        validateWizardLevelPoints();
        normalizeWizardSpellLevels();
        if (!(state.visitedMazeSectionKeys instanceof Set)) {
            throw new Error("Wizard of Flatland checkpoint save requires visited section tracking");
        }
        if (!(state.generatedMazeInstalledChunkKeys instanceof Set)) {
            throw new Error("Wizard of Flatland checkpoint save requires active section tracking");
        }
        const activeSectionKeys = new Set(state.generatedMazeInstalledChunkKeys);
        const visitedSectionKeys = new Set(state.visitedMazeSectionKeys);
        const spawnBudgetsBySectionKey = snapshotVisitedMazeSpawnBudgets(visitedSectionKeys);
        const enemies = [];
        for (const agent of state.agents) {
            const sectionKey = getActorMazeSectionKey(agent);
            const homeSectionKey = getAgentHomeSectionKey(agent);
            if (activeSectionKeys.has(sectionKey)) {
                enemies.push(createAgentCheckpointSnapshot(agent, sectionKey, homeSectionKey));
                continue;
            }
            if (!visitedSectionKeys.has(homeSectionKey)) {
                throw new Error(`Wizard of Flatland checkpoint enemy ${agent.id} has unvisited home section ${homeSectionKey}`);
            }
            spawnBudgetsBySectionKey.set(homeSectionKey, (spawnBudgetsBySectionKey.get(homeSectionKey) || 0) + 1);
        }
        return {
            version: 2,
            sectionSnapshotVersion: 1,
            savedAt: new Date().toISOString(),
            playerName: validateStartupPlayerName(state.playerName, "checkpoint save"),
            scenario: getScenarioValue(),
            maze: getMazeOptions(),
            activeSectionKeys: Array.from(activeSectionKeys).sort(),
            visitedSectionKeys: Array.from(visitedSectionKeys).sort(),
            collectedCoins: getVisitedCollectedCoinSnapshots(visitedSectionKeys),
            nextDroppedCoinId: getNextAvailableDroppedCoinId(),
            enemies,
            spawnBudgets: Array.from(spawnBudgetsBySectionKey.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([sectionKey, budget]) => ({ sectionKey, budget })),
            wizard: {
                x: state.target.x,
                y: state.target.y,
                heading: state.target.heading
            },
            selectedSpell: state.selectedSpell,
            spellLevels: { ...state.spellLevels },
            levelPoints: state.levelPoints,
            vitals: {
                health: state.wizardVitals.health,
                maxHealth: state.wizardVitals.maxHealth,
                magic: state.wizardVitals.magic,
                maxMagic: state.wizardVitals.maxMagic,
                exp: state.wizardVitals.exp,
                maxExp: state.wizardVitals.maxExp
            },
            activatedTalismanSectionKeys: Array.from(state.activatedTalismanSectionKeys).sort(),
            homeBaseTalismanSectionKey: getHomeBaseTalismanSectionKey()
        };
    }

    function snapshotVisitedMazeSpawnBudgets(visitedSectionKeys) {
        if (!(visitedSectionKeys instanceof Set)) {
            throw new Error("Wizard of Flatland checkpoint spawn budget snapshot requires visited sections");
        }
        if (!(state.generatedMazeInitialEnemySpawnBudgetsBySectionKey instanceof Map)) {
            throw new Error("Wizard of Flatland checkpoint save requires enemy spawn budget tracking");
        }
        const budgets = new Map();
        const options = getMazeOptions();
        for (const sectionKey of visitedSectionKeys) {
            validateMazeRoomEnemyBudgetSectionKey(sectionKey);
            budgets.set(sectionKey, getMazeRoomInitialEnemySpawnBudget(sectionKey, options));
        }
        return budgets;
    }

    function getVisitedCollectedCoinSnapshots(visitedSectionKeys) {
        if (!(visitedSectionKeys instanceof Set)) {
            throw new Error("Wizard of Flatland checkpoint coin snapshot requires visited sections");
        }
        if (!(state.collectedCoinKeys instanceof Set) || !(state.collectedCoinSectionKeysByCoinKey instanceof Map)) {
            throw new Error("Wizard of Flatland checkpoint save requires collected coin tracking");
        }
        const coins = [];
        for (const coinKey of state.collectedCoinKeys) {
            const sectionKey = state.collectedCoinSectionKeysByCoinKey.get(coinKey) || getMazeCoinSectionKeyFromKey(coinKey);
            if (!visitedSectionKeys.has(sectionKey)) continue;
            coins.push({ key: coinKey, sectionKey });
        }
        coins.sort((a, b) => a.key.localeCompare(b.key));
        return coins;
    }

    function getMazeCoinSectionKeyFromKey(coinKey) {
        if (typeof coinKey !== "string" || coinKey.length === 0) {
            throw new Error("Wizard of Flatland checkpoint coin key is missing");
        }
        if (coinKey.startsWith("drop|")) {
            throw new Error(`Wizard of Flatland collected dropped coin ${coinKey} is missing section ownership`);
        }
        const parts = coinKey.split("|");
        if (parts.length < 6) {
            throw new Error(`Wizard of Flatland collected coin key is malformed: ${coinKey}`);
        }
        const sectionKey = parts[4];
        validateMazeRoomEnemyBudgetSectionKey(sectionKey);
        return sectionKey;
    }

    function getDroppedMazeCoinIdFromKey(coinKey, context) {
        if (typeof coinKey !== "string") {
            throw new Error(`Wizard of Flatland ${context} dropped coin key must be a string`);
        }
        if (!coinKey.startsWith("drop|")) return null;
        const idText = coinKey.slice("drop|".length);
        const id = Number(idText);
        if (!Number.isInteger(id) || id < 1 || String(id) !== idText) {
            throw new Error(`Wizard of Flatland ${context} dropped coin key is malformed: ${coinKey}`);
        }
        return id;
    }

    function getNextAvailableDroppedCoinId(startId = state.nextDroppedCoinId) {
        if (!Number.isInteger(startId) || startId < 1) {
            throw new Error("Wizard of Flatland dropped coin id allocation requires a positive start id");
        }
        if (!(state.collectedCoinKeys instanceof Set)) {
            throw new Error("Wizard of Flatland dropped coin id allocation requires collected coin tracking");
        }
        if (!(state.droppedCoinsByKey instanceof Map)) {
            throw new Error("Wizard of Flatland dropped coin id allocation requires dropped coin tracking");
        }
        let nextId = startId;
        for (const coinKey of state.collectedCoinKeys) {
            const dropId = getDroppedMazeCoinIdFromKey(coinKey, "collected");
            if (dropId !== null && dropId >= nextId) nextId = dropId + 1;
        }
        for (const coinKey of state.droppedCoinsByKey.keys()) {
            const dropId = getDroppedMazeCoinIdFromKey(coinKey, "tracked");
            if (dropId !== null && dropId >= nextId) nextId = dropId + 1;
        }
        if (Array.isArray(state.coins)) {
            for (const coin of state.coins) {
                validateCoin(coin);
                const dropId = getDroppedMazeCoinIdFromKey(coin.key, "visible");
                if (dropId !== null && dropId >= nextId) nextId = dropId + 1;
            }
        }
        return nextId;
    }

    function getAgentHomeSectionKey(agent) {
        if (!agent || typeof agent !== "object") {
            throw new Error("Wizard of Flatland checkpoint enemy home lookup requires an enemy");
        }
        if (typeof agent.homeSectionKey === "string" && agent.homeSectionKey.length > 0) return agent.homeSectionKey;
        if (typeof agent.autoSpawnSectionKey === "string" && agent.autoSpawnSectionKey.length > 0) return agent.autoSpawnSectionKey;
        return getActorMazeSectionKey(agent);
    }

    function createAgentCheckpointSnapshot(agent, sectionKey, homeSectionKey) {
        validateAgentHealth(agent);
        validateAgentTemperature(agent);
        return {
            id: agent.id,
            sectionKey,
            homeSectionKey,
            autoSpawnSectionKey: typeof agent.autoSpawnSectionKey === "string" ? agent.autoSpawnSectionKey : "",
            x: agent.x,
            y: agent.y,
            vx: agent.vx,
            vy: agent.vy,
            speed: agent.speed,
            health: agent.health,
            maxHealth: agent.maxHealth,
            temperature: agent.temperature,
            freezeDamageSinceTemperatureDrop: agent.freezeDamageSinceTemperatureDrop,
            priority: agent.priority,
            waitTime: agent.waitTime,
            phase: agent.phase,
            phaseTime: agent.phaseTime,
            homeAngle: agent.homeAngle,
            cooldown: agent.cooldown,
            slotAngle: agent.slotAngle,
            heading: agent.heading,
            millingDirection: agent.millingDirection,
            millingWallTurnLock: agent.millingWallTurnLock || 0,
            solverState: agent.solverState,
            wallClamps: agent.wallClamps || 0,
            pathGoalX: Number.isFinite(agent.pathGoalX) ? agent.pathGoalX : agent.x,
            pathGoalY: Number.isFinite(agent.pathGoalY) ? agent.pathGoalY : agent.y
        };
    }

    function parseWizardCheckpointSnapshot(text) {
        if (typeof text !== "string" || text.length === 0) {
            throw new Error("Wizard of Flatland saved checkpoint is missing");
        }
        let snapshot = null;
        try {
            snapshot = JSON.parse(text);
        } catch (error) {
            throw new Error(`Wizard of Flatland saved checkpoint is invalid JSON: ${error.message}`);
        }
        validateWizardCheckpointSnapshot(snapshot);
        return snapshot;
    }

    function validateWizardCheckpointSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== "object") {
            throw new Error("Wizard of Flatland saved checkpoint must be an object");
        }
        if (snapshot.version !== 1 && snapshot.version !== 2) {
            throw new Error(`Wizard of Flatland saved checkpoint version is unsupported: ${snapshot.version}`);
        }
        validateWizardPositionTarget(snapshot.wizard, "saved checkpoint wizard position");
        if (!snapshot.maze || typeof snapshot.maze !== "object") {
            throw new Error("Wizard of Flatland saved checkpoint requires maze settings");
        }
        if (!Array.isArray(snapshot.visitedSectionKeys) || !Array.isArray(snapshot.collectedCoins) || !Array.isArray(snapshot.enemies) || !Array.isArray(snapshot.spawnBudgets)) {
            throw new Error("Wizard of Flatland saved checkpoint arrays are malformed");
        }
        if (!snapshot.vitals || typeof snapshot.vitals !== "object") {
            throw new Error("Wizard of Flatland saved checkpoint requires vitals");
        }
        if (snapshot.levelPoints !== undefined && (!Number.isInteger(snapshot.levelPoints) || snapshot.levelPoints < 0)) {
            throw new Error("Wizard of Flatland saved checkpoint levelPoints must be a non-negative integer");
        }
        if (snapshot.nextDroppedCoinId !== undefined && (!Number.isInteger(snapshot.nextDroppedCoinId) || snapshot.nextDroppedCoinId < 1)) {
            throw new Error("Wizard of Flatland saved checkpoint nextDroppedCoinId must be a positive integer");
        }
        if (snapshot.homeBaseTalismanSectionKey !== undefined && typeof snapshot.homeBaseTalismanSectionKey !== "string") {
            throw new Error("Wizard of Flatland saved checkpoint home base talisman key must be a string");
        }
    }

    function applyWizardCheckpointSnapshot(snapshot) {
        validateWizardCheckpointSnapshot(snapshot);
        applyCheckpointControls(snapshot);
        state.worldVersion += 1;
        state.temporaryPathCostsByNodeKey = new Map();
        state.liveEnemyPathCostsByNodeKey = new Map();
        state.liveEnemyPathCostSignature = "";
        state.temporaryDeathBlockersByKey = new Map();
        state.target = {
            x: snapshot.wizard.x,
            y: snapshot.wizard.y,
            heading: normalizeAngle(snapshot.wizard.heading)
        };
        state.agents = snapshot.version >= 2 ? [] : snapshot.enemies.map(createAgentFromCheckpointSnapshot);
        state.restoredSectionSnapshotKeys = new Set();
        state.fireballs = [];
        state.fireballExplosions = [];
        state.fireDeathEffects = [];
        state.freezeParticles = [];
        state.spikeShatterEffects = [];
        state.wallShatterEffects = [];
        state.brokenWallGaps = [];
        state.spellCooldownRemaining = 0;
        state.spellCooldownDuration = 0;
        state.coins = [];
        state.collectedCoinKeys = new Set();
        state.collectedCoinSectionKeysByCoinKey = new Map();
        for (const coin of snapshot.collectedCoins) {
            if (!coin || typeof coin.key !== "string" || typeof coin.sectionKey !== "string") {
                throw new Error("Wizard of Flatland saved checkpoint collected coin is malformed");
            }
            state.collectedCoinKeys.add(coin.key);
            state.collectedCoinSectionKeysByCoinKey.set(coin.key, coin.sectionKey);
        }
        state.droppedCoinsByKey = new Map();
        state.nextDroppedCoinId = getNextAvailableDroppedCoinId(snapshot.nextDroppedCoinId || 1);
        state.talismans = [];
        state.activatedTalismanSectionKeys = new Set(snapshot.activatedTalismanSectionKeys || []);
        state.homeBaseTalismanSectionKey = getHomeBaseTalismanSectionKeyFromCheckpointSnapshot(snapshot);
        state.visitedMazeSectionKeys = new Set(snapshot.visitedSectionKeys);
        state.generatedMazeInitialEnemySpawnBudgetsBySectionKey = new Map(snapshot.spawnBudgets.map((entry) => {
            if (!entry || typeof entry.sectionKey !== "string" || !Number.isInteger(entry.budget) || entry.budget < 0) {
                throw new Error("Wizard of Flatland saved checkpoint spawn budget is malformed");
            }
            return [entry.sectionKey, entry.budget];
        }));
        state.wizardVitals = { ...snapshot.vitals };
        state.selectedSpell = typeof snapshot.selectedSpell === "string" && snapshot.selectedSpell.length > 0
            ? snapshot.selectedSpell
            : "fireball";
        if (!isSelectableSpellId(state.selectedSpell)) state.selectedSpell = "fireball";
        updateSelectedSpellHud();
        state.spellLevels = snapshot.spellLevels && typeof snapshot.spellLevels === "object"
            ? { ...getStartingSpellLevels(), ...snapshot.spellLevels }
            : getStartingSpellLevels();
        state.levelPoints = snapshot.levelPoints === undefined ? 0 : snapshot.levelPoints;
        normalizeWizardSpellLevels();
        validateWizardLevelPoints();
        updateStatusBars();
        refreshSpellLevelPanel();
        state.generatedMazeWalls = createEmptyWallBuffer();
        state.walls = createEmptyWallBuffer();
        state.manualWalls = createEmptyWallBuffer();
        explorationSystem.reset();
        state.los.lastResult = null;
        state.generatedMazeChunkKeys = new Set();
        state.generatedMazeInstalledChunkKeys = new Set();
        state.generatedMazeSignature = "";
        state.generatedMazePendingSignature = "";
        state.generatedMazeLoading = false;
        state.pendingSolverDt = 0;
        state.lastSentTarget = { x: state.target.x, y: state.target.y };
        clearTargetTravelVector();
        clearAgentPathRequestsForMapRebuild();
        invalidateMazeLookaheadCache();
        clearPathfindingNodeLayer();
        state.lastCheckpointSnapshot = snapshot;
        refreshGeneratedMazeIfNeeded(true);
        return snapshot;
    }

    function applyCheckpointControls(snapshot) {
        if (scenarioSelect && snapshot.scenario) scenarioSelect.value = snapshot.scenario;
        if (typeof snapshot.maze.seed === "string") {
            state.mazeSeed = snapshot.maze.seed;
            if (mazeSeedInput) mazeSeedInput.value = snapshot.maze.seed;
        }
        if (mazeChunkSizeInput && Number.isFinite(snapshot.maze.chunkSize)) mazeChunkSizeInput.value = String(snapshot.maze.chunkSize);
        if (mazeRoomScaleInput && Number.isFinite(snapshot.maze.roomScale)) mazeRoomScaleInput.value = String(snapshot.maze.roomScale);
        if (mazeTwistinessInput && Number.isFinite(snapshot.maze.twistiness)) mazeTwistinessInput.value = String(snapshot.maze.twistiness);
        updateControlLabels();
    }

    function createAgentFromCheckpointSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== "object") {
            throw new Error("Wizard of Flatland saved checkpoint enemy is missing");
        }
        for (const field of ["id", "x", "y", "speed", "health"]) {
            if (!Number.isFinite(snapshot[field])) {
                throw new Error(`Wizard of Flatland saved checkpoint enemy requires finite ${field}`);
            }
        }
        const enemyScale = getEnemyScaleForCheckpointSnapshot(snapshot);
        const enemyDamageScale = getEnemyDamageScaleForCheckpointSnapshot(snapshot);
        const zoneLevel = getAgentHomeZone(snapshot);
        const maxHealth = ENEMY_MAX_HEALTH * enemyScale;
        const agent = {
            id: snapshot.id,
            x: snapshot.x,
            y: snapshot.y,
            vx: Number(snapshot.vx) || 0,
            vy: Number(snapshot.vy) || 0,
            radius: AGENT_RADIUS * enemyScale,
            speed: snapshot.speed,
            health: getScaledCheckpointEnemyHealth(snapshot, maxHealth),
            maxHealth,
            temperature: Number.isFinite(snapshot.temperature) ? Math.min(0, snapshot.temperature) : 0,
            freezeDamageSinceTemperatureDrop: Number.isFinite(snapshot.freezeDamageSinceTemperatureDrop)
                ? Math.max(0, snapshot.freezeDamageSinceTemperatureDrop)
                : 0,
            hitDamage: ENEMY_HIT_DAMAGE * enemyDamageScale,
            zoneLevel,
            priority: Number.isFinite(snapshot.priority) ? snapshot.priority : 0,
            waitTime: Number.isFinite(snapshot.waitTime) ? snapshot.waitTime : 0,
            phase: Number.isFinite(snapshot.phase) ? snapshot.phase : PHASE_MILLING,
            phaseTime: Number.isFinite(snapshot.phaseTime) ? snapshot.phaseTime : 0,
            homeAngle: Number.isFinite(snapshot.homeAngle) ? snapshot.homeAngle : Math.atan2(snapshot.y - state.target.y, snapshot.x - state.target.x),
            cooldown: Number.isFinite(snapshot.cooldown) ? snapshot.cooldown : 0,
            slotAngle: Number.isFinite(snapshot.slotAngle) ? snapshot.slotAngle : Math.atan2(snapshot.y - state.target.y, snapshot.x - state.target.x),
            heading: Number.isFinite(snapshot.heading) ? snapshot.heading : Math.atan2(state.target.y - snapshot.y, state.target.x - snapshot.x),
            headingHistory: [],
            millingDirection: snapshot.millingDirection >= 0 ? 1 : -1,
            millingWallTurnLock: Math.max(0, Number(snapshot.millingWallTurnLock) || 0),
            solverState: Number.isFinite(snapshot.solverState) ? snapshot.solverState : STATE_MILLING,
            wallClamps: Math.max(0, Number(snapshot.wallClamps) || 0),
            pathMode: PATH_MODE_DIRECT,
            pathRequestPending: false,
            pathRequestId: 0,
            pathRequestedAt: 0,
            pathRequestedWorldVersion: 0,
            pathRequestedRawStartKey: "",
            pathRequestedStartKey: "",
            pathRequestedGoalKey: "",
            pathNodeKeys: [],
            pathWaypoints: [],
            pathCursor: 0,
            pathGoalX: Number.isFinite(snapshot.pathGoalX) ? snapshot.pathGoalX : snapshot.x,
            pathGoalY: Number.isFinite(snapshot.pathGoalY) ? snapshot.pathGoalY : snapshot.y,
            pathGoalWallBlocked: false,
            wallBreakTargetEdgeKey: "",
            wallBreakTargetWallIndex: -1,
            wallBreakDamageByEdge: new Map(),
            homeSectionKey: snapshot.homeSectionKey
        };
        if (typeof snapshot.autoSpawnSectionKey === "string" && snapshot.autoSpawnSectionKey.length > 0) {
            agent.autoSpawnSectionKey = snapshot.autoSpawnSectionKey;
        }
        if (typeof agent.homeSectionKey !== "string" || agent.homeSectionKey.length === 0) {
            throw new Error(`Wizard of Flatland saved checkpoint enemy ${agent.id} requires a home section`);
        }
        validateAgentHealth(agent);
        return agent;
    }

    function getScaledCheckpointEnemyHealth(snapshot, maxHealth) {
        if (!(maxHealth > 0)) throw new Error("Wizard of Flatland saved checkpoint enemy requires positive derived max health");
        const previousMaxHealth = Number(snapshot.maxHealth);
        const health = Number(snapshot.health);
        if (!Number.isFinite(health)) {
            throw new Error("Wizard of Flatland saved checkpoint enemy requires finite health");
        }
        if (!(previousMaxHealth > 0)) return Math.min(maxHealth, health);
        return Math.max(0, Math.min(maxHealth, health / previousMaxHealth * maxHealth));
    }

    function getEnemyScaleForCheckpointSnapshot(snapshot) {
        if (snapshot && typeof snapshot.homeSectionKey === "string" && snapshot.homeSectionKey.length > 0) {
            return getEnemyScaleForMazeSectionKey(snapshot.homeSectionKey);
        }
        if (snapshot && typeof snapshot.autoSpawnSectionKey === "string" && snapshot.autoSpawnSectionKey.length > 0) {
            return getEnemyScaleForMazeSectionKey(snapshot.autoSpawnSectionKey);
        }
        return 1;
    }

    function getEnemyDamageScaleForCheckpointSnapshot(snapshot) {
        if (snapshot && typeof snapshot.homeSectionKey === "string" && snapshot.homeSectionKey.length > 0) {
            return getEnemyDamageScaleForMazeSectionKey(snapshot.homeSectionKey);
        }
        if (snapshot && typeof snapshot.autoSpawnSectionKey === "string" && snapshot.autoSpawnSectionKey.length > 0) {
            return getEnemyDamageScaleForMazeSectionKey(snapshot.autoSpawnSectionKey);
        }
        return ENEMY_DAMAGE_BASE_SCALE;
    }

    function getHomeBaseTalismanSectionKeyFromCheckpointSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== "object") {
            throw new Error("Wizard of Flatland saved checkpoint home base lookup requires a checkpoint");
        }
        if (typeof snapshot.homeBaseTalismanSectionKey === "string" && snapshot.homeBaseTalismanSectionKey.length > 0) {
            validateMazeRoomEnemyBudgetSectionKey(snapshot.homeBaseTalismanSectionKey);
            return snapshot.homeBaseTalismanSectionKey;
        }
        const options = getMazeOptions();
        const coord = worldToMazeSectionCoord(snapshot.wizard.x, snapshot.wizard.y, options);
        const sectionKey = mazeSectionKey(coord.q, coord.r);
        return state.activatedTalismanSectionKeys.has(sectionKey) ? sectionKey : "";
    }

    async function saveWizardCheckpointToSlot() {
        const operation = checkpointWriteChain.then(async () => {
            const sectionSnapshots = captureActiveMazeSectionSnapshots();
            const snapshot = getWizardCheckpointSnapshot();
            snapshot.revision = state.lastCheckpointSnapshot && Number.isInteger(state.lastCheckpointSnapshot.revision)
                ? state.lastCheckpointSnapshot.revision + 1
                : 1;
            await saveStore.putSave(snapshot, sectionSnapshots);
            state.lastCheckpointSnapshot = snapshot;
            state.manualWalls = createEmptyWallBuffer();
            state.brokenWallGaps = [];
            await refreshStartupSaveNameOptions();
            console.log("Wizard of Flatland checkpoint saved", snapshot);
            return snapshot;
        });
        checkpointWriteChain = operation.catch(() => undefined);
        return operation;
    }

    async function loadWizardCheckpointFromSlot() {
        const playerName = validateStartupPlayerName(state.playerName, "active checkpoint");
        const snapshot = await saveStore.getSave(playerName);
        if (!snapshot) throw new Error(`No talisman checkpoint save exists for "${playerName}"`);
        const sections = await saveStore.getSections(playerName);
        state.sectionSnapshotsByKey = new Map(sections.map((section) => [section.sectionKey, validateMazeSectionSnapshot(section)]));
        const applied = applyWizardCheckpointSnapshot(snapshot);
        console.log("Wizard of Flatland checkpoint loaded", applied);
        return applied;
    }

    async function showSavedWizardCheckpointFromSlot() {
        const snapshot = await saveStore.getSave(validateStartupPlayerName(state.playerName, "active checkpoint"));
        if (!snapshot) throw new Error("Wizard of Flatland saved checkpoint is missing");
        console.log("Wizard of Flatland saved checkpoint", snapshot);
        return snapshot;
    }

    async function clearSavedWizardCheckpointFromSlot() {
        await saveStore.deleteSave(validateStartupPlayerName(state.playerName, "active checkpoint"));
        state.lastCheckpointSnapshot = null;
        state.sectionSnapshotsByKey = new Map();
        await refreshStartupSaveNameOptions();
        console.log("Wizard of Flatland saved checkpoint cleared");
        return true;
    }

    function getWizardPositionSnapshot() {
        validateWizardPositionTarget(state.target, "current wizard position");
        return {
            version: 1,
            savedAt: new Date().toISOString(),
            scenario: getScenarioValue(),
            maze: getMazeOptions(),
            x: state.target.x,
            y: state.target.y,
            heading: state.target.heading
        };
    }

    function validateWizardPositionTarget(target, label) {
        if (!target || typeof target !== "object") {
            throw new Error(`Wizard of Flatland ${label} is missing`);
        }
        for (const field of ["x", "y", "heading"]) {
            if (!Number.isFinite(target[field])) {
                throw new Error(`Wizard of Flatland ${label} requires finite ${field}`);
            }
        }
    }

    function parseWizardPositionSnapshot(text) {
        if (typeof text !== "string" || text.length === 0) {
            throw new Error("Wizard of Flatland saved wizard position is missing");
        }
        let snapshot = null;
        try {
            snapshot = JSON.parse(text);
        } catch (error) {
            throw new Error(`Wizard of Flatland saved wizard position is invalid JSON: ${error.message}`);
        }
        if (!snapshot || typeof snapshot !== "object") {
            throw new Error("Wizard of Flatland saved wizard position must be an object");
        }
        if (snapshot.version !== 1) {
            throw new Error(`Wizard of Flatland saved wizard position version is unsupported: ${snapshot.version}`);
        }
        validateWizardPositionTarget(snapshot, "saved wizard position");
        return snapshot;
    }

    function applyWizardPositionSnapshot(snapshot) {
        validateWizardPositionTarget(snapshot, "saved wizard position");
        state.target = {
            x: snapshot.x,
            y: snapshot.y,
            heading: normalizeAngle(snapshot.heading)
        };
        state.worldVersion += 1;
        state.lastSentTarget = { x: state.target.x, y: state.target.y };
        clearTargetTravelVector();
        state.targetFlashTime = 0.18;
        state.pressedMovementKeys = Object.create(null);
        state.spaceHeld = false;
        state.zoomHeld = false;
        state.fastMovementHeld = false;
        clearAgentPathRequestsForMapRebuild();
        invalidateMazeLookaheadCache();
        state.hexGridLayer.dirty = true;
        state.nodeLayer.dirty = true;

        if (isProceduralMazeScenario()) {
            state.generatedMazeSignature = "";
            refreshGeneratedMazeIfNeeded(true);
        } else {
            constrainTargetToWalls();
            resolveTargetNpcContacts();
            rebuildPathfindingNodeLayer();
        }
        return getWizardPositionSnapshot();
    }

    function saveWizardPositionToConsoleSlot() {
        const snapshot = getWizardPositionSnapshot();
        getWizardPositionStorage().setItem(WIZARD_POSITION_STORAGE_KEY, JSON.stringify(snapshot));
        console.log("Wizard of Flatland position saved", snapshot);
        return snapshot;
    }

    function loadWizardPositionFromConsoleSlot() {
        const snapshot = parseWizardPositionSnapshot(getWizardPositionStorage().getItem(WIZARD_POSITION_STORAGE_KEY));
        const applied = applyWizardPositionSnapshot(snapshot);
        console.log("Wizard of Flatland position loaded", applied);
        return applied;
    }

    function showSavedWizardPositionFromConsoleSlot() {
        const snapshot = parseWizardPositionSnapshot(getWizardPositionStorage().getItem(WIZARD_POSITION_STORAGE_KEY));
        console.log("Wizard of Flatland saved position", snapshot);
        return snapshot;
    }

    function clearSavedWizardPositionFromConsoleSlot() {
        getWizardPositionStorage().removeItem(WIZARD_POSITION_STORAGE_KEY);
        console.log("Wizard of Flatland saved position cleared");
        return true;
    }

    window.wizardPosition = Object.freeze({
        save: saveWizardPositionToConsoleSlot,
        load: loadWizardPositionFromConsoleSlot,
        show: showSavedWizardPositionFromConsoleSlot,
        clear: clearSavedWizardPositionFromConsoleSlot,
        key: WIZARD_POSITION_STORAGE_KEY
    });

    window.wizardCheckpoint = Object.freeze({
        save: saveWizardCheckpointToSlot,
        load: loadWizardCheckpointFromSlot,
        show: showSavedWizardCheckpointFromSlot,
        clear: clearSavedWizardCheckpointFromSlot,
        key: TALISMAN_STORAGE_KEY,
        keyForPlayer: getWizardCheckpointStorageKeyForPlayer
    });

    function enableCoinDiagnosticsFromConsole() {
        state.debug.coinDiagnosticsEnabled = true;
        state.debug.coinDiagnostics = [];
        const snapshot = createMazeCoinDiagnosticSnapshot("manual-enable", getMazeOptions(), state.coins);
        console.log("Wizard of Flatland coin diagnostics enabled", snapshot);
        return snapshot;
    }

    function disableCoinDiagnosticsFromConsole() {
        state.debug.coinDiagnosticsEnabled = false;
        console.log("Wizard of Flatland coin diagnostics disabled");
        return true;
    }

    function snapshotCoinsFromConsole() {
        const snapshot = createMazeCoinDiagnosticSnapshot("manual-snapshot", getMazeOptions(), state.coins);
        console.log("Wizard of Flatland coin snapshot", snapshot);
        console.table(snapshot.coins);
        return snapshot;
    }

    function getCoinDiagnosticsHistoryFromConsole() {
        if (!Array.isArray(state.debug.coinDiagnostics)) state.debug.coinDiagnostics = [];
        return state.debug.coinDiagnostics.slice();
    }

    function printLastCoinDiagnosticFromConsole() {
        const history = getCoinDiagnosticsHistoryFromConsole();
        const record = history[history.length - 1] || null;
        if (!record) {
            console.log("Wizard of Flatland coin diagnostics have no records");
            return null;
        }
        logMazeCoinDiagnosticRecord(record);
        return record;
    }

    function clearCoinDiagnosticsFromConsole() {
        state.debug.coinDiagnostics = [];
        console.log("Wizard of Flatland coin diagnostics cleared");
        return true;
    }

    window.wizardCoins = Object.freeze({
        enableDiagnostics: enableCoinDiagnosticsFromConsole,
        disableDiagnostics: disableCoinDiagnosticsFromConsole,
        snapshot: snapshotCoinsFromConsole,
        history: getCoinDiagnosticsHistoryFromConsole,
        printLastDiagnostic: printLastCoinDiagnosticFromConsole,
        clearDiagnostics: clearCoinDiagnosticsFromConsole
    });

    function spawnEnemiesAtNearestSectionCenterFromConsole(count = 1) {
        const spawnCount = Number(count);
        if (!Number.isInteger(spawnCount) || spawnCount < 1) {
            throw new Error("Wizard of Flatland enemy spawn count must be a positive integer");
        }
        const options = getMazeOptions();
        const coord = worldToMazeSectionCoord(state.target.x, state.target.y, options);
        const sectionKey = mazeSectionKey(coord.q, coord.r);
        if (
            isProceduralMazeScenario() &&
            (!(state.generatedMazeInstalledChunkKeys instanceof Set) || !state.generatedMazeInstalledChunkKeys.has(sectionKey))
        ) {
            throw new Error(`Wizard of Flatland cannot spawn enemies in unloaded map section ${sectionKey}`);
        }
        const center = mazeSectionCenter(coord.q, coord.r, options);
        const firstId = getNextAgentId();
        for (let i = 0; i < spawnCount; i++) {
            addAgent(center.x, center.y, firstId + i, Math.random, { homeSectionKey: sectionKey });
        }
        enforceInitialWallConstraints();
        clearAgentPathRequestsForMapRebuild();
        const result = {
            spawned: spawnCount,
            section: { key: sectionKey, q: coord.q, r: coord.r },
            center: { x: center.x, y: center.y },
            firstId,
            totalAgents: state.agents.length
        };
        console.log("Wizard of Flatland enemies spawned", result);
        return result;
    }

    window.spawnEnemiesAtNearestSectionCenter = spawnEnemiesAtNearestSectionCenterFromConsole;

    function populateGeneratedMazeRooms(options) {
        if (!isProceduralMazeScenario()) return;
        if (!(state.generatedMazeInstalledChunkKeys instanceof Set)) {
            throw new Error("Wizard of Flatland enemy population requires installed section tracking");
        }
        if (!(state.generatedMazeInitialEnemySpawnBudgetsBySectionKey instanceof Map)) {
            throw new Error("Wizard of Flatland enemy population requires initial spawn budget tracking");
        }
        const keys = Array.from(state.generatedMazeInstalledChunkKeys).sort();
        for (const sectionKey of keys) {
            populateGeneratedMazeRoom(sectionKey, options);
        }
    }

    function populateGeneratedMazeRoom(sectionKey, options) {
        const savedSnapshot = state.sectionSnapshotsByKey.get(sectionKey);
        if (savedSnapshot) {
            validateMazeSectionSnapshot(savedSnapshot, sectionKey);
            state.generatedMazeInitialEnemySpawnBudgetsBySectionKey.set(sectionKey, 0);
            if (state.restoredSectionSnapshotKeys.has(sectionKey)) return;
            for (const enemySnapshot of savedSnapshot.enemies) {
                state.agents.push(createAgentFromCheckpointSnapshot(enemySnapshot));
            }
            state.restoredSectionSnapshotKeys.add(sectionKey);
            return;
        }
        const coord = parseMazeSectionKey(sectionKey);
        const count = consumeMazeRoomEnemySpawnBudget(sectionKey, options);
        if (count <= 0) return;
        const center = mazeSectionCenter(coord.q, coord.r, options);
        const roomRadius = getMazeRoomSpawnRadius(options);
        const random = seededRandom(hashString(`${options.seed}|enemy-position|${sectionKey}`));
        const firstId = getNextAgentId();
        for (let i = 0; i < count; i++) {
            const point = getMazeRoomEnemySpawnPoint(center, roomRadius, i, count, random);
            addAgent(point.x, point.y, firstId + i, random, { autoSpawnSectionKey: sectionKey, homeSectionKey: sectionKey });
        }
    }

    function consumeMazeRoomEnemySpawnBudget(sectionKey, options) {
        const budget = getMazeRoomInitialEnemySpawnBudget(sectionKey, options);
        if (budget <= 0) return 0;
        state.generatedMazeInitialEnemySpawnBudgetsBySectionKey.set(sectionKey, 0);
        return budget;
    }

    function getMazeRoomInitialEnemySpawnBudget(sectionKey, options) {
        validateMazeRoomEnemyBudgetSectionKey(sectionKey);
        if (!(state.generatedMazeInitialEnemySpawnBudgetsBySectionKey instanceof Map)) {
            throw new Error("Wizard of Flatland enemy budget lookup requires initial spawn budget tracking");
        }
        if (!state.generatedMazeInitialEnemySpawnBudgetsBySectionKey.has(sectionKey)) {
            state.generatedMazeInitialEnemySpawnBudgetsBySectionKey.set(sectionKey, getMazeRoomEnemyCount(sectionKey, options));
        }
        return state.generatedMazeInitialEnemySpawnBudgetsBySectionKey.get(sectionKey);
    }

    function getMazeRoomSpawnRadius(options) {
        return Math.max(2, getMazeSectionRadius(options) * MAZE_ROOM_ENEMY_SAFE_RADIUS_SCALE);
    }

    function getMazeRoomEnemySpawnPoint(center, radius, index, count, random) {
        if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
            throw new Error("Wizard of Flatland enemy spawn requires a finite room center");
        }
        if (!Number.isFinite(radius) || radius <= 0) {
            throw new Error("Wizard of Flatland enemy spawn requires a positive room radius");
        }
        if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || count < 1 || index >= count) {
            throw new Error("Wizard of Flatland enemy spawn requires a valid spawn index");
        }
        if (typeof random !== "function") {
            throw new Error("Wizard of Flatland enemy spawn requires a random source");
        }
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const packedRadius = radius * Math.sqrt((index + 0.5) / count);
        const countRoot = Math.sqrt(count);
        const jitterRadius = radius / Math.max(12, countRoot * 8);
        const angle = index * goldenAngle + (random() - 0.5) * 0.1 / Math.max(1, countRoot);
        const distance = Math.max(0, Math.min(radius, packedRadius + (random() - 0.5) * jitterRadius));
        return {
            x: center.x + Math.cos(angle) * distance,
            y: center.y + Math.sin(angle) * distance
        };
    }

    function clearPathfindingNodeLayer() {
        applyTemporaryPathfindingModifiersToNodes(true);
        state.nodeLayer.nodes = new Float32Array(0);
        state.nodeLayer.snapshotNodes = new Float32Array(0);
        state.nodeLayer.edges = new Int32Array(0);
        state.nodeLayer.blockedEdges = new Int32Array(0);
        state.nodeLayer.indexByKey = new Map();
        state.nodeLayer.pathCenterX = NaN;
        state.nodeLayer.pathCenterY = NaN;
        state.nodeLayer.version += 1;
        state.nodeLayer.targetNodeCache = null;
        state.nodeLayer.dirty = true;
    }

    function respawnAgentsForCurrentScenario() {
        state.liveEnemyPathCostsByNodeKey = new Map();
        state.liveEnemyPathCostSignature = "";
        state.agents = [];
        const count = getAgentCount();
        const scenario = getScenarioValue();
        if (scenario === "openArena") {
            spawnRing(count, 10, 3.5);
        } else if (scenario === "crowdedArena") {
            spawnCluster(count, -4.2, 0, 4.4, 10);
        } else if (scenario === "proceduralMaze") {
            enforceInitialWallConstraints();
        } else {
            spawnCluster(count, 0, 0.8, 4.8, 5);
        }
        enforceInitialWallConstraints();
    }

    function addRoomWalls(minX, minY, maxX, maxY) {
        state.walls = appendWallSegment(state.walls, minX, minY, maxX, minY, WALL_LABEL_ARENA_BOUNDARY, 0);
        state.walls = appendWallSegment(state.walls, maxX, minY, maxX, maxY, WALL_LABEL_ARENA_BOUNDARY, 1);
        state.walls = appendWallSegment(state.walls, maxX, maxY, minX, maxY, WALL_LABEL_ARENA_BOUNDARY, 2);
        state.walls = appendWallSegment(state.walls, minX, maxY, minX, minY, WALL_LABEL_ARENA_BOUNDARY, 3);
    }

    function spawnRing(count, radius, jitter) {
        for (let i = 0; i < count; i++) {
            const angle = i / count * Math.PI * 2;
            const r = radius + (Math.random() - 0.5) * jitter;
            addAgent(Math.cos(angle) * r, Math.sin(angle) * r, i);
        }
    }

    function spawnCluster(count, centerX, centerY, width, height, metadata = null) {
        const cols = Math.ceil(Math.sqrt(count * width / height));
        const firstId = getNextAgentId();
        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = centerX + (col / Math.max(1, cols - 1) - 0.5) * width + (Math.random() - 0.5) * 0.25;
            const y = centerY + (row / Math.max(1, Math.ceil(count / cols) - 1) - 0.5) * height + (Math.random() - 0.5) * 0.25;
            addAgent(x, y, firstId + i, Math.random, metadata);
        }
    }

    function getNextAgentId() {
        let maxId = -1;
        for (const agent of state.agents) {
            const id = Number(agent && agent.id);
            if (Number.isFinite(id)) maxId = Math.max(maxId, Math.floor(id));
        }
        return maxId + 1;
    }

    function addAgent(x, y, id, random = Math.random, metadata = null) {
        if (typeof random !== "function") {
            throw new Error("Wizard of Flatland agent creation requires a random source");
        }
        const enemyScale = getEnemyScaleForAgentMetadata(metadata);
        const enemyDamageScale = getEnemyDamageScaleForAgentMetadata(metadata);
        const zoneLevel = getEnemyZoneForAgentMetadata({ ...metadata, x, y });
        const agent = {
            id,
            x,
            y,
            vx: 0,
            vy: 0,
            radius: AGENT_RADIUS * enemyScale,
            speed: 5.7 + random() * 0.9,
            health: ENEMY_MAX_HEALTH * enemyScale,
            maxHealth: ENEMY_MAX_HEALTH * enemyScale,
            temperature: 0,
            freezeDamageSinceTemperatureDrop: 0,
            hitDamage: ENEMY_HIT_DAMAGE * enemyDamageScale,
            zoneLevel,
            priority: random(),
            waitTime: random() * 1.5,
            phase: PHASE_MILLING,
            phaseTime: 0,
            homeAngle: Math.atan2(y - state.target.y, x - state.target.x),
            cooldown: random() * 0.8,
            slotAngle: Math.atan2(y - state.target.y, x - state.target.x),
            heading: Math.atan2(state.target.y - y, state.target.x - x),
            headingHistory: [],
            millingDirection: (id % 2) === 0 ? 1 : -1,
            millingWallTurnLock: 0,
            solverState: STATE_MILLING,
            wallClamps: 0,
            pathMode: PATH_MODE_DIRECT,
            pathRequestPending: false,
            pathRequestId: 0,
            pathRequestedAt: 0,
            pathRequestedWorldVersion: 0,
            pathRequestedRawStartKey: "",
            pathRequestedStartKey: "",
            pathRequestedGoalKey: "",
            pathNodeKeys: [],
            pathWaypoints: [],
            pathCursor: 0,
            pathGoalX: x,
            pathGoalY: y,
            pathGoalWallBlocked: false,
            wallBreakTargetEdgeKey: "",
            wallBreakTargetWallIndex: -1,
            wallBreakDamageByEdge: new Map()
        };
        if (metadata && typeof metadata === "object") {
            if (metadata.autoSpawnSectionKey !== undefined) {
                if (typeof metadata.autoSpawnSectionKey !== "string" || metadata.autoSpawnSectionKey.length === 0) {
                    throw new Error("Wizard of Flatland auto-spawned enemy requires a section key");
                }
                agent.autoSpawnSectionKey = metadata.autoSpawnSectionKey;
            }
            if (metadata.homeSectionKey !== undefined) {
                if (typeof metadata.homeSectionKey !== "string" || metadata.homeSectionKey.length === 0) {
                    throw new Error("Wizard of Flatland enemy home section requires a section key");
                }
                agent.homeSectionKey = metadata.homeSectionKey;
            }
        }
        state.agents.push(agent);
    }

    function getEnemyScaleForAgentMetadata(metadata) {
        if (!metadata || typeof metadata !== "object") return 1;
        if (typeof metadata.homeSectionKey === "string" && metadata.homeSectionKey.length > 0) {
            return getEnemyScaleForMazeSectionKey(metadata.homeSectionKey);
        }
        if (typeof metadata.autoSpawnSectionKey === "string" && metadata.autoSpawnSectionKey.length > 0) {
            return getEnemyScaleForMazeSectionKey(metadata.autoSpawnSectionKey);
        }
        return 1;
    }

    function getEnemyDamageScaleForAgentMetadata(metadata) {
        if (!metadata || typeof metadata !== "object") return ENEMY_DAMAGE_BASE_SCALE;
        if (typeof metadata.homeSectionKey === "string" && metadata.homeSectionKey.length > 0) {
            return getEnemyDamageScaleForMazeSectionKey(metadata.homeSectionKey);
        }
        if (typeof metadata.autoSpawnSectionKey === "string" && metadata.autoSpawnSectionKey.length > 0) {
            return getEnemyDamageScaleForMazeSectionKey(metadata.autoSpawnSectionKey);
        }
        return ENEMY_DAMAGE_BASE_SCALE;
    }

    function getEnemyZoneForAgentMetadata(metadata) {
        if (!metadata || typeof metadata !== "object") return 0;
        return getAgentHomeZone(metadata);
    }

    function getAgentHitDamage(agent) {
        const damage = Number(agent && agent.hitDamage);
        if (Number.isFinite(damage) && damage > 0) return damage;
        const scale = getEnemyDamageScaleForAgentMetadata(agent);
        return ENEMY_HIT_DAMAGE * scale;
    }

    function enforceInitialWallConstraints() {
        for (const agent of state.agents) {
            constrainAgentToWalls(agent);
        }
    }

    function constrainTargetToWalls() {
        constrainActorToWalls(state.target, TARGET_RADIUS);
    }

    function updateTargetKeyboardMovement(dt) {
        if (!Number.isFinite(dt) || dt <= 0) {
            clearTargetTravelVector();
            return;
        }
        let forward = 0;
        let sideways = 0;
        let movementSpeedMultiplier = 1;
        for (const key of Object.keys(TARGET_FORWARD_KEYS)) {
            if (state.pressedMovementKeys[key]) forward += TARGET_FORWARD_KEYS[key];
        }
        for (const key of Object.keys(TARGET_SIDEWAYS_KEYS)) {
            if (state.pressedMovementKeys[key]) sideways += TARGET_SIDEWAYS_KEYS[key];
        }

        const signedForward = Math.max(-1, Math.min(1, forward));
        const signedSideways = Math.max(-1, Math.min(1, sideways));
        if (signedForward === 0 && signedSideways === 0) {
            clearTargetTravelVector();
            return;
        }

        if (signedForward > 0 && signedSideways !== 0) {
            movementSpeedMultiplier = TARGET_KEYBOARD_FORWARD_DIAGONAL_SPEED_MULTIPLIER;
        } else if (signedForward < 0 && signedSideways !== 0) {
            movementSpeedMultiplier = TARGET_KEYBOARD_BACKWARD_DIAGONAL_SPEED_MULTIPLIER;
        } else if (signedForward < 0) {
            movementSpeedMultiplier = TARGET_KEYBOARD_BACKWARD_SPEED_MULTIPLIER;
        } else if (signedSideways !== 0) {
            movementSpeedMultiplier = TARGET_KEYBOARD_SIDEWAYS_SPEED_MULTIPLIER;
        }

        const forwardX = Math.cos(state.target.heading);
        const forwardY = Math.sin(state.target.heading);
        const sideX = -forwardY;
        const sideY = forwardX;
        const dirX = forwardX * signedForward + sideX * signedSideways;
        const dirY = forwardY * signedForward + sideY * signedSideways;
        const magnitude = Math.hypot(dirX, dirY);
        if (!(magnitude > 0)) throw new Error("Wizard of Flatland keyboard direction must be non-zero");
        const speed = (state.fastMovementHeld ? TARGET_KEYBOARD_FAST_MOVE_SPEED : TARGET_KEYBOARD_MOVE_SPEED) *
            movementSpeedMultiplier *
            getProjectedCursorMovementSpeedMultiplier();
        const startX = state.target.x;
        const startY = state.target.y;
        moveTargetWithNpcPush(
            state.target.x + (dirX / magnitude) * speed * dt,
            state.target.y + (dirY / magnitude) * speed * dt
        );
        state.targetTravelVector.x = state.target.x - startX;
        state.targetTravelVector.y = state.target.y - startY;
    }

    function clearTargetTravelVector() {
        state.targetTravelVector.x = 0;
        state.targetTravelVector.y = 0;
    }

    function getProjectedCursorMovementSpeedMultiplier() {
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        if (!Number.isFinite(cursor.distance)) throw new Error("Wizard of Flatland cursor speed bonus requires a finite distance");
        const extensionRange = TARGET_PROJECTED_CURSOR_MAX_DISTANCE - TARGET_PROJECTED_CURSOR_DISTANCE;
        if (!(extensionRange > 0)) throw new Error("Wizard of Flatland cursor speed bonus requires a positive extension range");
        const extensionRatio = Math.max(0, Math.min(1, (cursor.distance - TARGET_PROJECTED_CURSOR_DISTANCE) / extensionRange));
        return 1 + extensionRatio * TARGET_PROJECTED_CURSOR_MAX_SPEED_BONUS;
    }

    function updateProjectedCursorKeyboardControls(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");

        let bend = 0;
        if (state.pressedMovementKeys.ArrowLeft) bend -= 1;
        if (state.pressedMovementKeys.ArrowRight) bend += 1;
        if (bend !== 0 || !state.projectedCursorMouseMode.active) {
            updateProjectedCursorBendInput(dt, bend);
        }

        let extend = 0;
        if (state.pressedMovementKeys.ArrowUp) extend += 1;
        if (state.pressedMovementKeys.ArrowDown) extend -= 1;
        if (extend !== 0) {
            cursor.distance = Math.max(
                TARGET_PROJECTED_CURSOR_MIN_DISTANCE,
                Math.min(
                    TARGET_PROJECTED_CURSOR_MAX_DISTANCE,
                    cursor.distance + Math.max(-1, Math.min(1, extend)) * TARGET_PROJECTED_CURSOR_DISTANCE_SPEED * dt
                )
            );
        }
    }

    function updateProjectedCursorMouseControls(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const mouseMode = state.projectedCursorMouseMode;
        if (!mouseMode || typeof mouseMode !== "object") throw new Error("Wizard of Flatland projected cursor mouse mode state is missing");
        if (!mouseMode.active) return;
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");

        const mouseWorld = projectedCursorMouseClientToWorld();
        const cursorWorld = getCurrentProjectedCursorWorldPoint();
        const displayedCursorProjection = getProjectedCursorProjectionForWorldPoint(cursorWorld);
        cursor.angleOffset = displayedCursorProjection.angleOffset;
        cursor.distance = displayedCursorProjection.distance;
        const cursorScreen = worldToScreen(cursorWorld.x, cursorWorld.y);
        const mouseScreen = worldToScreen(mouseWorld.x, mouseWorld.y);
        const screenDeltaX = mouseScreen.x - cursorScreen.x;
        const screenDeltaY = mouseScreen.y - cursorScreen.y;
        const targetProjection = getProjectedCursorProjectionForWorldPoint(mouseWorld);
        const targetBendDelta = targetProjection.angleOffset - cursor.angleOffset;
        const bendDirection = Math.abs(targetBendDelta) > 0.000001
            ? Math.sign(targetBendDelta)
            : 0;
        mouseMode.bendDirection = bendDirection;

        const wizardScreen = worldToScreen(state.target.x, state.target.y);
        const mouseRadius = Math.hypot(mouseScreen.x - wizardScreen.x, mouseScreen.y - wizardScreen.y);
        const cursorRadius = Math.hypot(cursorScreen.x - wizardScreen.x, cursorScreen.y - wizardScreen.y);
        const radiusDelta = mouseRadius - cursorRadius;
        mouseMode.distanceDirection = Math.abs(radiusDelta) > 0.001
            ? Math.sign(radiusDelta)
            : 0;

        if (Math.hypot(screenDeltaX, screenDeltaY) <= 0.001) {
            cursor.angleOffset = targetProjection.angleOffset;
            cursor.distance = targetProjection.distance;
            mouseMode.bendDirection = 0;
            mouseMode.distanceDirection = 0;
            updateProjectedCursorBendHold(dt, 0);
            return;
        }

        updateProjectedCursorBendHold(dt, bendDirection);
        const cursorInputMaxAngleDelta = bendDirection !== 0
            ? getProjectedCursorBendMaxDelta(dt, bendDirection)
            : 0;
        const maxDistanceDelta = TARGET_PROJECTED_CURSOR_DISTANCE_SPEED * dt;
        const startAngleOffset = cursor.angleOffset;
        const startDistance = cursor.distance;

        function getProjectionAlongMouseLine(progress) {
            const screenX = cursorScreen.x + screenDeltaX * progress;
            const screenY = cursorScreen.y + screenDeltaY * progress;
            const worldPoint = screenToWorld(screenX, screenY);
            return {
                projection: getProjectedCursorProjectionForWorldPoint(worldPoint),
                worldPoint
            };
        }

        function projectionFitsStep(candidate) {
            const headingTurn = bendDirection !== 0
                ? getProjectedCursorMouseHeadingTurnForCandidate(
                    candidate.projection,
                    candidate.worldPoint,
                    bendDirection,
                    dt
                )
                : 0;
            const combinedSignedAngleDelta = bendDirection * cursorInputMaxAngleDelta +
                2 * TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET * headingTurn;
            const maxAngleDelta = bendDirection !== 0
                ? Math.max(0, bendDirection * combinedSignedAngleDelta)
                : 0;
            return Math.abs(candidate.projection.angleOffset - startAngleOffset) <= maxAngleDelta + 0.000001 &&
                Math.abs(candidate.projection.distance - startDistance) <= maxDistanceDelta + 0.000001;
        }

        let progress = 1;
        let candidate = {
            projection: targetProjection,
            worldPoint: mouseWorld
        };
        if (!projectionFitsStep(candidate)) {
            let low = 0;
            let high = 1;
            for (let iteration = 0; iteration < 32; iteration++) {
                const candidateProgress = (low + high) * 0.5;
                const candidateStep = getProjectionAlongMouseLine(candidateProgress);
                if (projectionFitsStep(candidateStep)) {
                    low = candidateProgress;
                } else {
                    high = candidateProgress;
                }
            }
            progress = low;
            candidate = getProjectionAlongMouseLine(progress);
        }

        cursor.angleOffset = candidate.projection.angleOffset;
        cursor.distance = candidate.projection.distance;

        const remainingBendDelta = targetProjection.angleOffset - cursor.angleOffset;
        if (
            progress >= 1 - 0.000001 ||
            Math.abs(remainingBendDelta) <= 0.000001 ||
            (bendDirection !== 0 && Math.sign(remainingBendDelta) !== bendDirection)
        ) {
            mouseMode.bendDirection = 0;
            updateProjectedCursorBendHold(dt, 0);
        }
    }

    function getProjectedCursorMouseHeadingTurnForCandidate(projection, worldPoint, bendDirection, dt) {
        if (!projection || !Number.isFinite(projection.angleOffset) || !Number.isFinite(projection.distance)) {
            throw new Error("Wizard of Flatland mouse heading prediction requires a finite cursor projection");
        }
        if (!worldPoint || !Number.isFinite(worldPoint.x) || !Number.isFinite(worldPoint.y)) {
            throw new Error("Wizard of Flatland mouse heading prediction requires a finite world point");
        }
        if (bendDirection !== -1 && bendDirection !== 1) {
            throw new Error("Wizard of Flatland mouse heading prediction requires a signed bend direction");
        }
        if (!Number.isFinite(dt) || dt <= 0) {
            throw new Error("Wizard of Flatland mouse heading prediction requires positive finite time");
        }

        if (!isTargetMovementInputActive()) {
            const targetHeading = Math.atan2(worldPoint.y - state.target.y, worldPoint.x - state.target.x);
            const headingDelta = shortestAngleDelta(state.target.heading, targetHeading);
            const turnAcceleration = getProjectedCursorTurnAccelerationMultiplier(
                TARGET_PROJECTED_CURSOR_IDLE_TURN_ACCEL_SECONDS,
                TARGET_PROJECTED_CURSOR_IDLE_MAX_TURN_ACCEL_MULTIPLIER
            );
            const distanceSpeedMultiplier = TARGET_PROJECTED_CURSOR_DISTANCE /
                Math.max(TARGET_PROJECTED_CURSOR_MIN_DISTANCE, projection.distance);
            const maxTurn = TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET /
                TARGET_IDLE_FACE_CURSOR_SECONDS *
                TARGET_TURN_SPEED_MULTIPLIER *
                TARGET_PROJECTED_CURSOR_IDLE_TURN_RATE_MULTIPLIER *
                distanceSpeedMultiplier *
                turnAcceleration *
                dt;
            return Math.max(-maxTurn, Math.min(maxTurn, headingDelta));
        }

        const bendRatio = getProjectedCursorBendRatio(projection.angleOffset);
        if (bendRatio === 0) return 0;
        const turnRadius = getProjectedCursorTurnRadius(projection.distance, bendRatio);
        const turnRate = TARGET_KEYBOARD_MOVE_SPEED / turnRadius * TARGET_TURN_SPEED_MULTIPLIER;
        return bendDirection *
            turnRate *
            getProjectedCursorTurnAccelerationMultiplier(
                TARGET_PROJECTED_CURSOR_MOVING_TURN_ACCEL_SECONDS,
                TARGET_PROJECTED_CURSOR_MOVING_MAX_TURN_ACCEL_MULTIPLIER
            ) *
            dt;
    }

    function updateProjectedCursorBendInput(dt, bend, stopAngleOffset = NaN) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        if (!Number.isFinite(cursor.angleOffset)) throw new Error("Wizard of Flatland projected cursor bend requires a finite bend");
        if (!Number.isFinite(cursor.distance)) throw new Error("Wizard of Flatland projected cursor bend requires a finite distance");

        const signedBend = Math.max(-1, Math.min(1, bend));
        updateProjectedCursorBendHold(dt, signedBend);
        if (signedBend === 0) return;

        const maxDelta = getProjectedCursorBendMaxDelta(dt, signedBend);
        const nextAngleOffset = cursor.angleOffset + signedBend * maxDelta;
        if (Number.isFinite(stopAngleOffset)) {
            const stopDelta = stopAngleOffset - cursor.angleOffset;
            if (Math.sign(stopDelta) === signedBend && Math.abs(nextAngleOffset - cursor.angleOffset) > Math.abs(stopDelta)) {
                cursor.angleOffset = Math.max(
                    -TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET,
                    Math.min(TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET, stopAngleOffset)
                );
                return;
            }
        }
        cursor.angleOffset = Math.max(
            -TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET,
            Math.min(TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET, nextAngleOffset)
        );
    }

    function getProjectedCursorBendMaxDelta(dt, signedBend) {
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        if (!Number.isFinite(cursor.angleOffset)) throw new Error("Wizard of Flatland projected cursor bend requires a finite bend");
        if (!Number.isFinite(cursor.distance)) throw new Error("Wizard of Flatland projected cursor bend requires a finite distance");
        if (!Number.isFinite(dt) || dt <= 0) throw new Error("Wizard of Flatland projected cursor bend step requires positive finite time");
        if (signedBend !== -1 && signedBend !== 1) throw new Error("Wizard of Flatland projected cursor bend direction must be signed");

        const currentSign = Math.sign(cursor.angleOffset);
        const movingTowardStraight = currentSign !== 0 && currentSign !== Math.sign(signedBend);
        const bendProgress = Math.min(1, Math.abs(cursor.angleOffset) / TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET);
        const speedMultiplier = movingTowardStraight
            ? TARGET_PROJECTED_CURSOR_RETURN_ANGLE_SPEED_MULTIPLIER
            : Math.max(
                TARGET_PROJECTED_CURSOR_OUTWARD_ANGLE_SPEED_MIN_MULTIPLIER,
                1 - bendProgress
            );
        const targetIsMoving = isTargetMovementInputActive();
        const distanceSpeedMultiplier = TARGET_PROJECTED_CURSOR_DISTANCE / Math.max(TARGET_PROJECTED_CURSOR_DISTANCE, cursor.distance);
        return TARGET_PROJECTED_CURSOR_ANGLE_SPEED *
            speedMultiplier *
            distanceSpeedMultiplier *
            getProjectedCursorTurnAccelerationMultiplier(
                targetIsMoving
                    ? TARGET_PROJECTED_CURSOR_MOVING_TURN_ACCEL_SECONDS
                    : TARGET_PROJECTED_CURSOR_IDLE_TURN_ACCEL_SECONDS,
                targetIsMoving
                    ? TARGET_PROJECTED_CURSOR_MOVING_MAX_TURN_ACCEL_MULTIPLIER
                    : TARGET_PROJECTED_CURSOR_IDLE_MAX_TURN_ACCEL_MULTIPLIER
            ) *
            (targetIsMoving ? 1 : TARGET_PROJECTED_CURSOR_IDLE_TURN_RATE_MULTIPLIER) *
            dt;
    }

    function updateProjectedCursorBendHold(dt, bend) {
        const hold = state.projectedCursorBendHold;
        if (!hold || typeof hold !== "object") throw new Error("Wizard of Flatland projected cursor bend hold state is missing");
        if (!Number.isFinite(hold.seconds)) throw new Error("Wizard of Flatland projected cursor bend hold requires finite seconds");
        const direction = Math.max(-1, Math.min(1, bend));
        if (direction === 0) {
            hold.direction = 0;
            hold.seconds = 0;
            return;
        }
        if (hold.direction !== direction) {
            hold.direction = direction;
            hold.seconds = 0;
        }
        hold.seconds += dt;
    }

    function updateProjectedCursorDistanceReturn(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        if (state.projectedCursorMouseMode.active) return;
        if (state.pressedMovementKeys.ArrowUp) return;
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        if (!Number.isFinite(cursor.distance)) throw new Error("Wizard of Flatland projected cursor distance return requires a finite distance");
        cursor.distance = moveToward(
            cursor.distance,
            TARGET_PROJECTED_CURSOR_DISTANCE,
            TARGET_PROJECTED_CURSOR_RETURN_DISTANCE_SPEED * dt
        );
    }

    function updateIdleTargetFacingAndCursor(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        if (isTargetMovementInputActive()) return;
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        if (!Number.isFinite(cursor.distance)) throw new Error("Wizard of Flatland idle cursor requires a finite distance");

        const cursorPoint = getCurrentProjectedCursorWorldPoint();
        const dx = cursorPoint.x - state.target.x;
        const dy = cursorPoint.y - state.target.y;
        const cursorDistance = Math.hypot(dx, dy);
        if (cursorDistance > 0.000001) {
            const mouseBendInputActive = isProjectedCursorMouseBendInputActive();
            const targetHeading = Math.atan2(dy, dx);
            const delta = shortestAngleDelta(state.target.heading, targetHeading);
            const turnAcceleration = isProjectedCursorBendInputActive()
                ? getProjectedCursorTurnAccelerationMultiplier(
                    TARGET_PROJECTED_CURSOR_IDLE_TURN_ACCEL_SECONDS,
                    TARGET_PROJECTED_CURSOR_IDLE_MAX_TURN_ACCEL_MULTIPLIER
                )
                : 1;
            const distanceSpeedMultiplier = TARGET_PROJECTED_CURSOR_DISTANCE / Math.max(TARGET_PROJECTED_CURSOR_MIN_DISTANCE, cursor.distance);
            const maxTurn = TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET /
                TARGET_IDLE_FACE_CURSOR_SECONDS *
                TARGET_TURN_SPEED_MULTIPLIER *
                TARGET_PROJECTED_CURSOR_IDLE_TURN_RATE_MULTIPLIER *
                distanceSpeedMultiplier *
                turnAcceleration *
                dt;
            const appliedTurn = Math.max(-maxTurn, Math.min(maxTurn, delta));
            const fixedCursorPoint = mouseBendInputActive ? cursorPoint : null;
            state.target.heading = normalizeAngle(state.target.heading + appliedTurn);
            if (fixedCursorPoint) updateProjectedCursorFromFixedWorldPoint(fixedCursorPoint);
            if (isProjectedCursorBendInputActive()) return;

            updateProjectedCursorFromFixedWorldPoint({
                x: state.target.x + dx,
                y: state.target.y + dy
            });
        }
    }

    function updateTargetHeadingFromProjectedCursor(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        if (!Number.isFinite(cursor.angleOffset)) throw new Error("Wizard of Flatland projected cursor turn requires a finite bend");
        if (!isTargetMovementInputActive()) return;
        const bendRatio = getProjectedCursorBendRatio(cursor.angleOffset);
        if (bendRatio === 0) return;
        const trace = getCurrentProjectedCursorTrace();
        const effectiveDistance = getProjectedCursorTraceDistance(trace);
        const turnRadius = getProjectedCursorTurnRadius(effectiveDistance, bendRatio);
        const turnRate = TARGET_KEYBOARD_MOVE_SPEED / turnRadius * TARGET_TURN_SPEED_MULTIPLIER;
        if (isProjectedCursorBendInputActive()) {
            const mouseMode = state.projectedCursorMouseMode;
            const turnDirection = mouseMode && mouseMode.active && mouseMode.bendDirection !== 0
                ? Math.sign(mouseMode.bendDirection)
                : Math.sign(bendRatio);
            const turnStep = turnDirection *
                turnRate *
                getProjectedCursorTurnAccelerationMultiplier(
                    TARGET_PROJECTED_CURSOR_MOVING_TURN_ACCEL_SECONDS,
                    TARGET_PROJECTED_CURSOR_MOVING_MAX_TURN_ACCEL_MULTIPLIER
                ) *
                dt;
            const fixedCursorPoint = mouseMode && mouseMode.active ? trace.point : null;
            state.target.heading = normalizeAngle(
                state.target.heading + turnStep
            );
            if (fixedCursorPoint) updateProjectedCursorFromFixedWorldPoint(fixedCursorPoint);
            return;
        }

        const cursorPoint = trace.point;
        const targetHeading = Math.atan2(cursorPoint.y - state.target.y, cursorPoint.x - state.target.x);
        const delta = shortestAngleDelta(state.target.heading, targetHeading);
        const releasedTurnRate = Math.max(
            turnRate,
            TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET / TARGET_IDLE_FACE_CURSOR_SECONDS * TARGET_TURN_SPEED_MULTIPLIER
        );
        const maxTurn = releasedTurnRate * dt;
        const appliedTurn = Math.max(-maxTurn, Math.min(maxTurn, delta));
        state.target.heading = normalizeAngle(state.target.heading + appliedTurn);
        updateProjectedCursorFromFixedWorldPoint(cursorPoint);
    }

    function isTargetMovementInputActive() {
        for (const key of Object.keys(TARGET_FORWARD_KEYS)) {
            if (state.pressedMovementKeys[key]) return true;
        }
        for (const key of Object.keys(TARGET_SIDEWAYS_KEYS)) {
            if (state.pressedMovementKeys[key]) return true;
        }
        return false;
    }

    function isProjectedCursorBendInputActive() {
        return state.pressedMovementKeys.ArrowLeft ||
            state.pressedMovementKeys.ArrowRight ||
            isProjectedCursorMouseBendInputActive();
    }

    function isProjectedCursorMouseBendInputActive() {
        const mouseMode = state.projectedCursorMouseMode;
        return !!(mouseMode && mouseMode.active && mouseMode.bendDirection !== 0);
    }

    function getProjectedCursorTurnAccelerationMultiplier(secondsToMax, maxMultiplier) {
        const seconds = Number(secondsToMax);
        const multiplier = Number(maxMultiplier);
        if (!(seconds > 0) || !(multiplier >= 1)) {
            throw new Error("Wizard of Flatland turn acceleration requires valid curve parameters");
        }
        const hold = state.projectedCursorBendHold;
        if (!hold || typeof hold !== "object") throw new Error("Wizard of Flatland projected cursor bend hold state is missing");
        if (!Number.isFinite(hold.seconds)) throw new Error("Wizard of Flatland turn acceleration requires finite hold seconds");
        const ramp = Math.max(0, Math.min(1, hold.seconds / seconds));
        return 1 + ramp * (multiplier - 1);
    }

    function shootSelectedSpell() {
        if (state.selectedSpell === "fireball") {
            shootFireball();
            return;
        }
        if (state.selectedSpell === "spikes") {
            shootSpike();
            return;
        }
        if (state.selectedSpell === "freeze") return;
        throw new Error(`Wizard of Flatland cannot cast unknown selected spell: ${state.selectedSpell}`);
    }

    function shootFireball() {
        if (state.spellCooldownRemaining > 0) return;
        const cursorPoint = getCurrentProjectedCursorWorldPoint();
        const dx = cursorPoint.x - state.target.x;
        const dy = cursorPoint.y - state.target.y;
        const length = Math.hypot(dx, dy);
        if (!(length > 0.000001)) return;
        const fireballStats = getActiveFireballStats();
        if (!spendWizardMagic(fireballStats.manaCost)) return;
        const dirX = dx / length;
        const dirY = dy / length;
        state.spellCooldownRemaining = fireballStats.cooldown;
        state.spellCooldownDuration = fireballStats.cooldown;
        updateSpellCooldownHud();
        state.fireballs.push({
            spellId: "fireball",
            x: state.target.x + dirX * (TARGET_RADIUS + fireballStats.projectileRadius),
            y: state.target.y + dirY * (TARGET_RADIUS + fireballStats.projectileRadius),
            dirX,
            dirY,
            age: 0,
            impactActive: false,
            speed: fireballStats.projectileSpeed,
            maxAge: fireballStats.maxAge,
            damage: fireballStats.damage,
            explosionRadius: fireballStats.explosionRadius,
            projectileRadius: fireballStats.projectileRadius
        });
    }

    function shootSpike() {
        if (state.spellCooldownRemaining > 0) return;
        const cursorPoint = getCurrentProjectedCursorWorldPoint();
        const dx = cursorPoint.x - state.target.x;
        const dy = cursorPoint.y - state.target.y;
        const length = Math.hypot(dx, dy);
        if (!(length > 0.000001)) return;
        const spikeStats = getActiveSpikeStats();
        if (!spendWizardMagic(spikeStats.manaCost)) return;
        const dirX = dx / length;
        const dirY = dy / length;
        state.spellCooldownRemaining = spikeStats.cooldown;
        state.spellCooldownDuration = spikeStats.cooldown;
        updateSpellCooldownHud();
        state.fireballs.push({
            spellId: "spikes",
            x: state.target.x + dirX * (TARGET_RADIUS + SPIKE_PROJECTILE_RADIUS),
            y: state.target.y + dirY * (TARGET_RADIUS + SPIKE_PROJECTILE_RADIUS),
            dirX,
            dirY,
            age: 0,
            impactActive: false,
            speed: spikeStats.projectileSpeed,
            maxAge: spikeStats.maxAge,
            damage: spikeStats.damage,
            projectileRadius: SPIKE_PROJECTILE_RADIUS
        });
    }

    function updateSpellCooldowns(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        if (state.spellCooldownRemaining <= 0 && state.spellCooldownDuration <= 0 && spellCooldownHudVisible === false) return;
        state.spellCooldownRemaining = Math.max(0, state.spellCooldownRemaining - dt);
        updateSpellCooldownHud();
    }

    function updateHeldSpellCasting(dt) {
        if (!state.spaceHeld) return;
        if (state.selectedSpell === "freeze") {
            updateFreezeSpell(dt);
            return;
        }
        shootSelectedSpell();
    }

    function updateFreezeSpell(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const stats = getActiveFreezeStats();
        const freezeTickCost = stats.costPerSecond * dt;
        if (!spendWizardMagic(freezeTickCost)) {
            state.spaceHeld = false;
            return;
        }
        const dirX = Math.cos(state.target.heading);
        const dirY = Math.sin(state.target.heading);
        const halfAngle = stats.coneAngleRadians * 0.5;
        const startHalfWidth = FREEZE_CONE_START_WIDTH * 0.5;
        const coneSlope = Math.tan(halfAngle);
        const damage = stats.damagePerSecond * dt;
        state.agents = state.agents.filter((agent) => {
            const dx = agent.x - state.target.x;
            const dy = agent.y - state.target.y;
            const forwardDistance = dx * dirX + dy * dirY;
            if (forwardDistance < -agent.radius || forwardDistance > stats.range + agent.radius) return true;
            const lateralDistance = Math.abs(dx * -dirY + dy * dirX);
            const halfWidth = startHalfWidth + Math.max(0, forwardDistance) * coneSlope;
            if (lateralDistance > halfWidth + agent.radius) return true;
            return !damageAgentWithFreezeTemperatureAndMaybeDropCoin(agent, damage);
        });
        emitFreezeParticles(dt, stats, dirX, dirY, halfAngle);
    }

    function damageAgentWithFreezeTemperatureAndMaybeDropCoin(agent, damage) {
        validateAgentTemperature(agent);
        const previousHealth = agent.health;
        const killed = damageAgentAndMaybeDropCoin(agent, damage);
        const appliedDamage = previousHealth - agent.health;
        if (appliedDamage < 0) {
            throw new Error(`Wizard of Flatland freeze damage increased enemy ${agent.id} health`);
        }
        agent.freezeDamageSinceTemperatureDrop += appliedDamage;
        const damagePerDrop = agent.maxHealth * FREEZE_DAMAGE_FRACTION_PER_TEMPERATURE_DROP;
        if (!(damagePerDrop > 0)) {
            throw new Error(`Wizard of Flatland enemy ${agent.id} requires positive freeze temperature threshold`);
        }
        const dropCount = Math.floor((agent.freezeDamageSinceTemperatureDrop + 0.000000001) / damagePerDrop);
        if (dropCount > 0) {
            agent.temperature -= dropCount * FREEZE_TEMPERATURE_DROP_DEGREES;
            agent.freezeDamageSinceTemperatureDrop -= dropCount * damagePerDrop;
            if (agent.freezeDamageSinceTemperatureDrop < 0.000000001) {
                agent.freezeDamageSinceTemperatureDrop = 0;
            }
        }
        if (killed) emitFreezeDeathParticles(agent);
        return killed;
    }

    function emitFreezeDeathParticles(agent) {
        if (!agent || !Number.isFinite(agent.x) || !Number.isFinite(agent.y) || !(agent.radius > 0)) {
            throw new Error("Wizard of Flatland freeze death particles require a finite enemy position and positive radius");
        }
        for (let i = 0; i < FREEZE_DEATH_PARTICLE_COUNT; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * agent.radius;
            const speed = 1.5 + Math.random() * 2;
            state.freezeParticles.push({
                x: agent.x + Math.cos(angle) * distance,
                y: agent.y + Math.sin(angle) * distance,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: 0.045 + Math.random() * 0.09,
                age: 0,
                lifetime: 0.35 + Math.random() * 0.4,
                sourceX: agent.x,
                sourceY: agent.y,
                maxDistance: FREEZE_DEATH_PARTICLE_MAX_DISTANCE,
                boundaryKind: "burst",
                color: Math.random() < 0.5 ? "#8fddff" : "#e8fbff"
            });
        }
    }

    function emitFreezeParticles(dt, stats, dirX, dirY, halfAngle) {
        const levelParticleMultiplier = FREEZE_PARTICLE_COUNT_MULTIPLIER_PER_LEVEL ** (stats.level - 1);
        const requestedCount = dt * FREEZE_PARTICLES_PER_SECOND_AT_LEVEL_ONE * levelParticleMultiplier;
        const count = Math.floor(requestedCount) + (Math.random() < requestedCount % 1 ? 1 : 0);
        for (let i = 0; i < count; i++) {
            const forwardDistance = Math.random() * stats.range;
            const halfWidth = FREEZE_CONE_START_WIDTH * 0.5 + forwardDistance * Math.tan(halfAngle);
            const lateralDistance = (Math.random() * 2 - 1) * halfWidth;
            const x = state.target.x + dirX * forwardDistance - dirY * lateralDistance;
            const y = state.target.y + dirY * forwardDistance + dirX * lateralDistance;
            const angle = Math.atan2(y - state.target.y, x - state.target.x);
            const lifetime = FREEZE_PARTICLE_MIN_LIFETIME +
                Math.random() * (FREEZE_PARTICLE_MAX_LIFETIME - FREEZE_PARTICLE_MIN_LIFETIME);
            state.freezeParticles.push({
                x,
                y,
                vx: Math.cos(angle) * (1.5 + Math.random() * 2.5),
                vy: Math.sin(angle) * (1.5 + Math.random() * 2.5),
                radius: 0.025 + Math.random() * 0.055,
                age: 0,
                lifetime,
                sourceX: state.target.x,
                sourceY: state.target.y,
                maxDistance: stats.range,
                boundaryKind: "cone",
                directionX: dirX,
                directionY: dirY,
                halfAngle,
                color: "#ffffff"
            });
        }
    }

    function updateFreezeParticles(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        state.freezeParticles = state.freezeParticles.filter((particle) => {
            if (
                !Number.isFinite(particle.sourceX) ||
                !Number.isFinite(particle.sourceY) ||
                !(particle.maxDistance > 0) ||
                (particle.boundaryKind !== "cone" && particle.boundaryKind !== "burst")
            ) {
                throw new Error("Wizard of Flatland freeze particle update requires a finite source and positive range");
            }
            particle.age += dt;
            particle.x += particle.vx * dt;
            particle.y += particle.vy * dt;
            let insideBoundary;
            if (particle.boundaryKind === "burst") {
                insideBoundary = Math.hypot(
                    particle.x - particle.sourceX,
                    particle.y - particle.sourceY
                ) <= particle.maxDistance;
            } else {
                if (
                    !Number.isFinite(particle.directionX) ||
                    !Number.isFinite(particle.directionY) ||
                    !(particle.halfAngle > 0)
                ) {
                    throw new Error("Wizard of Flatland cone particle requires a finite direction and positive half angle");
                }
                const dx = particle.x - particle.sourceX;
                const dy = particle.y - particle.sourceY;
                const forwardDistance = dx * particle.directionX + dy * particle.directionY;
                const lateralDistance = Math.abs(dx * -particle.directionY + dy * particle.directionX);
                const halfWidth = FREEZE_CONE_START_WIDTH * 0.5 +
                    Math.max(0, forwardDistance) * Math.tan(particle.halfAngle);
                insideBoundary =
                    forwardDistance >= 0 &&
                    forwardDistance <= particle.maxDistance &&
                    lateralDistance <= halfWidth;
            }
            return particle.age < particle.lifetime && insideBoundary;
        });
    }

    function getEnemyTemperatureSpeedMultiplier(agent) {
        validateAgentTemperature(agent);
        return 1 / (2 ** (-agent.temperature / 10));
    }

    function validateAgentTemperature(agent) {
        if (!agent || typeof agent !== "object") {
            throw new Error("Wizard of Flatland enemy temperature requires an agent");
        }
        if (!Number.isFinite(agent.temperature) || agent.temperature > 0) {
            throw new Error(`Wizard of Flatland enemy ${agent.id} requires a finite non-positive temperature`);
        }
        if (!Number.isFinite(agent.freezeDamageSinceTemperatureDrop) || agent.freezeDamageSinceTemperatureDrop < 0) {
            throw new Error(`Wizard of Flatland enemy ${agent.id} requires finite accumulated freeze damage`);
        }
    }

    function updateEnemyTemperatures(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        for (const agent of state.agents) {
            validateAgentTemperature(agent);
            agent.temperature = Math.min(
                0,
                agent.temperature + ENEMY_TEMPERATURE_RECOVERY_PER_SECOND * dt
            );
        }
    }

    function updatePassiveHealing(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        if (getWizardSpellLevel("healing") < 1) return;
        if (!Array.isArray(getSpellLevelDefinitions())) return;
        validateWizardVitals();
        const missingHealth = state.wizardVitals.maxHealth - state.wizardVitals.health;
        if (!(missingHealth > 0)) return;
        const healingStats = getActiveHealingStats();
        const healingAmount = Math.min(missingHealth, state.wizardVitals.maxHealth / healingStats.secondsToFullHealth * dt);
        if (!(healingAmount > 0)) return;
        healWizard(healingAmount);
    }

    function updateFireballs(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const survivors = [];
        for (const fireball of state.fireballs) {
            validateSpellProjectile(fireball);
            if (fireball.impactActive) {
                if (fireball.spellId !== "fireball") {
                    throw new Error(`Wizard of Flatland unexpected impact animation for ${fireball.spellId}`);
                }
                fireball.age += dt * FIREBALL_IMPACT_ANIMATION_SPEED_MULTIPLIER;
                if (fireball.age < fireball.maxAge) survivors.push(fireball);
                continue;
            }
            const previousX = fireball.x;
            const previousY = fireball.y;
            const nextX = fireball.x + fireball.dirX * fireball.speed * dt;
            const nextY = fireball.y + fireball.dirY * fireball.speed * dt;
            const wallHit = findEarliestFireballWallHit(previousX, previousY, nextX, nextY, fireball.projectileRadius * FIREBALL_WALL_HIT_RADIUS_SCALE);
            if (wallHit) {
                if (fireball.spellId === "spikes") {
                    bounceSpikeProjectile(fireball, wallHit);
                    fireball.age += dt;
                    if (fireball.age < fireball.maxAge && fireball.damage > 0.000001) survivors.push(fireball);
                    continue;
                }
                fireball.x = wallHit.x;
                fireball.y = wallHit.y;
                detonateFireball(fireball);
                fireball.age += dt * FIREBALL_IMPACT_ANIMATION_SPEED_MULTIPLIER;
                if (fireball.age < fireball.maxAge) survivors.push(fireball);
                continue;
            }
            fireball.x = nextX;
            fireball.y = nextY;
            const hitAgent = findAgentIntersectingFireball(fireball);
            if (hitAgent) {
                if (fireball.spellId === "spikes") {
                    if (damageAgentAndMaybeDropCoin(hitAgent, fireball.damage)) {
                        state.spikeShatterEffects.push(createSpikeShatterEffect(hitAgent));
                        state.agents = state.agents.filter((agent) => agent !== hitAgent);
                    }
                    continue;
                }
                detonateFireball(fireball);
                fireball.age += dt * FIREBALL_IMPACT_ANIMATION_SPEED_MULTIPLIER;
                if (fireball.age < fireball.maxAge) survivors.push(fireball);
                continue;
            }
            fireball.age += dt;
            if (fireball.age < fireball.maxAge) survivors.push(fireball);
        }
        state.fireballs = survivors;
        updateFireballExplosions(dt);
    }

    function bounceSpikeProjectile(spike, wallHit) {
        if (!spike || spike.spellId !== "spikes") {
            throw new Error("Wizard of Flatland spike bounce requires a spike projectile");
        }
        if (
            !wallHit ||
            !Number.isFinite(wallHit.x) ||
            !Number.isFinite(wallHit.y) ||
            !Number.isFinite(wallHit.nx) ||
            !Number.isFinite(wallHit.ny)
        ) {
            throw new Error("Wizard of Flatland spike bounce requires finite wall hit data");
        }
        const normalLength = Math.hypot(wallHit.nx, wallHit.ny);
        if (!(normalLength > 0)) throw new Error("Wizard of Flatland spike bounce requires a wall normal");
        const nx = wallHit.nx / normalLength;
        const ny = wallHit.ny / normalLength;
        const incomingLength = Math.hypot(spike.dirX, spike.dirY);
        if (!(incomingLength > 0)) throw new Error("Wizard of Flatland spike bounce requires a movement direction");
        const inX = spike.dirX / incomingLength;
        const inY = spike.dirY / incomingLength;
        const intoNormal = inX * nx + inY * ny;
        const outX = inX - 2 * intoNormal * nx;
        const outY = inY - 2 * intoNormal * ny;
        const outLength = Math.hypot(outX, outY);
        if (!(outLength > 0)) throw new Error("Wizard of Flatland spike bounce produced an invalid direction");
        let reflectedX = outX / outLength;
        let reflectedY = outY / outLength;
        const deflectionDot = Math.max(-1, Math.min(1, inX * reflectedX + inY * reflectedY));
        const deflectionRatio = Math.acos(deflectionDot) / Math.PI;
        if (!Number.isFinite(deflectionRatio) || deflectionRatio < 0 || deflectionRatio > 1) {
            throw new Error("Wizard of Flatland spike bounce produced an invalid deflection");
        }
        const scatterAngle = SPIKE_BOUNCE_MAX_SCATTER_RADIANS * deflectionRatio * Math.random() * (Math.random() < 0.5 ? -1 : 1);
        const scatterCos = Math.cos(scatterAngle);
        const scatterSin = Math.sin(scatterAngle);
        const scatteredX = reflectedX * scatterCos - reflectedY * scatterSin;
        const scatteredY = reflectedX * scatterSin + reflectedY * scatterCos;
        const scatteredLength = Math.hypot(scatteredX, scatteredY);
        if (!(scatteredLength > 0)) throw new Error("Wizard of Flatland spike bounce scatter produced an invalid direction");
        reflectedX = scatteredX / scatteredLength;
        reflectedY = scatteredY / scatteredLength;
        spike.damage *= 1 - deflectionRatio * SPIKE_BOUNCE_MAX_DAMAGE_LOSS_RATIO;
        spike.speed *= 1 - deflectionRatio * SPIKE_BOUNCE_MAX_SPEED_LOSS_RATIO;
        spike.spinHz = SPIKE_BOUNCE_MAX_SPIN_HZ * deflectionRatio * (Math.random() < 0.5 ? -1 : 1);
        spike.spinStartAge = spike.age;
        spike.x = wallHit.x + reflectedX * SPIKE_BOUNCE_WALL_EXIT_EPSILON;
        spike.y = wallHit.y + reflectedY * SPIKE_BOUNCE_WALL_EXIT_EPSILON;
        spike.dirX = reflectedX;
        spike.dirY = reflectedY;
    }

    function validateSpellProjectile(projectile) {
        if (!projectile || typeof projectile !== "object") {
            throw new Error("Wizard of Flatland projectile update requires a projectile");
        }
        if (projectile.spellId !== "fireball" && projectile.spellId !== "spikes") {
            throw new Error(`Wizard of Flatland projectile has unknown spell id: ${projectile.spellId}`);
        }
        if (
            !Number.isFinite(projectile.x) ||
            !Number.isFinite(projectile.y) ||
            !Number.isFinite(projectile.dirX) ||
            !Number.isFinite(projectile.dirY) ||
            !Number.isFinite(projectile.age) ||
            !(projectile.speed > 0) ||
            !(projectile.maxAge > 0) ||
            !(projectile.damage > 0) ||
            !(projectile.projectileRadius > 0) ||
            (projectile.spinHz !== undefined && !Number.isFinite(projectile.spinHz)) ||
            (projectile.spinStartAge !== undefined && !Number.isFinite(projectile.spinStartAge))
        ) {
            throw new Error(`Wizard of Flatland ${projectile.spellId} projectile update requires resolved positive spell stats`);
        }
        if (projectile.spellId === "fireball" && !(projectile.explosionRadius > 0)) {
            throw new Error("Wizard of Flatland fireball update requires a positive explosion radius");
        }
    }

    function updateCoins(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        if (!Array.isArray(state.coins) || state.coins.length === 0) return;
        validateVisibleMazeCoinKeysAreUnique("coin update", state.coins);
        if (!(state.collectedCoinKeys instanceof Set)) {
            throw new Error("Wizard of Flatland coin collection requires collected coin tracking");
        }
        const survivors = [];
        for (const coin of state.coins) {
            validateCoin(coin);
            if (coin.dropPop) {
                coin.dropPop.age = Math.min(coin.dropPop.duration, coin.dropPop.age + dt);
                const popProgress = coin.dropPop.age / coin.dropPop.duration;
                coin.x = coin.dropPop.startX + (coin.homeX - coin.dropPop.startX) * popProgress;
                coin.y = coin.dropPop.startY + (coin.homeY - coin.dropPop.startY) * popProgress;
                if (coin.dropPop.age >= coin.dropPop.duration) {
                    coin.x = coin.homeX;
                    coin.y = coin.homeY;
                    coin.dropPop = null;
                }
            }
            const dx = state.target.x - coin.x;
            const dy = state.target.y - coin.y;
            const distance = Math.hypot(dx, dy);
            if (distance <= MAZE_COIN_ATTRACT_DISTANCE) {
                const reachable = isMazeCoinReachableFromTarget(coin);
                if (distance <= getMazeCoinCollectDistance(coin) && reachable) {
                    collectMazeCoin(coin);
                    continue;
                }
                coin.rushing = reachable;
            } else {
                coin.rushing = false;
            }
            if (coin.rushing && distance > 0.000001) {
                const step = Math.min(distance, MAZE_COIN_RUSH_SPEED * dt);
                const rushX = dx / distance * step;
                const rushY = dy / distance * step;
                coin.x += rushX;
                coin.y += rushY;
                if (coin.dropPop) {
                    coin.dropPop.startX += rushX;
                    coin.dropPop.startY += rushY;
                    coin.homeX += rushX;
                    coin.homeY += rushY;
                }
            }
            const nextDistance = Math.hypot(state.target.x - coin.x, state.target.y - coin.y);
            if (coin.rushing && nextDistance <= getMazeCoinCollectDistance(coin)) {
                collectMazeCoin(coin);
                continue;
            }
            survivors.push(coin);
        }
        state.coins = survivors;
    }

    function updateTalismans(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        for (const agent of state.agents) {
            if (!Number.isFinite(agent.talismanBlockedFlashSeconds)) continue;
            agent.talismanBlockedFlashSeconds = Math.max(0, agent.talismanBlockedFlashSeconds - dt);
        }
        if (!Array.isArray(state.talismans) || state.talismans.length === 0) return;
        for (const talisman of state.talismans) {
            validateTalisman(talisman);
            talisman.flashSeconds = Math.max(0, talisman.flashSeconds - dt);
            talisman.blockedFlashSeconds = Math.max(0, talisman.blockedFlashSeconds - dt);
            talisman.gameSavedPromptSeconds = Math.max(0, talisman.gameSavedPromptSeconds - dt);
            const distance = Math.hypot(state.target.x - talisman.x, state.target.y - talisman.y);
            const touching = distance <= TALISMAN_TOUCH_DISTANCE;
            if (!touching) {
                talisman.touching = false;
                continue;
            }
            if (talisman.touching) continue;
            talisman.touching = true;
            tryActivateTalisman(talisman);
        }
    }

    function tryActivateTalisman(talisman) {
        validateTalisman(talisman);
        if (hasEnemyInMazeSection(talisman.sectionKey)) {
            flashBlockedTalismanActivation(talisman);
            return false;
        }
        const restoredHealth = state.wizardVitals.health < state.wizardVitals.maxHealth;
        const restoredMagic = state.wizardVitals.magic < state.wizardVitals.maxMagic;
        state.wizardVitals.health = state.wizardVitals.maxHealth;
        state.wizardVitals.magic = state.wizardVitals.maxMagic;
        updateStatusBars();
        if (restoredHealth) flashTalismanRestoredBar(healthBar);
        if (restoredMagic) flashTalismanRestoredBar(magicBar);
        if (!(state.activatedTalismanSectionKeys instanceof Set)) {
            throw new Error("Wizard of Flatland talisman activation requires activated talisman tracking");
        }
        state.activatedTalismanSectionKeys.add(talisman.sectionKey);
        state.homeBaseTalismanSectionKey = talisman.sectionKey;
        talisman.activated = true;
        talisman.flashSeconds = TALISMAN_ACTIVATION_FLASH_SECONDS;
        void saveWizardCheckpointToSlot()
            .then(() => {
                if (talisman.pyramidDistance === 0) {
                    talisman.gameSavedPromptSeconds = TALISMAN_GAME_SAVED_PROMPT_SECONDS;
                }
            })
            .catch((error) => {
                setLabelText(labels.workerStatus, "checkpoint save failed");
                console.error("[wizard of flatland checkpoint]", error);
            });
        return true;
    }

    function flashTalismanRestoredBar(bar) {
        if (!bar) {
            throw new Error("Wizard of Flatland talisman recharge flash requires a status bar");
        }
        bar.classList.remove("talismanRechargeFlash");
        void bar.offsetWidth;
        bar.classList.add("talismanRechargeFlash");
    }

    function getHomeBaseTalismanSectionKey() {
        if (typeof state.homeBaseTalismanSectionKey !== "string") {
            throw new Error("Wizard of Flatland home base talisman state must be a string");
        }
        if (state.homeBaseTalismanSectionKey.length === 0) return "";
        validateMazeRoomEnemyBudgetSectionKey(state.homeBaseTalismanSectionKey);
        return state.homeBaseTalismanSectionKey;
    }

    function hasEnemyInMazeSection(sectionKey) {
        validateMazeRoomEnemyBudgetSectionKey(sectionKey);
        for (const agent of state.agents) {
            if (getActorMazeSectionKey(agent) === sectionKey) return true;
        }
        return false;
    }

    function flashBlockedTalismanActivation(talisman) {
        talisman.blockedFlashSeconds = TALISMAN_BLOCKED_FLASH_SECONDS;
        for (const agent of state.agents) {
            if (getActorMazeSectionKey(agent) !== talisman.sectionKey) continue;
            agent.talismanBlockedFlashSeconds = TALISMAN_BLOCKED_FLASH_SECONDS;
        }
    }

    function validateTalisman(talisman) {
        if (!talisman || typeof talisman !== "object") {
            throw new Error("Wizard of Flatland talisman is missing");
        }
        if (typeof talisman.sectionKey !== "string" || talisman.sectionKey.length === 0) {
            throw new Error("Wizard of Flatland talisman requires a section key");
        }
        for (const field of ["x", "y", "radius", "flashSeconds", "blockedFlashSeconds", "gameSavedPromptSeconds"]) {
            if (!Number.isFinite(talisman[field])) {
                throw new Error(`Wizard of Flatland talisman requires finite ${field}`);
            }
        }
    }

    function isMazeCoinReachableFromTarget(coin) {
        validateCoin(coin);
        validateWallBuffer(state.walls, "coin reachability walls");
        if (!Number.isFinite(state.target.x) || !Number.isFinite(state.target.y)) {
            throw new Error("Wizard of Flatland coin reachability requires a finite target");
        }
        if (Math.hypot(state.target.x - coin.x, state.target.y - coin.y) <= 0.000001) return true;
        return !findEarliestSegmentWallHit(state.target.x, state.target.y, coin.x, coin.y, coin.radius);
    }

    function getMazeCoinCollectDistance(coin) {
        validateCoin(coin);
        return TARGET_RADIUS + coin.radius + 0.08;
    }

    function maybeDropCoinForKilledEnemy(agent) {
        if (!agent || !Number.isFinite(agent.x) || !Number.isFinite(agent.y)) {
            throw new Error("Wizard of Flatland enemy coin drop requires a finite enemy");
        }
        const zone = getAgentHomeZone(agent);
        const coinCount = sampleEnemyCoinDropCount(zone);
        const coins = [];
        for (let coinIndex = 0; coinIndex < coinCount; coinIndex++) {
            coins.push(createDroppedMazeCoin(agent.x, agent.y));
        }
        return coins;
    }

    function getAgentHomeZone(agent) {
        const homeSectionKey = getAgentHomeSectionKey(agent);
        const homeCoord = parseMazeSectionKey(homeSectionKey);
        const homeRing = getMazeSectionRing(homeCoord.q, homeCoord.r);
        if (!Number.isInteger(homeRing) || homeRing < 0) {
            throw new Error(`Wizard of Flatland enemy ${agent.id} coin drop has invalid home ring ${homeRing}`);
        }
        return Math.floor(homeRing / MAZE_RING_BOUNDARY_INTERVAL);
    }

    function sampleEnemyCoinDropCount(zone, random = Math.random) {
        if (!Number.isInteger(zone) || zone < 0) {
            throw new Error(`Wizard of Flatland enemy coin drop requires a non-negative integer zone, got ${zone}`);
        }
        if (typeof random !== "function") {
            throw new Error("Wizard of Flatland enemy coin drop requires a random source");
        }
        const probabilities = getEnemyCoinDropProbabilities(zone);
        const roll = random();
        if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
            throw new Error(`Wizard of Flatland enemy coin drop random source returned ${roll}`);
        }
        let cumulativeProbability = 0;
        for (let coinCount = 0; coinCount < probabilities.length; coinCount++) {
            cumulativeProbability += probabilities[coinCount];
            if (roll < cumulativeProbability || coinCount === probabilities.length - 1) return coinCount;
        }
        throw new Error(`Wizard of Flatland enemy coin drop failed to sample zone ${zone}`);
    }

    function getEnemyCoinDropProbabilities(zone) {
        while (ENEMY_COIN_DROP_PROBABILITIES_BY_ZONE.length <= zone) {
            const nextZone = ENEMY_COIN_DROP_PROBABILITIES_BY_ZONE.length;
            ENEMY_COIN_DROP_PROBABILITIES_BY_ZONE.push(
                Object.freeze(generateEnemyCoinDropProbabilities(nextZone))
            );
        }
        return ENEMY_COIN_DROP_PROBABILITIES_BY_ZONE[zone];
    }

    function generateEnemyCoinDropProbabilities(zone) {
        const average = ENEMY_COIN_BASE_AVERAGE * ENEMY_COIN_ZONE_MULTIPLIER ** zone;
        const maximum = Math.ceil(average * 2);
        let ratio = 1;
        if (average < maximum / 2) {
            let low = 0;
            let high = 1;
            for (let iteration = 0; iteration < 80; iteration++) {
                ratio = (low + high) / 2;
                const candidateAverage = getTruncatedGeometricAverage(ratio, maximum);
                if (candidateAverage < average) low = ratio;
                else high = ratio;
            }
            ratio = (low + high) / 2;
        }
        let weightTotal = 0;
        for (let coinCount = 0; coinCount <= maximum; coinCount++) {
            weightTotal += ratio ** coinCount;
        }
        return Array.from(
            { length: maximum + 1 },
            (_, coinCount) => ratio ** coinCount / weightTotal
        );
    }

    function getTruncatedGeometricAverage(ratio, maximum) {
        let weightTotal = 0;
        let weightedCoinTotal = 0;
        for (let coinCount = 0; coinCount <= maximum; coinCount++) {
            const weight = ratio ** coinCount;
            weightTotal += weight;
            weightedCoinTotal += coinCount * weight;
        }
        return weightedCoinTotal / weightTotal;
    }

    function createDroppedMazeCoin(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error("Wizard of Flatland dropped coin requires finite coordinates");
        }
        if (!(state.droppedCoinsByKey instanceof Map)) {
            throw new Error("Wizard of Flatland dropped coin creation requires dropped coin tracking");
        }
        state.nextDroppedCoinId = getNextAvailableDroppedCoinId();
        const landingAngle = Math.random() * Math.PI * 2;
        const landingDistance = Math.sqrt(Math.random()) * ENEMY_COIN_DROP_MAX_LANDING_RADIUS;
        const desiredLandingX = x + Math.cos(landingAngle) * landingDistance;
        const desiredLandingY = y + Math.sin(landingAngle) * landingDistance;
        const landing = constrainMovementToSegmentWalls(
            x,
            y,
            desiredLandingX,
            desiredLandingY,
            MAZE_COIN_RADIUS
        );
        const coord = worldToMazeSectionCoord(landing.x, landing.y, getMazeOptions());
        const coin = {
            key: `drop|${state.nextDroppedCoinId}`,
            sectionKey: mazeSectionKey(coord.q, coord.r),
            q: coord.q,
            r: coord.r,
            wallIndex: -1,
            x,
            y,
            homeX: landing.x,
            homeY: landing.y,
            radius: MAZE_COIN_RADIUS,
            kind: "coin",
            value: MAZE_COIN_VALUE,
            rushing: false,
            phase: Math.random() * Math.PI * 2,
            source: "enemy-drop",
            dropPop: {
                age: 0,
                duration: ENEMY_COIN_DROP_POP_SECONDS,
                startX: x,
                startY: y
            }
        };
        state.nextDroppedCoinId += 1;
        validateCoin(coin);
        if (state.droppedCoinsByKey.has(coin.key)) {
            throw new Error(`Wizard of Flatland dropped coin key was reused: ${coin.key}`);
        }
        if (state.collectedCoinKeys instanceof Set && state.collectedCoinKeys.has(coin.key)) {
            throw new Error(`Wizard of Flatland dropped coin key was already collected: ${coin.key}`);
        }
        state.droppedCoinsByKey.set(coin.key, coin);
        if (!isProceduralMazeScenario() || isDroppedCoinInInstalledMazeSection(coin, getMazeOptions())) {
            addVisibleMazeCoin(coin, "enemy coin drop");
        }
        return coin;
    }

    function collectMazeCoin(coin) {
        validateCoin(coin);
        if (!(state.collectedCoinKeys instanceof Set)) {
            throw new Error("Wizard of Flatland coin collection requires collected coin tracking");
        }
        if (state.collectedCoinKeys.has(coin.key)) {
            throw new Error(`Wizard of Flatland visible coin ${coin.key} was already collected`);
        }
        state.collectedCoinKeys.add(coin.key);
        if (!(state.collectedCoinSectionKeysByCoinKey instanceof Map)) {
            throw new Error("Wizard of Flatland coin collection requires collected coin section tracking");
        }
        state.collectedCoinSectionKeysByCoinKey.set(coin.key, coin.sectionKey);
        if (state.droppedCoinsByKey instanceof Map) state.droppedCoinsByKey.delete(coin.key);
        gainWizardExp(coin.value);
    }

    function validateCoin(coin) {
        if (!coin || typeof coin !== "object") {
            throw new Error("Wizard of Flatland coin is missing");
        }
        if (typeof coin.key !== "string" || coin.key.length === 0) {
            throw new Error("Wizard of Flatland coin requires a key");
        }
        if (typeof coin.sectionKey !== "string" || coin.sectionKey.length === 0) {
            throw new Error(`Wizard of Flatland coin ${coin.key} requires a section key`);
        }
        if (
            !Number.isFinite(coin.x) ||
            !Number.isFinite(coin.y) ||
            !Number.isFinite(coin.homeX) ||
            !Number.isFinite(coin.homeY) ||
            !Number.isFinite(coin.radius)
        ) {
            throw new Error(`Wizard of Flatland coin ${coin.key} requires finite render data`);
        }
        if (coin.kind !== "coin" && coin.kind !== "trophy") {
            throw new Error(`Wizard of Flatland coin ${coin.key} has invalid kind`);
        }
        if (!Number.isFinite(coin.value) || coin.value <= 0) {
            throw new Error(`Wizard of Flatland coin ${coin.key} requires a positive value`);
        }
        if (coin.kind === "trophy" && (coin.value !== MAZE_TROPHY_VALUE || coin.radius !== MAZE_TROPHY_RADIUS)) {
            throw new Error(`Wizard of Flatland trophy ${coin.key} requires value ${MAZE_TROPHY_VALUE}`);
        }
        if (coin.kind === "coin" && (coin.value !== MAZE_COIN_VALUE || coin.radius !== MAZE_COIN_RADIUS)) {
            throw new Error(`Wizard of Flatland coin ${coin.key} requires value ${MAZE_COIN_VALUE}`);
        }
        if (
            coin.dropPop &&
            (
                !Number.isFinite(coin.dropPop.age) ||
                coin.dropPop.age < 0 ||
                !(coin.dropPop.duration > 0) ||
                coin.dropPop.age > coin.dropPop.duration ||
                !Number.isFinite(coin.dropPop.startX) ||
                !Number.isFinite(coin.dropPop.startY) ||
                Math.hypot(coin.homeX - coin.dropPop.startX, coin.homeY - coin.dropPop.startY)
                    > ENEMY_COIN_DROP_MAX_LANDING_RADIUS + 0.000001
            )
        ) {
            throw new Error(`Wizard of Flatland dropped coin ${coin.key} has invalid pop motion`);
        }
    }

    function findEarliestFireballWallHit(fromX, fromY, toX, toY, projectileRadius) {
        if (
            !Number.isFinite(fromX) ||
            !Number.isFinite(fromY) ||
            !Number.isFinite(toX) ||
            !Number.isFinite(toY) ||
            !Number.isFinite(projectileRadius)
        ) {
            throw new Error("Wizard of Flatland fireball wall hit test requires finite movement");
        }
        if (!(projectileRadius > 0)) throw new Error("Wizard of Flatland fireball wall hit test requires a positive projectile radius");
        let best = null;
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            const hit = sweptCircleSegmentHit(
                fromX,
                fromY,
                toX,
                toY,
                state.walls[i + WALL_X1],
                state.walls[i + WALL_Y1],
                state.walls[i + WALL_X2],
                state.walls[i + WALL_Y2],
                projectileRadius + WALL_WORLD_HALF_THICKNESS
            );
            if (!hit || (best && hit.t >= best.t)) continue;
            best = {
                t: hit.t,
                x: fromX + (toX - fromX) * hit.t,
                y: fromY + (toY - fromY) * hit.t,
                nx: hit.nx,
                ny: hit.ny
            };
        }
        return best;
    }

    function findAgentIntersectingFireball(fireball) {
        if (
            !fireball ||
            !Number.isFinite(fireball.x) ||
            !Number.isFinite(fireball.y) ||
            !Number.isFinite(fireball.projectileRadius)
        ) {
            throw new Error("Wizard of Flatland fireball hit test requires finite fireball data");
        }
        if (!(fireball.projectileRadius > 0)) throw new Error("Wizard of Flatland fireball hit test requires a positive projectile radius");
        return state.agents.find((agent) => {
            const distance = Math.hypot(agent.x - fireball.x, agent.y - fireball.y);
            return distance <= fireball.projectileRadius + agent.radius;
        }) || null;
    }

    function detonateFireball(fireball) {
        if (!fireball || !Number.isFinite(fireball.x) || !Number.isFinite(fireball.y)) {
            throw new Error("Wizard of Flatland fireball explosion requires a finite fireball");
        }
        if (!(fireball.damage > 0) || !(fireball.explosionRadius > 0)) {
            throw new Error("Wizard of Flatland fireball explosion requires resolved positive spell stats");
        }
        if (fireball.impactActive) return;
        fireball.impactActive = true;
        damageAgentsIntersectingCircle(fireball.x, fireball.y, fireball.explosionRadius, fireball.damage);
        damageWizardIntersectingFireballBlast(fireball.x, fireball.y, fireball.explosionRadius, fireball.damage);
        state.fireballExplosions.push({
            x: fireball.x,
            y: fireball.y,
            radius: fireball.explosionRadius,
            age: 0
        });
    }

    function damageWizardIntersectingFireballBlast(circleX, circleY, radius, damage) {
        if (!Number.isFinite(circleX) || !Number.isFinite(circleY) || !Number.isFinite(radius)) {
            throw new Error("Wizard of Flatland fireball self-damage requires a finite damage circle");
        }
        if (!(damage > 0)) throw new Error("Wizard of Flatland fireball self-damage requires a positive amount");
        if (!Number.isFinite(state.target.x) || !Number.isFinite(state.target.y)) {
            throw new Error("Wizard of Flatland fireball self-damage requires a finite wizard position");
        }
        const distance = Math.hypot(state.target.x - circleX, state.target.y - circleY);
        if (distance > radius + FIREBALL_HALF_DAMAGE_OUTER_RADIUS + TARGET_RADIUS) return;
        const damageScale = distance <= radius + TARGET_RADIUS ? 1 : 0.5;
        damageWizard(damage * damageScale * FIREBALL_SELF_DAMAGE_SCALE);
    }

    function updateFireballExplosions(dt) {
        state.fireballExplosions = state.fireballExplosions.filter((explosion) => {
            explosion.age += dt;
            return explosion.age < FIREBALL_EXPLOSION_VISUAL_SECONDS;
        });
    }

    function updateFireDeathEffects(dt) {
        if (!Array.isArray(state.fireDeathEffects)) {
            throw new Error("Wizard of Flatland fire death update requires effect tracking");
        }
        state.fireDeathEffects = state.fireDeathEffects.filter((effect) => {
            validateFireDeathEffect(effect);
            effect.age += dt;
            return effect.age < FIRE_DEATH_VISUAL_SECONDS;
        });
    }

    function createFireDeathEffect(agent) {
        if (!agent || !Number.isFinite(agent.x) || !Number.isFinite(agent.y) || !(agent.radius > 0)) {
            throw new Error("Wizard of Flatland fire death requires finite enemy geometry");
        }
        const flames = [];
        for (let i = 0; i < FIRE_DEATH_FLAME_COUNT; i++) {
            flames.push({
                offsetX: (Math.random() - 0.5) * agent.radius * 0.9,
                offsetY: (Math.random() - 0.5) * agent.radius * 0.45,
                size: agent.radius * (0.38 + Math.random() * 0.28) * 1.6875,
                phase: Math.random() * Math.PI * 2,
                sway: 0.65 + Math.random() * 0.7,
                speed: 27 + Math.random() * 16,
                delay: Math.random() * 0.12
            });
        }
        return { age: 0, x: agent.x, y: agent.y, radius: agent.radius, flames };
    }

    function validateFireDeathEffect(effect) {
        if (
            !effect ||
            !Number.isFinite(effect.age) ||
            effect.age < 0 ||
            !Number.isFinite(effect.x) ||
            !Number.isFinite(effect.y) ||
            !(effect.radius > 0) ||
            !Array.isArray(effect.flames) ||
            effect.flames.length !== FIRE_DEATH_FLAME_COUNT
        ) {
            throw new Error("Wizard of Flatland fire death effect requires finite flame geometry");
        }
    }

    function updateSpikeShatterEffects(dt) {
        if (!Array.isArray(state.spikeShatterEffects)) {
            throw new Error("Wizard of Flatland spike shatter update requires effect tracking");
        }
        state.spikeShatterEffects = state.spikeShatterEffects.filter((effect) => {
            validateSpikeShatterEffect(effect);
            effect.age += dt;
            return effect.age < SPIKE_SHATTER_VISUAL_SECONDS;
        });
    }

    function createSpikeShatterEffect(agent) {
        if (
            !agent ||
            !Number.isFinite(agent.x) ||
            !Number.isFinite(agent.y) ||
            !(agent.radius > 0) ||
            !Number.isFinite(agent.temperature)
        ) {
            throw new Error("Wizard of Flatland spike shatter requires finite enemy geometry");
        }
        const angle = getAgentFacingAngle(agent);
        const baseAngleOffset = Math.PI / 6;
        const vertices = [
            { x: Math.cos(angle) * agent.radius, y: Math.sin(angle) * agent.radius },
            {
                x: Math.cos(angle + Math.PI - baseAngleOffset) * agent.radius,
                y: Math.sin(angle + Math.PI - baseAngleOffset) * agent.radius
            },
            {
                x: Math.cos(angle + Math.PI + baseAngleOffset) * agent.radius,
                y: Math.sin(angle + Math.PI + baseAngleOffset) * agent.radius
            }
        ];
        const centerWeights = vertices.map(() => 0.7 + Math.random() * 0.6);
        const weightTotal = centerWeights.reduce((sum, weight) => sum + weight, 0);
        const center = vertices.reduce((point, vertex, index) => ({
            x: point.x + vertex.x * centerWeights[index] / weightTotal,
            y: point.y + vertex.y * centerWeights[index] / weightTotal
        }), { x: 0, y: 0 });
        const edgePoints = vertices.map((vertex, index) => {
            const next = vertices[(index + 1) % vertices.length];
            const ratio = 0.32 + Math.random() * 0.36;
            return {
                x: vertex.x + (next.x - vertex.x) * ratio,
                y: vertex.y + (next.y - vertex.y) * ratio
            };
        });
        const polygons = [];
        for (let i = 0; i < vertices.length; i++) {
            polygons.push([center, vertices[i], edgePoints[i]]);
            polygons.push([center, edgePoints[i], vertices[(i + 1) % vertices.length]]);
        }
        const fragments = polygons.map((polygon) => {
            const centroid = polygon.reduce((point, vertex) => ({
                x: point.x + vertex.x / polygon.length,
                y: point.y + vertex.y / polygon.length
            }), { x: 0, y: 0 });
            let directionAngle = Math.atan2(centroid.y, centroid.x);
            if (Math.hypot(centroid.x, centroid.y) < 0.000001) directionAngle = Math.random() * Math.PI * 2;
            directionAngle += (Math.random() - 0.5) * Math.PI / 3;
            const offsetRadius = SPIKE_SHATTER_MAX_OFFSET_RADIUS * (0.55 + Math.random() * 0.45);
            return {
                centerX: agent.x + centroid.x,
                centerY: agent.y + centroid.y,
                points: polygon.map((vertex) => ({
                    x: vertex.x - centroid.x,
                    y: vertex.y - centroid.y
                })),
                offsetX: Math.cos(directionAngle) * offsetRadius,
                offsetY: Math.sin(directionAngle) * offsetRadius,
                rotation: (Math.random() * 2 - 1) * SPIKE_SHATTER_MAX_ROTATION
            };
        });
        const warmColor = agent.isDesignatedAttacker ? "#6f0000" : getAgentHomeZoneOppositeColor(agent);
        return {
            age: 0,
            fillColor: getAgentTemperatureColor(warmColor, agent.temperature),
            fragments
        };
    }

    function validateSpikeShatterEffect(effect) {
        if (!effect || typeof effect !== "object") throw new Error("Wizard of Flatland spike shatter effect is missing");
        if (!Number.isFinite(effect.age) || effect.age < 0) {
            throw new Error("Wizard of Flatland spike shatter effect requires finite age");
        }
        if (typeof effect.fillColor !== "string" || !Array.isArray(effect.fragments) || effect.fragments.length === 0) {
            throw new Error("Wizard of Flatland spike shatter effect requires color and fragments");
        }
    }

    function updateWallShatterEffects(dt) {
        if (!Array.isArray(state.wallShatterEffects)) {
            throw new Error("Wizard of Flatland wall shatter update requires effect tracking");
        }
        state.wallShatterEffects = state.wallShatterEffects.filter((effect) => {
            validateWallShatterEffect(effect);
            effect.age += dt;
            return effect.age < WALL_SHATTER_VISUAL_SECONDS;
        });
    }

    function createWallShatterEffect(gap) {
        validateBrokenWallGap(gap);
        const dx = gap.bx - gap.ax;
        const dy = gap.by - gap.ay;
        const length = Math.hypot(dx, dy);
        if (!(length > 0)) throw new Error("Wizard of Flatland wall shatter requires a separated wall");
        const tx = dx / length;
        const ty = dy / length;
        const nx = -ty;
        const ny = tx;
        const fragments = [];
        for (let i = 0; i < WALL_SHATTER_FRAGMENT_COUNT; i++) {
            const t = gap.startT + (gap.endT - gap.startT) * ((i + 0.5) / WALL_SHATTER_FRAGMENT_COUNT);
            const scatter = (Math.random() - 0.5) * WALL_WORLD_THICKNESS * 1.4;
            const speed = 1.2 + Math.random() * 2.6;
            const side = Math.random() < 0.5 ? -1 : 1;
            fragments.push({
                x: gap.ax + dx * t + nx * scatter,
                y: gap.ay + dy * t + ny * scatter,
                vx: tx * (Math.random() - 0.5) * 1.4 + nx * side * speed,
                vy: ty * (Math.random() - 0.5) * 1.4 + ny * side * speed,
                size: 0.08 + Math.random() * 0.12,
                spin: (Math.random() - 0.5) * 12,
                angle: Math.random() * Math.PI * 2
            });
        }
        return { age: 0, fragments };
    }

    function validateWallShatterEffect(effect) {
        if (!effect || typeof effect !== "object") throw new Error("Wizard of Flatland wall shatter effect is missing");
        if (!Number.isFinite(effect.age) || effect.age < 0) throw new Error("Wizard of Flatland wall shatter effect requires finite age");
        if (!Array.isArray(effect.fragments)) throw new Error("Wizard of Flatland wall shatter effect requires fragments");
    }

    function damageAgentsIntersectingCircle(circleX, circleY, radius, damage) {
        if (!Number.isFinite(circleX) || !Number.isFinite(circleY) || !Number.isFinite(radius)) {
            throw new Error("Wizard of Flatland fireball explosion requires a finite damage circle");
        }
        if (!(damage > 0)) throw new Error("Wizard of Flatland fireball damage requires a positive amount");
        state.agents = state.agents.filter((agent) => {
            const distance = Math.hypot(agent.x - circleX, agent.y - circleY);
            if (distance > radius + FIREBALL_HALF_DAMAGE_OUTER_RADIUS + agent.radius) return true;
            const damageScale = distance <= radius + agent.radius ? 1 : 0.5;
            const killed = damageAgentAndMaybeDropCoin(agent, damage * damageScale);
            if (killed) state.fireDeathEffects.push(createFireDeathEffect(agent));
            return !killed;
        });
    }

    function damageAgentAndMaybeDropCoin(agent, damage) {
        if (damageAgent(agent, damage)) {
            maybeDropCoinForKilledEnemy(agent);
            addEnemyDeathPathfindingCost(agent);
            return true;
        }
        return false;
    }

    function addEnemyDeathPathfindingCost(agent) {
        if (!agent || !Number.isFinite(agent.x) || !Number.isFinite(agent.y)) {
            throw new Error("Wizard of Flatland enemy death path cost requires a finite enemy position");
        }
        if (!(state.temporaryPathCostsByNodeKey instanceof Map)) {
            throw new Error("Wizard of Flatland enemy death path cost requires temporary path cost tracking");
        }
        const pathIndices = nearestReachablePathfindingNodes(agent.x, agent.y, ENEMY_DEATH_PATH_COST_TILE_COUNT);
        if (pathIndices.length !== ENEMY_DEATH_PATH_COST_TILE_COUNT) {
            throw new Error(`Wizard of Flatland enemy ${agent.id} death path cost could not find ${ENEMY_DEATH_PATH_COST_TILE_COUNT} reachable path nodes`);
        }
        const expiresAt = performance.now() / 1000 + ENEMY_DEATH_PATH_COST_SECONDS;
        for (const pathIndex of pathIndices) {
            const nodeKey = getPathfindingNodeKey(pathIndex);
            addTemporaryPathCostPenalty(
                nodeKey,
                getPathfindingNodeX(pathIndex),
                getPathfindingNodeY(pathIndex),
                ENEMY_DEATH_PATH_COST,
                expiresAt
            );
        }
        addEnemyDeathBlocker(agent);
        publishTemporaryPathCostChange();
    }

    function addTemporaryPathCostPenalty(nodeKey, x, y, cost, expiresAt) {
        if (!(state.temporaryPathCostsByNodeKey instanceof Map)) {
            throw new Error("Wizard of Flatland temporary path cost add requires temporary path cost tracking");
        }
        if (typeof nodeKey !== "string" || nodeKey.length === 0) {
            throw new Error("Wizard of Flatland temporary path cost add requires a node key");
        }
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(`Wizard of Flatland temporary path cost ${nodeKey} add requires finite coordinates`);
        }
        if (!Number.isFinite(cost) || cost <= 0) {
            throw new Error(`Wizard of Flatland temporary path cost ${nodeKey} add requires a positive finite cost`);
        }
        if (!Number.isFinite(expiresAt)) {
            throw new Error(`Wizard of Flatland temporary path cost ${nodeKey} add requires a finite expiry time`);
        }
        const existing = state.temporaryPathCostsByNodeKey.get(nodeKey);
        if (existing) {
            validateTemporaryPathCostPenalty(nodeKey, existing);
            existing.entries.push({ cost, expiresAt });
            existing.cost = getTemporaryPathCostEntryTotal(existing.entries);
            return;
        }
        state.temporaryPathCostsByNodeKey.set(nodeKey, {
            x,
            y,
            cost,
            entries: [{ cost, expiresAt }]
        });
    }

    function addEnemyDeathBlocker(agent) {
        if (!agent || !Number.isFinite(agent.x) || !Number.isFinite(agent.y)) {
            throw new Error("Wizard of Flatland enemy death blocker requires a finite enemy position");
        }
        if (!(state.temporaryDeathBlockersByKey instanceof Map)) {
            throw new Error("Wizard of Flatland enemy death blocker requires blocker tracking");
        }
        const key = `death-blocker|${state.pathfindingRequestId++}`;
        state.temporaryDeathBlockersByKey.set(key, {
            x: agent.x,
            y: agent.y,
            radius: ENEMY_DEATH_BLOCKER_RADIUS,
            expiresAt: performance.now() / 1000 + ENEMY_DEATH_BLOCKER_SECONDS
        });
    }

    function updateTemporaryPathfindingCosts() {
        if (!(state.temporaryPathCostsByNodeKey instanceof Map)) {
            throw new Error("Wizard of Flatland temporary path cost update requires temporary path cost tracking");
        }
        if (state.temporaryPathCostsByNodeKey.size === 0) return;
        const nowSeconds = performance.now() / 1000;
        let changed = false;
        for (const [nodeKey, penalty] of state.temporaryPathCostsByNodeKey) {
            validateTemporaryPathCostPenalty(nodeKey, penalty);
            const activeEntries = penalty.entries.filter((entry) => entry.expiresAt > nowSeconds);
            if (activeEntries.length === penalty.entries.length) continue;
            changed = true;
            if (activeEntries.length === 0) {
                state.temporaryPathCostsByNodeKey.delete(nodeKey);
                continue;
            }
            penalty.entries = activeEntries;
            penalty.cost = getTemporaryPathCostEntryTotal(activeEntries);
        }
        if (changed) publishTemporaryPathCostChange();
    }

    function updateLiveEnemyPathfindingCosts() {
        if (!(state.liveEnemyPathCostsByNodeKey instanceof Map)) {
            throw new Error("Wizard of Flatland live enemy path cost update requires live path cost tracking");
        }
        const nextCostsByNodeKey = buildLiveEnemyPathfindingCosts();
        const nextSignature = getLiveEnemyPathCostSignature(nextCostsByNodeKey);
        if (nextSignature === state.liveEnemyPathCostSignature) return;
        state.liveEnemyPathCostsByNodeKey = nextCostsByNodeKey;
        state.liveEnemyPathCostSignature = nextSignature;
        publishPathfindingCostModifierChange();
    }

    function buildLiveEnemyPathfindingCosts() {
        const costsByNodeKey = new Map();
        let skippedAgents = 0;
        if (state.agents.length === 0) return costsByNodeKey;
        for (const agent of state.agents) {
            if (!agent || !Number.isFinite(agent.x) || !Number.isFinite(agent.y)) {
                throw new Error("Wizard of Flatland live enemy path cost requires finite enemy positions");
            }
            if (Number.isFinite(agent.health) && agent.health <= 0) continue;
            if (!isAgentInInstalledMazeSection(agent)) continue;
            const pathIndices = nearestLocalPassablePathfindingNodes(agent.x, agent.y, LIVE_ENEMY_PATH_COST_TILE_COUNT, {
                allowFewer: true
            });
            if (pathIndices.length === 0) {
                skippedAgents += 1;
                continue;
            }
            if (pathIndices.length > LIVE_ENEMY_PATH_COST_TILE_COUNT) {
                throw new Error(`Wizard of Flatland enemy ${agent.id} live path cost could not find ${LIVE_ENEMY_PATH_COST_TILE_COUNT} reachable path nodes`);
            }
            for (const pathIndex of pathIndices) {
                const nodeKey = getPathfindingNodeKey(pathIndex);
                const existing = costsByNodeKey.get(nodeKey);
                if (existing) {
                    existing.cost += LIVE_ENEMY_PATH_COST;
                    continue;
                }
                costsByNodeKey.set(nodeKey, {
                    x: getPathfindingNodeX(pathIndex),
                    y: getPathfindingNodeY(pathIndex),
                    cost: LIVE_ENEMY_PATH_COST
                });
            }
        }
        if (state.debug && typeof state.debug === "object") {
            state.debug.liveEnemyPathCostSkippedAgents = skippedAgents;
        }
        return costsByNodeKey;
    }

    function getLiveEnemyPathCostSignature(costsByNodeKey) {
        if (!(costsByNodeKey instanceof Map)) {
            throw new Error("Wizard of Flatland live enemy path cost signature requires a cost map");
        }
        if (costsByNodeKey.size === 0) return "";
        const parts = [];
        for (const [nodeKey, penalty] of costsByNodeKey) {
            validateLiveEnemyPathCostPenalty(nodeKey, penalty);
            parts.push(`${nodeKey}:${penalty.cost}`);
        }
        parts.sort();
        return parts.join("|");
    }

    function validateLiveEnemyPathCostPenalty(nodeKey, penalty) {
        if (typeof nodeKey !== "string" || nodeKey.length === 0) {
            throw new Error("Wizard of Flatland live enemy path cost requires a node key");
        }
        if (!penalty || typeof penalty !== "object") {
            throw new Error(`Wizard of Flatland live enemy path cost ${nodeKey} is missing`);
        }
        if (!Number.isFinite(penalty.x) || !Number.isFinite(penalty.y)) {
            throw new Error(`Wizard of Flatland live enemy path cost ${nodeKey} requires finite render coordinates`);
        }
        if (!Number.isFinite(penalty.cost) || penalty.cost <= 0) {
            throw new Error(`Wizard of Flatland live enemy path cost ${nodeKey} requires a positive finite cost`);
        }
    }

    function updateTemporaryDeathBlockers() {
        if (!(state.temporaryDeathBlockersByKey instanceof Map)) {
            throw new Error("Wizard of Flatland temporary death blocker update requires blocker tracking");
        }
        if (state.temporaryDeathBlockersByKey.size === 0) return;
        const nowSeconds = performance.now() / 1000;
        for (const [key, blocker] of state.temporaryDeathBlockersByKey) {
            validateTemporaryDeathBlocker(key, blocker);
            if (blocker.expiresAt > nowSeconds) continue;
            state.temporaryDeathBlockersByKey.delete(key);
        }
    }

    function validateTemporaryDeathBlocker(key, blocker) {
        if (typeof key !== "string" || key.length === 0) {
            throw new Error("Wizard of Flatland temporary death blocker requires a key");
        }
        if (!blocker || typeof blocker !== "object") {
            throw new Error(`Wizard of Flatland temporary death blocker ${key} is missing`);
        }
        if (!Number.isFinite(blocker.x) || !Number.isFinite(blocker.y)) {
            throw new Error(`Wizard of Flatland temporary death blocker ${key} requires finite coordinates`);
        }
        if (!Number.isFinite(blocker.radius) || !(blocker.radius > 0)) {
            throw new Error(`Wizard of Flatland temporary death blocker ${key} requires a positive finite radius`);
        }
        if (!Number.isFinite(blocker.expiresAt)) {
            throw new Error(`Wizard of Flatland temporary death blocker ${key} requires a finite expiry time`);
        }
    }

    function publishTemporaryPathCostChange() {
        publishPathfindingCostModifierChange();
    }

    function publishPathfindingCostModifierChange() {
        applyTemporaryPathfindingModifiersToNodes();
        state.nodeLayer.dirty = true;
        publishPathfindingSnapshot({ preserveVersion: true });
    }

    function applyTemporaryPathfindingModifiersToNodes(skipMissingNodes = false) {
        if (!(state.temporaryPathCostsByNodeKey instanceof Map)) {
            throw new Error("Wizard of Flatland temporary path cost application requires temporary path cost tracking");
        }
        if (!(state.liveEnemyPathCostsByNodeKey instanceof Map)) {
            throw new Error("Wizard of Flatland live enemy path cost application requires live path cost tracking");
        }
        const nodes = state.nodeLayer && state.nodeLayer.nodes;
        const baselineNodes = state.nodeLayer && state.nodeLayer.snapshotNodes;
        if (!(nodes instanceof Float32Array) || nodes.length % PATH_SNAPSHOT_NODE_STRIDE !== 0) {
            if (skipMissingNodes) return;
            throw new Error("Wizard of Flatland temporary path modifiers require packed pathfinding nodes");
        }
        if (!(baselineNodes instanceof Float32Array) || baselineNodes.length !== nodes.length) {
            if (skipMissingNodes) return;
            throw new Error("Wizard of Flatland temporary path modifiers require baseline pathfinding nodes");
        }
        for (let base = 0; base < nodes.length; base += PATH_SNAPSHOT_NODE_STRIDE) {
            nodes[base + PATH_NODE_BLOCKED] = baselineNodes[base + PATH_NODE_BLOCKED];
            nodes[base + PATH_NODE_TEMPORARY_COST] = 0;
        }
        for (const [nodeKey, penalty] of state.temporaryPathCostsByNodeKey) {
            validateTemporaryPathCostPenalty(nodeKey, penalty);
            const pathIndex = getPathfindingNodeIndexForKey(nodeKey);
            if (!Number.isInteger(pathIndex)) continue;
            nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_TEMPORARY_COST] = penalty.cost;
        }
        for (const [nodeKey, penalty] of state.liveEnemyPathCostsByNodeKey) {
            validateLiveEnemyPathCostPenalty(nodeKey, penalty);
            const pathIndex = getPathfindingNodeIndexForKey(nodeKey);
            if (!Number.isInteger(pathIndex)) continue;
            nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_TEMPORARY_COST] += penalty.cost;
        }
    }

    function validateTemporaryPathCostPenalty(nodeKey, penalty) {
        if (typeof nodeKey !== "string" || nodeKey.length === 0) {
            throw new Error("Wizard of Flatland temporary path cost requires a node key");
        }
        if (!penalty || typeof penalty !== "object") {
            throw new Error(`Wizard of Flatland temporary path cost ${nodeKey} is missing`);
        }
        if (!Number.isFinite(penalty.x) || !Number.isFinite(penalty.y)) {
            throw new Error(`Wizard of Flatland temporary path cost ${nodeKey} requires finite render coordinates`);
        }
        if (!Number.isFinite(penalty.cost) || penalty.cost < 0) {
            throw new Error(`Wizard of Flatland temporary path cost ${nodeKey} requires a non-negative finite cost`);
        }
        if (!Array.isArray(penalty.entries) || penalty.entries.length === 0) {
            throw new Error(`Wizard of Flatland temporary path cost ${nodeKey} requires active cost entries`);
        }
        const total = getTemporaryPathCostEntryTotal(penalty.entries);
        if (Math.abs(total - penalty.cost) > 0.000001) {
            throw new Error(`Wizard of Flatland temporary path cost ${nodeKey} total is inconsistent`);
        }
    }

    function getTemporaryPathCostEntryTotal(entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
            throw new Error("Wizard of Flatland temporary path cost total requires entries");
        }
        let total = 0;
        for (const entry of entries) {
            if (!entry || typeof entry !== "object") {
                throw new Error("Wizard of Flatland temporary path cost entry is missing");
            }
            if (!Number.isFinite(entry.cost) || entry.cost <= 0) {
                throw new Error("Wizard of Flatland temporary path cost entry requires a positive finite cost");
            }
            if (!Number.isFinite(entry.expiresAt)) {
                throw new Error("Wizard of Flatland temporary path cost entry requires a finite expiry time");
            }
            total += entry.cost;
        }
        return total;
    }

    function damageAgent(agent, damage) {
        validateAgentHealth(agent);
        if (!(damage > 0)) throw new Error("Wizard of Flatland enemy damage requires a positive amount");
        const previousHealth = agent.health;
        agent.health = Math.max(0, agent.health - damage);
        return previousHealth > 0 && agent.health <= 0;
    }

    function validateAgentHealth(agent) {
        if (!agent || typeof agent !== "object") throw new Error("Wizard of Flatland enemy health requires an agent");
        if (!Number.isFinite(agent.health) || !Number.isFinite(agent.maxHealth)) {
            throw new Error(`Wizard of Flatland enemy ${agent.id} requires finite health`);
        }
        if (!(agent.maxHealth > 0)) throw new Error(`Wizard of Flatland enemy ${agent.id} requires positive max health`);
        if (agent.health < 0 || agent.health > agent.maxHealth) {
            throw new Error(`Wizard of Flatland enemy ${agent.id} health is outside its maximum`);
        }
    }

    function polygonIntersectsCircle(polygon, circleX, circleY, radius) {
        if (!Number.isFinite(circleX) || !Number.isFinite(circleY) || !Number.isFinite(radius)) {
            throw new Error("Wizard of Flatland polygon-circle hit test requires finite circle data");
        }
        if (pointInPolygon(circleX, circleY, polygon)) return true;
        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i];
            const b = polygon[(i + 1) % polygon.length];
            if (pointSegmentDistance(circleX, circleY, a.x, a.y, b.x, b.y) <= radius) return true;
        }
        return false;
    }

    function pointInPolygon(x, y, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i];
            const b = polygon[j];
            if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
                throw new Error("Wizard of Flatland polygon hit test requires finite polygon points");
            }
            const intersects = ((a.y > y) !== (b.y > y)) &&
                x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x;
            if (intersects) inside = !inside;
        }
        return inside;
    }

    function moveTargetWithNpcPush(desiredX, desiredY) {
        if (!Number.isFinite(desiredX) || !Number.isFinite(desiredY)) {
            throw new Error("Wizard of Flatland target move requires finite coordinates");
        }
        const constrainedMove = constrainMovementToSegmentWalls(
            state.target.x,
            state.target.y,
            desiredX,
            desiredY,
            TARGET_RADIUS
        );
        state.target.x = constrainedMove.x;
        state.target.y = constrainedMove.y;
        constrainTargetToWalls();
        resolveTargetNpcContacts(false);
    }

    function resolveTargetNpcContacts(resolveAgentContacts = true) {
        if (!TARGET_NPC_CONTACTS_ENABLED) return;
        let pushes = 0;
        for (let pass = 0; pass < TARGET_NPC_PUSH_ITERATIONS; pass++) {
            let changed = false;
            for (const agent of state.agents) {
                const result = resolveTargetAgentOverlap(agent);
                if (!result.changed) continue;
                pushes += 1;
                changed = true;
            }
            if (resolveAgentContacts) {
                const agentContacts = resolveAgentAgentOverlapsSpatial();
                if (agentContacts.pushes > 0) {
                    pushes += agentContacts.pushes;
                    changed = true;
                }
            }
            if (!changed) break;
        }
        // Temporarily disabled while tuning faster NPC movement/contact behavior.
        // assertContactInvariants();
        state.targetPushes = pushes;
    }

    function resolveAgentAgentOverlapsSpatial() {
        if (state.agents.length <= 0) return { pushes: 0 };
        const contactCellSize = getAgentContactGridCellSize();
        const grid = buildAgentContactGrid(contactCellSize);
        let pushes = 0;
        const checkedPairs = new Set();
        for (const [cellKey, cellAgents] of grid) {
            const cell = parseAgentContactCellKey(cellKey);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const neighborAgents = grid.get(getAgentContactCellKey(cell.x + dx, cell.y + dy));
                    if (!neighborAgents) continue;
                    for (const left of cellAgents) {
                        for (const right of neighborAgents) {
                            if (left === right) continue;
                            const pairKey = getAgentPairKey(left, right);
                            if (checkedPairs.has(pairKey)) continue;
                            checkedPairs.add(pairKey);
                            const result = resolveAgentAgentOverlap(left, right);
                            if (!result.changed) continue;
                            pushes += 1;
                        }
                    }
                }
            }
        }
        return { pushes };
    }

    function getAgentContactGridCellSize() {
        let maxRadius = 0;
        for (const agent of state.agents) {
            if (!agent || !Number.isFinite(agent.radius) || !(agent.radius > 0)) {
                throw new Error("Wizard of Flatland contact grid requires positive enemy radii");
            }
            maxRadius = Math.max(maxRadius, agent.radius);
        }
        if (!(maxRadius > 0)) throw new Error("Wizard of Flatland contact grid requires at least one enemy radius");
        return maxRadius * 2 + NPC_CONTACT_GRID_PADDING;
    }

    function buildAgentContactGrid(contactCellSize) {
        const grid = new Map();
        for (const agent of state.agents) {
            const cellX = Math.floor(agent.x / contactCellSize);
            const cellY = Math.floor(agent.y / contactCellSize);
            const cellKey = getAgentContactCellKey(cellX, cellY);
            let cell = grid.get(cellKey);
            if (!cell) {
                cell = [];
                grid.set(cellKey, cell);
            }
            cell.push(agent);
        }
        return grid;
    }

    function getAgentContactCellKey(x, y) {
        return `${x},${y}`;
    }

    function parseAgentContactCellKey(key) {
        const comma = key.indexOf(",");
        if (comma < 0) throw new Error(`Wizard of Flatland contact grid cell key is invalid: ${key}`);
        const x = Number(key.slice(0, comma));
        const y = Number(key.slice(comma + 1));
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            throw new Error(`Wizard of Flatland contact grid cell key is not integral: ${key}`);
        }
        return { x, y };
    }

    function getAgentPairKey(left, right) {
        const leftId = Number(left && left.id);
        const rightId = Number(right && right.id);
        if (!Number.isFinite(leftId) || !Number.isFinite(rightId)) {
            throw new Error("Wizard of Flatland NPC contact pair requires finite agent ids");
        }
        return leftId < rightId ? `${leftId}:${rightId}` : `${rightId}:${leftId}`;
    }

    function resolveTargetAgentOverlap(agent) {
        const combinedRadius = TARGET_RADIUS + agent.radius;
        let dx = agent.x - state.target.x;
        let dy = agent.y - state.target.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= combinedRadius - TARGET_NPC_PUSH_SLOP) return { changed: false };

        if (!(dist > TARGET_NPC_PUSH_MIN_AXIS)) {
            const angle = Number.isFinite(agent.homeAngle) ? agent.homeAngle : agent.id;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            dist = 1;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        const correction = combinedRadius - dist + TARGET_NPC_PUSH_SLOP;
        const targetShare = TARGET_NPC_PUSH_PLAYER_SHARE;
        const agentShare = 1 - targetShare;
        const previousAgentX = agent.x;
        const previousAgentY = agent.y;
        const previousTargetX = state.target.x;
        const previousTargetY = state.target.y;

        agent.x += nx * correction * agentShare;
        agent.y += ny * correction * agentShare;
        constrainAgentToWalls(agent);

        const blockedAgentPushX = (previousAgentX + nx * correction * agentShare) - agent.x;
        const blockedAgentPushY = (previousAgentY + ny * correction * agentShare) - agent.y;
        state.target.x -= nx * correction * targetShare + blockedAgentPushX;
        state.target.y -= ny * correction * targetShare + blockedAgentPushY;
        constrainTargetToWalls();

        if (agent.x !== previousAgentX || agent.y !== previousAgentY || state.target.x !== previousTargetX || state.target.y !== previousTargetY) {
            accumulateContactVelocity(agent, previousAgentX, previousAgentY);
            return { changed: true };
        }
        return { changed: false };
    }

    function resolveAgentAgentOverlap(left, right) {
        const combinedRadius = left.radius + right.radius;
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= combinedRadius - TARGET_NPC_PUSH_SLOP) return { changed: false };

        if (!(dist > TARGET_NPC_PUSH_MIN_AXIS)) {
            const angle = ((left.id * 928371 + right.id * 689287) % 360) / 360 * Math.PI * 2;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            dist = 1;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        const correction = combinedRadius - dist + TARGET_NPC_PUSH_SLOP;
        const previousLeftX = left.x;
        const previousLeftY = left.y;
        const previousRightX = right.x;
        const previousRightY = right.y;

        const pushShare = getAgentAgentPushShare(left, right);
        const leftPushX = -nx * correction * pushShare.left;
        const leftPushY = -ny * correction * pushShare.left;
        const rightPushX = nx * correction * pushShare.right;
        const rightPushY = ny * correction * pushShare.right;

        const leftApplied = moveAgentWithWallConstraint(left, leftPushX, leftPushY);
        const rightApplied = moveAgentWithWallConstraint(right, rightPushX - leftApplied.blockedX, rightPushY - leftApplied.blockedY);
        if (rightApplied.blockedX !== 0 || rightApplied.blockedY !== 0) {
            moveAgentWithWallConstraint(left, -rightApplied.blockedX, -rightApplied.blockedY);
        }

        if (left.x !== previousLeftX || left.y !== previousLeftY || right.x !== previousRightX || right.y !== previousRightY) {
            accumulateContactVelocity(left, previousLeftX, previousLeftY);
            accumulateContactVelocity(right, previousRightX, previousRightY);
            return { changed: true };
        }
        return { changed: false };
    }

    function getAgentAgentPushShare(left, right) {
        const leftForce = getAgentContactPushForce(left);
        const rightForce = getAgentContactPushForce(right);
        const total = leftForce + rightForce;
        if (!(total > 0)) {
            return { left: NPC_NPC_PUSH_SHARE, right: 1 - NPC_NPC_PUSH_SHARE };
        }
        return {
            left: rightForce / total,
            right: leftForce / total
        };
    }

    function getAgentContactPushForce(agent) {
        return agent && (agent.solverState === STATE_VACATING || agent.phase === PHASE_VACATING)
            ? VACATING_CONTACT_PUSH_FORCE
            : 1;
    }

    function moveAgentWithWallConstraint(agent, dx, dy) {
        const intendedX = agent.x + dx;
        const intendedY = agent.y + dy;
        agent.x = intendedX;
        agent.y = intendedY;
        constrainAgentToWalls(agent);
        return {
            blockedX: intendedX - agent.x,
            blockedY: intendedY - agent.y
        };
    }

    function accumulateContactVelocity(agent, previousX, previousY) {
        agent.vx += agent.x - previousX;
        agent.vy += agent.y - previousY;
    }

    function constrainAgentToWalls(agent) {
        constrainActorToWalls(agent, agent.radius);
    }

    function constrainActorToWalls(actor, radius) {
        for (let pass = 0; pass < 4; pass++) {
            let changed = false;
            for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
                const ax = state.walls[i + WALL_X1];
                const ay = state.walls[i + WALL_Y1];
                const bx = state.walls[i + WALL_X2];
                const by = state.walls[i + WALL_Y2];
                const distance = pointSegmentDistance(actor.x, actor.y, ax, ay, bx, by);
                const blockingRadius = radius + WALL_WORLD_HALF_THICKNESS;
                if (distance >= blockingRadius) continue;
                const normal = segmentRepulsionNormal(actor.x, actor.y, ax, ay, bx, by);
                const correction = blockingRadius - distance + TARGET_NPC_PUSH_SLOP;
                actor.x += normal.x * correction;
                actor.y += normal.y * correction;
                changed = true;
            }
            if (!changed) break;
        }
    }

    function assertContactInvariants() {
        assertActorWallSeparation("target", state.target, TARGET_RADIUS);
        for (const agent of state.agents) {
            assertActorWallSeparation(`agent ${agent.id}`, agent, agent.radius);
            const minDistance = TARGET_RADIUS + agent.radius - TARGET_NPC_PUSH_SLOP * 4;
            const distance = Math.hypot(agent.x - state.target.x, agent.y - state.target.y);
            if (distance < minDistance) {
                throw new Error(`Wizard of Flatland target collision unresolved for agent ${agent.id}`);
            }
        }
        for (let i = 0; i < state.agents.length; i++) {
            const left = state.agents[i];
            for (let j = i + 1; j < state.agents.length; j++) {
                const right = state.agents[j];
                const minDistance = left.radius + right.radius - TARGET_NPC_PUSH_SLOP * 4;
                const distance = Math.hypot(right.x - left.x, right.y - left.y);
                if (distance < minDistance) {
                    throw new Error(`Wizard of Flatland NPC collision unresolved for agents ${left.id} and ${right.id}`);
                }
            }
        }
    }

    function assertActorWallSeparation(label, actor, radius) {
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            const distance = pointSegmentDistance(
                actor.x,
                actor.y,
                state.walls[i + WALL_X1],
                state.walls[i + WALL_Y1],
                state.walls[i + WALL_X2],
                state.walls[i + WALL_Y2]
            );
            if (distance < radius + WALL_WORLD_HALF_THICKNESS - TARGET_NPC_PUSH_SLOP * 4) {
                throw new Error(`Wizard of Flatland ${label} segment wall collision unresolved`);
            }
        }
    }

    function packAgents() {
        const activeAgents = [];
        for (const agent of state.agents) {
            if (!isAgentInInstalledMazeSection(agent)) {
                freezeAgentForUnloadedSection(agent);
                continue;
            }
            activeAgents.push(agent);
        }
        const packed = new Float32Array(activeAgents.length * STRIDE);
        for (let i = 0; i < activeAgents.length; i++) {
            const agent = activeAgents[i];
            const base = i * STRIDE;
            packed[base] = agent.id;
            packed[base + 1] = agent.x;
            packed[base + 2] = agent.y;
            packed[base + 3] = agent.radius;
            packed[base + 4] = agent.speed * getEnemyTemperatureSpeedMultiplier(agent);
            packed[base + 5] = agent.priority;
            packed[base + 6] = agent.waitTime;
            packed[base + 7] = agent.phase;
            packed[base + 8] = agent.phaseTime;
            packed[base + 9] = agent.homeAngle;
            packed[base + 10] = agent.cooldown;
            packed[base + 11] = agent.heading;
            packed[base + 12] = agent.millingDirection;
            packed[base + 13] = agent.millingWallTurnLock || 0;
            packed[base + 14] = agent.pathMode === PATH_MODE_WORKER ? PATH_MODE_WORKER : PATH_MODE_DIRECT;
            packed[base + 15] = Number.isFinite(agent.pathGoalX) ? agent.pathGoalX : state.target.x;
            packed[base + 16] = Number.isFinite(agent.pathGoalY) ? agent.pathGoalY : state.target.y;
            packed[base + 17] = agent.pathGoalWallBlocked === true ? 1 : 0;
        }
        return packed;
    }

    function requestStep(dt) {
        if (Number.isFinite(dt) && dt > 0) {
            state.pendingSolverDt = Math.min(SOLVER_STEP_DT_MAX, state.pendingSolverDt + dt);
        }
        if (state.waitingForWorker) return;
        if (isProceduralMazeScenario() && getPathfindingNodeCount() === 0) {
            setLabelText(labels.workerStatus, state.generatedMazeLoading ? "maze loading" : "maze missing");
            return;
        }
        const solverDt = state.pendingSolverDt;
        if (!(solverDt > 0)) return;
        updateAgentPathing(solverDt);
        state.waitingForWorker = true;
        state.pendingSolverDt = 0;
        const targetMoved = Math.hypot(
            state.target.x - state.lastSentTarget.x,
            state.target.y - state.lastSentTarget.y
        ) > 0.001;
        state.lastSentTarget = { x: state.target.x, y: state.target.y };
        const agents = packAgents();
        const includeWalls = state.solverWallVersion !== state.worldVersion;
        const walls = includeWalls ? cloneWallBuffer(state.walls, "solver walls") : null;
        const message = {
            type: "step",
            requestId: state.requestId++,
            worldVersion: state.worldVersion,
            dt: solverDt,
            agents,
            params: {
                targetX: state.target.x,
                targetY: state.target.y,
                targetRadius: TARGET_RADIUS,
                ringRadius: COMBAT_RING_RADIUS,
                separationStrength: getSeparationStrength(),
                speedScale: getSpeedScale(),
                targetMoved
            }
        };
        const transfer = [agents.buffer];
        if (includeWalls) {
            message.walls = walls;
            transfer.push(walls.buffer);
            state.solverWallVersion = state.worldVersion;
        }
        worker.postMessage(message, transfer);
    }

    function handleWorkerMessage(event) {
        const message = event && event.data ? event.data : null;
        if (!message) return;
        if (message.type === "ready") {
            setLabelText(labels.workerStatus, "ready");
            return;
        }
        if (message.type === "error") {
            state.waitingForWorker = false;
            state.solverWallVersion = 0;
            setLabelText(labels.workerStatus, message.message || "solver error");
            return;
        }
        if (message.type !== "step_result") return;
        state.waitingForWorker = false;
        applySolverResult(message.agents);
        resolveTargetNpcContacts(false);
        state.stats = message.stats || null;
        if ((state.stats.hits || 0) > 0) {
            damageWizard(getEnemyHitDamageFromSolverStats(state.stats));
            state.targetFlashTime = 0.18;
        }
        handleEnemyWallHitsFromSolverStats(state.stats);
        setLabelText(labels.workerStatus, "ready");
        updateStats();
    }

    function applySolverResult(packed) {
        if (!(packed instanceof Float32Array)) return;
        state.debug.headingGlitchFrame += 1;
        const byId = new Map(state.agents.map((agent) => [agent.id, agent]));
        for (const agent of state.agents) agent.isDesignatedAttacker = false;
        for (let i = 0; i < packed.length; i += OUT_STRIDE) {
            const agent = byId.get(packed[i]);
            if (!agent) continue;
            agent.vx = packed[i + 3];
            agent.vy = packed[i + 4];
            agent.x = packed[i + 1];
            agent.y = packed[i + 2];
            agent.solverState = packed[i + 5];
            agent.wallClamps = packed[i + 6];
            agent.phase = packed[i + 7];
            agent.phaseTime = packed[i + 8];
            agent.cooldown = packed[i + 9];
            agent.slotAngle = packed[i + 10];
            agent.heading = packed[i + 11];
            agent.millingDirection = packed[i + 12] >= 0 ? 1 : -1;
            agent.millingWallTurnLock = Math.max(0, packed[i + 13] || 0);
            agent.isDesignatedAttacker = packed[i + 14] >= 0.5;
            agent.waitTime = agent.solverState === STATE_HOLDING
                ? agent.waitTime + 1 / 60
                : Math.max(0, agent.waitTime - 0.12);
            recordAgentHeadingForGlitchDetection(agent);
        }
    }

    function getEnemyHitDamageFromSolverStats(stats) {
        if (!stats || !Number.isInteger(stats.hits) || stats.hits < 0) {
            throw new Error("Wizard of Flatland enemy hit damage requires solver hit stats");
        }
        if (stats.hits === 0) return 0;
        if (!Array.isArray(stats.hitAgentIds)) {
            throw new Error("Wizard of Flatland enemy hit damage requires hit agent ids");
        }
        if (stats.hitAgentIds.length !== stats.hits) {
            throw new Error("Wizard of Flatland enemy hit damage count does not match hit ids");
        }
        const agentsById = new Map(state.agents.map((agent) => [agent.id, agent]));
        let damage = 0;
        for (const id of stats.hitAgentIds) {
            const agent = agentsById.get(id);
            if (!agent) throw new Error(`Wizard of Flatland enemy hit damage missing agent ${id}`);
            damage += getAgentHitDamage(agent);
        }
        return damage;
    }

    function handleEnemyWallHitsFromSolverStats(stats) {
        if (!stats) return;
        const wallHits = Number(stats.wallHits || 0);
        if (!Number.isInteger(wallHits) || wallHits < 0) {
            throw new Error("Wizard of Flatland enemy wall hit damage requires solver wall hit stats");
        }
        if (wallHits === 0) return;
        if (!Array.isArray(stats.wallHitAgentIds)) {
            throw new Error("Wizard of Flatland enemy wall hit damage requires wall hit agent ids");
        }
        if (stats.wallHitAgentIds.length !== wallHits) {
            throw new Error("Wizard of Flatland enemy wall hit damage count does not match wall hit ids");
        }
        const agentsById = new Map(state.agents.map((agent) => [agent.id, agent]));
        for (const id of stats.wallHitAgentIds) {
            const agent = agentsById.get(id);
            if (!agent) throw new Error(`Wizard of Flatland enemy wall hit damage missing agent ${id}`);
            recordEnemyWallHit(agent);
        }
    }

    function recordEnemyWallHit(agent) {
        validateAgentHealth(agent);
        if (agent.pathGoalWallBlocked !== true) return;
        if (typeof agent.wallBreakTargetEdgeKey !== "string" || agent.wallBreakTargetEdgeKey.length === 0) {
            throw new Error(`Wizard of Flatland enemy ${agent.id} wall hit requires a target edge`);
        }
        if (!Number.isInteger(agent.wallBreakTargetWallIndex) || agent.wallBreakTargetWallIndex < 0) {
            throw new Error(`Wizard of Flatland enemy ${agent.id} wall hit requires a target wall index`);
        }
        if (!(agent.wallBreakDamageByEdge instanceof Map)) agent.wallBreakDamageByEdge = new Map();
        const previousDamage = Number(agent.wallBreakDamageByEdge.get(agent.wallBreakTargetEdgeKey) || 0);
        if (!Number.isFinite(previousDamage) || previousDamage < 0) {
            throw new Error(`Wizard of Flatland enemy ${agent.id} has invalid wall break progress`);
        }
        const nextDamage = previousDamage + getAgentHitDamage(agent);
        if (nextDamage < WALL_BREAK_HITPOINTS) {
            agent.wallBreakDamageByEdge.set(agent.wallBreakTargetEdgeKey, nextDamage);
            return;
        }
        breakWallSectionForAgent(agent);
    }

    function breakWallSectionForAgent(agent) {
        if (!Number.isInteger(agent.wallBreakTargetWallIndex) || agent.wallBreakTargetWallIndex < 0) {
            throw new Error(`Wizard of Flatland enemy ${agent.id} wall break requires a target wall index`);
        }
        const wallIndex = agent.wallBreakTargetWallIndex;
        const wallBase = wallIndex * WALL_STRIDE;
        validateWallBuffer(state.walls, "wall break walls");
        if (wallBase < 0 || wallBase + WALL_STRIDE > state.walls.length) {
            throw new Error(`Wizard of Flatland enemy ${agent.id} wall break target ${wallIndex} is outside active walls`);
        }
        const gap = createWallBreakGapForAgent(agent, state.walls, wallBase);
        state.brokenWallGaps.push(gap);
        state.wallShatterEffects.push(createWallShatterEffect(gap));
        if (isProceduralMazeScenario()) {
            applyProceduralWallBreak(wallIndex, gap);
        } else {
            state.walls = splitWallBufferAtIndexForGap(state.walls, wallIndex, gap);
        }
        for (const candidate of state.agents) {
            candidate.wallBreakDamageByEdge = new Map();
            candidate.wallBreakTargetEdgeKey = "";
            candidate.wallBreakTargetWallIndex = -1;
        }
        state.worldVersion += 1;
        clearAgentPathRequestsForMapRebuild();
        rebuildPathfindingNodeLayer();
    }

    function createWallBreakGapForAgent(agent, walls, wallBase) {
        const ax = walls[wallBase + WALL_X1];
        const ay = walls[wallBase + WALL_Y1];
        const bx = walls[wallBase + WALL_X2];
        const by = walls[wallBase + WALL_Y2];
        const wallLength = Math.hypot(bx - ax, by - ay);
        if (!(wallLength > 0)) throw new Error("Wizard of Flatland wall break requires a separated wall segment");
        const projection = pointProjectionParameter(agent.x, agent.y, ax, ay, bx, by);
        const centerT = Math.max(0, Math.min(1, projection));
        const halfGapT = Math.min(0.5, WALL_BREAK_SECTION_LENGTH / wallLength * 0.5);
        const startT = Math.max(0, centerT - halfGapT);
        const endT = Math.min(1, centerT + halfGapT);
        return {
            ax,
            ay,
            bx,
            by,
            startT,
            endT,
            labelCode: Math.round(walls[wallBase + WALL_LABEL_CODE]),
            sideCode: Math.round(walls[wallBase + WALL_LABEL_SIDE])
        };
    }

    function applyProceduralWallBreak(wallIndex, gap) {
        const generatedWallCount = getWallCount(state.generatedMazeWalls);
        if (wallIndex < generatedWallCount) {
            state.generatedMazeWalls = splitWallBufferAtIndexForGap(state.generatedMazeWalls, wallIndex, gap);
        } else {
            const manualWallIndex = wallIndex - generatedWallCount;
            state.manualWalls = splitWallBufferAtIndexForGap(state.manualWalls, manualWallIndex, gap);
        }
        state.walls = concatWallBuffers(state.generatedMazeWalls, state.manualWalls);
        state.generatedMazeSignature = "";
    }

    function applyBrokenWallGapsToBuffer(walls, gaps, label) {
        validateWallBuffer(walls, label);
        let next = walls;
        for (const gap of gaps) {
            validateBrokenWallGap(gap);
            const wallIndex = findMatchingWallGapIndex(next, gap);
            if (wallIndex < 0) continue;
            next = splitWallBufferAtIndexForGap(next, wallIndex, gap);
        }
        return next;
    }

    function splitWallBufferAtIndexForGap(walls, wallIndex, gap) {
        validateWallBuffer(walls, "wall break split source");
        validateBrokenWallGap(gap);
        if (!Number.isInteger(wallIndex) || wallIndex < 0 || wallIndex >= getWallCount(walls)) {
            throw new Error("Wizard of Flatland wall break split requires a valid wall index");
        }
        const wallBase = wallIndex * WALL_STRIDE;
        if (!wallSegmentMatchesGap(walls, wallBase, gap)) {
            throw new Error("Wizard of Flatland wall break split target does not match the requested gap");
        }
        const parent = readWallPiece(walls, wallBase);
        const pieces = [];
        const children = [];
        for (let base = 0; base < walls.length; base += WALL_STRIDE) {
            if (base !== wallBase) {
                pieces.push(readWallPiece(walls, base));
                continue;
            }
            const left = createWallPieceForRange(gap, 0, gap.startT);
            const right = createWallPieceForRange(gap, gap.endT, 1);
            if (left) {
                pieces.push(left);
                children.push(left);
            }
            if (right) {
                pieces.push(right);
                children.push(right);
            }
        }
        explorationSystem.inheritSplit(parent, children);
        return packWallPieces(pieces);
    }

    function findMatchingWallGapIndex(walls, gap) {
        for (let base = 0; base < walls.length; base += WALL_STRIDE) {
            if (wallSegmentMatchesGap(walls, base, gap)) return base / WALL_STRIDE;
        }
        return -1;
    }

    function wallSegmentMatchesGap(walls, base, gap) {
        const forward =
            Math.abs(walls[base + WALL_X1] - gap.ax) < 0.001 &&
            Math.abs(walls[base + WALL_Y1] - gap.ay) < 0.001 &&
            Math.abs(walls[base + WALL_X2] - gap.bx) < 0.001 &&
            Math.abs(walls[base + WALL_Y2] - gap.by) < 0.001;
        const reverse =
            Math.abs(walls[base + WALL_X1] - gap.bx) < 0.001 &&
            Math.abs(walls[base + WALL_Y1] - gap.by) < 0.001 &&
            Math.abs(walls[base + WALL_X2] - gap.ax) < 0.001 &&
            Math.abs(walls[base + WALL_Y2] - gap.ay) < 0.001;
        return forward || reverse;
    }

    function readWallPiece(walls, base) {
        return {
            ax: walls[base + WALL_X1],
            ay: walls[base + WALL_Y1],
            bx: walls[base + WALL_X2],
            by: walls[base + WALL_Y2],
            labelCode: Math.round(walls[base + WALL_LABEL_CODE]),
            sideCode: Math.round(walls[base + WALL_LABEL_SIDE])
        };
    }

    function createWallPieceForRange(gap, startT, endT) {
        if (endT - startT <= 0.001) return null;
        return {
            ax: gap.ax + (gap.bx - gap.ax) * startT,
            ay: gap.ay + (gap.by - gap.ay) * startT,
            bx: gap.ax + (gap.bx - gap.ax) * endT,
            by: gap.ay + (gap.by - gap.ay) * endT,
            labelCode: gap.labelCode,
            sideCode: gap.sideCode
        };
    }

    function packWallPieces(pieces) {
        let walls = createEmptyWallBuffer();
        for (const piece of pieces) {
            walls = appendWallSegment(walls, piece.ax, piece.ay, piece.bx, piece.by, piece.labelCode, piece.sideCode);
        }
        return walls;
    }

    function validateBrokenWallGap(gap) {
        if (!gap || typeof gap !== "object") throw new Error("Wizard of Flatland broken wall gap is missing");
        for (const field of ["ax", "ay", "bx", "by", "startT", "endT"]) {
            if (!Number.isFinite(gap[field])) throw new Error(`Wizard of Flatland broken wall gap requires finite ${field}`);
        }
        if (!(gap.startT >= 0 && gap.endT <= 1 && gap.endT > gap.startT)) {
            throw new Error("Wizard of Flatland broken wall gap requires an ordered segment range");
        }
        if (!Number.isInteger(gap.labelCode) || !Number.isInteger(gap.sideCode)) {
            throw new Error("Wizard of Flatland broken wall gap requires wall label data");
        }
    }

    function recordAgentHeadingForGlitchDetection(agent) {
        if (!Number.isFinite(agent.heading)) return;
        if (!Array.isArray(agent.headingHistory)) agent.headingHistory = [];
        agent.headingHistory.push({
            frame: state.debug.headingGlitchFrame,
            heading: normalizeAngle(agent.heading),
            solverState: agent.solverState,
            phase: agent.phase,
            phaseTime: agent.phaseTime,
            pathMode: agent.pathMode,
            pathCursor: agent.pathCursor,
            pathGoalX: agent.pathGoalX,
            pathGoalY: agent.pathGoalY,
            x: agent.x,
            y: agent.y,
            vx: agent.vx,
            vy: agent.vy,
            wallClamps: agent.wallClamps,
            millingDirection: agent.millingDirection,
            millingWallTurnLock: agent.millingWallTurnLock
        });
        if (agent.headingHistory.length > 4) agent.headingHistory.shift();
        if (!state.debug.headingGlitchLogged && isAgentHeadingGlitch(agent.headingHistory)) {
            state.debug.headingGlitchLogged = true;
            logAgentHeadingGlitch(agent);
        }
    }

    function isAgentHeadingGlitch(history) {
        if (!Array.isArray(history) || history.length < 4) return false;
        const a = history[0];
        const b = history[1];
        const c = history[2];
        const d = history[3];
        if (b.frame !== a.frame + 1 || c.frame !== b.frame + 1 || d.frame !== c.frame + 1) return false;
        const turnA = Math.abs(shortestAngleDelta(a.heading, b.heading));
        const turnB = Math.abs(shortestAngleDelta(b.heading, c.heading));
        const turnC = Math.abs(shortestAngleDelta(c.heading, d.heading));
        const returned = Math.abs(shortestAngleDelta(a.heading, d.heading));
        return turnA >= HEADING_GLITCH_TURN_THRESHOLD &&
            turnB >= HEADING_GLITCH_TURN_THRESHOLD &&
            turnC >= HEADING_GLITCH_TURN_THRESHOLD &&
            returned <= HEADING_GLITCH_RETURN_THRESHOLD;
    }

    function logAgentHeadingGlitch(agent) {
        const history = agent.headingHistory.map((entry) => ({
            frame: entry.frame,
            heading: entry.heading,
            headingDegrees: Math.round(entry.heading * 180 / Math.PI),
            solverState: getSolverStateName(entry.solverState),
            phase: getPhaseName(entry.phase),
            phaseTime: entry.phaseTime,
            pathMode: entry.pathMode === PATH_MODE_WORKER ? "worker" : "direct",
            pathCursor: entry.pathCursor,
            pathGoalX: entry.pathGoalX,
            pathGoalY: entry.pathGoalY,
            x: entry.x,
            y: entry.y,
            vx: entry.vx,
            vy: entry.vy,
            speed: Math.hypot(entry.vx, entry.vy),
            wallClamps: entry.wallClamps,
            millingDirection: entry.millingDirection,
            millingWallTurnLock: entry.millingWallTurnLock
        }));
        const dump = {
            reason: "heading returned to its starting direction after three consecutive turning frames",
            id: agent.id,
            frame: state.debug.headingGlitchFrame,
            history,
            current: {
                position: { x: agent.x, y: agent.y },
                velocity: { x: agent.vx, y: agent.vy, speed: Math.hypot(agent.vx, agent.vy) },
                heading: agent.heading,
                solverState: getSolverStateName(agent.solverState),
                phase: getPhaseName(agent.phase),
                phaseTime: agent.phaseTime,
                waitTime: agent.waitTime,
                cooldown: agent.cooldown,
                wallClamps: agent.wallClamps,
                pathMode: agent.pathMode === PATH_MODE_WORKER ? "worker" : "direct",
                pathCursor: agent.pathCursor,
                pathLength: agent.pathNodeKeys.length,
                pathGoal: { x: agent.pathGoalX, y: agent.pathGoalY },
                pathRequestPending: agent.pathRequestPending,
                pathRequestedWorldVersion: agent.pathRequestedWorldVersion,
                pathRequestedStartKey: agent.pathRequestedStartKey,
                pathRequestedGoalKey: agent.pathRequestedGoalKey
            },
            target: { x: state.target.x, y: state.target.y },
            stats: state.stats
        };
        console.groupCollapsed(`Wizard of Flatland heading glitch: agent ${agent.id}`);
        console.log(dump);
        console.table(history);
        console.groupEnd();
    }

    function getSolverStateName(value) {
        switch (value) {
            case STATE_MILLING: return "milling";
            case STATE_ATTACKING: return "attacking";
            case STATE_BLOCKED: return "blocked";
            case STATE_SEEKING: return "seeking";
            case STATE_HOLDING: return "holding";
            case STATE_RECOVERING: return "recovering";
            case STATE_VACATING: return "vacating";
            default: return `unknown:${value}`;
        }
    }

    function getPhaseName(value) {
        switch (value) {
            case PHASE_MILLING: return "milling";
            case 1: return "attacking";
            case 2: return "recovering";
            case 3: return "holding";
            case 4: return "seeking";
            case 5: return "vacating";
            default: return `unknown:${value}`;
        }
    }

    function updateStats() {
        const stats = state.stats || {};
        setLabelText(labels.solveMs, `${Number(stats.solveMs || 0).toFixed(2)} ms`);
        setLabelText(labels.pairChecks, String(stats.pairChecks || 0));
        setLabelText(labels.movingCount, String(stats.moving || stats.milling || 0));
        setLabelText(labels.seekingCount, String(stats.seeking || 0));
        setLabelText(labels.waitingCount, String(stats.waiting || 0));
        setLabelText(labels.attackingCount, String(stats.attacking || 0));
        setLabelText(labels.retreatingCount, String(stats.retreating || 0));
        setLabelText(labels.blockedCount, String(stats.blocked || 0));
        setLabelText(labels.wallLeaks, String(stats.wallLeaks || 0));
    }

    function createPathingMetrics() {
        return {
            at: performance.now(),
            agents: 0,
            direct: 0,
            worker: 0,
            frozen: 0,
            stopped: 0,
            pending: 0,
            requests: 0,
            deferredRequests: 0,
            lineOfSightChecks: 0,
            lineOfSightMs: 0,
            nearestNodeLookups: 0,
            nearestNodeFastHits: 0,
            nearestNodeMs: 0,
            totalMs: 0
        };
    }

    function updateAgentPathing(_dt) {
        const now = performance.now();
        const metrics = createPathingMetrics();
        const started = performance.now();
        let goalNodeIndex = null;
        let goalNodeKey = "";
        let requestsSent = 0;
        for (const agent of state.agents) {
            metrics.agents += 1;
            if (!isAgentInInstalledMazeSection(agent)) {
                freezeAgentForUnloadedSection(agent);
                metrics.frozen += 1;
                continue;
            }
            const losStarted = performance.now();
            const hasLos = hasDirectLineOfSight(agent.x, agent.y, state.target.x, state.target.y, agent.radius);
            metrics.lineOfSightChecks += 1;
            metrics.lineOfSightMs += performance.now() - losStarted;
            if (hasLos) {
                agent.pathMode = PATH_MODE_DIRECT;
                agent.pathGoalX = state.target.x;
                agent.pathGoalY = state.target.y;
                agent.pathGoalWallBlocked = false;
                agent.wallBreakTargetEdgeKey = "";
                agent.wallBreakTargetWallIndex = -1;
                agent.pathNodeKeys = [];
                agent.pathWaypoints = [];
                agent.pathCursor = 0;
                metrics.direct += 1;
                continue;
            }

            agent.pathMode = PATH_MODE_WORKER;
            metrics.worker += 1;
            advanceAgentPathCursor(agent);
            const waypoint = getAgentPathWaypoint(agent);
            if (waypoint) {
                agent.pathGoalX = waypoint.x;
                agent.pathGoalY = waypoint.y;
                agent.pathGoalWallBlocked = waypoint.wallBlockedFromPrevious === true;
                agent.wallBreakTargetEdgeKey = waypoint.wallBlockedFromPrevious === true ? waypoint.wallBlockedEdgeKey : "";
                agent.wallBreakTargetWallIndex = waypoint.wallBlockedFromPrevious === true ? waypoint.wallBlockedWallIndex : -1;
            } else {
                agent.pathGoalWallBlocked = false;
                agent.wallBreakTargetEdgeKey = "";
                agent.wallBreakTargetWallIndex = -1;
            }
            if (agent.pathRequestPending) {
                metrics.pending += 1;
                continue;
            }

            if (!Number.isInteger(goalNodeIndex)) {
                goalNodeIndex = getCachedTargetPathfindingNode(metrics);
                if (!Number.isInteger(goalNodeIndex)) {
                    metrics.stopped += 1;
                    stopAgentForMissingPathNode(agent);
                    continue;
                }
                goalNodeKey = getPathfindingNodeKey(goalNodeIndex);
            }
            const rawStartNodeIndex = nearestPathfindingNode(agent.x, agent.y, metrics);
            if (!Number.isInteger(rawStartNodeIndex)) {
                metrics.stopped += 1;
                stopAgentForMissingPathNode(agent);
                continue;
            }
            const startNodeIndex = isPathfindingNodePassable(rawStartNodeIndex)
                ? rawStartNodeIndex
                : nearestPassablePathfindingNode(agent.x, agent.y, metrics);
            if (!Number.isInteger(startNodeIndex)) {
                metrics.stopped += 1;
                stopAgentForMissingPathNode(agent);
                continue;
            }
            const rawStartNodeKey = getPathfindingNodeKey(rawStartNodeIndex);
            const startNodeKey = getPathfindingNodeKey(startNodeIndex);
            const requestAgeMs = now - agent.pathRequestedAt;
            const requestIntervalMs = PATH_REQUEST_INTERVAL_SECONDS * 1000;
            const currentPathInvalid = !waypoint || waypoint.stale === true || waypoint.blocked === true;
            const requestedRouteChanged =
                agent.pathRequestedGoalKey !== goalNodeKey ||
                agent.pathRequestedRawStartKey !== rawStartNodeKey ||
                agent.pathRequestedStartKey !== startNodeKey;
            const shouldRequest =
                (currentPathInvalid && (requestedRouteChanged || requestAgeMs >= requestIntervalMs)) ||
                (requestedRouteChanged && requestAgeMs >= requestIntervalMs);
            if (!shouldRequest) continue;
            if (requestsSent >= PATH_REQUESTS_PER_FRAME) {
                metrics.deferredRequests += 1;
                continue;
            }
            requestAgentPath(agent, rawStartNodeIndex, startNodeIndex, goalNodeIndex, now);
            requestsSent += 1;
            metrics.requests += 1;
        }
        metrics.totalMs = performance.now() - started;
        state.debug.lastPathingMetrics = metrics;
        profiler.notePathing(metrics);
    }

    function stopAgentForMissingPathNode(agent) {
        freezeAgentForUnloadedSection(agent);
    }

    function hasDirectLineOfSight(fromX, fromY, toX, toY, radius) {
        const wallGeometry = getWallGeometryApi();
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            if (wallGeometry.connectionCrossesWallFaces(
                { x: fromX, y: fromY },
                { x: toX, y: toY },
                { x: state.walls[i + WALL_X1], y: state.walls[i + WALL_Y1] },
                { x: state.walls[i + WALL_X2], y: state.walls[i + WALL_Y2] },
                {
                    thickness: WALL_WORLD_THICKNESS,
                    extend: PATH_NODE_WALL_FACE_EXTEND
                }
            )) {
                return false;
            }
        }
        if (temporaryDeathBlockerBlocksLineOfSight(fromX, fromY, toX, toY, radius)) return false;
        return true;
    }

    function temporaryDeathBlockerBlocksLineOfSight(fromX, fromY, toX, toY, actorRadius) {
        if (!(state.temporaryDeathBlockersByKey instanceof Map)) {
            throw new Error("Wizard of Flatland temporary death blocker line-of-sight requires blocker tracking");
        }
        if (state.temporaryDeathBlockersByKey.size === 0) return false;
        if (!Number.isFinite(actorRadius) || actorRadius < 0) {
            throw new Error("Wizard of Flatland temporary death blocker line-of-sight requires a non-negative actor radius");
        }
        const targetDistance = Math.hypot(toX - fromX, toY - fromY);
        const lungeReadyDistance = COMBAT_RING_RADIUS + actorRadius * ENEMY_DEATH_BLOCKER_LOS_LUNGE_BYPASS_RADIUS_SCALE;
        if (targetDistance <= lungeReadyDistance) return false;
        for (const [key, blocker] of state.temporaryDeathBlockersByKey) {
            validateTemporaryDeathBlocker(key, blocker);
            const distance = pointSegmentDistance(blocker.x, blocker.y, fromX, fromY, toX, toY);
            if (distance <= blocker.radius + actorRadius) return true;
        }
        return false;
    }

    function getCachedTargetPathfindingNode(metrics) {
        const cache = state.nodeLayer.targetNodeCache;
        const approx = getApproximatePathfindingGridCoord(state.target.x, state.target.y);
        if (
            cache &&
            cache.version === state.nodeLayer.version &&
            cache.xindex === approx.xindex &&
            cache.yindex === approx.yindex
        ) {
            return cache.pathIndex;
        }
        const pathIndex = nearestPassablePathfindingNode(state.target.x, state.target.y, metrics);
        state.nodeLayer.targetNodeCache = {
            version: state.nodeLayer.version,
            xindex: approx.xindex,
            yindex: approx.yindex,
            pathIndex
        };
        return pathIndex;
    }

    function nearestPathfindingNode(worldX, worldY, metrics = null) {
        return findNearestPathfindingNode(worldX, worldY, { passable: false, metrics });
    }

    function nearestPassablePathfindingNode(worldX, worldY, metrics = null) {
        return findNearestPathfindingNode(worldX, worldY, { passable: true, metrics });
    }

    function nearestPathfindingNodes(worldX, worldY, count) {
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
            throw new Error("Wizard of Flatland nearest path nodes require finite world coordinates");
        }
        if (!Number.isInteger(count) || count <= 0) {
            throw new Error("Wizard of Flatland nearest path nodes require a positive integer count");
        }
        const nodeCount = getPathfindingNodeCount();
        if (nodeCount < count) {
            throw new Error(`Wizard of Flatland nearest path nodes need ${count} nodes, only ${nodeCount} are loaded`);
        }
        const candidates = [];
        for (let pathIndex = 0; pathIndex < nodeCount; pathIndex++) {
            const nodeX = getPathfindingNodeX(pathIndex);
            const nodeY = getPathfindingNodeY(pathIndex);
            candidates.push({
                pathIndex,
                distSq: squareDistance(worldX, worldY, nodeX, nodeY)
            });
        }
        candidates.sort((a, b) => a.distSq - b.distSq);
        return candidates.slice(0, count).map((candidate) => candidate.pathIndex);
    }

    function nearestReachablePathfindingNodes(worldX, worldY, count) {
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
            throw new Error("Wizard of Flatland nearest reachable path nodes require finite world coordinates");
        }
        if (!Number.isInteger(count) || count <= 0) {
            throw new Error("Wizard of Flatland nearest reachable path nodes require a positive integer count");
        }
        const startIndex = nearestPassablePathfindingNode(worldX, worldY);
        if (!Number.isInteger(startIndex)) {
            throw new Error("Wizard of Flatland nearest reachable path nodes require a reachable start node");
        }
        const reachable = collectReachablePathfindingNodes(startIndex);
        const candidates = [];
        for (const pathIndex of reachable) {
            candidates.push({
                pathIndex,
                distSq: squareDistance(worldX, worldY, getPathfindingNodeX(pathIndex), getPathfindingNodeY(pathIndex))
            });
        }
        candidates.sort((a, b) => a.distSq - b.distSq);
        return candidates.slice(0, count).map((candidate) => candidate.pathIndex);
    }

    function nearestLocalPassablePathfindingNodes(worldX, worldY, count, options) {
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
            throw new Error("Wizard of Flatland nearest local path nodes require finite world coordinates");
        }
        if (!Number.isInteger(count) || count <= 0) {
            throw new Error("Wizard of Flatland nearest local path nodes require a positive integer count");
        }
        const allowFewer = options && options.allowFewer === true;
        const approx = getApproximatePathfindingGridCoord(worldX, worldY);
        const candidates = [];
        const seen = new Set();
        for (let radius = 0; radius <= PATH_NODE_FAST_SEARCH_RADIUS; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const xindex = approx.xindex + dx;
                const rowCenter = Math.round(worldY - (isEvenGridColumn(xindex) ? 0.5 : 0));
                for (let dy = -radius; dy <= radius; dy++) {
                    if (radius > 0 && Math.abs(dx) < radius && Math.abs(dy) < radius) continue;
                    const pathIndex = getPathfindingNodeIndexForGrid(xindex, rowCenter + dy);
                    if (!Number.isInteger(pathIndex) || seen.has(pathIndex)) continue;
                    if (!isValidPathfindingNodeIndex(pathIndex)) {
                        throw new Error(`Wizard of Flatland local path node grid lookup returned invalid node index ${pathIndex}`);
                    }
                    seen.add(pathIndex);
                    if (!isPathfindingNodePassable(pathIndex)) continue;
                    candidates.push({
                        pathIndex,
                        distSq: squareDistance(worldX, worldY, getPathfindingNodeX(pathIndex), getPathfindingNodeY(pathIndex))
                    });
                }
            }
            if (candidates.length >= count) {
                candidates.sort((a, b) => a.distSq - b.distSq);
                return candidates.slice(0, count).map((candidate) => candidate.pathIndex);
            }
        }
        if (allowFewer) {
            candidates.sort((a, b) => a.distSq - b.distSq);
            return candidates.slice(0, count).map((candidate) => candidate.pathIndex);
        }
        throw new Error(`Wizard of Flatland nearest local path nodes found ${candidates.length} passable nodes, need ${count}`);
    }

    function collectReachablePathfindingNodes(startIndex) {
        if (!isPathfindingNodePassable(startIndex)) {
            throw new Error(`Wizard of Flatland reachable path node collection requires a passable start node, got ${startIndex}`);
        }
        const nodeCount = getPathfindingNodeCount();
        const adjacency = buildCurrentPathfindingAdjacency(nodeCount);
        const visited = new Uint8Array(nodeCount);
        const queue = [startIndex];
        const reachable = [];
        visited[startIndex] = 1;
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const pathIndex = queue[cursor];
            reachable.push(pathIndex);
            const neighbors = adjacency[pathIndex];
            if (!neighbors) continue;
            for (const neighborIndex of neighbors) {
                if (visited[neighborIndex] === 1) continue;
                visited[neighborIndex] = 1;
                queue.push(neighborIndex);
            }
        }
        return reachable;
    }

    function buildCurrentPathfindingAdjacency(nodeCount) {
        if (!Number.isInteger(nodeCount) || nodeCount <= 0) {
            throw new Error("Wizard of Flatland pathfinding adjacency requires a positive node count");
        }
        const edges = state.nodeLayer && state.nodeLayer.edges;
        if (!(edges instanceof Int32Array) || edges.length % PATH_SNAPSHOT_EDGE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland pathfinding adjacency requires packed pathfinding edges");
        }
        const adjacency = new Array(nodeCount);
        for (let edgeBase = 0; edgeBase < edges.length; edgeBase += PATH_SNAPSHOT_EDGE_STRIDE) {
            const fromIndex = edges[edgeBase + PATH_EDGE_FROM];
            const toIndex = edges[edgeBase + PATH_EDGE_TO];
            if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= nodeCount) {
                throw new Error(`Wizard of Flatland pathfinding adjacency found invalid from node ${fromIndex}`);
            }
            if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= nodeCount) {
                throw new Error(`Wizard of Flatland pathfinding adjacency found invalid to node ${toIndex}`);
            }
            if (isPathfindingNodeBlocked(fromIndex) || isPathfindingNodeBlocked(toIndex)) continue;
            if (!adjacency[fromIndex]) adjacency[fromIndex] = [];
            adjacency[fromIndex].push(toIndex);
        }
        return adjacency;
    }

    function findNearestPathfindingNode(worldX, worldY, options) {
        const metrics = options && options.metrics ? options.metrics : null;
        if (metrics) metrics.nearestNodeLookups += 1;
        const started = performance.now();
        try {
            const pathIndex = findNearestPathfindingNodeNearGrid(worldX, worldY, options);
            if (Number.isInteger(pathIndex)) {
                if (metrics) metrics.nearestNodeFastHits += 1;
                return pathIndex;
            }
            return null;
        } finally {
            if (metrics) metrics.nearestNodeMs += performance.now() - started;
        }
    }

    function findNearestPathfindingNodeNearGrid(worldX, worldY, options) {
        const approx = getApproximatePathfindingGridCoord(worldX, worldY);
        let bestIndex = -1;
        let bestDistSq = Infinity;
        for (let colRadius = 0; colRadius <= PATH_NODE_FAST_SEARCH_RADIUS; colRadius++) {
            for (let dx = -colRadius; dx <= colRadius; dx++) {
                const xindex = approx.xindex + dx;
                const rowCenter = Math.round(worldY - (isEvenGridColumn(xindex) ? 0.5 : 0));
                for (let dy = -colRadius; dy <= colRadius; dy++) {
                    if (colRadius > 0 && Math.abs(dx) < colRadius && Math.abs(dy) < colRadius) continue;
                    const pathIndex = getPathfindingNodeIndexForGrid(xindex, rowCenter + dy);
                    if (!Number.isInteger(pathIndex)) continue;
                    if (!isValidPathfindingNodeIndex(pathIndex)) {
                        throw new Error(`Wizard of Flatland path node grid lookup returned invalid node index ${pathIndex}`);
                    }
                    if (options && options.passable && !isPathfindingNodePassable(pathIndex)) continue;
                    const nodeX = getPathfindingNodeX(pathIndex);
                    const nodeY = getPathfindingNodeY(pathIndex);
                    const distSq = squareDistance(worldX, worldY, nodeX, nodeY);
                    if (distSq < bestDistSq) {
                        bestDistSq = distSq;
                        bestIndex = pathIndex;
                    }
                }
            }
        }
        return bestIndex >= 0 ? bestIndex : null;
    }

    function getApproximatePathfindingGridCoord(worldX, worldY) {
        const xindex = Math.round(worldX / HEX_GRID_COL_STEP);
        return {
            xindex,
            yindex: Math.round(worldY - (isEvenGridColumn(xindex) ? 0.5 : 0))
        };
    }

    function getPathfindingNodeIndexForGrid(xindex, yindex) {
        if (!Number.isInteger(xindex) || !Number.isInteger(yindex)) {
            throw new Error("Wizard of Flatland path node grid lookup requires integer coordinates");
        }
        return getPathfindingNodeIndexForKey(pathfindingNodeKey(xindex, yindex));
    }

    function advanceAgentPathCursor(agent) {
        const reachedDistance = getAgentPathWaypointReachedDistance(agent);
        while (agent.pathCursor < agent.pathNodeKeys.length) {
            const waypoint = getAgentPathWaypoint(agent);
            if (!waypoint) return;
            const distance = Math.hypot(waypoint.x - agent.x, waypoint.y - agent.y);
            if (distance > reachedDistance) return;
            agent.pathCursor += 1;
        }
    }

    function getAgentPathWaypointReachedDistance(agent) {
        if (!agent || !Number.isFinite(agent.radius) || !(agent.radius > 0)) {
            throw new Error("Wizard of Flatland path waypoint reach requires a positive enemy radius");
        }
        return agent.radius + PATH_WAYPOINT_REACHED_PADDING;
    }

    function getAgentPathWaypoint(agent) {
        if (agent.pathCursor >= agent.pathNodeKeys.length) return null;
        const pathKey = agent.pathNodeKeys[agent.pathCursor];
        if (typeof pathKey !== "string" || pathKey.length === 0) {
            throw new Error(`Wizard of Flatland path contains malformed node key at cursor ${agent.pathCursor}`);
        }
        const currentPathIndex = getPathfindingNodeIndexForKey(pathKey);
        const storedWaypoint = getStoredAgentPathWaypoint(agent, agent.pathCursor, pathKey);
        if (Number.isInteger(currentPathIndex)) {
            return {
                pathIndex: currentPathIndex,
                x: getPathfindingNodeX(currentPathIndex),
                y: getPathfindingNodeY(currentPathIndex),
                key: pathKey,
                blocked: isPathfindingNodeBlocked(currentPathIndex),
                wallBlockedFromPrevious: storedWaypoint ? storedWaypoint.wallBlockedFromPrevious === true : false,
                wallBlockedEdgeKey: storedWaypoint && typeof storedWaypoint.wallBlockedEdgeKey === "string" ? storedWaypoint.wallBlockedEdgeKey : "",
                wallBlockedWallIndex: storedWaypoint && Number.isInteger(storedWaypoint.wallBlockedWallIndex) ? storedWaypoint.wallBlockedWallIndex : -1,
                stale: false
            };
        }
        if (!storedWaypoint) {
            throw new Error(`Wizard of Flatland path waypoint ${pathKey} is missing from current and stored path data`);
        }
        return {
            pathIndex: null,
            x: storedWaypoint.x,
            y: storedWaypoint.y,
            key: pathKey,
            blocked: null,
            wallBlockedFromPrevious: storedWaypoint.wallBlockedFromPrevious === true,
            wallBlockedEdgeKey: typeof storedWaypoint.wallBlockedEdgeKey === "string" ? storedWaypoint.wallBlockedEdgeKey : "",
            wallBlockedWallIndex: Number.isInteger(storedWaypoint.wallBlockedWallIndex) ? storedWaypoint.wallBlockedWallIndex : -1,
            stale: true
        };
    }

    function getStoredAgentPathWaypoint(agent, cursor, expectedKey) {
        const waypoints = Array.isArray(agent.pathWaypoints) ? agent.pathWaypoints : [];
        const waypoint = waypoints[cursor];
        if (!waypoint || typeof waypoint !== "object") return null;
        if (waypoint.key !== expectedKey) {
            throw new Error(`Wizard of Flatland path waypoint key mismatch: expected ${expectedKey}, got ${waypoint.key}`);
        }
        if (!Number.isFinite(waypoint.x) || !Number.isFinite(waypoint.y)) {
            throw new Error(`Wizard of Flatland path waypoint ${expectedKey} has invalid coordinates`);
        }
        if (waypoint.wallBlockedFromPrevious !== undefined && typeof waypoint.wallBlockedFromPrevious !== "boolean") {
            throw new Error(`Wizard of Flatland path waypoint ${expectedKey} has invalid wall-blocked edge flag`);
        }
        if (waypoint.wallBlockedEdgeKey !== undefined && typeof waypoint.wallBlockedEdgeKey !== "string") {
            throw new Error(`Wizard of Flatland path waypoint ${expectedKey} has invalid wall-blocked edge key`);
        }
        if (waypoint.wallBlockedWallIndex !== undefined && (!Number.isInteger(waypoint.wallBlockedWallIndex) || waypoint.wallBlockedWallIndex < -1)) {
            throw new Error(`Wizard of Flatland path waypoint ${expectedKey} has invalid wall-blocked wall index`);
        }
        return waypoint;
    }

    function getPathfindingNodeCount() {
        return state.nodeLayer.nodes.length / PATH_SNAPSHOT_NODE_STRIDE;
    }

    function getPathfindingEdgeCount() {
        return state.nodeLayer.edges.length / PATH_SNAPSHOT_EDGE_STRIDE;
    }

    function getPathfindingBlockedEdgeCount() {
        return state.nodeLayer.blockedEdges.length / PATH_SNAPSHOT_EDGE_STRIDE;
    }

    function getPathfindingBlockedEdgeWallIndex(fromPathIndex, toPathIndex) {
        if (!isValidPathfindingNodeIndex(fromPathIndex) || !isValidPathfindingNodeIndex(toPathIndex)) {
            throw new Error("Wizard of Flatland blocked path edge lookup requires valid path nodes");
        }
        const blockedEdges = state.nodeLayer && state.nodeLayer.blockedEdges;
        if (!(blockedEdges instanceof Int32Array) || blockedEdges.length % PATH_SNAPSHOT_EDGE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland blocked path edge lookup requires packed blocked edges");
        }
        const forwardWallIndex = findPathfindingBlockedEdgeWallIndex(blockedEdges, fromPathIndex, toPathIndex);
        if (forwardWallIndex >= 0) return forwardWallIndex;
        const reverseWallIndex = findPathfindingBlockedEdgeWallIndex(blockedEdges, toPathIndex, fromPathIndex);
        if (reverseWallIndex >= 0) return reverseWallIndex;
        throw new Error(`Wizard of Flatland blocked path edge ${fromPathIndex}->${toPathIndex} is missing its wall index`);
    }

    function findPathfindingBlockedEdgeWallIndex(blockedEdges, fromPathIndex, toPathIndex) {
        if (!(blockedEdges instanceof Int32Array) || blockedEdges.length % PATH_SNAPSHOT_EDGE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland blocked path edge scan requires packed blocked edges");
        }
        for (let base = 0; base < blockedEdges.length; base += PATH_SNAPSHOT_EDGE_STRIDE) {
            if (blockedEdges[base + PATH_EDGE_FROM] !== fromPathIndex || blockedEdges[base + PATH_EDGE_TO] !== toPathIndex) continue;
            const wallIndex = blockedEdges[base + 2];
            if (!Number.isInteger(wallIndex) || wallIndex < 0) {
                throw new Error("Wizard of Flatland blocked path edge lookup found invalid wall index");
            }
            return wallIndex;
        }
        return -1;
    }

    function isValidPathfindingNodeIndex(pathIndex) {
        return Number.isInteger(pathIndex) && pathIndex >= 0 && pathIndex < getPathfindingNodeCount();
    }

    function getPathfindingNodeBase(pathIndex) {
        if (!isValidPathfindingNodeIndex(pathIndex)) {
            throw new Error(`Wizard of Flatland path node index is invalid: ${pathIndex}`);
        }
        return pathIndex * PATH_SNAPSHOT_NODE_STRIDE;
    }

    function getPathfindingNodeX(pathIndex) {
        return state.nodeLayer.nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_X];
    }

    function getPathfindingNodeY(pathIndex) {
        return state.nodeLayer.nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_Y];
    }

    function isPathfindingNodeBlocked(pathIndex) {
        return state.nodeLayer.nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_BLOCKED] === 1;
    }

    function getPathfindingNodeXIndex(pathIndex) {
        return Math.round(state.nodeLayer.nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_XINDEX]);
    }

    function getPathfindingNodeYIndex(pathIndex) {
        return Math.round(state.nodeLayer.nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_YINDEX]);
    }

    function getPathfindingNodeKey(pathIndex) {
        return pathfindingNodeKey(getPathfindingNodeXIndex(pathIndex), getPathfindingNodeYIndex(pathIndex));
    }

    function getPathfindingNodeIndexForKey(pathKey) {
        if (typeof pathKey !== "string" || pathKey.length === 0) {
            throw new Error("Wizard of Flatland path node lookup requires a node key");
        }
        if (!(state.nodeLayer.indexByKey instanceof Map)) {
            throw new Error("Wizard of Flatland path node lookup requires a node key index");
        }
        return state.nodeLayer.indexByKey.has(pathKey) ? state.nodeLayer.indexByKey.get(pathKey) : null;
    }

    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const width = Math.max(1, Math.floor(rect.width * dpr));
        const height = Math.max(1, Math.floor(rect.height * dpr));
        const previousScale = state.view.scale;
        const previousOffsetX = state.view.offsetX;
        const previousOffsetY = state.view.offsetY;
        const previousCenterX = state.view.centerX;
        const previousCenterY = state.view.centerY;
        let resized = false;
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            resized = true;
        }
        state.view.width = width;
        state.view.height = height;
        state.view.dpr = dpr;
        state.view.baseScale = Math.min(width / 42, height / 29);
        state.view.scale = state.view.baseScale * state.view.zoom;
        state.view.offsetX = width / 2;
        state.view.offsetY = height / 2;
        state.view.centerX = Number.isFinite(state.target.x) ? state.target.x : 0;
        state.view.centerY = Number.isFinite(state.target.y) ? state.target.y : 0;
        if (
            resized ||
            Math.abs(state.view.scale - previousScale) > 0.001 ||
            Math.abs(state.view.offsetX - previousOffsetX) > 0.001 ||
            Math.abs(state.view.offsetY - previousOffsetY) > 0.001 ||
            Math.abs(state.view.centerX - previousCenterX) > 0.001 ||
            Math.abs(state.view.centerY - previousCenterY) > 0.001
        ) {
            state.hexGridLayer.dirty = true;
            state.nodeLayer.dirty = true;
            if (
                isProceduralMazeScenario() &&
                (
                    resized ||
                    Math.abs(state.view.scale - previousScale) > 0.001 ||
                    Math.abs(state.view.offsetX - previousOffsetX) > 0.001 ||
                    Math.abs(state.view.offsetY - previousOffsetY) > 0.001
                )
            ) {
                invalidateMazeLookaheadCache();
            }
        }
    }

    function worldToScreen(x, y) {
        return {
            x: state.view.offsetX + (x - state.view.centerX) * state.view.scale,
            y: state.view.offsetY + (y - state.view.centerY) * state.view.scale
        };
    }

    function handleZoomWheel(event) {
        if (!state.zoomHeld) return false;
        if (!event || !Number.isFinite(event.deltaY)) return false;
        resizeCanvas();
        const previousZoom = state.view.zoom;
        const multiplier = Math.exp(-event.deltaY * VIEW_ZOOM_WHEEL_STEP);
        const nextZoom = Math.max(VIEW_ZOOM_MIN, Math.min(VIEW_ZOOM_MAX, previousZoom * multiplier));
        if (Math.abs(nextZoom - previousZoom) <= 0.0001) {
            event.preventDefault();
            return true;
        }
        state.view.zoom = nextZoom;
        state.view.scale = state.view.baseScale * state.view.zoom;
        state.hexGridLayer.dirty = true;
        state.nodeLayer.dirty = true;
        if (isProceduralMazeScenario()) {
            invalidateMazeLookaheadCache();
            state.nodeLayer.pathCenterX = NaN;
            state.nodeLayer.pathCenterY = NaN;
        }
        event.preventDefault();
        return true;
    }

    function ensureDebugFpsCounterElement() {
        if (state.debug.fpsCounterElement) return state.debug.fpsCounterElement;
        const element = document.createElement("div");
        element.className = "debug-fps-counter hidden";
        element.setAttribute("aria-live", "off");
        document.body.appendChild(element);
        state.debug.fpsCounterElement = element;
        return element;
    }

    function setDebugFpsCounterVisible(visible) {
        state.debug.showFpsCounter = !!visible;
        const element = ensureDebugFpsCounterElement();
        element.classList.toggle("hidden", !state.debug.showFpsCounter);
        if (state.debug.showFpsCounter) {
            state.debug.lastFpsCounterUpdateAt = 0;
        }
        return state.debug.showFpsCounter;
    }

    function toggleDebugFpsCounter() {
        return setDebugFpsCounterVisible(!state.debug.showFpsCounter);
    }

    function updateDebugFpsCounter(now, dt, renderMs, frameParts = []) {
        if (!state.debug.showFpsCounter) return;
        if (now - state.debug.lastFpsCounterUpdateAt < 100) return;
        const element = ensureDebugFpsCounterElement();
        const fps = dt > 0 ? 1 / dt : 0;
        const npcSolverMs = Number(state.stats && state.stats.solveMs || 0);
        const crowdThrottleCount = Number(state.stats && state.stats.crowdThrottleCount || 0);
        const contactPasses = Number(state.stats && state.stats.contactPasses || 0);
        const contactPairChecks = Number(state.stats && state.stats.contactPairChecks || 0);
        const slowestPart = Array.isArray(frameParts) && frameParts.length > 0
            ? frameParts.reduce((slowest, part) => part.duration > slowest.duration ? part : slowest, frameParts[0])
            : null;
        const lines = [
            `FPS ${fps.toFixed(1)}`,
            `Render ${renderMs.toFixed(2)} ms`,
            `NPC solver ${npcSolverMs.toFixed(2)} ms`,
            `Contact ${contactPasses}p/${contactPairChecks}c`,
            `Crowd ${crowdThrottleCount}`
        ];
        if (state.los && state.los.lastMetrics) {
            const losMetrics = state.los.lastMetrics;
            lines.push(`LOS ${Number(losMetrics.elapsedMs || 0).toFixed(2)} ms/${Number(losMetrics.candidateWallCount || 0)}w`);
        }
        if (slowestPart) lines.push(`Main ${slowestPart.label} ${slowestPart.duration.toFixed(2)} ms`);
        element.textContent = lines.join("\n");
        state.debug.lastFpsCounterUpdateAt = now;
    }

    function draw() {
        resizeCanvas();
        drawFloor();
        drawMazeRingBoundaries();
        if (state.debug.showHexGrid) drawHexGridLayer();
        drawPathfindingNodeLayer();
        drawWallShatterEffects();
        drawSectionBoundaries();
        drawWallLabels();
        drawWallBuildPreview();
        drawCoins();
        drawTalismans();
        drawTarget();
        if (state.debug.showAgentPath) drawAgentPaths();
        drawFreezeParticles();
        if (state.debug.showDeathPathDiagnostics) {
            drawTemporaryDeathBlockerDiagnostics();
            drawTemporaryPathCostDiagnostics();
        }
        drawFireballs();
        drawFireballExplosions();
        drawFireDeathEffects();
        drawSpikeShatterEffects();
        drawAgents();
        drawLosOverlay();
        drawWalls();
    }

    function updateLosAndExploration() {
        const los = state.los;
        if (!los || los.enabled !== true) return;
        explorationSystem.syncWalls(state.walls, explorationWallLayout);
        const result = computeLosVisibilityPolygon({
            x: state.target.x,
            y: state.target.y,
            walls: state.walls,
            wallStride: WALL_STRIDE,
            wallX1: WALL_X1,
            wallY1: WALL_Y1,
            wallX2: WALL_X2,
            wallY2: WALL_Y2,
            bins: los.bins,
            maxDistance: los.maxDistance
        });
        los.lastMetrics = {
            bins: result.bins,
            candidateWallCount: result.candidateWallCount,
            elapsedMs: result.elapsedMs
        };
        los.lastResult = result;
        explorationSystem.applyVisibility(result.hitWallIndices, result.hitWallTs);
    }

    function drawLosOverlay() {
        const los = state.los;
        if (!los || los.enabled !== true) return;
        if (!(state.view.width > 0 && state.view.height > 0 && state.view.scale > 0)) {
            throw new Error("Wizard of Flatland LOS overlay requires a valid viewport");
        }
        if (!los.lastResult) throw new Error("Wizard of Flatland LOS overlay requires a computed visibility result");
        drawLosVisibilityMask(los.lastResult.points, los.opacity);
    }

    function drawLosVisibilityMask(points, opacity) {
        if (!Array.isArray(points) || points.length < 3) {
            throw new Error("Wizard of Flatland LOS overlay requires a visibility polygon");
        }
        const alpha = Number.isFinite(Number(opacity)) ? Math.max(0, Math.min(1, Number(opacity))) : 0.64;
        if (alpha <= 0) return;

        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${alpha})`;
        ctx.beginPath();
        ctx.rect(0, 0, canvas.width, canvas.height);
        const first = worldToScreen(points[0].x, points[0].y);
        if (!Number.isFinite(first.x) || !Number.isFinite(first.y)) {
            throw new Error("Wizard of Flatland LOS overlay generated an invalid screen point");
        }
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < points.length; i++) {
            const screen = worldToScreen(points[i].x, points[i].y);
            if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
                throw new Error("Wizard of Flatland LOS overlay generated an invalid screen point");
            }
            ctx.lineTo(screen.x, screen.y);
        }
        ctx.closePath();
        ctx.fill("evenodd");
        ctx.restore();
    }

    function drawFloor() {
        if (!(state.view.width > 0 && state.view.height > 0 && state.view.scale > 0)) {
            throw new Error("Wizard of Flatland floor gradient requires a valid viewport");
        }
        const options = getMazeOptions();
        const viewport = getCurrentMazeViewportRect();
        if (!viewport) throw new Error("Wizard of Flatland floor gradient requires a current viewport");
        const sectionWorldStep = Math.sqrt(3) * getMazeSectionRadius(options);
        const edgeWorldRadius = sectionWorldStep * FLOOR_GRADIENT_SECTION_DISTANCE;
        const midOuterWorldRadius = sectionWorldStep * FLOOR_GRADIENT_MID_OUTER_SECTION_DISTANCE;
        const farOuterWorldRadius = sectionWorldStep * FLOOR_GRADIENT_FAR_OUTER_SECTION_DISTANCE;
        const outerWorldRadius = sectionWorldStep * FLOOR_GRADIENT_OUTER_SECTION_DISTANCE;
        if (!(outerWorldRadius > 0)) {
            throw new Error("Wizard of Flatland floor gradient requires a positive radius");
        }
        ctx.fillStyle = FLOOR_OUTER_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (getMinDistanceFromOriginToRect(viewport) >= outerWorldRadius) {
            drawInactivePyramidFloorDarkness(options, viewport, sectionWorldStep);
            drawHomeBaseFloorLight(options, viewport, sectionWorldStep);
            return;
        }
        const center = worldToScreen(0, 0);
        const outerRadius = outerWorldRadius * state.view.scale;
        if (!(outerRadius > 0)) {
            throw new Error("Wizard of Flatland floor gradient requires a positive radius");
        }
        const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, outerRadius);
        gradient.addColorStop(0, FLOOR_CENTER_COLOR);
        gradient.addColorStop(edgeWorldRadius / outerWorldRadius, FLOOR_EDGE_COLOR);
        gradient.addColorStop(midOuterWorldRadius / outerWorldRadius, FLOOR_MID_OUTER_COLOR);
        gradient.addColorStop(farOuterWorldRadius / outerWorldRadius, FLOOR_FAR_OUTER_COLOR);
        gradient.addColorStop(1, FLOOR_OUTER_COLOR);
        ctx.save();
        ctx.beginPath();
        ctx.arc(center.x, center.y, outerRadius, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        drawInactivePyramidFloorDarkness(options, viewport, sectionWorldStep);
        drawHomeBaseFloorLight(options, viewport, sectionWorldStep);
    }

    function drawInactivePyramidFloorDarkness(options, viewport, sectionWorldStep) {
        if (!options || typeof options !== "object") {
            throw new Error("Wizard of Flatland pyramid darkness requires maze options");
        }
        if (!viewport) throw new Error("Wizard of Flatland pyramid darkness requires a current viewport");
        if (!(sectionWorldStep > 0)) {
            throw new Error("Wizard of Flatland pyramid darkness requires a positive section step");
        }
        if (!(state.activatedTalismanSectionKeys instanceof Set)) {
            throw new Error("Wizard of Flatland pyramid darkness requires activated talisman tracking");
        }
        const darknessRadiusWorld = sectionWorldStep * FLOOR_INACTIVE_PYRAMID_DARKNESS_SECTION_DISTANCE;
        const darknessRadius = darknessRadiusWorld * state.view.scale;
        if (!(darknessRadius > 0)) {
            throw new Error("Wizard of Flatland pyramid darkness requires a positive screen radius");
        }
        const sectionRadius = getMazeSectionRadius(options);
        const expandedViewport = {
            minX: viewport.minX - darknessRadiusWorld,
            minY: viewport.minY - darknessRadiusWorld,
            maxX: viewport.maxX + darknessRadiusWorld,
            maxY: viewport.maxY + darknessRadiusWorld
        };
        const bounds = getMazeSectionCoordBoundsForRect(expandedViewport, sectionRadius);
        for (let q = bounds.minQ; q <= bounds.maxQ; q += 1) {
            for (let r = bounds.minR; r <= bounds.maxR; r += 1) {
                if (getMazePyramidRoomDistance(q, r) === null) continue;
                const sectionKey = mazeSectionKey(q, r);
                if (state.activatedTalismanSectionKeys.has(sectionKey)) continue;
                const centerWorld = mazeSectionCenter(q, r, options);
                if (getMinDistanceFromPointToRect(centerWorld.x, centerWorld.y, viewport) >= darknessRadiusWorld) continue;
                drawInactivePyramidFloorDarknessGradient(centerWorld, darknessRadius);
            }
        }
    }

    function getMazeSectionCoordBoundsForRect(rect, sectionRadius) {
        if (
            !rect ||
            !Number.isFinite(rect.minX) ||
            !Number.isFinite(rect.minY) ||
            !Number.isFinite(rect.maxX) ||
            !Number.isFinite(rect.maxY) ||
            rect.maxX < rect.minX ||
            rect.maxY < rect.minY ||
            !(sectionRadius > 0)
        ) {
            throw new Error("Wizard of Flatland pyramid darkness requires finite section-coordinate bounds");
        }
        const coords = [];
        for (const x of [rect.minX, rect.maxX]) {
            for (const y of [rect.minY, rect.maxY]) {
                const r = 2 * y / (3 * sectionRadius);
                coords.push({
                    q: x / (Math.sqrt(3) * sectionRadius) - r * 0.5,
                    r
                });
            }
        }
        return {
            minQ: Math.floor(Math.min(...coords.map((coord) => coord.q))) - 1,
            maxQ: Math.ceil(Math.max(...coords.map((coord) => coord.q))) + 1,
            minR: Math.floor(Math.min(...coords.map((coord) => coord.r))) - 1,
            maxR: Math.ceil(Math.max(...coords.map((coord) => coord.r))) + 1
        };
    }

    function drawInactivePyramidFloorDarknessGradient(centerWorld, darknessRadius) {
        if (!centerWorld || !Number.isFinite(centerWorld.x) || !Number.isFinite(centerWorld.y)) {
            throw new Error("Wizard of Flatland pyramid darkness gradient requires a finite center");
        }
        if (!(darknessRadius > 0)) {
            throw new Error("Wizard of Flatland pyramid darkness gradient requires a positive radius");
        }
        const center = worldToScreen(centerWorld.x, centerWorld.y);
        const gradient = ctx.createRadialGradient(
            center.x,
            center.y,
            0,
            center.x,
            center.y,
            darknessRadius
        );
        gradient.addColorStop(0, `rgba(0,0,0,${FLOOR_INACTIVE_PYRAMID_DARKNESS})`);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.save();
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(center.x, center.y, darknessRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawHomeBaseFloorLight(options, viewport, sectionWorldStep) {
        const sectionKey = getHomeBaseTalismanSectionKey();
        if (sectionKey.length === 0) return;
        if (!viewport) throw new Error("Wizard of Flatland home base floor light requires a current viewport");
        if (!(sectionWorldStep > 0)) throw new Error("Wizard of Flatland home base floor light requires a positive section step");
        const coord = parseMazeSectionKey(sectionKey);
        if (getMazePyramidRoomDistance(coord.q, coord.r) === null) {
            throw new Error(`Wizard of Flatland home base floor light requires a pyramid section, got ${sectionKey}`);
        }
        const lightRadiusWorld = sectionWorldStep * FLOOR_HOME_BASE_LIGHT_SECTION_DISTANCE;
        if (!(lightRadiusWorld > 0)) throw new Error("Wizard of Flatland home base floor light requires a positive radius");
        const centerWorld = mazeSectionCenter(coord.q, coord.r, options);
        if (getMinDistanceFromPointToRect(centerWorld.x, centerWorld.y, viewport) >= lightRadiusWorld) return;
        const center = worldToScreen(centerWorld.x, centerWorld.y);
        const lightRadius = lightRadiusWorld * state.view.scale;
        if (!(lightRadius > 0)) throw new Error("Wizard of Flatland home base floor light requires a positive screen radius");
        const viewportMinDistance = getMinDistanceFromPointToRect(centerWorld.x, centerWorld.y, viewport);
        const viewportCenterDistance = Math.hypot(state.target.x - centerWorld.x, state.target.y - centerWorld.y);
        const viewportMaxDistance = getMaxDistanceFromPointToRect(centerWorld.x, centerWorld.y, viewport);
        const lightStops = getHomeBaseFloorLightStops(
            lightRadiusWorld,
            viewportMinDistance,
            viewportCenterDistance,
            viewportMaxDistance
        );
        const lightGradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, lightRadius);
        const saturationGradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, lightRadius);
        for (const stop of lightStops) {
            const position = stop.distance / lightRadiusWorld;
            lightGradient.addColorStop(position, `rgba(255,255,255,${stop.brightness})`);
            saturationGradient.addColorStop(position, `rgba(255,0,0,${stop.brightness})`);
        }
        ctx.save();
        ctx.beginPath();
        ctx.arc(center.x, center.y, lightRadius, 0, Math.PI * 2);
        ctx.globalCompositeOperation = "saturation";
        if (ctx.globalCompositeOperation !== "saturation") {
            throw new Error("Wizard of Flatland home base floor light requires saturation compositing");
        }
        ctx.fillStyle = saturationGradient;
        ctx.fill();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = lightGradient;
        ctx.fill();
        ctx.restore();
    }

    function getMinDistanceFromOriginToRect(rect) {
        if (!rect || !Number.isFinite(rect.minX) || !Number.isFinite(rect.minY) || !Number.isFinite(rect.maxX) || !Number.isFinite(rect.maxY)) {
            throw new Error("Wizard of Flatland floor gradient requires a finite viewport rectangle");
        }
        const dx = rect.minX > 0 ? rect.minX : rect.maxX < 0 ? -rect.maxX : 0;
        const dy = rect.minY > 0 ? rect.minY : rect.maxY < 0 ? -rect.maxY : 0;
        return Math.hypot(dx, dy);
    }

    function getMaxDistanceFromOriginToRect(rect) {
        if (!rect || !Number.isFinite(rect.minX) || !Number.isFinite(rect.minY) || !Number.isFinite(rect.maxX) || !Number.isFinite(rect.maxY)) {
            throw new Error("Wizard of Flatland ring boundary drawing requires a finite viewport rectangle");
        }
        return Math.max(
            Math.hypot(rect.minX, rect.minY),
            Math.hypot(rect.maxX, rect.minY),
            Math.hypot(rect.maxX, rect.maxY),
            Math.hypot(rect.minX, rect.maxY)
        );
    }

    function getMinDistanceFromPointToRect(x, y, rect) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error("Wizard of Flatland point-rectangle distance requires a finite point");
        }
        if (!rect || !Number.isFinite(rect.minX) || !Number.isFinite(rect.minY) || !Number.isFinite(rect.maxX) || !Number.isFinite(rect.maxY)) {
            throw new Error("Wizard of Flatland point-rectangle distance requires a finite rectangle");
        }
        const dx = x < rect.minX ? rect.minX - x : x > rect.maxX ? x - rect.maxX : 0;
        const dy = y < rect.minY ? rect.minY - y : y > rect.maxY ? y - rect.maxY : 0;
        return Math.hypot(dx, dy);
    }

    function getMaxDistanceFromPointToRect(x, y, rect) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error("Wizard of Flatland point-rectangle distance requires a finite point");
        }
        if (!rect || !Number.isFinite(rect.minX) || !Number.isFinite(rect.minY) || !Number.isFinite(rect.maxX) || !Number.isFinite(rect.maxY)) {
            throw new Error("Wizard of Flatland point-rectangle distance requires a finite rectangle");
        }
        return Math.max(
            Math.hypot(rect.minX - x, rect.minY - y),
            Math.hypot(rect.maxX - x, rect.minY - y),
            Math.hypot(rect.maxX - x, rect.maxY - y),
            Math.hypot(rect.minX - x, rect.maxY - y)
        );
    }

    function drawMazeRingBoundaries() {
        if (!isProceduralMazeScenario()) return;
        const options = getMazeOptions();
        const viewport = getCurrentMazeViewportRect();
        if (!viewport) throw new Error("Wizard of Flatland ring boundary drawing requires a current viewport");
        const radius = getMazeSectionRadius(options);
        if (!(radius > 0)) throw new Error("Wizard of Flatland ring boundary drawing requires a positive section radius");
        const sectionWorldStep = Math.sqrt(3) * radius;
        const minDistance = getMinDistanceFromOriginToRect(viewport);
        const maxDistance = getMaxDistanceFromOriginToRect(viewport);
        const firstRing = Math.max(
            MAZE_RING_BOUNDARY_INTERVAL,
            Math.ceil(minDistance / sectionWorldStep / MAZE_RING_BOUNDARY_INTERVAL) * MAZE_RING_BOUNDARY_INTERVAL
        );
        const lastRing = Math.floor(maxDistance / sectionWorldStep / MAZE_RING_BOUNDARY_INTERVAL) * MAZE_RING_BOUNDARY_INTERVAL;
        if (lastRing < firstRing) return;

        ctx.save();
        ctx.strokeStyle = MAZE_RING_BOUNDARY_COLOR;
        ctx.lineWidth = Math.max(1, state.view.scale * 0.026);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.setLineDash([Math.max(2.5, state.view.scale * 0.14), Math.max(3.5, state.view.scale * 0.18)]);
        const center = worldToScreen(0, 0);
        for (let ring = firstRing; ring <= lastRing; ring += MAZE_RING_BOUNDARY_INTERVAL) {
            drawMazeRingBoundaryCircle(center, sectionWorldStep * ring);
        }
        ctx.setLineDash([]);
        ctx.restore();
    }

    function drawMazeRingBoundaryCircle(center, worldRadius) {
        if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y) || !(worldRadius > 0)) {
            throw new Error("Wizard of Flatland ring boundary circle requires finite render data");
        }
        const screenRadius = worldRadius * state.view.scale;
        if (!(screenRadius > 0)) throw new Error("Wizard of Flatland ring boundary circle requires a positive screen radius");
        ctx.beginPath();
        ctx.arc(center.x, center.y, screenRadius, 0, Math.PI * 2);
        ctx.stroke();
    }

    function drawHexGridLayer() {
        const layer = state.hexGridLayer;
        if (!layer.ctx) throw new Error("Wizard of Flatland hex grid layer requires a 2D context");
        if (
            layer.dirty ||
            layer.width !== state.view.width ||
            layer.height !== state.view.height ||
            Math.abs(layer.scale - state.view.scale) > 0.001 ||
            Math.abs(layer.offsetX - state.view.offsetX) > 0.001 ||
            Math.abs(layer.offsetY - state.view.offsetY) > 0.001 ||
            Math.abs(layer.centerX - state.view.centerX) > 0.001 ||
            Math.abs(layer.centerY - state.view.centerY) > 0.001
        ) {
            rebuildHexGridLayer();
        }
        ctx.drawImage(layer.canvas, 0, 0);
    }

    function rebuildHexGridLayer() {
        const layer = state.hexGridLayer;
        if (!layer.ctx) throw new Error("Wizard of Flatland hex grid layer requires a 2D context");
        if (!(state.view.width > 0 && state.view.height > 0 && state.view.scale > 0)) {
            throw new Error("Wizard of Flatland hex grid requires a valid viewport");
        }

        layer.width = state.view.width;
        layer.height = state.view.height;
        layer.scale = state.view.scale;
        layer.offsetX = state.view.offsetX;
        layer.offsetY = state.view.offsetY;
        layer.centerX = state.view.centerX;
        layer.centerY = state.view.centerY;
        layer.canvas.width = layer.width;
        layer.canvas.height = layer.height;

        const gridCtx = layer.ctx;
        gridCtx.clearRect(0, 0, layer.width, layer.height);
        gridCtx.save();
        gridCtx.lineWidth = Math.max(1, layer.scale * 0.018);
        gridCtx.strokeStyle = "rgba(236,244,248,0.13)";

        const worldMinX = layer.centerX + (0 - layer.offsetX) / layer.scale;
        const worldMaxX = layer.centerX + (layer.width - layer.offsetX) / layer.scale;
        const worldMinY = layer.centerY + (0 - layer.offsetY) / layer.scale;
        const worldMaxY = layer.centerY + (layer.height - layer.offsetY) / layer.scale;
        const colStart = Math.floor(worldMinX / HEX_GRID_COL_STEP) - HEX_GRID_PADDING;
        const colEnd = Math.ceil(worldMaxX / HEX_GRID_COL_STEP) + HEX_GRID_PADDING;
        const rowStart = Math.floor(worldMinY / HEX_GRID_ROW_STEP) - HEX_GRID_PADDING;
        const rowEnd = Math.ceil(worldMaxY / HEX_GRID_ROW_STEP) + HEX_GRID_PADDING;
        const halfW = HEX_GRID_WIDTH * layer.scale * 0.5;
        const quarterW = HEX_GRID_WIDTH * layer.scale * 0.25;
        const halfH = HEX_GRID_HEIGHT * layer.scale * 0.5;

        for (let col = colStart; col <= colEnd; col++) {
            const centerX = layer.offsetX + (col * HEX_GRID_COL_STEP - layer.centerX) * layer.scale;
            for (let row = rowStart; row <= rowEnd; row++) {
                const centerY = layer.offsetY + (row + (isEvenGridColumn(col) ? 0.5 : 0) - layer.centerY) * layer.scale;
                gridCtx.beginPath();
                gridCtx.moveTo(centerX - halfW, centerY);
                gridCtx.lineTo(centerX - quarterW, centerY - halfH);
                gridCtx.lineTo(centerX + quarterW, centerY - halfH);
                gridCtx.lineTo(centerX + halfW, centerY);
                gridCtx.lineTo(centerX + quarterW, centerY + halfH);
                gridCtx.lineTo(centerX - quarterW, centerY + halfH);
                gridCtx.closePath();
                gridCtx.stroke();
            }
        }

        gridCtx.restore();
        layer.dirty = false;
    }

    function rebuildPathfindingNodeLayer() {
        const wallGeometry = getWallGeometryApi();
        const bounds = getPathfindingLayerBounds();
        state.nodeLayer.pathCenterX = state.target.x;
        state.nodeLayer.pathCenterY = state.target.y;
        const colStart = Math.floor(bounds.minX / HEX_GRID_COL_STEP) - PATH_NODE_LAYER_PADDING;
        const colEnd = Math.ceil(bounds.maxX / HEX_GRID_COL_STEP) + PATH_NODE_LAYER_PADDING;
        const rowStart = Math.floor(bounds.minY) - PATH_NODE_LAYER_PADDING;
        const rowEnd = Math.ceil(bounds.maxY) + PATH_NODE_LAYER_PADDING;
        const nodes = [];
        const nodeByKey = new Map();

        for (let col = colStart; col <= colEnd; col++) {
            for (let row = rowStart; row <= rowEnd; row++) {
                const node = createPathfindingNode(col, row);
                nodes.push(node);
                nodeByKey.set(node.key, node);
            }
        }

        for (const node of nodes) {
            const offsets = getPathfindingNeighborOffsets(node.xindex);
            for (let dir = 0; dir < 12; dir++) {
                const offset = offsets[dir];
                const neighbor = nodeByKey.get(pathfindingNodeKey(node.xindex + offset.x, node.yindex + offset.y));
                node.neighbors[dir] = neighbor || null;
            }
        }

        const blockedEdges = [];
        const blockedKeys = new Set();
        for (let w = 0; w < state.walls.length; w += WALL_STRIDE) {
            const ax = state.walls[w + WALL_X1];
            const ay = state.walls[w + WALL_Y1];
            const bx = state.walls[w + WALL_X2];
            const by = state.walls[w + WALL_Y2];
            const wallMinX = Math.min(ax, bx) - HEX_GRID_WIDTH;
            const wallMaxX = Math.max(ax, bx) + HEX_GRID_WIDTH;
            const wallMinY = Math.min(ay, by) - HEX_GRID_HEIGHT;
            const wallMaxY = Math.max(ay, by) + HEX_GRID_HEIGHT;
            for (const node of nodes) {
                if (node.x < wallMinX || node.x > wallMaxX || node.y < wallMinY || node.y > wallMaxY) continue;
                for (let dir = 0; dir < 12; dir++) {
                    const neighbor = node.neighbors[dir];
                    if (!neighbor) continue;
                    const edgeKey = pathfindingEdgeKey(node, neighbor);
                    if (blockedKeys.has(edgeKey)) continue;
                    if (!wallGeometry.connectionCrossesWallFaces(
                        node,
                        neighbor,
                        { x: ax, y: ay },
                        { x: bx, y: by },
                        {
                            thickness: PATH_NODE_WALL_THICKNESS,
                            extend: PATH_NODE_WALL_FACE_EXTEND
                        }
                    )) {
                        continue;
                    }
                    blockedKeys.add(edgeKey);
                    addDirectionalBlock(node, dir, w / WALL_STRIDE);
                    const reverseDir = neighbor.neighbors.indexOf(node);
                    if (reverseDir >= 0) addDirectionalBlock(neighbor, reverseDir, w / WALL_STRIDE);
                    blockedEdges.push({ a: node, b: neighbor, wallIndex: w / WALL_STRIDE });
                }
            }
        }
        for (const node of nodes) {
            node.blocked = !isPathfindingNodeTerrainPassable(node);
        }
        for (let i = 0; i < nodes.length; i++) {
            nodes[i].pathIndex = i;
        }
        const packedNodes = packPathfindingNodeObjects(nodes);
        const packedEdges = packPathfindingEdgeObjects(nodes);
        state.nodeLayer.nodes = packedNodes;
        state.nodeLayer.snapshotNodes = packedNodes.slice();
        state.nodeLayer.edges = packedEdges;
        state.nodeLayer.blockedEdges = packBlockedPathfindingEdgeObjects(blockedEdges);
        state.nodeLayer.indexByKey = buildPathfindingNodeIndexByKey(packedNodes);
        applyTemporaryPathfindingModifiersToNodes();
        state.nodeLayer.nodeStride = PATH_SNAPSHOT_NODE_STRIDE;
        state.nodeLayer.edgeStride = PATH_SNAPSHOT_EDGE_STRIDE;
        state.nodeLayer.version += 1;
        state.nodeLayer.targetNodeCache = null;
        state.nodeLayer.dirty = true;
        publishPathfindingSnapshot();
    }

    function packPathfindingNodeObjects(nodes) {
        const packed = new Float32Array(nodes.length * PATH_SNAPSHOT_NODE_STRIDE);
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const base = i * PATH_SNAPSHOT_NODE_STRIDE;
            packed[base + PATH_NODE_X] = node.x;
            packed[base + PATH_NODE_Y] = node.y;
            packed[base + PATH_NODE_BLOCKED] = node.blocked === true ? 1 : 0;
            packed[base + PATH_NODE_CLEARANCE] = Infinity;
            packed[base + PATH_NODE_XINDEX] = node.xindex;
            packed[base + PATH_NODE_YINDEX] = node.yindex;
            packed[base + PATH_NODE_HAS_UNBLOCKED_NEIGHBOR] = hasUnblockedPathfindingObjectNeighbor(node) ? 1 : 0;
            packed[base + PATH_NODE_BLOCKED_NEIGHBOR_COUNT] = getPathfindingBlockedNeighborCount(node);
            packed[base + PATH_NODE_TEMPORARY_COST] = 0;
        }
        return packed;
    }

    function packPathfindingEdgeObjects(nodes) {
        let edgeCount = 0;
        for (const node of nodes) {
            for (let dir = 0; dir < node.neighbors.length; dir++) {
                if (node.neighbors[dir]) edgeCount += 1;
            }
        }
        const packed = new Int32Array(edgeCount * PATH_SNAPSHOT_EDGE_STRIDE);
        let offset = 0;
        for (const node of nodes) {
            for (let dir = 0; dir < node.neighbors.length; dir++) {
                const neighbor = node.neighbors[dir];
                if (!neighbor) continue;
                packed[offset + PATH_EDGE_FROM] = node.pathIndex;
                packed[offset + PATH_EDGE_TO] = neighbor.pathIndex;
                packed[offset + PATH_EDGE_DIRECTION] = dir;
                packed[offset + PATH_EDGE_WALL_BLOCKED] = node.blockedNeighbors.has(dir) ? 1 : 0;
                offset += PATH_SNAPSHOT_EDGE_STRIDE;
            }
        }
        return packed;
    }

    function packBlockedPathfindingEdgeObjects(blockedEdges) {
        const packed = new Int32Array(blockedEdges.length * PATH_SNAPSHOT_EDGE_STRIDE);
        for (let i = 0; i < blockedEdges.length; i++) {
            const edge = blockedEdges[i];
            const base = i * PATH_SNAPSHOT_EDGE_STRIDE;
            packed[base + PATH_EDGE_FROM] = edge.a.pathIndex;
            packed[base + PATH_EDGE_TO] = edge.b.pathIndex;
            packed[base + 2] = edge.wallIndex;
            packed[base + 3] = 0;
        }
        return packed;
    }

    function publishPathfindingSnapshot(options = {}) {
        if (options.preserveVersion !== true) {
            state.pathfindingSnapshotVersion = state.worldVersion;
        }
        const snapshot = profiler.span("build packed path snapshot", () => buildPathfindingWorkerSnapshot());
        profiler.span("transfer packed path snapshot", () => {
            pathfindingWorker.postMessage({
                type: "replace_snapshot",
                snapshot
            }, [snapshot.nodes.buffer, snapshot.edges.buffer]);
        });
    }

    function buildPathfindingWorkerSnapshot() {
        const nodes = state.nodeLayer.nodes.slice();
        const edges = state.nodeLayer.edges.slice();
        if (!(nodes instanceof Float32Array) || nodes.length % PATH_SNAPSHOT_NODE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland packed path snapshot requires packed nodes");
        }
        if (!(edges instanceof Int32Array) || edges.length % PATH_SNAPSHOT_EDGE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland packed path snapshot requires packed edges");
        }
        return {
            format: "wizard-flatland-packed-v1",
            version: state.pathfindingSnapshotVersion,
            nodeStride: PATH_SNAPSHOT_NODE_STRIDE,
            edgeStride: PATH_SNAPSHOT_EDGE_STRIDE,
            nodes,
            edges
        };
    }

    function getWallGeometryApi() {
        const api = window.WallGeometry;
        if (!api || typeof api.connectionCrossesWallFaces !== "function") {
            throw new Error("Wizard of Flatland pathfinding node layer requires WallGeometry.connectionCrossesWallFaces");
        }
        return api;
    }

    function getPathfindingLayerBounds() {
        if (isProceduralMazeScenario()) {
            const halfWidth = state.view && state.view.scale > 0
                ? state.view.width / state.view.scale * 0.5
                : 28;
            const halfHeight = state.view && state.view.scale > 0
                ? state.view.height / state.view.scale * 0.5
                : 20;
            const padding = getMazeChunkSize() * 0.65;
            return {
                minX: state.target.x - halfWidth - padding,
                minY: state.target.y - halfHeight - padding,
                maxX: state.target.x + halfWidth + padding,
                maxY: state.target.y + halfHeight + padding
            };
        }
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            minX = Math.min(minX, state.walls[i + WALL_X1], state.walls[i + WALL_X2]);
            minY = Math.min(minY, state.walls[i + WALL_Y1], state.walls[i + WALL_Y2]);
            maxX = Math.max(maxX, state.walls[i + WALL_X1], state.walls[i + WALL_X2]);
            maxY = Math.max(maxY, state.walls[i + WALL_Y1], state.walls[i + WALL_Y2]);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            throw new Error("Wizard of Flatland pathfinding node layer requires finite wall bounds");
        }
        return { minX, minY, maxX, maxY };
    }

    function createPathfindingNode(xindex, yindex) {
        return {
            x: xindex * HEX_GRID_COL_STEP,
            y: yindex + (isEvenGridColumn(xindex) ? 0.5 : 0),
            xindex,
            yindex,
            key: pathfindingNodeKey(xindex, yindex),
            pathIndex: -1,
            neighbors: new Array(12).fill(null),
            blockedNeighbors: new Map()
        };
    }

    function getPathfindingNeighborOffsets(xindex) {
        if (isEvenGridColumn(xindex)) {
            return [
                { x: -2, y: 0 },
                { x: -1, y: 0 },
                { x: -1, y: -1 },
                { x: 0, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 0 },
                { x: 2, y: 0 },
                { x: 1, y: 1 },
                { x: 1, y: 2 },
                { x: 0, y: 1 },
                { x: -1, y: 2 },
                { x: -1, y: 1 }
            ];
        }
        return [
            { x: -2, y: 0 },
            { x: -1, y: -1 },
            { x: -1, y: -2 },
            { x: 0, y: -1 },
            { x: 1, y: -2 },
            { x: 1, y: -1 },
            { x: 2, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
            { x: -1, y: 1 },
            { x: -1, y: 0 }
        ];
    }

    function pathfindingNodeKey(xindex, yindex) {
        return `${xindex},${yindex}`;
    }

    function pathfindingEdgeKey(a, b) {
        return a.key <= b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
    }

    function isPathfindingNodePassable(pathIndex) {
        return isValidPathfindingNodeIndex(pathIndex) &&
            !isPathfindingNodeBlocked(pathIndex) &&
            state.nodeLayer.nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_HAS_UNBLOCKED_NEIGHBOR] === 1;
    }

    function hasUnblockedPathfindingObjectNeighbor(node) {
        if (!node || !Array.isArray(node.neighbors)) return false;
        for (let dir = 0; dir < node.neighbors.length; dir++) {
            const neighbor = node.neighbors[dir];
            if (!neighbor || neighbor.blocked === true) continue;
            return true;
        }
        return false;
    }

    function getPathfindingBlockedNeighborCount(node) {
        if (!node || !Array.isArray(node.neighbors) || !(node.blockedNeighbors instanceof Map)) {
            throw new Error("Wizard of Flatland pathfinding blocked neighbor count requires a node");
        }
        let count = 0;
        for (let dir = 0; dir < node.neighbors.length; dir++) {
            if (node.neighbors[dir] && node.blockedNeighbors.has(dir)) count += 1;
        }
        return count;
    }

    function isPathfindingNodeTerrainPassable(node) {
        if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
            throw new Error("Wizard of Flatland pathfinding passability requires a finite node");
        }
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            const distance = pointSegmentDistance(
                node.x,
                node.y,
                state.walls[i + WALL_X1],
                state.walls[i + WALL_Y1],
                state.walls[i + WALL_X2],
                state.walls[i + WALL_Y2]
            );
            if (distance < TARGET_RADIUS + WALL_WORLD_HALF_THICKNESS) return false;
        }
        return true;
    }

    function addDirectionalBlock(node, direction, blocker) {
        if (!node || !Number.isInteger(direction) || direction < 0 || direction > 11) {
            throw new Error("Wizard of Flatland pathfinding block requires a valid node direction");
        }
        if (!node.neighbors[direction]) {
            throw new Error("Wizard of Flatland pathfinding block requires an existing neighbor connection");
        }
        if (!node.blockedNeighbors.has(direction)) node.blockedNeighbors.set(direction, new Set());
        node.blockedNeighbors.get(direction).add(blocker);
    }

    function drawPathfindingNodeLayer() {
        const layer = state.nodeLayer;
        if (!layer.ctx) throw new Error("Wizard of Flatland pathfinding node layer requires a 2D context");
        if (
            layer.dirty ||
            layer.width !== state.view.width ||
            layer.height !== state.view.height ||
            Math.abs(layer.scale - state.view.scale) > 0.001 ||
            Math.abs(layer.offsetX - state.view.offsetX) > 0.001 ||
            Math.abs(layer.offsetY - state.view.offsetY) > 0.001 ||
            Math.abs(layer.centerX - state.view.centerX) > 0.001 ||
            Math.abs(layer.centerY - state.view.centerY) > 0.001 ||
            layer.renderedVersion !== layer.version ||
            layer.renderedShowPathBlockedEdges !== state.debug.showPathBlockedEdges
        ) {
            rebuildPathfindingNodeRenderLayer();
        }
        ctx.drawImage(layer.canvas, 0, 0);
    }

    function rebuildPathfindingNodeRenderLayer() {
        const layer = state.nodeLayer;
        if (!layer.ctx) throw new Error("Wizard of Flatland pathfinding node layer requires a 2D context");
        if (!(state.view.width > 0 && state.view.height > 0 && state.view.scale > 0)) {
            throw new Error("Wizard of Flatland pathfinding node layer requires a valid viewport");
        }

        layer.width = state.view.width;
        layer.height = state.view.height;
        layer.scale = state.view.scale;
        layer.offsetX = state.view.offsetX;
        layer.offsetY = state.view.offsetY;
        layer.centerX = state.view.centerX;
        layer.centerY = state.view.centerY;
        layer.renderedVersion = layer.version;
        layer.renderedShowPathBlockedEdges = state.debug.showPathBlockedEdges;
        layer.canvas.width = layer.width;
        layer.canvas.height = layer.height;

        const nodeCtx = layer.ctx;
        nodeCtx.clearRect(0, 0, layer.width, layer.height);
        nodeCtx.save();

        if (state.debug.showPathBlockedEdges) {
            nodeCtx.strokeStyle = "rgba(255,107,107,0.78)";
            nodeCtx.lineWidth = Math.max(1.5, layer.scale * 0.035);
            nodeCtx.lineCap = "round";
            for (let i = 0; i < layer.blockedEdges.length; i += PATH_SNAPSHOT_EDGE_STRIDE) {
                const fromIndex = layer.blockedEdges[i + PATH_EDGE_FROM];
                const toIndex = layer.blockedEdges[i + PATH_EDGE_TO];
                if (!isValidPathfindingNodeIndex(fromIndex) || !isValidPathfindingNodeIndex(toIndex)) continue;
                const a = worldToScreen(getPathfindingNodeX(fromIndex), getPathfindingNodeY(fromIndex));
                const b = worldToScreen(getPathfindingNodeX(toIndex), getPathfindingNodeY(toIndex));
                nodeCtx.beginPath();
                nodeCtx.moveTo(a.x, a.y);
                nodeCtx.lineTo(b.x, b.y);
                nodeCtx.stroke();
            }
        }

        nodeCtx.restore();
        layer.dirty = false;
    }

    function drawWalls() {
        explorationSystem.syncWalls(state.walls, explorationWallLayout);
        const cache = state.exploredWallRenderCache;
        const explorationVersion = explorationSystem.getVersion();
        if (
            !cache.path ||
            cache.explorationVersion !== explorationVersion ||
            cache.worldVersion !== state.worldVersion
        ) {
            if (typeof Path2D !== "function") {
                throw new Error("Wizard of Flatland explored wall rendering requires Path2D");
            }
            const path = new Path2D();
            explorationSystem.forEachActiveInterval((wall, startT, endT) => {
                path.moveTo(
                    wall.ax + (wall.bx - wall.ax) * startT,
                    wall.ay + (wall.by - wall.ay) * startT
                );
                path.lineTo(
                    wall.ax + (wall.bx - wall.ax) * endT,
                    wall.ay + (wall.by - wall.ay) * endT
                );
            });
            cache.path = path;
            cache.explorationVersion = explorationVersion;
            cache.worldVersion = state.worldVersion;
        }
        ctx.save();
        ctx.lineCap = "round";
        ctx.setTransform(
            state.view.scale,
            0,
            0,
            state.view.scale,
            state.view.offsetX - state.view.centerX * state.view.scale,
            state.view.offsetY - state.view.centerY * state.view.scale
        );
        ctx.lineWidth = WALL_WORLD_THICKNESS;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke(cache.path);
        ctx.restore();
    }

    function getHomeBaseFloorLightStops(lightRadiusWorld, viewportMinDistance, viewportCenterDistance, viewportMaxDistance) {
        if (!(lightRadiusWorld > 0)) {
            throw new Error("Wizard of Flatland home base floor light stops require a positive light radius");
        }
        if (
            !Number.isFinite(viewportMinDistance) ||
            !Number.isFinite(viewportCenterDistance) ||
            !Number.isFinite(viewportMaxDistance) ||
            viewportMinDistance < 0 ||
            viewportCenterDistance < viewportMinDistance ||
            viewportMaxDistance < viewportCenterDistance
        ) {
            throw new Error("Wizard of Flatland home base floor light stops require ordered viewport distances");
        }
        const distanceProgress = Math.max(0, Math.min(1, viewportCenterDistance / lightRadiusWorld));
        const viewportExaggerationSections =
            FLOOR_HOME_BASE_LIGHT_MIN_VIEWPORT_EXAGGERATION_SECTIONS +
            (
                FLOOR_HOME_BASE_LIGHT_MAX_VIEWPORT_EXAGGERATION_SECTIONS -
                FLOOR_HOME_BASE_LIGHT_MIN_VIEWPORT_EXAGGERATION_SECTIONS
            ) * distanceProgress;
        const viewportExaggerationBrightness =
            FLOOR_HOME_BASE_LIGHT_BRIGHTNESS *
            viewportExaggerationSections /
            FLOOR_HOME_BASE_LIGHT_SECTION_DISTANCE;
        const minDistance = Math.min(lightRadiusWorld, viewportMinDistance);
        const centerDistance = Math.min(lightRadiusWorld, viewportCenterDistance);
        const maxDistance = Math.min(lightRadiusWorld, viewportMaxDistance);
        const distances = [...new Set([0, minDistance, centerDistance, maxDistance, lightRadiusWorld])]
            .sort((a, b) => a - b);
        return distances.map((distance) => {
            const normalBrightness =
                FLOOR_HOME_BASE_LIGHT_BRIGHTNESS * (1 - distance / lightRadiusWorld);
            let exaggeration = 0;
            if (distance < centerDistance && centerDistance > minDistance) {
                exaggeration = viewportExaggerationBrightness *
                    (centerDistance - distance) /
                    (centerDistance - minDistance);
            } else if (distance > centerDistance && maxDistance > centerDistance) {
                exaggeration = -viewportExaggerationBrightness *
                    (distance - centerDistance) /
                    (maxDistance - centerDistance);
            }
            return {
                distance,
                brightness: Math.max(
                    0,
                    Math.min(FLOOR_HOME_BASE_LIGHT_BRIGHTNESS, normalBrightness + exaggeration)
                )
            };
        });
    }

    function drawSectionBoundaries() {
        if (!state.debug.showSectionBoundaries) return;
        if (!isProceduralMazeScenario()) return;
        const sectionKeys = getDebugSectionBoundaryKeys();
        if (sectionKeys.length === 0) return;
        const options = getMazeOptions();
        const radius = getMazeSectionRadius(options);

        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
        ctx.lineWidth = Math.max(1.25, state.view.scale * 0.035);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.setLineDash([Math.max(2, state.view.scale * 0.11), Math.max(3, state.view.scale * 0.15)]);
        for (const key of sectionKeys) {
            const coord = parseMazeSectionKey(key);
            const center = mazeSectionCenter(coord.q, coord.r, options);
            const corners = getHexCornersWorld(center.x, center.y, radius);
            drawSectionBoundaryPolygon(corners);
        }
        ctx.setLineDash([]);
        ctx.restore();
    }

    function getDebugSectionBoundaryKeys() {
        if (state.generatedMazeInstalledChunkKeys instanceof Set && state.generatedMazeInstalledChunkKeys.size > 0) {
            return Array.from(state.generatedMazeInstalledChunkKeys).sort();
        }
        if (state.generatedMazeChunkKeys instanceof Set) return Array.from(state.generatedMazeChunkKeys).sort();
        throw new Error("Wizard of Flatland section boundary debug requires section key tracking");
    }

    function drawSectionBoundaryPolygon(corners) {
        if (!Array.isArray(corners) || corners.length < 3) {
            throw new Error("Wizard of Flatland section boundary debug requires polygon corners");
        }
        const screenCorners = corners.map((corner) => worldToScreen(corner.x, corner.y));
        if (!polygonMayBeVisible(screenCorners)) return;
        ctx.beginPath();
        ctx.moveTo(screenCorners[0].x, screenCorners[0].y);
        for (let i = 1; i < screenCorners.length; i++) {
            ctx.lineTo(screenCorners[i].x, screenCorners[i].y);
        }
        ctx.closePath();
        ctx.stroke();
    }

    function polygonMayBeVisible(points) {
        const padding = 80;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const point of points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            throw new Error("Wizard of Flatland section boundary debug requires finite screen points");
        }
        return maxX >= -padding && minX <= state.view.width + padding && maxY >= -padding && minY <= state.view.height + padding;
    }

    function lineSegmentMayBeVisible(a, b) {
        if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
            throw new Error("Wizard of Flatland line visibility requires finite screen points");
        }
        return polygonMayBeVisible([a, b]);
    }

    function drawWallLabels() {
        if (!state.debug.showWallLabels) return;
        validateWallLabelBuffer(state.walls, "rendered walls");
        ctx.save();
        ctx.font = `${Math.max(15, Math.min(21, state.view.scale * 0.33))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            const ax = state.walls[i + WALL_X1];
            const ay = state.walls[i + WALL_Y1];
            const bx = state.walls[i + WALL_X2];
            const by = state.walls[i + WALL_Y2];
            const a = worldToScreen(ax, ay);
            const b = worldToScreen(bx, by);
            if (!segmentMayBeVisible(a, b)) continue;

            const label = getWallDebugLabel(state.walls[i + WALL_LABEL_CODE], state.walls[i + WALL_LABEL_SIDE]);
            const midX = (a.x + b.x) * 0.5;
            const midY = (a.y + b.y) * 0.5;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const length = Math.hypot(dx, dy);
            if (!(length > 0.001)) {
                throw new Error("Wizard of Flatland wall label render requires separated screen endpoints");
            }
            const offset = Math.max(15, state.view.scale * (WALL_WORLD_THICKNESS + 0.2));
            const labelX = midX - dy / length * offset;
            const labelY = midY + dx / length * offset;
            let angle = Math.atan2(dy, dx);
            if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
            const metrics = ctx.measureText(label);
            const paddingX = 4;
            const boxWidth = metrics.width + paddingX * 2;
            const boxHeight = Math.max(13, Number.parseFloat(ctx.font) + 5);
            ctx.save();
            ctx.translate(labelX, labelY);
            ctx.rotate(angle);
            ctx.fillStyle = "rgba(12, 14, 16, 0.74)";
            ctx.fillRect(-boxWidth * 0.5, -boxHeight * 0.5, boxWidth, boxHeight);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
            ctx.lineWidth = 1;
            ctx.strokeRect(-boxWidth * 0.5, -boxHeight * 0.5, boxWidth, boxHeight);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(label, 0, 0);
            ctx.restore();
        }
        ctx.restore();
    }

    function segmentMayBeVisible(a, b) {
        const padding = 80;
        const minX = Math.min(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxX = Math.max(a.x, b.x);
        const maxY = Math.max(a.y, b.y);
        return maxX >= -padding && minX <= state.view.width + padding && maxY >= -padding && minY <= state.view.height + padding;
    }

    function drawWallBuildPreview() {
        const tool = state.wallTool;
        if (!tool.dragging || !tool.startNode || !tool.hoverNode) return;
        const a = worldToScreen(tool.startNode.x, tool.startNode.y);
        const b = worldToScreen(tool.hoverNode.x, tool.hoverNode.y);
        const sameNode = tool.startNode.key === tool.hoverNode.key;
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineWidth = state.view.scale * WALL_WORLD_THICKNESS;
        ctx.strokeStyle = sameNode ? "rgba(255,107,107,0.82)" : "rgba(0,0,0,0.9)";
        ctx.setLineDash(sameNode ? [6, 6] : [10, 7]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = sameNode ? "rgba(255,107,107,0.95)" : "rgba(0,0,0,0.95)";
        for (const point of [a, b]) {
            ctx.beginPath();
            ctx.arc(point.x, point.y, Math.max(4, state.view.scale * 0.09), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawTarget() {
        const point = worldToScreen(state.target.x, state.target.y);
        const flash = Math.max(0, Math.min(1, state.targetFlashTime / 0.18));
        const radius = TARGET_RADIUS * state.view.scale;
        ctx.save();
        ctx.strokeStyle = flash > 0 ? "#ff4d4d" : WIZARD_OUTLINE_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = flash > 0
            ? `rgba(255,77,77,${0.25 + flash * 0.45})`
            : WIZARD_FILL_COLOR;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        drawTargetTravelChevrons(point.x, point.y, radius);
        drawTargetHat(point.x, point.y + state.view.scale * 0.2, radius);
        drawProjectedTargetCursor(state.target.x, state.target.y, state.target.heading);
        ctx.restore();
    }

    function drawTargetTravelChevrons(x, y, radius) {
        const travel = state.targetTravelVector;
        const dx = Number(travel && travel.x) || 0;
        const dy = Number(travel && travel.y) || 0;
        if (Math.hypot(dx, dy) <= 0.0001) return;

        const angle = Math.atan2(dy, dx);
        const chevronWidth = radius * (2 / 3);
        const chevronHeight = chevronWidth * 2 * Math.tan(Math.PI / 3);
        const gap = chevronWidth * 0.48;
        const strokeWidth = Math.max(2, radius * 0.14);
        const forwardOffset = radius + chevronWidth * 0.5 + Math.max(3, radius * 0.18);

        ctx.save();
        ctx.translate(x + Math.cos(angle) * forwardOffset, y + Math.sin(angle) * forwardOffset);
        ctx.rotate(angle);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(0,0,0,0.56)";
        ctx.lineWidth = strokeWidth + Math.max(1, radius * 0.05);
        drawTargetTravelChevronPair(chevronWidth, chevronHeight, gap);
        ctx.strokeStyle = "rgba(255,255,255,0.96)";
        ctx.lineWidth = strokeWidth;
        drawTargetTravelChevronPair(chevronWidth, chevronHeight, gap);
        ctx.restore();
    }

    function drawTargetTravelChevronPair(chevronWidth, chevronHeight, gap) {
        const pointX = chevronWidth * 0.5;
        const leftX = -chevronWidth * 0.5;
        const halfHeight = chevronHeight * 0.5;
        ctx.beginPath();
        for (let i = 0; i < 2; i++) {
            const offsetX = i * gap;
            ctx.moveTo(leftX + offsetX, -halfHeight);
            ctx.lineTo(pointX + offsetX, 0);
            ctx.lineTo(leftX + offsetX, halfHeight);
        }
        ctx.stroke();
    }

    function drawTargetHat(x, y, radius) {
        const hatRadius = radius * 3 * 0.7;
        const brimY = y - hatRadius * (0.55 - WIZARD_HAT_TOP_DOWN_BRIM_DROP);
        const brimWidth = hatRadius * 1.15 * WIZARD_HAT_TOP_DOWN_BRIM_WIDTH;
        const brimHeight = hatRadius * 0.36 * WIZARD_HAT_TOP_DOWN_BRIM_HEIGHT;
        const bandWidth = brimWidth * 0.78;
        const bandHeight = brimHeight * 0.54;
        const pointBaseY = brimY - brimHeight * 0.12;
        const pointHeight = hatRadius * 0.95 * WIZARD_HAT_TOP_DOWN_CONE_HEIGHT;
        const pointWidth = hatRadius * 0.78;

        ctx.save();
        ctx.fillStyle = "#000099";
        ctx.beginPath();
        ctx.ellipse(x, brimY, brimWidth * 0.5, brimHeight * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffd700";
        ctx.beginPath();
        ctx.ellipse(x, brimY, bandWidth * 0.5, bandHeight * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#000099";
        ctx.beginPath();
        ctx.ellipse(x, brimY, pointWidth * 0.5, bandHeight * 0.35, 0, 0, Math.PI * 2);
        ctx.rect(x - pointWidth * 0.5, brimY - bandHeight * 0.55, pointWidth, bandHeight * 0.7);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(x, pointBaseY - pointHeight);
        ctx.lineTo(x - pointWidth * 0.5, pointBaseY);
        ctx.lineTo(x + pointWidth * 0.5, pointBaseY);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawProjectedTargetCursor(targetX, targetY, heading) {
        if (!Number.isFinite(heading)) throw new Error("Wizard of Flatland projected cursor requires a finite heading");
        const trace = getCurrentProjectedCursorTrace();
        const projectedWorld = trace.point;
        const cursorHeading = getCurrentProjectedCursorHeading();
        drawProjectedCursorGuide(trace.points);
        const projected = worldToScreen(projectedWorld.x, projectedWorld.y);
        const cursorSize = 30;
        const tenpoints = Array.from(
            { length: 10 },
            (_, i) => rotatePoint(Math.cos(i * 36 * Math.PI / 180) * cursorSize, Math.sin(i * 36 * Math.PI / 180) * cursorSize, cursorHeading)
        );
        const fivepoints = Array.from(
            { length: 5 },
            (_, i) => rotatePoint(Math.cos((i * 72 + 18) * Math.PI / 180) * cursorSize * 0.5, Math.sin((i * 72 + 18) * Math.PI / 180) * cursorSize * 0.5, cursorHeading)
        );

        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            ctx.moveTo(projected.x + tenpoints[i * 2].x, projected.y + tenpoints[i * 2].y);
            ctx.lineTo(projected.x + fivepoints[i].x, projected.y + fivepoints[i].y);
            ctx.lineTo(projected.x + tenpoints[i * 2 + 1].x, projected.y + tenpoints[i * 2 + 1].y);
        }
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.strokeStyle = "#44aaff";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(projected.x - 1.5, projected.y - 1.5, 3, 3);
        ctx.fillStyle = "#44aaff";
        ctx.fillRect(projected.x - 0.5, projected.y - 0.5, 1, 1);
    }

    function getCurrentProjectedCursorHeading() {
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        if (!Number.isFinite(state.target.heading) || !Number.isFinite(cursor.angleOffset)) {
            throw new Error("Wizard of Flatland projected cursor heading requires finite angles");
        }
        return normalizeAngle(state.target.heading + getProjectedCursorCurveHeadingDelta(cursor.distance, cursor.angleOffset));
    }

    function getCurrentProjectedCursorWorldPoint() {
        return getCurrentProjectedCursorTrace().point;
    }

    function getCurrentProjectedCursorTrace() {
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        return getWallClampedProjectedCursorCurveTrace(
            state.target.x,
            state.target.y,
            state.target.heading,
            cursor.angleOffset,
            cursor.distance
        );
    }

    function updateProjectedCursorFromFixedWorldPoint(point) {
        const projection = getProjectedCursorProjectionForWorldPoint(point);
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        cursor.angleOffset = projection.angleOffset;
        cursor.distance = projection.distance;
    }

    function getProjectedCursorProjectionForWorldPoint(point) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            throw new Error("Wizard of Flatland fixed cursor point requires finite coordinates");
        }
        const dx = point.x - state.target.x;
        const dy = point.y - state.target.y;
        const chord = Math.hypot(dx, dy);
        if (!(chord > 0.000001)) {
            return {
                angleOffset: 0,
                distance: TARGET_PROJECTED_CURSOR_MIN_DISTANCE
            };
        }

        const forwardX = Math.cos(state.target.heading);
        const forwardY = Math.sin(state.target.heading);
        const localForward = dx * forwardX + dy * forwardY;
        const localSide = dx * -forwardY + dy * forwardX;
        const rawHeadingDelta = 2 * Math.atan2(localSide, localForward);
        const bendRatio = Math.max(-1, Math.min(1, rawHeadingDelta));
        const angleOffset = bendRatio * TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET;
        if (Math.abs(bendRatio) <= 0.000001) {
            return {
                angleOffset,
                distance: Math.max(
                    TARGET_PROJECTED_CURSOR_MIN_DISTANCE,
                    Math.min(TARGET_PROJECTED_CURSOR_MAX_DISTANCE, chord)
                )
            };
        }

        const halfDelta = Math.abs(bendRatio) * 0.5;
        const denominator = 2 * Math.sin(halfDelta);
        if (!(denominator > 0.000001)) {
            throw new Error("Wizard of Flatland fixed cursor projection produced an invalid arc");
        }
        const arcDistance = (chord / denominator) * Math.abs(bendRatio);
        return {
            angleOffset,
            distance: Math.max(
                TARGET_PROJECTED_CURSOR_MIN_DISTANCE,
                Math.min(TARGET_PROJECTED_CURSOR_MAX_DISTANCE, arcDistance)
            )
        };
    }

    function getProjectedCursorTraceDistance(trace) {
        if (!trace || !Array.isArray(trace.points) || trace.points.length < 2) {
            throw new Error("Wizard of Flatland projected cursor trace requires at least two points");
        }
        let distance = 0;
        for (let i = 1; i < trace.points.length; i++) {
            const previous = trace.points[i - 1];
            const current = trace.points[i];
            if (
                !previous ||
                !current ||
                !Number.isFinite(previous.x) ||
                !Number.isFinite(previous.y) ||
                !Number.isFinite(current.x) ||
                !Number.isFinite(current.y)
            ) {
                throw new Error("Wizard of Flatland projected cursor trace contains invalid points");
            }
            distance += Math.hypot(current.x - previous.x, current.y - previous.y);
        }
        return distance;
    }

    function drawProjectedCursorGuide(points) {
        if (!Array.isArray(points) || points.length < 2) throw new Error("Wizard of Flatland projected cursor guide requires curve points");
        ctx.save();
        ctx.strokeStyle = "rgba(68,170,255,0.72)";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.setLineDash([6, 24]);
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const point = worldToScreen(points[i].x, points[i].y);
            if (i === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
        ctx.restore();
    }

    function getWallClampedProjectedCursorCurveTrace(targetX, targetY, heading, angleOffset, distance) {
        const points = getProjectedCursorCurvePoints(targetX, targetY, heading, angleOffset, distance);
        const trace = [points[0]];
        for (let i = 1; i < points.length; i++) {
            const previous = points[i - 1];
            const current = points[i];
            for (let w = 0; w < state.walls.length; w += WALL_STRIDE) {
                const hit = segmentIntersectionParameters(
                    previous.x,
                    previous.y,
                    current.x,
                    current.y,
                    state.walls[w + WALL_X1],
                    state.walls[w + WALL_Y1],
                    state.walls[w + WALL_X2],
                    state.walls[w + WALL_Y2]
                );
                if (!hit || hit.t <= 0.000001) continue;
                const point = {
                    x: previous.x + (current.x - previous.x) * hit.t,
                    y: previous.y + (current.y - previous.y) * hit.t
                };
                trace.push(point);
                return { point, points: trace };
            }
            trace.push(current);
        }
        return { point: points[points.length - 1], points: trace };
    }

    function getProjectedCursorCurvePoints(targetX, targetY, heading, angleOffset, distance) {
        if (!Number.isFinite(targetX) || !Number.isFinite(targetY) || !Number.isFinite(heading) || !Number.isFinite(angleOffset) || !Number.isFinite(distance)) {
            throw new Error("Wizard of Flatland projected cursor curve requires finite inputs");
        }
        const bendRatio = getProjectedCursorBendRatio(angleOffset);
        const headingDelta = getProjectedCursorCurveHeadingDelta(distance, angleOffset);
        const sampleCount = 32;
        const forwardX = Math.cos(heading);
        const forwardY = Math.sin(heading);
        const sideX = -forwardY;
        const sideY = forwardX;
        const points = [];
        for (let i = 0; i <= sampleCount; i++) {
            const t = i / sampleCount;
            let localForward;
            let localSide;
            if (Math.abs(bendRatio) <= 0.000001 || Math.abs(headingDelta) <= 0.000001) {
                localForward = distance * t;
                localSide = 0;
            } else {
                const theta = headingDelta * t;
                const radius = distance / headingDelta;
                localForward = radius * Math.sin(theta);
                localSide = radius * (1 - Math.cos(theta));
            }
            points.push({
                x: targetX + forwardX * localForward + sideX * localSide,
                y: targetY + forwardY * localForward + sideY * localSide
            });
        }
        return points;
    }

    function getProjectedCursorBendRatio(angleOffset) {
        if (!Number.isFinite(angleOffset)) throw new Error("Wizard of Flatland projected cursor bend requires a finite angle");
        return Math.max(-1, Math.min(1, angleOffset / TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET));
    }

    function getProjectedCursorTurnRadius(distance, bendRatio) {
        if (!Number.isFinite(distance) || !Number.isFinite(bendRatio)) {
            throw new Error("Wizard of Flatland projected cursor turn radius requires finite values");
        }
        const normalizedBend = Math.min(1, Math.max(0, Math.abs(bendRatio)));
        if (normalizedBend <= 0.000001) return Infinity;
        return Math.max(TARGET_PROJECTED_CURSOR_MIN_TURN_RADIUS, Math.max(0, distance) / normalizedBend);
    }

    function getProjectedCursorCurveHeadingDelta(distance, angleOffset) {
        const bendRatio = getProjectedCursorBendRatio(angleOffset);
        if (Math.abs(bendRatio) <= 0.000001) return 0;
        const turnRadius = getProjectedCursorTurnRadius(distance, bendRatio);
        if (!Number.isFinite(turnRadius)) return 0;
        return Math.sign(bendRatio) * Math.max(0, distance) / turnRadius;
    }

    function drawCombatRing() {
        const point = worldToScreen(state.target.x, state.target.y);
        ctx.save();
        ctx.strokeStyle = "rgba(104,183,255,0.35)";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.arc(point.x, point.y, COMBAT_RING_RADIUS * state.view.scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    function drawAgentSlot(agent) {
        if (agent.solverState === STATE_MILLING || agent.solverState === STATE_BLOCKED) return;
        if (!Number.isFinite(agent.slotAngle)) return;
        const slot = worldToScreen(
            state.target.x + Math.cos(agent.slotAngle) * COMBAT_RING_RADIUS,
            state.target.y + Math.sin(agent.slotAngle) * COMBAT_RING_RADIUS
        );
        ctx.save();
        ctx.fillStyle = "rgba(104,183,255,0.22)";
        ctx.beginPath();
        ctx.arc(slot.x, slot.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawAgentPaths() {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.82)";
        ctx.lineWidth = Math.max(1, state.view.scale * 0.025);
        ctx.setLineDash([1, Math.max(3, state.view.scale * 0.08)]);
        ctx.lineCap = "round";
        for (const agent of state.agents) {
            if (agent.pathMode !== PATH_MODE_WORKER) continue;
            const waypoints = Array.isArray(agent.pathWaypoints) ? agent.pathWaypoints : [];
            const start = Math.max(0, Math.min(waypoints.length, Math.floor(agent.pathCursor || 0)));
            if (waypoints.length - start < 2) continue;
            ctx.beginPath();
            for (let i = start; i < waypoints.length; i++) {
                const waypoint = waypoints[i];
                if (!waypoint || !Number.isFinite(waypoint.x) || !Number.isFinite(waypoint.y)) {
                    throw new Error(`Wizard of Flatland agent ${agent.id} path overlay has an invalid waypoint`);
                }
                const point = worldToScreen(waypoint.x, waypoint.y);
                if (i === start) {
                    ctx.moveTo(point.x, point.y);
                } else {
                    ctx.lineTo(point.x, point.y);
                }
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawTemporaryPathCostDiagnostics() {
        if (!(state.temporaryPathCostsByNodeKey instanceof Map)) {
            throw new Error("Wizard of Flatland temporary path cost diagnostics require temporary path cost tracking");
        }
        if (state.temporaryPathCostsByNodeKey.size === 0) return;
        ctx.save();
        ctx.fillStyle = "rgba(255,0,0,0.86)";
        ctx.strokeStyle = "rgba(255,255,255,0.74)";
        ctx.lineWidth = 1;
        for (const [nodeKey, penalty] of state.temporaryPathCostsByNodeKey) {
            validateTemporaryPathCostPenalty(nodeKey, penalty);
            if (!(penalty.cost > 0)) continue;
            const point = worldToScreen(penalty.x, penalty.y);
            const radius = getTemporaryPathCostDiagnosticRadius(penalty.cost);
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    function getTemporaryPathCostDiagnosticRadius(cost) {
        if (!Number.isFinite(cost) || cost <= 0) {
            throw new Error("Wizard of Flatland temporary path cost diagnostic radius requires a positive finite cost");
        }
        const stackScale = Math.sqrt(cost / ENEMY_DEATH_PATH_COST);
        return Math.max(3, Math.min(18, state.view.scale * 0.11 * stackScale));
    }

    function drawTemporaryDeathBlockerDiagnostics() {
        if (!(state.temporaryDeathBlockersByKey instanceof Map)) {
            throw new Error("Wizard of Flatland temporary death blocker diagnostics require blocker tracking");
        }
        if (state.temporaryDeathBlockersByKey.size === 0) return;
        ctx.save();
        ctx.fillStyle = "rgba(255,0,0,0.16)";
        ctx.strokeStyle = "rgba(255,0,0,0.9)";
        ctx.lineWidth = Math.max(1.5, state.view.scale * 0.03);
        for (const [key, blocker] of state.temporaryDeathBlockersByKey) {
            validateTemporaryDeathBlocker(key, blocker);
            const point = worldToScreen(blocker.x, blocker.y);
            const radius = blocker.radius * state.view.scale;
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawFireballs() {
        ctx.save();
        for (const fireball of state.fireballs) {
            if (fireball.spellId === "fireball") {
                drawAnimatedFireball(fireball);
            } else if (fireball.spellId === "spikes") {
                drawSpikeProjectile(fireball);
            } else {
                throw new Error(`Wizard of Flatland cannot draw unknown projectile spell: ${fireball.spellId}`);
            }
        }
        ctx.restore();
    }

    function drawFreezeParticles() {
        ctx.save();
        for (const particle of state.freezeParticles) {
            if (
                !Number.isFinite(particle.x) ||
                !Number.isFinite(particle.y) ||
                !Number.isFinite(particle.radius) ||
                !Number.isFinite(particle.age) ||
                !(particle.lifetime > 0) ||
                typeof particle.color !== "string" ||
                !/^#[0-9a-f]{6}$/i.test(particle.color)
            ) {
                throw new Error("Wizard of Flatland freeze particle render requires finite particle data");
            }
            const point = worldToScreen(particle.x, particle.y);
            ctx.globalAlpha = Math.max(0, 1 - particle.age / particle.lifetime);
            ctx.fillStyle = particle.color;
            ctx.beginPath();
            ctx.arc(point.x, point.y, Math.max(1, particle.radius * state.view.scale), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function getFireballAnimationFrameIndex(fireball) {
        if (!fireball || !Number.isFinite(fireball.age) || !(fireball.maxAge > 0)) {
            throw new Error("Wizard of Flatland fireball animation requires finite age and max age");
        }
        const progress = Math.max(0, Math.min(1, fireball.age / fireball.maxAge));
        return Math.max(0, Math.min(FIREBALL_ANIMATION_FRAME_COUNT - 1, Math.floor(progress * FIREBALL_ANIMATION_FRAME_COUNT)));
    }

    function requireFireballAnimationImage() {
        if (fireballAnimationLoadError) throw fireballAnimationLoadError;
        if (!fireballAnimationImage.complete || !(fireballAnimationImage.naturalWidth > 0) || !(fireballAnimationImage.naturalHeight > 0)) {
            throw new Error(`Wizard of Flatland missing fireball animation texture: ${FIREBALL_ANIMATION_TEXTURE_PATH}`);
        }
        return fireballAnimationImage;
    }

    function requireTrophyImage() {
        if (trophyImageLoadError) throw trophyImageLoadError;
        if (!trophyImage.complete || !(trophyImage.naturalWidth > 0) || !(trophyImage.naturalHeight > 0)) {
            throw new Error(`Wizard of Flatland missing trophy texture: ${TROPHY_TEXTURE_PATH}`);
        }
        return trophyImage;
    }

    function drawAnimatedFireball(fireball) {
        if (
            !fireball ||
            fireball.spellId !== "fireball" ||
            !Number.isFinite(fireball.x) ||
            !Number.isFinite(fireball.y) ||
            !Number.isFinite(fireball.projectileRadius) ||
            !Number.isFinite(fireball.explosionRadius)
        ) {
            throw new Error("Wizard of Flatland fireball animation requires finite fireball position");
        }
        if (!(fireball.projectileRadius > 0)) throw new Error("Wizard of Flatland fireball animation requires a positive projectile radius");
        if (!(fireball.explosionRadius > 0)) throw new Error("Wizard of Flatland fireball animation requires a positive explosion radius");
        const image = requireFireballAnimationImage();
        const frameWidth = image.naturalWidth / FIREBALL_ANIMATION_FRAME_COLUMNS;
        const frameHeight = image.naturalHeight / FIREBALL_ANIMATION_FRAME_ROWS;
        if (!(frameWidth > 0) || !(frameHeight > 0)) {
            throw new Error("Wizard of Flatland fireball animation texture has invalid frame dimensions");
        }
        const frameIndex = getFireballAnimationFrameIndex(fireball);
        const frameColumn = frameIndex % FIREBALL_ANIMATION_FRAME_COLUMNS;
        const frameRow = Math.floor(frameIndex / FIREBALL_ANIMATION_FRAME_COLUMNS);
        const center = worldToScreen(fireball.x, fireball.y);
        const animationRadius = fireball.impactActive ? fireball.explosionRadius : fireball.projectileRadius;
        const drawSize = animationRadius * 2 * state.view.scale;
        if (!(drawSize > 0)) throw new Error("Wizard of Flatland fireball animation requires positive draw size");
        ctx.drawImage(
            image,
            frameColumn * frameWidth,
            frameRow * frameHeight,
            frameWidth,
            frameHeight,
            center.x - drawSize * 0.5,
            center.y - drawSize * 0.5,
            drawSize,
            drawSize
        );
    }

    function drawSpikeProjectile(spike) {
        if (
            !spike ||
            spike.spellId !== "spikes" ||
            !Number.isFinite(spike.x) ||
            !Number.isFinite(spike.y) ||
            !Number.isFinite(spike.dirX) ||
            !Number.isFinite(spike.dirY) ||
            !Number.isFinite(spike.projectileRadius) ||
            (spike.spinHz !== undefined && !Number.isFinite(spike.spinHz)) ||
            (spike.spinStartAge !== undefined && !Number.isFinite(spike.spinStartAge))
        ) {
            throw new Error("Wizard of Flatland spike render requires finite projectile data");
        }
        if (!(spike.projectileRadius > 0)) throw new Error("Wizard of Flatland spike render requires a positive projectile radius");
        const center = worldToScreen(spike.x, spike.y);
        const forward = Math.max(7, spike.projectileRadius * state.view.scale * 2.25);
        const side = Math.max(3.5, spike.projectileRadius * state.view.scale * 0.95);
        const spinAge = Math.max(0, spike.age - (Number(spike.spinStartAge) || 0));
        const spinAngle = (Number(spike.spinHz) || 0) * spinAge * Math.PI * 2;
        const angle = Math.atan2(spike.dirY, spike.dirX) + spinAngle;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const points = [
            { x: center.x + cos * forward, y: center.y + sin * forward },
            { x: center.x - sin * side, y: center.y + cos * side },
            { x: center.x - cos * forward, y: center.y - sin * forward },
            { x: center.x + sin * side, y: center.y - cos * side }
        ];
        ctx.save();
        ctx.fillStyle = "#cfd6dc";
        ctx.strokeStyle = "#f6fbff";
        ctx.lineWidth = Math.max(1, state.view.scale * 0.025);
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "rgba(80,90,100,0.55)";
        ctx.beginPath();
        ctx.moveTo(center.x + cos * forward * 0.7, center.y + sin * forward * 0.7);
        ctx.lineTo(center.x - cos * forward * 0.55, center.y - sin * forward * 0.55);
        ctx.stroke();
        ctx.restore();
    }

    function drawCoins() {
        if (!Array.isArray(state.coins) || state.coins.length === 0) return;
        ctx.save();
        for (const coin of state.coins) {
            validateCoin(coin);
            const point = worldToScreen(coin.x, coin.y);
            if (coin.dropPop) {
                const popProgress = coin.dropPop.age / coin.dropPop.duration;
                point.y -= Math.sin(popProgress * Math.PI) * ENEMY_COIN_DROP_POP_HEIGHT * state.view.scale;
            }
            const radius = Math.max(3.5, coin.radius * state.view.scale);
            if (coin.kind === "trophy") {
                drawTrophyCoin(coin, point, radius);
                continue;
            }
            const glowRadius = Math.max(radius * 1.9, state.view.scale * 0.22);
            const shineAngle = (performance.now() * 0.006 + coin.phase) % (Math.PI * 2);
            ctx.fillStyle = coin.rushing ? "rgba(255,238,128,0.24)" : "rgba(255,214,74,0.18)";
            ctx.beginPath();
            ctx.arc(point.x, point.y, glowRadius, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "#d99818";
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#fff1a8";
            ctx.lineWidth = Math.max(1.25, radius * 0.18);
            ctx.stroke();

            ctx.strokeStyle = "rgba(255,255,255,0.88)";
            ctx.lineWidth = Math.max(1, radius * 0.14);
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(point.x + Math.cos(shineAngle) * radius * 0.12, point.y + Math.sin(shineAngle) * radius * 0.12);
            ctx.lineTo(point.x + Math.cos(shineAngle) * radius * 0.62, point.y + Math.sin(shineAngle) * radius * 0.62);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawTrophyCoin(coin, point, radius) {
        validateCoin(coin);
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !(radius > 0)) {
            throw new Error(`Wizard of Flatland trophy ${coin.key} requires finite draw geometry`);
        }
        const image = requireTrophyImage();
        const aspect = image.naturalWidth / image.naturalHeight;
        if (!(aspect > 0)) throw new Error(`Wizard of Flatland trophy texture has invalid dimensions: ${TROPHY_TEXTURE_PATH}`);
        const pulse = coin.rushing ? 1.12 : 1;
        const drawHeight = radius * 2 * MAZE_TROPHY_IMAGE_SCALE * pulse;
        const drawWidth = drawHeight * aspect;
        ctx.drawImage(
            image,
            point.x - drawWidth * 0.5,
            point.y - drawHeight * 0.5,
            drawWidth,
            drawHeight
        );
    }

    function drawTalismans() {
        if (!Array.isArray(state.talismans) || state.talismans.length === 0) return;
        ctx.save();
        const homeBaseTalismanSectionKey = getHomeBaseTalismanSectionKey();
        for (const talisman of state.talismans) {
            validateTalisman(talisman);
            const point = worldToScreen(talisman.x, talisman.y);
            const radius = Math.max(8, talisman.radius * state.view.scale);
            const blocked = talisman.blockedFlashSeconds > 0;
            const activated = talisman.sectionKey === homeBaseTalismanSectionKey;
            const activationPulse = Math.max(0, Math.min(1, talisman.flashSeconds / TALISMAN_ACTIVATION_FLASH_SECONDS));
            const glowAlpha = blocked ? 0.58 : activated ? 0.38 + activationPulse * 0.32 : 0.1;
            const glowColor = blocked ? `rgba(255,31,31,${glowAlpha})` : `rgba(255,255,255,${glowAlpha})`;
            const pyramidFill = blocked ? "#8f0909" : activated ? "#f7f7f7" : "#050505";
            const rearFaceFill = blocked ? "#650606" : activated ? "#e4e4e4" : "#020202";
            const sideFaceFill = blocked ? "#760707" : activated ? "#eeeeee" : "#090909";
            const edgeColor = blocked ? "#ff2525" : activated ? "#9b9b9b" : "#ffffff";
            const capColor = blocked ? "#ff4a4a" : activated ? "#d9a323" : "#111111";
            const capRearColor = blocked ? "#c42121" : activated ? "#a97914" : "#070707";
            const capSideColor = blocked ? "#dd3030" : activated ? "#c68c1a" : "#171717";

            ctx.fillStyle = glowColor;
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius * (activated ? 1.95 : 1.55), 0, Math.PI * 2);
            ctx.fill();

            const projection = createTalismanPyramidProjection(point.x, point.y, radius);
            drawTalismanFaceFill([projection.apex, projection.base[2], projection.base[3]], rearFaceFill);
            drawTalismanFaceFill([projection.apex, projection.base[3], projection.base[0]], sideFaceFill);
            drawTalismanFaceFill([projection.apex, projection.base[0], projection.base[1]], pyramidFill);
            drawTalismanFaceFill([projection.apex, projection.base[1], projection.base[2]], sideFaceFill);
            drawTalismanFaceFill(
                projection.capBase,
                blocked ? "rgba(255,74,74,0.22)" : activated ? "rgba(155,155,155,0.22)" : "rgba(255,255,255,0.12)"
            );
            drawTalismanFaceFill([projection.apex, projection.capBase[2], projection.capBase[3]], capRearColor);
            drawTalismanFaceFill([projection.apex, projection.capBase[3], projection.capBase[0]], capSideColor);
            drawTalismanFaceFill([projection.apex, projection.capBase[0], projection.capBase[1]], capColor);
            drawTalismanFaceFill([projection.apex, projection.capBase[1], projection.capBase[2]], capSideColor);
            drawTalismanVisibleEdges(projection, edgeColor, radius, activated, blocked);
            if (talisman.pyramidDistance === 0) {
                if (talisman.gameSavedPromptSeconds > 0) {
                    drawInitialTalismanPrompt(projection, radius, "game saved");
                } else if (!state.activatedTalismanSectionKeys.has(talisman.sectionKey)) {
                    drawInitialTalismanPrompt(projection, radius, "touch the pyramid");
                }
            }
        }
        ctx.restore();
    }

    function drawInitialTalismanPrompt(projection, radius, message) {
        if (!projection || !projection.apex) {
            throw new Error("Wizard of Flatland initial pyramid prompt requires a pyramid projection");
        }
        if (typeof message !== "string" || message.length === 0) {
            throw new Error("Wizard of Flatland initial pyramid prompt requires a message");
        }
        const fontSize = Math.max(16, Math.min(28, radius * 0.42));
        const promptY = projection.apex.y - Math.max(12, radius * 0.3);
        ctx.save();
        ctx.font = `800 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(3, fontSize * 0.18);
        ctx.strokeStyle = "rgba(0, 0, 0, 0.92)";
        ctx.strokeText(message, projection.apex.x, promptY);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(message, projection.apex.x, promptY);
        ctx.restore();
    }

    function createTalismanPyramidProjection(x, y, radius) {
        const rotation = Math.PI / 4;
        const tiltScale = 0.78;
        const baseRadius = radius * 0.86;
        const baseWidthScale = 1.22;
        const baseYOffset = radius * 0.2;
        const apex = { x, y: y - radius * 0.58 };
        const base = [];
        for (let i = 0; i < 4; i++) {
            const angle = rotation + Math.PI / 4 + i * Math.PI / 2;
            base.push({
                x: x + Math.cos(angle) * baseRadius * baseWidthScale,
                y: y + baseYOffset + Math.sin(angle) * baseRadius * tiltScale
            });
        }
        const capBase = base.map((corner) => ({
            x: apex.x + (corner.x - apex.x) / 3,
            y: apex.y + (corner.y - apex.y) / 3
        }));
        return { apex, base, capBase };
    }

    function drawTalismanFaceFill(points, fillStyle) {
        if (!Array.isArray(points) || points.length < 3) {
            throw new Error("Wizard of Flatland talisman face requires at least three points");
        }
        ctx.fillStyle = fillStyle;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        ctx.fill();
    }

    function drawTalismanVisibleEdges(projection, strokeStyle, radius, activated, blocked) {
        if (!projection || !projection.apex || !Array.isArray(projection.base) || !Array.isArray(projection.capBase)) {
            throw new Error("Wizard of Flatland talisman edge drawing requires a projection");
        }
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = Math.max(0.75, radius * 0.0275);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        const inactive = !activated && !blocked;
        if (activated) {
            strokeTalismanPolyline([projection.capBase[1], projection.base[1]]);
            strokeTalismanPolyline([projection.capBase[3], projection.base[3]]);
            strokeTalismanPolyline([projection.capBase[0], projection.base[0]]);
        } else {
            strokeTalismanPolyline([projection.apex, projection.base[1]]);
            if (inactive) strokeTalismanPolyline([projection.apex, projection.base[2]]);
            strokeTalismanPolyline([projection.apex, projection.base[3]]);
            strokeTalismanPolyline([projection.apex, projection.base[0]]);
        }
        if (inactive) {
            strokeTalismanPolyline([projection.base[0], projection.base[1]]);
            strokeTalismanPolyline([projection.base[3], projection.base[0]]);
        }
        strokeTalismanPolyline([projection.capBase[0], projection.capBase[1]]);
        strokeTalismanPolyline([projection.capBase[3], projection.capBase[0]]);
    }

    function strokeTalismanPolyline(points) {
        if (!Array.isArray(points) || points.length < 2) {
            throw new Error("Wizard of Flatland talisman edge stroke requires at least two points");
        }
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
    }

    function drawFireballExplosions() {
        ctx.save();
        for (const explosion of state.fireballExplosions) {
            if (!Number.isFinite(explosion.x) || !Number.isFinite(explosion.y) || !Number.isFinite(explosion.radius) || !Number.isFinite(explosion.age)) {
                throw new Error("Wizard of Flatland fireball explosion render requires finite explosion data");
            }
            const center = worldToScreen(explosion.x, explosion.y);
            const t = Math.max(0, Math.min(1, explosion.age / FIREBALL_EXPLOSION_VISUAL_SECONDS));
            const radius = explosion.radius * state.view.scale * (0.72 + t * 0.28);
            const outerRadius = (explosion.radius + FIREBALL_HALF_DAMAGE_OUTER_RADIUS)
                * state.view.scale
                * (0.72 + t * 0.28);
            ctx.strokeStyle = `rgba(255,132,49,${0.52 * (1 - t)})`;
            ctx.lineWidth = Math.max(1, state.view.scale * 0.035);
            ctx.beginPath();
            ctx.arc(center.x, center.y, outerRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = `rgba(255,115,36,${0.28 * (1 - t)})`;
            ctx.strokeStyle = `rgba(255,209,102,${0.95 * (1 - t)})`;
            ctx.lineWidth = Math.max(2, state.view.scale * 0.06);
            ctx.beginPath();
            ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawFireDeathEffects() {
        if (!Array.isArray(state.fireDeathEffects) || state.fireDeathEffects.length === 0) return;
        for (const effect of state.fireDeathEffects) {
            validateFireDeathEffect(effect);
            const center = worldToScreen(effect.x, effect.y);
            ctx.save();
            ctx.translate(center.x, center.y);
            for (const flame of effect.flames) {
                if (
                    !flame ||
                    !Number.isFinite(flame.offsetX) ||
                    !Number.isFinite(flame.offsetY) ||
                    !(flame.size > 0) ||
                    !Number.isFinite(flame.phase) ||
                    !Number.isFinite(flame.sway) ||
                    !(flame.speed > 0) ||
                    !Number.isFinite(flame.delay) ||
                    flame.delay < 0 ||
                    flame.delay >= FIRE_DEATH_VISUAL_SECONDS
                ) {
                    throw new Error("Wizard of Flatland fire death flame requires finite animation data");
                }
                const flameProgress = Math.max(
                    0,
                    Math.min(1, (effect.age - flame.delay) / (FIRE_DEATH_VISUAL_SECONDS - flame.delay))
                );
                const flameEnvelope = Math.sin(flameProgress * Math.PI);
                const flicker = 0.82 + Math.sin(effect.age * flame.speed + flame.phase) * 0.18;
                const sway = Math.sin(effect.age * 22 + flame.phase) * flame.size * flame.sway;
                const x = flame.offsetX * state.view.scale;
                const riseAndFall = Math.sin(effect.age * flame.speed * 0.22 + flame.phase)
                    * effect.radius
                    * state.view.scale
                    * 0.1;
                const y = flame.offsetY * state.view.scale + riseAndFall;
                const width = flame.size * state.view.scale * flicker * flameEnvelope;
                const height = width * (1.7 + flicker * 0.45);
                if (!(width > 0.000001)) continue;
                ctx.globalAlpha = Math.min(1, flameEnvelope * 1.6);
                ctx.fillStyle = "#ff7a18";
                ctx.beginPath();
                ctx.moveTo(x - width * 0.55, y + height * 0.35);
                ctx.quadraticCurveTo(x - width * 0.25, y - height * 0.25, x + sway, y - height);
                ctx.quadraticCurveTo(x + width * 0.55, y - height * 0.12, x + width * 0.55, y + height * 0.35);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = "#ffd15c";
                ctx.beginPath();
                ctx.moveTo(x - width * 0.24, y + height * 0.3);
                ctx.quadraticCurveTo(x, y - height * 0.08, x + sway * 0.45, y - height * 0.52);
                ctx.quadraticCurveTo(x + width * 0.25, y, x + width * 0.24, y + height * 0.3);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        }
    }

    function drawSpikeShatterEffects() {
        if (!Array.isArray(state.spikeShatterEffects) || state.spikeShatterEffects.length === 0) return;
        for (const effect of state.spikeShatterEffects) {
            validateSpikeShatterEffect(effect);
            const progress = Math.max(0, Math.min(1, effect.age / SPIKE_SHATTER_VISUAL_SECONDS));
            const movementProgress = 1 - Math.pow(1 - progress, 3);
            const alpha = Math.min(1, (1 - progress) * 2.5);
            for (const fragment of effect.fragments) {
                if (
                    !fragment ||
                    !Number.isFinite(fragment.centerX) ||
                    !Number.isFinite(fragment.centerY) ||
                    !Number.isFinite(fragment.offsetX) ||
                    !Number.isFinite(fragment.offsetY) ||
                    !Number.isFinite(fragment.rotation) ||
                    !Array.isArray(fragment.points) ||
                    fragment.points.length !== 3 ||
                    fragment.points.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
                ) {
                    throw new Error("Wizard of Flatland spike shatter fragment requires finite triangular geometry");
                }
                if (Math.hypot(fragment.offsetX, fragment.offsetY) > SPIKE_SHATTER_MAX_OFFSET_RADIUS + 0.000001) {
                    throw new Error("Wizard of Flatland spike shatter fragment exceeds maximum offset radius");
                }
                if (Math.abs(fragment.rotation) > SPIKE_SHATTER_MAX_ROTATION + 0.000001) {
                    throw new Error("Wizard of Flatland spike shatter fragment exceeds maximum rotation");
                }
                const center = worldToScreen(
                    fragment.centerX + fragment.offsetX * movementProgress,
                    fragment.centerY + fragment.offsetY * movementProgress
                );
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.translate(center.x, center.y);
                ctx.rotate(fragment.rotation * movementProgress);
                ctx.fillStyle = effect.fillColor;
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = Math.max(1, state.view.scale * 0.026);
                ctx.beginPath();
                ctx.moveTo(fragment.points[0].x * state.view.scale, fragment.points[0].y * state.view.scale);
                for (let i = 1; i < fragment.points.length; i++) {
                    ctx.lineTo(fragment.points[i].x * state.view.scale, fragment.points[i].y * state.view.scale);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    function drawWallShatterEffects() {
        if (!Array.isArray(state.wallShatterEffects) || state.wallShatterEffects.length === 0) return;
        ctx.save();
        for (const effect of state.wallShatterEffects) {
            validateWallShatterEffect(effect);
            const t = Math.max(0, Math.min(1, effect.age / WALL_SHATTER_VISUAL_SECONDS));
            const alpha = 1 - t;
            for (const fragment of effect.fragments) {
                if (
                    !fragment ||
                    !Number.isFinite(fragment.x) ||
                    !Number.isFinite(fragment.y) ||
                    !Number.isFinite(fragment.vx) ||
                    !Number.isFinite(fragment.vy) ||
                    !Number.isFinite(fragment.size) ||
                    !Number.isFinite(fragment.angle) ||
                    !Number.isFinite(fragment.spin)
                ) {
                    throw new Error("Wizard of Flatland wall shatter fragment requires finite render data");
                }
                const x = fragment.x + fragment.vx * effect.age;
                const y = fragment.y + fragment.vy * effect.age;
                const point = worldToScreen(x, y);
                const size = fragment.size * state.view.scale * (1 - t * 0.35);
                ctx.save();
                ctx.translate(point.x, point.y);
                ctx.rotate(fragment.angle + fragment.spin * effect.age);
                ctx.fillStyle = `rgba(16,16,16,${0.86 * alpha})`;
                ctx.fillRect(-size * 0.5, -size * 0.5, size, size * 0.62);
                ctx.restore();
            }
        }
        ctx.restore();
    }

    function drawAgents() {
        ctx.save();
        for (const agent of state.agents) {
            const point = worldToScreen(agent.x, agent.y);
            const radius = agent.radius * state.view.scale;
            drawAgentTriangle(point.x, point.y, radius, getAgentFacingAngle(agent), agent);
            drawAgentHealthBar(point.x, point.y, radius, agent);
        }
        ctx.restore();
    }

    function drawAgentHealthBar(x, y, radius, agent) {
        validateAgentHealth(agent);
        if (agent.health >= agent.maxHealth) return;
        const ratio = Math.max(0, Math.min(1, agent.health / agent.maxHealth));
        const width = Math.max(18, radius * 1.8);
        const height = Math.max(3, Math.min(6, state.view.scale * 0.08));
        const top = y - radius - Math.max(7, state.view.scale * 0.12);
        const left = x - width * 0.5;
        ctx.fillStyle = "rgba(12,18,22,0.78)";
        ctx.fillRect(left, top, width, height);
        ctx.fillStyle = ratio > 0.5 ? "#58d27b" : ratio > 0.25 ? "#ffd166" : "#ff6b6b";
        ctx.fillRect(left, top, width * ratio, height);
        ctx.strokeStyle = "rgba(236,244,248,0.65)";
        ctx.lineWidth = 1;
        ctx.strokeRect(left, top, width, height);
    }

    function getAgentFacingAngle(agent) {
        return Number.isFinite(agent.heading)
            ? agent.heading
            : Math.atan2(state.target.y - agent.y, state.target.x - agent.x);
    }

    function getOppositeHexColor(hexColor) {
        if (typeof hexColor !== "string" || !/^#[0-9a-f]{6}$/i.test(hexColor)) {
            throw new Error(`Wizard of Flatland opposite color requires a six-digit hex color, got ${hexColor}`);
        }
        const color = Number.parseInt(hexColor.slice(1), 16);
        return `#${(0xffffff ^ color).toString(16).padStart(6, "0")}`;
    }

    function getAgentHomeZoneColor(agent) {
        const zoneIndex = Math.min(
            FLOOR_ZONE_COLORS.length - 1,
            getAgentHomeZone(agent)
        );
        return FLOOR_ZONE_COLORS[zoneIndex];
    }

    function getAgentHomeZoneOppositeColor(agent) {
        return getOppositeHexColor(getAgentHomeZoneColor(agent));
    }

    function getAgentTemperatureColor(baseColor, temperature) {
        if (typeof baseColor !== "string" || !/^#[0-9a-f]{6}$/i.test(baseColor)) {
            throw new Error(`Wizard of Flatland enemy temperature color requires a six-digit hex color, got ${baseColor}`);
        }
        if (!Number.isFinite(temperature) || temperature > 0) {
            throw new Error(`Wizard of Flatland enemy temperature color requires a finite non-positive temperature, got ${temperature}`);
        }
        const color = Number.parseInt(baseColor.slice(1), 16);
        const coldDegrees = -temperature;
        const redGreenProgress = Math.min(1, coldDegrees / 40);
        const blueProgress = Math.min(1, coldDegrees / 20);
        const warmRed = (color >> 16) & 0xff;
        const warmGreen = (color >> 8) & 0xff;
        const warmBlue = color & 0xff;
        const red = Math.round(warmRed + (255 - warmRed) * redGreenProgress);
        const green = Math.round(warmGreen + (255 - warmGreen) * redGreenProgress);
        const blue = Math.round(warmBlue + (255 - warmBlue) * blueProgress);
        return `rgb(${red}, ${green}, ${blue})`;
    }

    function drawAgentTriangle(x, y, radius, angle, agent) {
        const wallClamped = agent.wallClamps > 0 || agent.solverState === STATE_BLOCKED;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const baseAngleOffset = Math.PI / 6;
        const tipX = x + cos * radius;
        const tipY = y + sin * radius;
        const leftX = x + Math.cos(angle + Math.PI - baseAngleOffset) * radius;
        const leftY = y + Math.sin(angle + Math.PI - baseAngleOffset) * radius;
        const rightX = x + Math.cos(angle + Math.PI + baseAngleOffset) * radius;
        const rightY = y + Math.sin(angle + Math.PI + baseAngleOffset) * radius;

        const warmColor = agent.isDesignatedAttacker ? "#6f0000" : getAgentHomeZoneOppositeColor(agent);
        ctx.fillStyle = getAgentTemperatureColor(warmColor, agent.temperature);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1, state.view.scale * 0.026);
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(leftX, leftY);
        ctx.lineTo(rightX, rightY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (wallClamped) {
            ctx.fillStyle = "rgba(255,107,107,0.35)";
            ctx.beginPath();
            ctx.arc(x, y, Math.max(2, radius * 0.35), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function screenToWorld(screenX, screenY) {
        return {
            x: state.view.centerX + (screenX - state.view.offsetX) / state.view.scale,
            y: state.view.centerY + (screenY - state.view.offsetY) / state.view.scale
        };
    }

    function canvasEventToWorld(event) {
        resizeCanvas();
        const rect = canvas.getBoundingClientRect();
        const screenX = (event.clientX - rect.left) * state.view.dpr;
        const screenY = (event.clientY - rect.top) * state.view.dpr;
        return screenToWorld(screenX, screenY);
    }

    function projectedCursorMouseClientToWorld() {
        const mouseMode = state.projectedCursorMouseMode;
        if (!mouseMode || typeof mouseMode !== "object") throw new Error("Wizard of Flatland projected cursor mouse mode state is missing");
        if (!Number.isFinite(mouseMode.clientX) || !Number.isFinite(mouseMode.clientY)) {
            throw new Error("Wizard of Flatland mouse cursor mode requires a finite client pointer");
        }
        resizeCanvas();
        const rect = canvas.getBoundingClientRect();
        const screenX = (mouseMode.clientX - rect.left) * state.view.dpr;
        const screenY = (mouseMode.clientY - rect.top) * state.view.dpr;
        return screenToWorld(screenX, screenY);
    }

    function setProjectedCursorMouseClientPoint(event) {
        if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
            throw new Error("Wizard of Flatland mouse cursor mode requires finite client coordinates");
        }
        const mouseMode = state.projectedCursorMouseMode;
        if (!mouseMode || typeof mouseMode !== "object") throw new Error("Wizard of Flatland projected cursor mouse mode state is missing");
        mouseMode.clientX = event.clientX;
        mouseMode.clientY = event.clientY;
    }

    function activateProjectedCursorMouseMode(event) {
        if (state.wallTool.active) return false;
        const mouseMode = state.projectedCursorMouseMode;
        if (!mouseMode || typeof mouseMode !== "object") throw new Error("Wizard of Flatland projected cursor mouse mode state is missing");
        setProjectedCursorMouseClientPoint(event);
        mouseMode.active = true;
        event.preventDefault();
        return true;
    }

    function updateProjectedCursorMouseModePointer(event) {
        const mouseMode = state.projectedCursorMouseMode;
        if (!mouseMode || typeof mouseMode !== "object") throw new Error("Wizard of Flatland projected cursor mouse mode state is missing");
        if (!mouseMode.active) return false;
        setProjectedCursorMouseClientPoint(event);
        return true;
    }

    function deactivateProjectedCursorMouseMode() {
        const mouseMode = state.projectedCursorMouseMode;
        if (!mouseMode || typeof mouseMode !== "object") throw new Error("Wizard of Flatland projected cursor mouse mode state is missing");
        mouseMode.active = false;
        mouseMode.clientX = NaN;
        mouseMode.clientY = NaN;
        mouseMode.bendDirection = 0;
        mouseMode.distanceDirection = 0;
    }

    function inspectAgentAtPointer(event) {
        const world = canvasEventToWorld(event);
        const agent = findAgentAtWorldPoint(world.x, world.y);
        if (!agent) return false;
        logAgentPathfindingState(agent);
        event.preventDefault();
        return true;
    }

    function findAgentAtWorldPoint(worldX, worldY) {
        let best = null;
        for (const agent of state.agents) {
            const distance = Math.hypot(agent.x - worldX, agent.y - worldY);
            const pickRadius = Math.max(agent.radius * 1.35, 0.55);
            if (distance > pickRadius) continue;
            if (!best || distance < best.distance) best = { agent, distance };
        }
        return best ? best.agent : null;
    }

    function logAgentPathfindingState(agent) {
        const currentNode = nearestPathfindingNode(agent.x, agent.y);
        const targetNearestNode = nearestPathfindingNode(state.target.x, state.target.y);
        const targetPassableNode = nearestPassablePathfindingNode(state.target.x, state.target.y);
        const waypoint = getAgentPathWaypoint(agent);
        const pathNodes = agent.pathNodeKeys.map((pathKey, index) => {
            const currentPathIndex = typeof pathKey === "string" ? getPathfindingNodeIndexForKey(pathKey) : null;
            const exists = Number.isInteger(currentPathIndex);
            const stored = getStoredAgentPathWaypoint(agent, index, pathKey);
            const x = exists ? getPathfindingNodeX(currentPathIndex) : (stored ? stored.x : null);
            const y = exists ? getPathfindingNodeY(currentPathIndex) : (stored ? stored.y : null);
            return {
                index,
                pathIndex: exists ? currentPathIndex : null,
                key: pathKey,
                current: index === agent.pathCursor,
                exists,
                x,
                y,
                blocked: exists ? isPathfindingNodeBlocked(currentPathIndex) : null,
                passable: exists ? isPathfindingNodePassable(currentPathIndex) : null,
                stale: !exists,
                distanceFromAgent: Number.isFinite(x) && Number.isFinite(y) ? Math.hypot(x - agent.x, y - agent.y) : null
            };
        });
        const wallClearances = [];
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            wallClearances.push({
                index: i / WALL_STRIDE,
                kind: "segment",
                clearance: pointSegmentDistance(
                    agent.x,
                    agent.y,
                    state.walls[i + WALL_X1],
                    state.walls[i + WALL_Y1],
                    state.walls[i + WALL_X2],
                    state.walls[i + WALL_Y2]
                ) - WALL_WORLD_HALF_THICKNESS
            });
        }
        wallClearances.sort((a, b) => a.clearance - b.clearance);
        wallClearances.length = Math.min(wallClearances.length, 5);
        const dump = {
            id: agent.id,
            position: { x: agent.x, y: agent.y },
            velocity: { x: agent.vx, y: agent.vy, speed: Math.hypot(agent.vx, agent.vy) },
            radius: agent.radius,
            solverState: agent.solverState,
            pathMode: agent.pathMode === PATH_MODE_WORKER ? "worker" : "direct",
            pathRequestPending: agent.pathRequestPending,
            pathRequestId: agent.pathRequestId,
            pathRequestedAt: agent.pathRequestedAt,
            pathRequestedWorldVersion: agent.pathRequestedWorldVersion,
            pathRequestedRawStartKey: agent.pathRequestedRawStartKey,
            pathRequestedStartKey: agent.pathRequestedStartKey,
            pathRequestedGoalKey: agent.pathRequestedGoalKey,
            pathCursor: agent.pathCursor,
            pathLength: agent.pathNodeKeys.length,
            pathGoal: { x: agent.pathGoalX, y: agent.pathGoalY },
            waypoint: waypoint ? { index: waypoint.pathIndex, key: waypoint.key, x: waypoint.x, y: waypoint.y, blocked: waypoint.blocked === true } : null,
            currentNode: createPathfindingNodeDiagnostic(currentNode),
            targetNearestNode: createPathfindingNodeDiagnostic(targetNearestNode),
            targetPassableNode: createPathfindingNodeDiagnostic(targetPassableNode),
            lineOfSightToTarget: hasDirectLineOfSight(agent.x, agent.y, state.target.x, state.target.y, agent.radius),
            wallClamps: agent.wallClamps,
            nearestWallClearances: wallClearances,
            pathNodes
        };
        console.groupCollapsed(`Wizard of Flatland agent ${agent.id} pathfinding`);
        console.log(dump);
        console.table(pathNodes);
        console.groupEnd();
    }

    function createPathfindingNodeDiagnostic(pathIndex) {
        if (!Number.isInteger(pathIndex)) return null;
        return {
            index: pathIndex,
            key: getPathfindingNodeKey(pathIndex),
            x: getPathfindingNodeX(pathIndex),
            y: getPathfindingNodeY(pathIndex),
            blocked: isPathfindingNodeBlocked(pathIndex),
            passable: isPathfindingNodePassable(pathIndex)
        };
    }

    function nearestHexNode(worldX, worldY) {
        const approxCol = Math.round(worldX / HEX_GRID_COL_STEP);
        const approxRow = Math.round(worldY);
        let best = null;
        for (let col = approxCol - 2; col <= approxCol + 2; col++) {
            for (let row = approxRow - 2; row <= approxRow + 2; row++) {
                const node = {
                    x: col * HEX_GRID_COL_STEP,
                    y: row + (isEvenGridColumn(col) ? 0.5 : 0),
                    xindex: col,
                    yindex: row,
                    key: pathfindingNodeKey(col, row)
                };
                const distSq = (node.x - worldX) * (node.x - worldX) + (node.y - worldY) * (node.y - worldY);
                if (!best || distSq < best.distSq) best = { ...node, distSq };
            }
        }
        if (!best) throw new Error("Wizard of Flatland wall tool could not resolve nearest hex node");
        return best;
    }

    function beginWallBuildDrag(event) {
        if (!state.wallTool.active) return false;
        const world = canvasEventToWorld(event);
        const node = nearestHexNode(world.x, world.y);
        state.wallTool.dragging = true;
        state.wallTool.pointerId = event.pointerId;
        state.wallTool.startNode = node;
        state.wallTool.hoverNode = node;
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
        return true;
    }

    function updateWallBuildDrag(event) {
        if (!state.wallTool.dragging || state.wallTool.pointerId !== event.pointerId) return false;
        const world = canvasEventToWorld(event);
        state.wallTool.hoverNode = nearestHexNode(world.x, world.y);
        event.preventDefault();
        return true;
    }

    function finishWallBuildDrag(event) {
        if (!state.wallTool.dragging || state.wallTool.pointerId !== event.pointerId) return false;
        updateWallBuildDrag(event);
        const start = state.wallTool.startNode;
        const end = state.wallTool.hoverNode;
        if (start && end && start.key !== end.key) {
            addSegmentWall(start.x, start.y, end.x, end.y);
        }
        cancelWallBuildDrag();
        event.preventDefault();
        return true;
    }

    function cancelWallBuildDrag() {
        if (state.wallTool.pointerId !== null) {
            try {
                if (canvas.hasPointerCapture(state.wallTool.pointerId)) {
                    canvas.releasePointerCapture(state.wallTool.pointerId);
                }
            } catch (_error) {
                // Pointer capture may already be gone after browser-level cancellation.
            }
        }
        state.wallTool.dragging = false;
        state.wallTool.pointerId = null;
        state.wallTool.startNode = null;
        state.wallTool.hoverNode = null;
    }

    function constrainMovementToSegmentWalls(previousX, previousY, x, y, radius) {
        let currentX = previousX;
        let currentY = previousY;
        let remainingX = x - previousX;
        let remainingY = y - previousY;

        for (let iteration = 0; iteration < 4; iteration++) {
            if (Math.hypot(remainingX, remainingY) <= 0.000001) break;
            const intendedX = currentX + remainingX;
            const intendedY = currentY + remainingY;
            const hit = findEarliestSegmentWallHit(currentX, currentY, intendedX, intendedY, radius);
            if (!hit) {
                currentX = intendedX;
                currentY = intendedY;
                break;
            }

            const safeT = Math.max(0, hit.t - 0.0005);
            currentX += remainingX * safeT;
            currentY += remainingY * safeT;

            const leftoverScale = Math.max(0, 1 - safeT);
            let slideX = remainingX * leftoverScale;
            let slideY = remainingY * leftoverScale;
            const intoNormal = slideX * hit.nx + slideY * hit.ny;
            if (intoNormal < 0) {
                slideX -= hit.nx * intoNormal;
                slideY -= hit.ny * intoNormal;
            }
            remainingX = slideX;
            remainingY = slideY;
        }

        return { x: currentX, y: currentY };
    }

    function findEarliestSegmentWallHit(fromX, fromY, toX, toY, radius) {
        let best = null;
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            const hit = sweptCircleSegmentHit(
                fromX,
                fromY,
                toX,
                toY,
                state.walls[i + WALL_X1],
                state.walls[i + WALL_Y1],
                state.walls[i + WALL_X2],
                state.walls[i + WALL_Y2],
                radius + WALL_WORLD_HALF_THICKNESS
            );
            if (hit && (!best || hit.t < best.t)) best = hit;
        }
        return best;
    }

    function sweptCircleSegmentHit(fromX, fromY, toX, toY, ax, ay, bx, by, radius) {
        const startDistance = pointSegmentDistance(fromX, fromY, ax, ay, bx, by);
        if (startDistance < radius - 0.0005) {
            const normal = segmentRepulsionNormal(fromX, fromY, ax, ay, bx, by);
            return { t: 0, nx: normal.x, ny: normal.y };
        }

        const closest = closestMovementWallDistance(fromX, fromY, toX, toY, ax, ay, bx, by);
        if (!closest || closest.distance > radius) return null;

        let lo = 0;
        let hi = Math.max(0, Math.min(1, closest.t));
        if (hi <= 0.000001) hi = 1;
        for (let i = 0; i < 24; i++) {
            const mid = (lo + hi) / 2;
            const px = fromX + (toX - fromX) * mid;
            const py = fromY + (toY - fromY) * mid;
            if (pointSegmentDistance(px, py, ax, ay, bx, by) <= radius) {
                hi = mid;
            } else {
                lo = mid;
            }
        }
        const hitX = fromX + (toX - fromX) * hi;
        const hitY = fromY + (toY - fromY) * hi;
        const normal = segmentRepulsionNormal(hitX, hitY, ax, ay, bx, by);
        return { t: hi, nx: normal.x, ny: normal.y };
    }

    function closestMovementWallDistance(fromX, fromY, toX, toY, ax, ay, bx, by) {
        const candidates = [];
        const intersection = segmentIntersectionParameters(fromX, fromY, toX, toY, ax, ay, bx, by);
        if (intersection) candidates.push({ t: intersection.t, distance: 0 });
        candidates.push({ t: 0, distance: pointSegmentDistance(fromX, fromY, ax, ay, bx, by) });
        candidates.push({ t: 1, distance: pointSegmentDistance(toX, toY, ax, ay, bx, by) });

        const aProjection = pointProjectionParameter(ax, ay, fromX, fromY, toX, toY);
        if (aProjection >= 0 && aProjection <= 1) {
            const px = fromX + (toX - fromX) * aProjection;
            const py = fromY + (toY - fromY) * aProjection;
            candidates.push({ t: aProjection, distance: Math.hypot(px - ax, py - ay) });
        }

        const bProjection = pointProjectionParameter(bx, by, fromX, fromY, toX, toY);
        if (bProjection >= 0 && bProjection <= 1) {
            const px = fromX + (toX - fromX) * bProjection;
            const py = fromY + (toY - fromY) * bProjection;
            candidates.push({ t: bProjection, distance: Math.hypot(px - bx, py - by) });
        }

        let best = null;
        for (const candidate of candidates) {
            if (!best || candidate.distance < best.distance) best = candidate;
        }
        return best;
    }

    function tick(now) {
        const frameStarted = performance.now();
        const frameParts = [];
        function framePart(label, fn) {
            const started = performance.now();
            try {
                return fn();
            } finally {
                frameParts.push({
                    label,
                    duration: performance.now() - started
                });
            }
        }
        const dt = Math.min(0.05, Math.max(0.001, (now - state.lastTime) / 1000));
        state.lastTime = now;
        state.targetFlashTime = Math.max(0, state.targetFlashTime - dt);
        framePart("projected cursor input", () => updateProjectedCursorKeyboardControls(dt));
        framePart("projected cursor mouse input", () => updateProjectedCursorMouseControls(dt));
        framePart("idle target facing", () => updateIdleTargetFacingAndCursor(dt));
        framePart("projected cursor distance return", () => updateProjectedCursorDistanceReturn(dt));
        framePart("target heading", () => updateTargetHeadingFromProjectedCursor(dt));
        framePart("target movement", () => updateTargetKeyboardMovement(dt));
        framePart("refresh maze sections", () => refreshGeneratedMazeIfNeeded(false));
        framePart("refresh path bounds", () => refreshMazePathBoundsIfNeeded());
        framePart("line of sight", () => updateLosAndExploration());
        framePart("spell cooldowns", () => updateSpellCooldowns(dt));
        framePart("held spell casting", () => updateHeldSpellCasting(dt));
        framePart("freeze particles", () => updateFreezeParticles(dt));
        framePart("enemy temperatures", () => updateEnemyTemperatures(dt));
        framePart("fireballs", () => updateFireballs(dt));
        framePart("fire deaths", () => updateFireDeathEffects(dt));
        framePart("spike shatters", () => updateSpikeShatterEffects(dt));
        framePart("wall shatters", () => updateWallShatterEffects(dt));
        framePart("temporary path costs", () => updateTemporaryPathfindingCosts());
        framePart("live enemy path costs", () => updateLiveEnemyPathfindingCosts());
        framePart("temporary death blockers", () => updateTemporaryDeathBlockers());
        framePart("coins", () => updateCoins(dt));
        framePart("talismans", () => updateTalismans(dt));
        framePart("wizard vitals", () => regenerateWizardVitals(dt));
        framePart("passive healing", () => updatePassiveHealing(dt));
        if (state.running) framePart("request solver step", () => requestStep(dt));
        framePart("draw", () => draw());
        const drawPart = frameParts.find((part) => part.label === "draw");
        updateDebugFpsCounter(now, dt, drawPart ? drawPart.duration : 0, frameParts);
        const frameDuration = performance.now() - frameStarted;
        frameParts.sort((a, b) => b.duration - a.duration);
        profiler.noteFrame(frameDuration, frameParts);
        profiler.noteFirstFrameAfterLoad(frameDuration, frameParts);
        requestAnimationFrame(tick);
    }

    if (playButton) {
        playButton.addEventListener("click", () => {
            state.running = !state.running;
            playButton.textContent = state.running ? "Pause" : "Play";
        });
    }
    if (stepButton) stepButton.addEventListener("click", () => requestStep(1 / 60));
    if (resetButton) resetButton.addEventListener("click", createScenario);
    if (scenarioSelect) scenarioSelect.addEventListener("change", createScenario);
    if (expLevelUpButton) expLevelUpButton.addEventListener("click", showSpellLevelPanel);
    if (spellLevelCloseButton) spellLevelCloseButton.addEventListener("click", () => {
        if (!state.initialSpellChoiceRequired) hideSpellLevelPanel();
    });
    document.addEventListener("pointerdown", (event) => {
        if (!spellLevelPanel || spellLevelPanel.classList.contains("hidden")) return;
        if (spellLevelPanel.contains(event.target)) return;
        if (expLevelUpButton && expLevelUpButton.contains(event.target)) return;
        if (state.initialSpellChoiceRequired) return;
        hideSpellLevelPanel();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && spellLevelPanel && !spellLevelPanel.classList.contains("hidden")) {
            if (state.initialSpellChoiceRequired) return;
            hideSpellLevelPanel();
        }
    });
    for (const input of [agentCountInput, separationInput, speedScaleInput]) {
        if (!input) continue;
        input.addEventListener("input", () => {
            updateControlLabels();
            if (input === agentCountInput) respawnAgentsForCurrentScenario();
        });
    }
    for (const input of [mazeSeedInput, mazeChunkSizeInput, mazeRoomScaleInput, mazeTwistinessInput]) {
        if (!input) continue;
        input.addEventListener("input", () => {
            if (input === mazeSeedInput) state.mazeSeed = getMazeSeed();
            updateControlLabels();
            if (!isProceduralMazeScenario()) return;
            state.generatedMazeSignature = "";
            resetGeneratedMazeEnemyPopulation();
            resetGeneratedMazeCoinPopulation();
            resetGeneratedMazeTalismanState();
            invalidateMazeLookaheadCache();
            refreshGeneratedMazeIfNeeded(true);
        });
    }
    canvas.addEventListener("pointerdown", (event) => {
        if (beginWallBuildDrag(event)) return;
        inspectAgentAtPointer(event);
    });
    canvas.addEventListener("pointermove", (event) => {
        updateWallBuildDrag(event);
        updateProjectedCursorMouseModePointer(event);
    });
    canvas.addEventListener("pointerup", (event) => {
        finishWallBuildDrag(event);
    });
    canvas.addEventListener("pointercancel", (event) => {
        if (state.wallTool.pointerId === event.pointerId) cancelWallBuildDrag();
    });
    canvas.addEventListener("dblclick", (event) => {
        activateProjectedCursorMouseMode(event);
    });
    canvas.addEventListener("wheel", (event) => {
        handleZoomWheel(event);
    }, { passive: false });

    function isEditableEventTarget(target) {
        if (!target || typeof target !== "object") return false;
        const tagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
        return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable === true;
    }

    function getTargetKeyboardControlKey(event) {
        if (!event) return null;
        if (TARGET_CURSOR_KEYS.has(event.key)) return event.key;
        if (TARGET_SIDEWAYS_KEYS[event.code] || TARGET_FORWARD_KEYS[event.code]) return event.code;
        const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
        if (key === "a") return "KeyA";
        if (key === "d") return "KeyD";
        if (key === "w") return "KeyW";
        if (key === "s") return "KeyS";
        return null;
    }
    window.addEventListener("keydown", (event) => {
        if (state.startupMenuOpen) return;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key && event.key.toLowerCase() === "f") {
            event.preventDefault();
            if (!event.repeat) toggleDebugFpsCounter();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key && event.key.toLowerCase() === "s") {
            event.preventDefault();
            saveWizardPositionToConsoleSlot();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key && event.key.toLowerCase() === "l") {
            event.preventDefault();
            loadWizardPositionFromConsoleSlot();
            return;
        }
        if (!isEditableEventTarget(event.target) && event.code === "KeyF") {
            event.preventDefault();
            setSelectedSpell("fireball");
            return;
        }
        if (!isEditableEventTarget(event.target) && event.code === "KeyK") {
            event.preventDefault();
            setSelectedSpell("spikes");
            return;
        }
        if (!isEditableEventTarget(event.target) && event.code === "KeyI") {
            event.preventDefault();
            setSelectedSpell("freeze");
            return;
        }
        if (event.code === "Space" || event.key === " ") {
            event.preventDefault();
            if (!state.spaceHeld) shootSelectedSpell();
            state.spaceHeld = true;
            return;
        }
        if (event.key === "b" || event.key === "B") {
            state.wallTool.active = true;
            return;
        }
        if ((event.key === "z" || event.key === "Z") && !isEditableEventTarget(event.target)) {
            state.zoomHeld = true;
            return;
        }
        if (event.key === "Shift") {
            state.fastMovementHeld = true;
            return;
        }
        const movementKey = getTargetKeyboardControlKey(event);
        if (!movementKey) return;
        event.preventDefault();
        if (TARGET_CURSOR_KEYS.has(movementKey)) deactivateProjectedCursorMouseMode();
        state.fastMovementHeld = event.shiftKey;
        state.pressedMovementKeys[movementKey] = true;
    });
    window.addEventListener("keyup", (event) => {
        if (state.startupMenuOpen) return;
        if (event.code === "Space" || event.key === " ") {
            event.preventDefault();
            state.spaceHeld = false;
            return;
        }
        if (event.key === "b" || event.key === "B") {
            state.wallTool.active = false;
            cancelWallBuildDrag();
            return;
        }
        if (event.key === "z" || event.key === "Z") {
            state.zoomHeld = false;
            return;
        }
        if (event.key === "Shift") {
            state.fastMovementHeld = false;
            return;
        }
        const movementKey = getTargetKeyboardControlKey(event);
        if (!movementKey) return;
        event.preventDefault();
        delete state.pressedMovementKeys[movementKey];
    });
    window.addEventListener("blur", () => {
        state.pressedMovementKeys = Object.create(null);
        state.spaceHeld = false;
        state.zoomHeld = false;
        state.fastMovementHeld = false;
        state.wallTool.active = false;
        cancelWallBuildDrag();
    });
    window.addEventListener("resize", resizeCanvas);

    fetchSpellLevelDefinitions().catch((error) => {
        console.error("[wizard of flatland spell levels] startup load failed", error);
    });
    setSpeedScaleValue(SPEED_SCALE_DEFAULT);
    updateControlLabels();
    setupStartupMenu().catch(showStartupPersistenceError);
    resizeCanvas();
})();
