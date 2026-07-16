export const VERT_FULLSCREEN = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`

export const VERT_QUAD = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
uniform mat3 uModel;
out vec2 vUv;
void main() {
    vUv = aUv;
    vec3 p = uModel * vec3(aPos, 1.0);
    gl_Position = vec4(p.xy, 0.0, 1.0);
}
`

const LUMA = `float luma(vec3 c) { return dot(c, vec3(0.2627, 0.678, 0.0593)); }`

const SRGB = `
vec3 oetf(vec3 x) {
    x = clamp(x, 0.0, 1.0);
    return mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x));
}
vec3 eotf(vec3 x) {
    return mix(x / 12.92, pow((x + 0.055) / 1.055, vec3(2.4)), step(0.04045, x));
}
`

const HSV = `
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`

const LUT3D = `
uniform sampler2D uLut;
uniform float uLutSize;
vec3 sampleDisplayLut(vec3 rgb) {
    float n = uLutSize;
    float w = n * n;
    vec3 c = clamp(rgb, 0.0, 1.0);
    float bCoord = c.b * (n - 1.0);
    float b0 = floor(bCoord);
    float b1 = min(b0 + 1.0, n - 1.0);
    float bf = bCoord - b0;
    float xr = 0.5 + c.r * (n - 1.0);
    float v = (0.5 + c.g * (n - 1.0)) / n;
    vec3 s0 = texture(uLut, vec2((b0 * n + xr) / w, v)).rgb;
    vec3 s1 = texture(uLut, vec2((b1 * n + xr) / w, v)).rgb;
    return mix(s0, s1, bf);
}
`

export const FRAG_PASS1 = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform mat3 uColorMatrix;
uniform vec3 uWbGain;
out vec4 o;
void main() {
    vec3 c = texture(uTex, vUv).rgb;
    o = vec4(uColorMatrix * (uWbGain * c), 1.0);
}
`

export const FRAG_PASS2 = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform mat3 uWarp;
uniform vec2 uTexSize;
uniform vec2 uLensNorm;
uniform int uLensActive;
uniform int uLensHasProfile;
uniform int uDistModel;
uniform vec3 uDistCoeffs;
uniform float uDistStrength;
uniform int uLensHasTca;
uniform int uTcaModel;
uniform vec3 uTcaR;
uniform vec3 uTcaB;
uniform float uTcaStrength;
uniform int uLensHasVig;
uniform vec3 uVigCoeffs;
uniform float uVigStrength;
uniform float uManualDist;
uniform float uManualVig;
out vec4 o;
float cmrw(float x) {
    x = abs(x);
    float x2 = x * x;
    float x3 = x2 * x;
    if (x < 1.0) return 1.5 * x3 - 2.5 * x2 + 1.0;
    if (x < 2.0) return -0.5 * x3 + 2.5 * x2 - 4.0 * x + 2.0;
    return 0.0;
}
vec3 sampleBicubic(vec2 uv) {
    vec2 coord = uv * uTexSize - 0.5;
    vec2 base = floor(coord);
    vec2 f = coord - base;
    ivec2 hi = ivec2(uTexSize) - 1;
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    for (int j = -1; j <= 2; j++) {
        float wy = cmrw(float(j) - f.y);
        for (int i = -1; i <= 2; i++) {
            float w = cmrw(float(i) - f.x) * wy;
            ivec2 t = clamp(ivec2(base) + ivec2(i, j), ivec2(0), hi);
            sum += texelFetch(uTex, t, 0).rgb * w;
            wsum += w;
        }
    }
    return sum / wsum;
}
float distRatio(float ru) {
    float ru2 = ru * ru;
    if (uDistModel == 1) return 1.0 + uDistCoeffs.x * ru2 + uDistCoeffs.y * ru2 * ru2;
    if (uDistModel == 2) {
        float a = uDistCoeffs.x;
        float b = uDistCoeffs.y;
        float c = uDistCoeffs.z;
        return a * ru2 * ru + b * ru2 + c * ru + (1.0 - a - b - c);
    }
    float k1 = uDistCoeffs.x;
    return (1.0 - k1) + k1 * ru2;
}
float tcaScale(vec3 t, float ru) {
    if (uTcaModel == 1) return t.z * ru * ru + t.y * ru + t.x;
    return t.x;
}
void main() {
    vec3 p = uWarp * vec3(vUv - 0.5, 1.0);
    vec2 gUv = p.xy / p.z + 0.5;
    if (any(lessThan(gUv, vec2(0.0))) || any(greaterThan(gUv, vec2(1.0)))) {
        o = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    if (uLensActive == 0) {
        o = vec4(texture(uTex, gUv).rgb, 1.0);
        return;
    }
    vec2 d = gUv - 0.5;
    vec2 n = d * uLensNorm;
    float ru = length(n);
    vec3 color;
    if (uLensHasProfile == 1) {
        float dr = mix(1.0, distRatio(ru), uDistStrength);
        vec2 baseSrc = 0.5 + d * dr;
        color = sampleBicubic(baseSrc);
        if (uLensHasTca == 1) {
            float sr = mix(1.0, tcaScale(uTcaR, ru), uTcaStrength);
            float sb = mix(1.0, tcaScale(uTcaB, ru), uTcaStrength);
            color.r = sampleBicubic(0.5 + (baseSrc - 0.5) * sr).r;
            color.b = sampleBicubic(0.5 + (baseSrc - 0.5) * sb).b;
        }
        if (uLensHasVig == 1) {
            vec2 ns = (baseSrc - 0.5) * uLensNorm;
            float rs2 = dot(ns, ns);
            float gainPoly = 1.0 + uVigCoeffs.x * rs2 + uVigCoeffs.y * rs2 * rs2 + uVigCoeffs.z * rs2 * rs2 * rs2;
            color /= max(mix(1.0, gainPoly, uVigStrength), 0.05);
        }
    } else {
        float dr = 1.0 + uManualDist * 0.3 * ru * ru;
        color = sampleBicubic(0.5 + d * dr);
        color *= max(1.0 + uManualVig * 0.6 * ru * ru, 0.05);
    }
    o = vec4(max(color, vec3(0.0)), 1.0);
}
`

