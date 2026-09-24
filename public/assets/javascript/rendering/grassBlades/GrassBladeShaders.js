(function attachGrassBladeShaders(global) {
    const GRASS_BLADE_VERTEX_WEBGL2 = `#version 300 es
precision highp float;
in vec2 aBaseWorld;
in vec2 aBladeVertex;
in vec4 aBladeMeta;
in vec2 aSwayMeta;
in float aColorShift;
uniform vec2 uScreenSize;
uniform vec2 uCameraWorld;
uniform float uCameraZ;
uniform float uBaseZ;
uniform float uViewScale;
uniform float uXyRatio;
uniform float uBladeHeightWorld;
uniform float uBladeBaseHalfWidthWorld;
uniform float uTimeSeconds;
uniform float uSwayRadians;
uniform vec2 uMapSize;
uniform vec2 uWrapEnabled;
out vec2 vBaseWorld;
out vec2 vBaseScreen;
out float vAlpha;
out float vColorShift;

float wrappedDelta(float fromValue, float toValue, float wrapEnabled, float worldSize) {
    float delta = toValue - fromValue;
    if (wrapEnabled <= 0.5 || worldSize <= 0.0) return delta;
    return mod(mod(delta + worldSize * 0.5, worldSize) + worldSize, worldSize) - worldSize * 0.5;
}

vec2 worldToScreen(vec2 world, float worldZ) {
    float dx = wrappedDelta(uCameraWorld.x, world.x, uWrapEnabled.x, uMapSize.x);
    float dyBase = wrappedDelta(uCameraWorld.y, world.y, uWrapEnabled.y, uMapSize.y);
    float dy = dyBase - (worldZ - uCameraZ);
    return vec2(dx * uViewScale, dy * uViewScale * uXyRatio);
}

void main(void) {
    vec2 baseScreen = worldToScreen(aBaseWorld, uBaseZ);
    float heightPx = max(1.0, uBladeHeightWorld * uViewScale);
    float halfWidthPx = max(0.5, uBladeBaseHalfWidthWorld * uViewScale);
    float heightScale = max(0.2, aBladeMeta.x);
    float widthScale = max(0.2, aBladeMeta.y);
    float staticTiltRadians = clamp(aBladeMeta.w, -0.2, 0.2);
    float swayRadians = sin(uTimeSeconds * max(0.01, aSwayMeta.y) + aSwayMeta.x) * uSwayRadians;
    float tiltRadians = clamp(staticTiltRadians + swayRadians, -0.35, 0.35);
    float t = clamp(aBladeVertex.y, 0.0, 1.0);
    float bladeHeightPx = heightPx * heightScale;
    float bladeHalfWidthPx = halfWidthPx * widthScale;
    float tiltOffsetPx = tan(tiltRadians) * bladeHeightPx * t;
    vec2 screen = baseScreen + vec2(aBladeVertex.x * bladeHalfWidthPx + tiltOffsetPx, -t * bladeHeightPx);
    vec2 screenSize = max(uScreenSize, vec2(1.0));
    vec2 clip = vec2(
        (screen.x / screenSize.x) * 2.0 - 1.0,
        1.0 - (screen.y / screenSize.y) * 2.0
    );
    gl_Position = vec4(clip, 0.0, 1.0);
    vBaseWorld = aBaseWorld;
    vBaseScreen = baseScreen;
    vAlpha = clamp(aBladeMeta.z, 0.0, 1.0);
    vColorShift = clamp(aColorShift, -0.2, 0.2);
}
`;

    const GRASS_BLADE_FRAGMENT_WEBGL2 = `#version 300 es
precision highp float;
in vec2 vBaseWorld;
in vec2 vBaseScreen;
in float vAlpha;
in float vColorShift;
out vec4 fragColor;
uniform sampler2D uRootMask;
uniform sampler2D uLosDepthTexture;
uniform vec2 uScreenSize;
uniform vec2 uRootMaskWorldOrigin;
uniform vec2 uRootMaskWorldSize;
uniform vec2 uCameraWorld;
uniform float uCameraZ;
uniform float uBaseZ;
uniform float uDepthBias;
uniform vec2 uDepthRange;
uniform vec4 uTint;
uniform vec4 uTintLow;
uniform float uRootMaskThreshold;
uniform float uAlphaCutoff;
uniform vec2 uMapSize;
uniform vec2 uWrapEnabled;
uniform float uLosShadowEnabled;
uniform vec2 uLosWizardWorld;
uniform float uLosDepthBins;
uniform float uLosMinAngle;
uniform float uLosFarDistance;
uniform float uLosHasForwardFov;
uniform float uLosFacingAngle;
uniform float uLosHalfFovRad;
uniform float uLosNearRevealRadius;
uniform float uLosShadowOpacity;
uniform float uLosShadowFactor;
uniform float uWizardShadowEnabled;
uniform vec2 uWizardShadowWorld;
uniform vec2 uWizardShadowRadius;
uniform float uWizardShadowOpacity;
uniform float uWizardShadowFactor;

const float TWO_PI = 6.283185307179586;

float wrappedDelta(float fromValue, float toValue, float wrapEnabled, float worldSize) {
    float delta = toValue - fromValue;
    if (wrapEnabled <= 0.5 || worldSize <= 0.0) return delta;
    return mod(mod(delta + worldSize * 0.5, worldSize) + worldSize, worldSize) - worldSize * 0.5;
}

float normalizedAngleDelta(float a, float b) {
    return mod(mod(a - b + 3.141592653589793, TWO_PI) + TWO_PI, TWO_PI) - 3.141592653589793;
}

float depthForBaseWorld(vec2 baseWorld) {
    float camDy = wrappedDelta(uCameraWorld.y, baseWorld.y, uWrapEnabled.y, uMapSize.y);
    float camDz = uBaseZ - uCameraZ;
    float depthMetric = camDy + camDz + uDepthBias;
    float farMetric = uDepthRange.x;
    float invSpan = max(1e-6, uDepthRange.y);
    return clamp((farMetric - depthMetric) * invSpan, 0.0, 1.0);
}

vec2 rootMaskUvForWorld(vec2 baseWorld) {
    return (baseWorld - uRootMaskWorldOrigin) / max(uRootMaskWorldSize, vec2(0.0001));
}

float unpackLosDepth(vec4 packedDepth) {
    float hi = floor(packedDepth.r * 255.0 + 0.5);
    float lo = floor(packedDepth.g * 255.0 + 0.5);
    return ((hi * 256.0 + lo) / 65535.0) * max(0.0001, uLosFarDistance);
}

float losShadowCoverageForBase(vec2 baseWorld) {
    if (uLosShadowEnabled <= 0.5 || uLosDepthBins < 3.0 || uLosFarDistance <= 0.0) return 0.0;
    vec2 delta = vec2(
        wrappedDelta(uLosWizardWorld.x, baseWorld.x, uWrapEnabled.x, uMapSize.x),
        wrappedDelta(uLosWizardWorld.y, baseWorld.y, uWrapEnabled.y, uMapSize.y)
    );
    float dist = length(delta);
    float theta = atan(delta.y, delta.x);
    bool insideFov = true;
    if (uLosHasForwardFov > 0.5) {
        insideFov = abs(normalizedAngleDelta(theta, uLosFacingAngle)) <= uLosHalfFovRad;
    }
    float normAngle = mod(mod(theta - uLosMinAngle, TWO_PI) + TWO_PI, TWO_PI);
    float bin = clamp(floor((normAngle / TWO_PI) * uLosDepthBins), 0.0, max(0.0, uLosDepthBins - 1.0));
    vec2 depthUv = vec2((bin + 0.5) / max(1.0, uLosDepthBins), 0.5);
    float losDepth = unpackLosDepth(texture(uLosDepthTexture, depthUv));
    float nearReveal = insideFov ? 0.0 : max(0.0, uLosNearRevealRadius);
    float litDistance = max(nearReveal, losDepth);
    return dist > litDistance ? clamp(uLosShadowOpacity, 0.0, 1.0) : 0.0;
}

float wizardShadowCoverageForBase(vec2 baseWorld) {
    if (uWizardShadowEnabled <= 0.5) return 0.0;
    vec2 radius = max(uWizardShadowRadius, vec2(0.0001));
    vec2 local = vec2(
        wrappedDelta(uWizardShadowWorld.x, baseWorld.x, uWrapEnabled.x, uMapSize.x),
        wrappedDelta(uWizardShadowWorld.y, baseWorld.y, uWrapEnabled.y, uMapSize.y)
    ) / radius;
    return length(local) <= 1.0 ? clamp(uWizardShadowOpacity, 0.0, 1.0) : 0.0;
}

float grassShadowShade(vec2 baseWorld) {
    float losCoverage = losShadowCoverageForBase(baseWorld);
    float wizardCoverage = wizardShadowCoverageForBase(baseWorld);
    float shade = mix(1.0, clamp(uLosShadowFactor, 0.0, 1.0), losCoverage);
    shade *= mix(1.0, clamp(uWizardShadowFactor, 0.0, 1.0), wizardCoverage);
    return shade;
}

void main(void) {
    vec2 maskUv = rootMaskUvForWorld(vBaseWorld);
    if (maskUv.x < 0.0 || maskUv.y < 0.0 || maskUv.x > 1.0 || maskUv.y > 1.0) discard;
    float rootMask = texture(uRootMask, maskUv).r;
    if (rootMask <= uRootMaskThreshold) discard;
    float alpha = vAlpha * uTint.a;
    if (alpha <= uAlphaCutoff) discard;
    gl_FragDepth = depthForBaseWorld(vBaseWorld);
    float shade = grassShadowShade(vBaseWorld);
    float colorT = clamp((vColorShift + 0.2) / 0.4, 0.0, 1.0);
    vec3 variedTint = mix(uTintLow.rgb, uTint.rgb, colorT);
    fragColor = vec4(variedTint * shade * alpha, alpha);
}
`;

    global.RenderingGrassBladeShaders = {
        vertexWebgl2: GRASS_BLADE_VERTEX_WEBGL2,
        fragmentWebgl2: GRASS_BLADE_FRAGMENT_WEBGL2
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
