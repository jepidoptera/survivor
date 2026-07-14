(function attachGrassDepthShaders(global) {
    const GRASS_DEPTH_VERTEX_WEBGL2 = `#version 300 es
precision highp float;
in vec2 aScreenPosition;
uniform vec2 uScreenSize;
out vec2 vScreenPosition;
void main(void) {
    vec2 screenSize = max(uScreenSize, vec2(1.0));
    vec2 clip = vec2(
        (aScreenPosition.x / screenSize.x) * 2.0 - 1.0,
        1.0 - (aScreenPosition.y / screenSize.y) * 2.0
    );
    gl_Position = vec4(clip, 0.0, 1.0);
    vScreenPosition = aScreenPosition;
}
`;

    const GRASS_DEPTH_FRAGMENT_WEBGL2 = `#version 300 es
precision highp float;
in vec2 vScreenPosition;
out vec4 fragColor;
uniform sampler2D uRootMask;
uniform sampler2D uSeedTexture;
uniform vec2 uScreenSize;
uniform vec2 uRootMaskSize;
uniform vec2 uRootMaskWorldOrigin;
uniform vec2 uCameraWorld;
uniform vec2 uSeedCameraWorld;
uniform float uCameraZ;
uniform float uBaseZ;
uniform float uDepthBias;
uniform float uViewScale;
uniform float uXyRatio;
uniform vec2 uDepthRange;
uniform vec2 uSeedWorldScale;
uniform float uMaxBladeHeightPx;
uniform float uStepPx;
uniform float uTimeSeconds;
uniform float uSwayPx;
uniform float uBladeBaseHalfWidthPx;
uniform float uRootMaskThreshold;
uniform float uAlphaCutoff;
uniform vec4 uTint;
uniform sampler2D uLosDepthTexture;
uniform float uLosShadowEnabled;
uniform vec2 uLosWizardWorld;
uniform vec2 uLosMapSize;
uniform vec2 uLosWrapEnabled;
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

const int MAX_GRASS_DEPTH_STEPS = 80;
const int MAX_GRASS_HALF_WIDTH_STEPS = 6;
const float TWO_PI = 6.283185307179586;

vec2 screenToWorldWithCamera(vec2 seedScreen, vec2 cameraWorld) {
    float invScale = 1.0 / max(0.0001, uViewScale);
    float invYScale = 1.0 / max(0.0001, uViewScale * uXyRatio);
    float camDz = uBaseZ - uCameraZ;
    return vec2(
        cameraWorld.x + seedScreen.x * invScale,
        cameraWorld.y + seedScreen.y * invYScale + camDz
    );
}

vec2 seedScreenToWorld(vec2 seedScreen) {
    return screenToWorldWithCamera(seedScreen, uCameraWorld);
}

vec2 seedScreenToSnappedWorld(vec2 seedScreen) {
    return screenToWorldWithCamera(seedScreen, uSeedCameraWorld);
}

vec2 rootMaskUvForWorld(vec2 seedWorld) {
    vec2 maskSize = max(uRootMaskSize, vec2(1.0));
    return vec2(
        (seedWorld.x - uRootMaskWorldOrigin.x) * uViewScale,
        (seedWorld.y - uRootMaskWorldOrigin.y) * uViewScale * uXyRatio
    ) / maskSize;
}

float depthForSeedWorld(vec2 seedWorld) {
    float camDy = seedWorld.y - uCameraWorld.y;
    float camDz = uBaseZ - uCameraZ;
    float depthMetric = camDy + camDz + uDepthBias;
    float farMetric = uDepthRange.x;
    float invSpan = max(1e-6, uDepthRange.y);
    return clamp((farMetric - depthMetric) * invSpan, 0.0, 1.0);
}

float seedCoverageFromSample(vec4 sampleColor) {
    return max(max(sampleColor.r, sampleColor.g), sampleColor.b) * sampleColor.a;
}

float sampleNearestSeedCoverage(vec2 uv) {
    vec2 texturePixels = max(vec2(textureSize(uSeedTexture, 0)), vec2(1.0));
    vec2 texelCenter = (floor(fract(uv) * texturePixels) + vec2(0.5)) / texturePixels;
    return seedCoverageFromSample(texture(uSeedTexture, texelCenter));
}

float wrappedDelta(float fromValue, float toValue, float wrapEnabled, float worldSize) {
    float delta = toValue - fromValue;
    if (wrapEnabled <= 0.5 || worldSize <= 0.0) return delta;
    return mod(mod(delta + worldSize * 0.5, worldSize) + worldSize, worldSize) - worldSize * 0.5;
}

float normalizedAngleDelta(float a, float b) {
    return mod(mod(a - b + 3.141592653589793, TWO_PI) + TWO_PI, TWO_PI) - 3.141592653589793;
}

float unpackLosDepth(vec4 packedDepth) {
    float hi = floor(packedDepth.r * 255.0 + 0.5);
    float lo = floor(packedDepth.g * 255.0 + 0.5);
    return ((hi * 256.0 + lo) / 65535.0) * max(0.0001, uLosFarDistance);
}

float losShadowCoverageForSeed(vec2 seedWorld) {
    if (uLosShadowEnabled <= 0.5 || uLosDepthBins < 3.0 || uLosFarDistance <= 0.0) return 0.0;
    vec2 delta = vec2(
        wrappedDelta(uLosWizardWorld.x, seedWorld.x, uLosWrapEnabled.x, uLosMapSize.x),
        wrappedDelta(uLosWizardWorld.y, seedWorld.y, uLosWrapEnabled.y, uLosMapSize.y)
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

float wizardShadowCoverageForSeed(vec2 seedWorld) {
    if (uWizardShadowEnabled <= 0.5) return 0.0;
    vec2 radius = max(uWizardShadowRadius, vec2(0.0001));
    vec2 local = vec2(
        wrappedDelta(uWizardShadowWorld.x, seedWorld.x, uLosWrapEnabled.x, uLosMapSize.x),
        wrappedDelta(uWizardShadowWorld.y, seedWorld.y, uLosWrapEnabled.y, uLosMapSize.y)
    ) / radius;
    float dist = length(local);
    return dist <= 1.0 ? clamp(uWizardShadowOpacity, 0.0, 1.0) : 0.0;
}

float grassShadowShade(vec2 seedWorld) {
    float losCoverage = losShadowCoverageForSeed(seedWorld);
    float wizardCoverage = wizardShadowCoverageForSeed(seedWorld);
    float shade = mix(1.0, clamp(uLosShadowFactor, 0.0, 1.0), losCoverage);
    shade *= mix(1.0, clamp(uWizardShadowFactor, 0.0, 1.0), wizardCoverage);
    return shade;
}

void main(void) {
    vec2 screenSize = max(uScreenSize, vec2(1.0));
    float maxHeight = max(1.0, uMaxBladeHeightPx);
    float stepPx = max(1.0, uStepPx);
    float maxStepCount = ceil(maxHeight / stepPx);
    float baseHalfWidth = clamp(uBladeBaseHalfWidthPx, 0.0, float(MAX_GRASS_HALF_WIDTH_STEPS));
    float bestAlong = -1.0;
    vec2 bestSeedScreen = vec2(0.0);
    float bestSeedCoverage = 0.0;

    for (int i = 0; i < MAX_GRASS_DEPTH_STEPS; i++) {
        float fi = float(i);
        if (fi > maxStepCount) break;
        float along = fi * stepPx;
        float normalizedAlong = clamp(along / maxHeight, 0.0, 1.0);
        float sway = sin(uTimeSeconds * 1.35 + vScreenPosition.x * 0.027 + along * 0.071) *
            uSwayPx * normalizedAlong;
        float allowedHalfWidth = baseHalfWidth * (1.0 - normalizedAlong);
        for (int wi = -MAX_GRASS_HALF_WIDTH_STEPS; wi <= MAX_GRASS_HALF_WIDTH_STEPS; wi++) {
            float side = float(wi);
            if (abs(side) > allowedHalfWidth + 0.5) continue;
            vec2 seedScreen = vScreenPosition + vec2(side - sway, along);
            if (
                seedScreen.x < 0.0 ||
                seedScreen.y < 0.0 ||
                seedScreen.x > screenSize.x ||
                seedScreen.y > screenSize.y
            ) {
                continue;
            }

            vec2 maskUv = rootMaskUvForWorld(seedScreenToWorld(seedScreen));
            if (
                maskUv.x < 0.0 ||
                maskUv.y < 0.0 ||
                maskUv.x > 1.0 ||
                maskUv.y > 1.0
            ) {
                continue;
            }
            float rootMask = texture(uRootMask, maskUv).r;
            if (rootMask <= uRootMaskThreshold) continue;

            vec2 seedWorld = seedScreenToSnappedWorld(seedScreen);
            vec2 seedUv = fract(seedWorld * uSeedWorldScale);
            float seedCoverage = sampleNearestSeedCoverage(seedUv);
            if (seedCoverage <= uAlphaCutoff) continue;

            bestAlong = along;
            bestSeedScreen = seedScreen;
            bestSeedCoverage = seedCoverage;
        }
    }

    if (bestAlong < 0.0) discard;
    if (bestAlong <= 0.5) discard;

    float alpha = bestSeedCoverage * uTint.a;
    if (alpha <= uAlphaCutoff) discard;

    vec2 seedWorld = seedScreenToWorld(bestSeedScreen);
    gl_FragDepth = depthForSeedWorld(seedWorld);
    float shade = grassShadowShade(seedWorld);
    fragColor = vec4(uTint.rgb * shade * alpha, alpha);
}
`;

    global.RenderingGrassDepthShaders = {
        vertexWebgl2: GRASS_DEPTH_VERTEX_WEBGL2,
        fragmentWebgl2: GRASS_DEPTH_FRAGMENT_WEBGL2
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