export const FRAG_PASS3 = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uExposure;
uniform float uHighlightRecovery;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uContrastK;
out vec4 o;
${LUMA}
void main() {
    vec3 c = texture(uTex, vUv).rgb * uExposure;
    if (uHighlightRecovery > 0.0) c = c / (1.0 + uHighlightRecovery * max(c - 1.0, 0.0));
    float y = luma(c);
    float hi = smoothstep(0.5, 0.9, y);
    float lo = 1.0 - smoothstep(0.1, 0.45, y);
    c *= exp2(uHighlights * hi);
    c *= exp2(uShadows * lo);
    float pivot = 0.18;
    c = pivot * pow(max(c, vec3(1e-5)) / pivot, vec3(uContrastK));
    c *= 1.0 + uWhites * 0.3 * smoothstep(0.3, 1.0, y);
    c += uBlacks * 0.05 * (1.0 - smoothstep(0.0, 0.3, y));
    o = vec4(max(c, vec3(0.0)), 1.0);
}
`

export const FRAG_PASS4 = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uBase;
uniform sampler2D uTone;
out vec4 o;
float oetf1(float x) {
    x = clamp(x, 0.0, 1.0);
    return x <= 0.0031308 ? x * 12.92 : 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}
float eotf1(float x) {
    return x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4);
}
float applyChannel(float lin, int ch) {
    float e = texture(uBase, vec2(oetf1(lin), 0.5)).r;
    float comp = texture(uTone, vec2(e, 0.5)).a;
    vec4 t = texture(uTone, vec2(comp, 0.5));
    return eotf1(ch == 0 ? t.r : ch == 1 ? t.g : t.b);
}
void main() {
    vec3 c = texture(uTex, vUv).rgb;
    o = vec4(applyChannel(c.r, 0), applyChannel(c.g, 1), applyChannel(c.b, 2), 1.0);
}
`

export const FRAG_PASS5 = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uHue[8];
uniform float uSat[8];
uniform float uLum[8];
uniform float uVibrance;
uniform float uSaturation;
uniform int uBw;
out vec4 o;
const float BAND[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0);
${LUMA}
${HSV}
float angDist(float a, float b) {
    float d = abs(a - b);
    return min(d, 360.0 - d);
}
void main() {
    vec3 c = max(texture(uTex, vUv).rgb, vec3(0.0));
    vec3 hsv = rgb2hsv(c);
    float deg = hsv.x * 360.0;
    float hueShift = 0.0;
    float satMul = 0.0;
    float lumMul = 0.0;
    for (int i = 0; i < 8; i++) {
        float dist = angDist(deg, BAND[i]);
        float w = dist < 60.0 ? 0.5 * (1.0 + cos(3.14159265 * dist / 60.0)) : 0.0;
        hueShift += w * uHue[i];
        satMul += w * uSat[i];
        lumMul += w * uLum[i];
    }
    hsv.x = fract(hsv.x + hueShift * (30.0 / 360.0));
    hsv.y = clamp(hsv.y * (1.0 + satMul), 0.0, 4.0);
    hsv.z = max(hsv.z * (1.0 + lumMul), 0.0);
    c = hsv2rgb(hsv);
    if (uBw == 1) {
        float g = luma(c) * (1.0 + lumMul);
        o = vec4(vec3(max(g, 0.0)), 1.0);
        return;
    }
    float y = luma(c);
    vec3 hv = rgb2hsv(max(c, vec3(0.0)));
    float protect = clamp(abs(hv.x * 360.0 - 35.0) / 20.0, 0.0, 1.0);
    float vib = uVibrance * (1.0 - hv.y) * protect;
    c = mix(vec3(y), c, clamp(1.0 + vib, 0.0, 4.0));
    c = mix(vec3(y), c, clamp(1.0 + uSaturation, 0.0, 4.0));
    o = vec4(max(c, vec3(0.0)), 1.0);
}
`

export const FRAG_NR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uNrLuma;
uniform float uNrLumaDetail;
uniform float uNrLumaContrast;
uniform float uNrColor;
uniform float uNrColorDetail;
out vec4 o;
${LUMA}
void main() {
    vec3 c = texture(uTex, vUv).rgb;
    float y0 = luma(c);
    vec3 chroma0 = c - y0;
    float thr = mix(0.05, 0.004, uNrLumaDetail);
    float dilations[3] = float[3](1.0, 2.0, 4.0);
    float weights[3] = float[3](0.5, 0.3, 0.2);
    vec2 dirs[4] = vec2[4](vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0));
    float sumY = y0;
    float sumW = 1.0;
    vec3 sumC = chroma0;
    float sumCW = 1.0;
    for (int l = 0; l < 3; l++) {
        for (int k = 0; k < 4; k++) {
            vec2 off = dirs[k] * dilations[l] * uTexel;
            vec3 s = texture(uTex, vUv + off).rgb;
            float ys = luma(s);
            float rw = exp(-(ys - y0) * (ys - y0) / (2.0 * thr * thr)) * weights[l];
            sumY += ys * rw;
            sumW += rw;
            float cthr = mix(0.2, 0.02, uNrColorDetail);
            vec3 cs = s - ys;
            float cw = exp(-dot(cs - chroma0, cs - chroma0) / (2.0 * cthr * cthr)) * weights[l];
            sumC += cs * cw;
            sumCW += cw;
        }
    }
    float yd = sumY / sumW;
    float ynew = mix(y0, yd, uNrLuma);
    ynew = mix(ynew, y0, uNrLumaContrast * (1.0 - uNrLuma) * 0.5);
    vec3 chroma = mix(chroma0, sumC / sumCW, uNrColor);
    o = vec4(max(vec3(ynew) + chroma, vec3(0.0)), 1.0);
}
`

export const FRAG_SHARPEN = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uAmount;
uniform float uRadius;
uniform float uDetail;
uniform float uMasking;
out vec4 o;
${LUMA}
void main() {
    vec3 c = texture(uTex, vUv).rgb;
    float y = luma(c);
    float r = uRadius;
    float blur = y * 0.25;
    blur += luma(texture(uTex, vUv + vec2(uTexel.x, 0.0) * r).rgb) * 0.125;
    blur += luma(texture(uTex, vUv - vec2(uTexel.x, 0.0) * r).rgb) * 0.125;
    blur += luma(texture(uTex, vUv + vec2(0.0, uTexel.y) * r).rgb) * 0.125;
    blur += luma(texture(uTex, vUv - vec2(0.0, uTexel.y) * r).rgb) * 0.125;
    blur += luma(texture(uTex, vUv + uTexel * r).rgb) * 0.0625;
    blur += luma(texture(uTex, vUv - uTexel * r).rgb) * 0.0625;
    blur += luma(texture(uTex, vUv + vec2(uTexel.x, -uTexel.y) * r).rgb) * 0.0625;
    blur += luma(texture(uTex, vUv + vec2(-uTexel.x, uTexel.y) * r).rgb) * 0.0625;
    float detail = y - blur;
    float grad = length(vec2(dFdx(y), dFdy(y))) * 40.0;
    float mask = mix(1.0, smoothstep(0.0, 1.0, grad), uMasking);
    float amt = uAmount * mix(0.6, 1.6, uDetail);
    float yn = y + amt * detail * mask;
    o = vec4(max(c * (yn / max(y, 1e-4)), vec3(0.0)), 1.0);
}
`

export const FRAG_PASS7 = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uClarity;
uniform float uDehaze;
uniform float uVignetteAmount;
uniform float uVignetteMidpoint;
uniform float uVignetteRoundness;
uniform float uVignetteFeather;
uniform float uGrainAmount;
uniform float uGrainSize;
uniform float uGrainRoughness;
uniform float uSeed;
out vec4 o;
${LUMA}
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
void main() {
    vec3 c = texture(uTex, vUv).rgb;
    float y = luma(c);
    if (uClarity != 0.0) {
        float blur = 0.0;
        float radii[3] = float[3](8.0, 16.0, 24.0);
        for (int i = 0; i < 3; i++) {
            blur += luma(texture(uTex, vUv + vec2(radii[i], 0.0) * uTexel).rgb);
            blur += luma(texture(uTex, vUv - vec2(radii[i], 0.0) * uTexel).rgb);
            blur += luma(texture(uTex, vUv + vec2(0.0, radii[i]) * uTexel).rgb);
            blur += luma(texture(uTex, vUv - vec2(0.0, radii[i]) * uTexel).rgb);
        }
        blur /= 12.0;
        float local = y - blur;
        float mid = clamp(1.0 - abs(y - 0.4) * 2.0, 0.0, 1.0);
        float yc = y + uClarity * local * mid;
        c *= yc / max(y, 1e-4);
        y = luma(c);
    }
    if (uDehaze != 0.0) {
        float dc = min(min(c.r, c.g), c.b);
        c = c + uDehaze * (c - dc) * 0.5;
        float yd = luma(c);
        c = mix(vec3(yd), c, 1.0 + uDehaze * 0.2);
        c = max(c, vec3(0.0));
    }
    if (uVignetteAmount != 0.0) {
        vec2 d = vUv - 0.5;
        float linf = max(abs(d.x), abs(d.y)) * 1.41421356;
        float l2 = length(d);
        float rr = mix(linf, l2, (uVignetteRoundness + 100.0) / 200.0);
        float mid = uVignetteMidpoint / 100.0 * 0.7;
        float feather = uVignetteFeather / 100.0 * 0.6 + 0.02;
        float v = smoothstep(mid, mid + feather, rr);
        c *= 1.0 + uVignetteAmount * v * (uVignetteAmount < 0.0 ? 1.0 : 0.6);
        c = max(c, vec3(0.0));
    }
    if (uGrainAmount != 0.0) {
        vec2 gp = vUv / uTexel;
        float scale = mix(0.5, 4.0, uGrainSize / 100.0);
        float n = hash(floor(gp / scale) + uSeed);
        float n2 = hash(floor(gp / scale) * 1.7 + uSeed * 2.0);
        float grain = mix(n, n2, uGrainRoughness / 100.0) - 0.5;
        c += grain * uGrainAmount * 0.2;
        c = max(c, vec3(0.0));
    }
    o = vec4(c, 1.0);
}
`

export const FRAG_PASS8 = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uBaseTex;
uniform int uSourceKind;
uniform int uDisplayP3;
uniform mat3 uRec2020ToDisplay;
uniform mat3 uSrgbToDisplay;
uniform int uClipMode;
uniform int uHasBase;
uniform int uUseLut;
uniform vec3 uSplit;
uniform int uCropMode;
uniform vec4 uCrop;
uniform vec2 uCanvas;
out vec4 o;
${SRGB}
${LUT3D}
void main() {
    vec2 screen = gl_FragCoord.xy / uCanvas;
    float axisCoord = uSplit.y < 0.5 ? screen.x : 1.0 - screen.y;
    bool beforeSide = uSplit.x > 0.5 && axisCoord < uSplit.z;
    vec3 lin = beforeSide && uHasBase == 1 ? texture(uBaseTex, vUv).rgb : texture(uTex, vUv).rgb;
    bool clipHi = all(greaterThanEqual(lin, vec3(1.0)));
    bool clipLo = all(lessThanEqual(lin, vec3(0.0)));
    vec3 c = lin;
    if (uSourceKind == 0) {
        if (uUseLut == 1) {
            c = sampleDisplayLut(c);
        } else {
            c = uRec2020ToDisplay * c;
            c = oetf(c);
        }
    } else if (uDisplayP3 == 1) {
        vec3 l = eotf(c);
        l = uSrgbToDisplay * l;
        c = oetf(l);
    }
    if (uCropMode > 0) {
        bool inside = vUv.x >= uCrop.x && vUv.y >= uCrop.y && vUv.x <= uCrop.z && vUv.y <= uCrop.w;
        if (!inside) c *= uCropMode == 2 ? 0.4 : 0.0;
    }
    if ((uClipMode == 1 || uClipMode == 2) && clipHi) c = vec3(1.0, 0.0, 0.0);
    if ((uClipMode == 1 || uClipMode == 3) && clipLo) c = vec3(0.0, 0.0, 1.0);
    if (uSplit.x > 0.5 && abs(axisCoord - uSplit.z) < 0.0015) c = vec3(1.0);
    o = vec4(c, 1.0);
}
`

export const VERT_TILE = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform mat3 uModel;
out vec2 vSrcUv;
void main() {
    vec3 p = uModel * vec3(aPos, 1.0);
    vSrcUv = p.xy * 0.5 + 0.5;
    gl_Position = vec4(p.xy, 0.0, 1.0);
}
`

export const FRAG_TILE = `#version 300 es
precision highp float;
in vec2 vSrcUv;
uniform sampler2D uTile;
uniform vec2 uSrcOrigin;
uniform vec2 uUvOffset;
uniform vec2 uUvScale;
out vec4 o;
void main() {
    vec2 uv = uUvOffset + (vSrcUv - uSrcOrigin) * uUvScale;
    o = vec4(texture(uTile, uv).rgb, 1.0);
}
`

export const FRAG_HISTO = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform mat3 uRec2020ToDisplay;
out vec4 o;
${SRGB}
${LUMA}
void main() {
    vec3 lin = texture(uTex, vUv).rgb;
    vec3 d = oetf(uRec2020ToDisplay * lin);
    float y = clamp(luma(lin), 0.0, 1.0);
    o = vec4(d, oetf(vec3(y)).x);
}
`
