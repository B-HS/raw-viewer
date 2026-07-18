const COMMON = /* wgsl */ `
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2627, 0.678, 0.0593)); }
fn oetf(x: vec3f) -> vec3f {
    let c = clamp(x, vec3f(0.0), vec3f(1.0));
    return mix(c * 12.92, 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, step(vec3f(0.0031308), c));
}
fn eotf(x: vec3f) -> vec3f {
    return mix(x / 12.92, pow((x + 0.055) / 1.055, vec3f(2.4)), step(vec3f(0.04045), x));
}
fn rgb2hsv(c: vec3f) -> vec3f {
    let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
    let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
fn hsv2rgb(c: vec3f) -> vec3f {
    let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}
`

const FULLSCREEN_VERT = /* wgsl */ `
struct VsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) index: u32) -> VsOut {
    var corners = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
    let p = corners[index];
    var out: VsOut;
    out.pos = vec4f(p, 0.0, 1.0);
    out.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    return out;
}
`

export const WGSL_PASS1 = /* wgsl */ `
${FULLSCREEN_VERT}
struct U { colorMatrix: mat3x3f, wbGain: vec3f }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    let c = textureSampleLevel(tex, samp, in.uv, 0.0).rgb;
    return vec4f(u.colorMatrix * (u.wbGain * c), 1.0);
}
`

export const WGSL_PASS2 = /* wgsl */ `
${FULLSCREEN_VERT}
struct U {
    warp: mat3x3f,
    texSize: vec2f,
    lensNorm: vec2f,
    distCoeffs: vec3f,
    lensActive: f32,
    tcaR: vec3f,
    lensHasProfile: f32,
    tcaB: vec3f,
    distModel: f32,
    vigCoeffs: vec3f,
    distStrength: f32,
    lensHasTca: f32,
    tcaModel: f32,
    tcaStrength: f32,
    lensHasVig: f32,
    vigStrength: f32,
    manualDist: f32,
    manualVig: f32,
    pad: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
fn cmrw(v: f32) -> f32 {
    let x = abs(v);
    let x2 = x * x;
    let x3 = x2 * x;
    if (x < 1.0) { return 1.5 * x3 - 2.5 * x2 + 1.0; }
    if (x < 2.0) { return -0.5 * x3 + 2.5 * x2 - 4.0 * x + 2.0; }
    return 0.0;
}
fn sampleBicubic(uv: vec2f) -> vec3f {
    let coord = uv * u.texSize - 0.5;
    let base = floor(coord);
    let f = coord - base;
    let hi = vec2i(u.texSize) - 1;
    var sum = vec3f(0.0);
    var wsum = 0.0;
    for (var j = -1; j <= 2; j++) {
        let wy = cmrw(f32(j) - f.y);
        for (var i = -1; i <= 2; i++) {
            let w = cmrw(f32(i) - f.x) * wy;
            let t = clamp(vec2i(base) + vec2i(i, j), vec2i(0), hi);
            sum += textureLoad(tex, t, 0).rgb * w;
            wsum += w;
        }
    }
    return sum / wsum;
}
fn distRatio(ru: f32) -> f32 {
    let ru2 = ru * ru;
    if (u.distModel == 1.0) { return 1.0 + u.distCoeffs.x * ru2 + u.distCoeffs.y * ru2 * ru2; }
    if (u.distModel == 2.0) {
        let a = u.distCoeffs.x;
        let b = u.distCoeffs.y;
        let c = u.distCoeffs.z;
        return a * ru2 * ru + b * ru2 + c * ru + (1.0 - a - b - c);
    }
    let k1 = u.distCoeffs.x;
    return (1.0 - k1) + k1 * ru2;
}
fn tcaScale(t: vec3f, ru: f32) -> f32 {
    if (u.tcaModel == 1.0) { return t.z * ru * ru + t.y * ru + t.x; }
    return t.x;
}
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    let p = u.warp * vec3f(in.uv - 0.5, 1.0);
    let gUv = p.xy / p.z + 0.5;
    if (any(gUv < vec2f(0.0)) || any(gUv > vec2f(1.0))) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    if (u.lensActive == 0.0) { return vec4f(textureSampleLevel(tex, samp, gUv, 0.0).rgb, 1.0); }
    let d = gUv - 0.5;
    let n = d * u.lensNorm;
    let ru = length(n);
    var color: vec3f;
    if (u.lensHasProfile == 1.0) {
        let dr = mix(1.0, distRatio(ru), u.distStrength);
        let baseSrc = 0.5 + d * dr;
        color = sampleBicubic(baseSrc);
        if (u.lensHasTca == 1.0) {
            let sr = mix(1.0, tcaScale(u.tcaR, ru), u.tcaStrength);
            let sb = mix(1.0, tcaScale(u.tcaB, ru), u.tcaStrength);
            color.r = sampleBicubic(0.5 + (baseSrc - 0.5) * sr).r;
            color.b = sampleBicubic(0.5 + (baseSrc - 0.5) * sb).b;
        }
        if (u.lensHasVig == 1.0) {
            let ns = (baseSrc - 0.5) * u.lensNorm;
            let rs2 = dot(ns, ns);
            let gainPoly = 1.0 + u.vigCoeffs.x * rs2 + u.vigCoeffs.y * rs2 * rs2 + u.vigCoeffs.z * rs2 * rs2 * rs2;
            color /= max(mix(1.0, gainPoly, u.vigStrength), 0.05);
        }
    } else {
        let dr = 1.0 + u.manualDist * 0.3 * ru * ru;
        color = sampleBicubic(0.5 + d * dr);
        color *= max(1.0 + u.manualVig * 0.6 * ru * ru, 0.05);
    }
    return vec4f(max(color, vec3f(0.0)), 1.0);
}
`

export const WGSL_PASS3 = /* wgsl */ `
${FULLSCREEN_VERT}
${COMMON}
struct U {
    exposure: f32,
    highlightRecovery: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    contrastK: f32,
    pad: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    var c = textureSampleLevel(tex, samp, in.uv, 0.0).rgb * u.exposure;
    if (u.highlightRecovery > 0.0) { c = c / (1.0 + u.highlightRecovery * max(c - 1.0, vec3f(0.0))); }
    let y = luma(c);
    let hi = smoothstep(0.5, 0.9, y);
    let lo = 1.0 - smoothstep(0.1, 0.45, y);
    c *= exp2(u.highlights * hi);
    c *= exp2(u.shadows * lo);
    let pivot = 0.18;
    c = pivot * pow(max(c, vec3f(1e-5)) / pivot, vec3f(u.contrastK));
    c *= 1.0 + u.whites * 0.3 * smoothstep(0.3, 1.0, y);
    c += u.blacks * 0.05 * (1.0 - smoothstep(0.0, 0.3, y));
    return vec4f(max(c, vec3f(0.0)), 1.0);
}
`

export const WGSL_PASS4 = /* wgsl */ `
${FULLSCREEN_VERT}
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var baseLut: texture_2d<f32>;
@group(0) @binding(2) var toneLut: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
fn oetf1(v: f32) -> f32 {
    let x = clamp(v, 0.0, 1.0);
    return select(1.055 * pow(x, 1.0 / 2.4) - 0.055, x * 12.92, x <= 0.0031308);
}
fn eotf1(x: f32) -> f32 {
    return select(pow((x + 0.055) / 1.055, 2.4), x / 12.92, x <= 0.04045);
}
fn applyChannel(lin: f32, ch: i32) -> f32 {
    let e = textureSampleLevel(baseLut, samp, vec2f(oetf1(lin), 0.5), 0.0).r;
    let comp = textureSampleLevel(toneLut, samp, vec2f(e, 0.5), 0.0).a;
    let t = textureSampleLevel(toneLut, samp, vec2f(comp, 0.5), 0.0);
    var v: f32;
    if (ch == 0) { v = t.r; } else if (ch == 1) { v = t.g; } else { v = t.b; }
    return eotf1(v);
}
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    let c = textureSampleLevel(tex, samp, in.uv, 0.0).rgb;
    return vec4f(applyChannel(c.r, 0), applyChannel(c.g, 1), applyChannel(c.b, 2), 1.0);
}
`

export const WGSL_PASS5 = /* wgsl */ `
${FULLSCREEN_VERT}
${COMMON}
struct U {
    hue0: vec4f,
    hue1: vec4f,
    sat0: vec4f,
    sat1: vec4f,
    lum0: vec4f,
    lum1: vec4f,
    vibrance: f32,
    saturation: f32,
    bw: f32,
    pad: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
fn angDist(a: f32, b: f32) -> f32 {
    let d = abs(a - b);
    return min(d, 360.0 - d);
}
fn bandValue(v0: vec4f, v1: vec4f, i: i32) -> f32 {
    if (i < 4) { return v0[i]; }
    return v1[i - 4];
}
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    var BAND = array<f32, 8>(0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0);
    var c = max(textureSampleLevel(tex, samp, in.uv, 0.0).rgb, vec3f(0.0));
    var hsv = rgb2hsv(c);
    let deg = hsv.x * 360.0;
    var hueShift = 0.0;
    var satMul = 0.0;
    var lumMul = 0.0;
    for (var i = 0; i < 8; i++) {
        let dist = angDist(deg, BAND[i]);
        var w = 0.0;
        if (dist < 60.0) { w = 0.5 * (1.0 + cos(3.14159265 * dist / 60.0)); }
        hueShift += w * bandValue(u.hue0, u.hue1, i);
        satMul += w * bandValue(u.sat0, u.sat1, i);
        lumMul += w * bandValue(u.lum0, u.lum1, i);
    }
    hsv.x = fract(hsv.x + hueShift * (30.0 / 360.0));
    hsv.y = clamp(hsv.y * (1.0 + satMul), 0.0, 4.0);
    hsv.z = max(hsv.z * (1.0 + lumMul), 0.0);
    c = hsv2rgb(hsv);
    if (u.bw == 1.0) {
        let g = luma(c) * (1.0 + lumMul);
        return vec4f(vec3f(max(g, 0.0)), 1.0);
    }
    let y = luma(c);
    let hv = rgb2hsv(max(c, vec3f(0.0)));
    let protect = clamp(abs(hv.x * 360.0 - 35.0) / 20.0, 0.0, 1.0);
    let vib = u.vibrance * (1.0 - hv.y) * protect;
    c = mix(vec3f(y), c, clamp(1.0 + vib, 0.0, 4.0));
    c = mix(vec3f(y), c, clamp(1.0 + u.saturation, 0.0, 4.0));
    return vec4f(max(c, vec3f(0.0)), 1.0);
}
`

export const NR_COMPUTE_RADIUS = 4
export const NR_COMPUTE_SIGMA_SPATIAL = 2.0
export const NR_COMPUTE_WORKGROUP = 16

export const WGSL_NR_COMPUTE = /* wgsl */ `
struct U {
    size: vec2f,
    nrLuma: f32,
    nrLumaDetail: f32,
    nrLumaContrast: f32,
    nrColor: f32,
    nrColorDetail: f32,
    pad: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;
const RADIUS: i32 = ${NR_COMPUTE_RADIUS};
const GROUP: i32 = ${NR_COMPUTE_WORKGROUP};
const TILE: i32 = GROUP + 2 * RADIUS;
const SIGMA_S: f32 = ${NR_COMPUTE_SIGMA_SPATIAL};
var<workgroup> tileRgb: array<vec3f, ${(NR_COMPUTE_WORKGROUP + 2 * NR_COMPUTE_RADIUS) * (NR_COMPUTE_WORKGROUP + 2 * NR_COMPUTE_RADIUS)}>;
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2627, 0.678, 0.0593)); }
@compute @workgroup_size(${NR_COMPUTE_WORKGROUP}, ${NR_COMPUTE_WORKGROUP})
fn cs(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u, @builtin(local_invocation_index) lindex: u32) {
    let origin = vec2i(wid.xy) * GROUP - RADIUS;
    let maxCoord = vec2i(u.size) - 1;
    var index = i32(lindex);
    while (index < TILE * TILE) {
        let t = origin + vec2i(index % TILE, index / TILE);
        tileRgb[index] = textureLoad(src, clamp(t, vec2i(0), maxCoord), 0).rgb;
        index += GROUP * GROUP;
    }
    workgroupBarrier();
    let gid = vec2i(wid.xy) * GROUP + vec2i(lid.xy);
    if (gid.x > maxCoord.x || gid.y > maxCoord.y) { return; }
    let local = vec2i(lid.xy) + RADIUS;
    let center = tileRgb[local.y * TILE + local.x];
    let y0 = luma(center);
    let chroma0 = center - y0;
    let thr = mix(0.05, 0.004, u.nrLumaDetail);
    let cthr = mix(0.2, 0.02, u.nrColorDetail);
    var sumY = 0.0;
    var sumW = 0.0;
    var sumC = vec3f(0.0);
    var sumCW = 0.0;
    for (var dy = -RADIUS; dy <= RADIUS; dy++) {
        for (var dx = -RADIUS; dx <= RADIUS; dx++) {
            let s = tileRgb[(local.y + dy) * TILE + (local.x + dx)];
            let ys = luma(s);
            let sw = exp(-f32(dx * dx + dy * dy) / (2.0 * SIGMA_S * SIGMA_S));
            let rw = exp(-(ys - y0) * (ys - y0) / (2.0 * thr * thr)) * sw;
            sumY += ys * rw;
            sumW += rw;
            let cs = s - ys;
            let dc = cs - chroma0;
            let cw = exp(-dot(dc, dc) / (2.0 * cthr * cthr)) * sw;
            sumC += cs * cw;
            sumCW += cw;
        }
    }
    let yd = sumY / sumW;
    var ynew = mix(y0, yd, u.nrLuma);
    ynew = mix(ynew, y0, u.nrLumaContrast * (1.0 - u.nrLuma) * 0.5);
    let chroma = mix(chroma0, sumC / sumCW, u.nrColor);
    textureStore(dst, gid, vec4f(max(vec3f(ynew) + chroma, vec3f(0.0)), 1.0));
}
`

export const WGSL_SHARPEN = /* wgsl */ `
${FULLSCREEN_VERT}
${COMMON}
struct U {
    texel: vec2f,
    amount: f32,
    radius: f32,
    detail: f32,
    masking: f32,
    pad0: f32,
    pad1: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    let c = textureSampleLevel(tex, samp, in.uv, 0.0).rgb;
    let y = luma(c);
    let r = u.radius;
    var blur = y * 0.25;
    blur += luma(textureSampleLevel(tex, samp, in.uv + vec2f(u.texel.x, 0.0) * r, 0.0).rgb) * 0.125;
    blur += luma(textureSampleLevel(tex, samp, in.uv - vec2f(u.texel.x, 0.0) * r, 0.0).rgb) * 0.125;
    blur += luma(textureSampleLevel(tex, samp, in.uv + vec2f(0.0, u.texel.y) * r, 0.0).rgb) * 0.125;
    blur += luma(textureSampleLevel(tex, samp, in.uv - vec2f(0.0, u.texel.y) * r, 0.0).rgb) * 0.125;
    blur += luma(textureSampleLevel(tex, samp, in.uv + u.texel * r, 0.0).rgb) * 0.0625;
    blur += luma(textureSampleLevel(tex, samp, in.uv - u.texel * r, 0.0).rgb) * 0.0625;
    blur += luma(textureSampleLevel(tex, samp, in.uv + vec2f(u.texel.x, -u.texel.y) * r, 0.0).rgb) * 0.0625;
    blur += luma(textureSampleLevel(tex, samp, in.uv + vec2f(-u.texel.x, u.texel.y) * r, 0.0).rgb) * 0.0625;
    let detail = y - blur;
    let grad = length(vec2f(dpdx(y), dpdy(y))) * 40.0;
    let mask = mix(1.0, smoothstep(0.0, 1.0, grad), u.masking);
    let amt = u.amount * mix(0.6, 1.6, u.detail);
    let yn = y + amt * detail * mask;
    return vec4f(max(c * (yn / max(y, 1e-4)), vec3f(0.0)), 1.0);
}
`

export const WGSL_PASS7 = /* wgsl */ `
${FULLSCREEN_VERT}
${COMMON}
struct U {
    texel: vec2f,
    clarity: f32,
    dehaze: f32,
    vignetteAmount: f32,
    vignetteMidpoint: f32,
    vignetteRoundness: f32,
    vignetteFeather: f32,
    grainAmount: f32,
    grainSize: f32,
    grainRoughness: f32,
    seed: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
fn hash(v: vec2f) -> f32 {
    var p = fract(v * vec2f(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    var c = textureSampleLevel(tex, samp, in.uv, 0.0).rgb;
    var y = luma(c);
    if (u.clarity != 0.0) {
        var blur = 0.0;
        var radii = array<f32, 3>(8.0, 16.0, 24.0);
        for (var i = 0; i < 3; i++) {
            blur += luma(textureSampleLevel(tex, samp, in.uv + vec2f(radii[i], 0.0) * u.texel, 0.0).rgb);
            blur += luma(textureSampleLevel(tex, samp, in.uv - vec2f(radii[i], 0.0) * u.texel, 0.0).rgb);
            blur += luma(textureSampleLevel(tex, samp, in.uv + vec2f(0.0, radii[i]) * u.texel, 0.0).rgb);
            blur += luma(textureSampleLevel(tex, samp, in.uv - vec2f(0.0, radii[i]) * u.texel, 0.0).rgb);
        }
        blur /= 12.0;
        let localContrast = y - blur;
        let mid = clamp(1.0 - abs(y - 0.4) * 2.0, 0.0, 1.0);
        let yc = y + u.clarity * localContrast * mid;
        c *= yc / max(y, 1e-4);
        y = luma(c);
    }
    if (u.dehaze != 0.0) {
        let dc = min(min(c.r, c.g), c.b);
        c = c + u.dehaze * (c - dc) * 0.5;
        let yd = luma(c);
        c = mix(vec3f(yd), c, 1.0 + u.dehaze * 0.2);
        c = max(c, vec3f(0.0));
    }
    if (u.vignetteAmount != 0.0) {
        let d = in.uv - 0.5;
        let linf = max(abs(d.x), abs(d.y)) * 1.41421356;
        let l2 = length(d);
        let rr = mix(linf, l2, (u.vignetteRoundness + 100.0) / 200.0);
        let mid = u.vignetteMidpoint / 100.0 * 0.7;
        let feather = u.vignetteFeather / 100.0 * 0.6 + 0.02;
        let v = smoothstep(mid, mid + feather, rr);
        c *= 1.0 + u.vignetteAmount * v * select(0.6, 1.0, u.vignetteAmount < 0.0);
        c = max(c, vec3f(0.0));
    }
    if (u.grainAmount != 0.0) {
        let gp = in.uv / u.texel;
        let scale = mix(0.5, 4.0, u.grainSize / 100.0);
        let n = hash(floor(gp / scale) + u.seed);
        let n2 = hash(floor(gp / scale) * 1.7 + u.seed * 2.0);
        let grain = mix(n, n2, u.grainRoughness / 100.0) - 0.5;
        c += grain * u.grainAmount * 0.2;
        c = max(c, vec3f(0.0));
    }
    return vec4f(c, 1.0);
}
`

export const WGSL_PASS8 = /* wgsl */ `
struct VsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
struct U {
    model: mat3x3f,
    rec2020ToDisplay: mat3x3f,
    srgbToDisplay: mat3x3f,
    split: vec3f,
    sourceKind: f32,
    crop: vec4f,
    canvas: vec2f,
    displayP3: f32,
    clipMode: f32,
    hasBase: f32,
    useLut: f32,
    lutSize: f32,
    cropMode: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var baseTex: texture_2d<f32>;
@group(0) @binding(3) var lut: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
${COMMON}
fn sampleDisplayLut(rgb: vec3f) -> vec3f {
    let n = u.lutSize;
    let w = n * n;
    let c = clamp(rgb, vec3f(0.0), vec3f(1.0));
    let bCoord = c.b * (n - 1.0);
    let b0 = floor(bCoord);
    let b1 = min(b0 + 1.0, n - 1.0);
    let bf = bCoord - b0;
    let xr = 0.5 + c.r * (n - 1.0);
    let v = (0.5 + c.g * (n - 1.0)) / n;
    let s0 = textureSampleLevel(lut, samp, vec2f((b0 * n + xr) / w, v), 0.0).rgb;
    let s1 = textureSampleLevel(lut, samp, vec2f((b1 * n + xr) / w, v), 0.0).rgb;
    return mix(s0, s1, bf);
}
@vertex fn vs(@location(0) pos: vec2f, @location(1) inUv: vec2f) -> VsOut {
    var out: VsOut;
    let p = u.model * vec3f(pos, 1.0);
    out.pos = vec4f(p.xy, 0.0, 1.0);
    out.uv = inUv;
    return out;
}
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    let screen = vec2f(in.pos.x / u.canvas.x, 1.0 - in.pos.y / u.canvas.y);
    var axisCoord = screen.x;
    if (u.split.y >= 0.5) { axisCoord = 1.0 - screen.y; }
    let beforeSide = u.split.x > 0.5 && axisCoord < u.split.z;
    var lin: vec3f;
    if (beforeSide && u.hasBase == 1.0) { lin = textureSampleLevel(baseTex, samp, in.uv, 0.0).rgb; }
    else { lin = textureSampleLevel(tex, samp, in.uv, 0.0).rgb; }
    let clipHi = all(lin >= vec3f(1.0));
    let clipLo = all(lin <= vec3f(0.0));
    var c = lin;
    if (u.sourceKind == 0.0) {
        if (u.useLut == 1.0) {
            c = sampleDisplayLut(c);
        } else {
            c = u.rec2020ToDisplay * c;
            c = oetf(c);
        }
    } else if (u.displayP3 == 1.0) {
        var l = eotf(c);
        l = u.srgbToDisplay * l;
        c = oetf(l);
    }
    if (u.cropMode > 0.0) {
        let inside = in.uv.x >= u.crop.x && in.uv.y >= u.crop.y && in.uv.x <= u.crop.z && in.uv.y <= u.crop.w;
        if (!inside) { c *= select(0.0, 0.4, u.cropMode == 2.0); }
    }
    if ((u.clipMode == 1.0 || u.clipMode == 2.0) && clipHi) { c = vec3f(1.0, 0.0, 0.0); }
    if ((u.clipMode == 1.0 || u.clipMode == 3.0) && clipLo) { c = vec3f(0.0, 0.0, 1.0); }
    if (u.split.x > 0.5 && abs(axisCoord - u.split.z) < 0.0015) { c = vec3f(1.0); }
    return vec4f(c, 1.0);
}
`

export const WGSL_ORIENT = /* wgsl */ `
${FULLSCREEN_VERT}
struct U { flip: f32, pad0: f32, pad1: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    var src = in.uv;
    if (u.flip == 3.0) { src = vec2f(1.0 - in.uv.x, 1.0 - in.uv.y); }
    if (u.flip == 5.0) { src = vec2f(1.0 - in.uv.y, in.uv.x); }
    if (u.flip == 6.0) { src = vec2f(in.uv.y, 1.0 - in.uv.x); }
    return vec4f(textureSampleLevel(tex, samp, src, 0.0).rgb, 1.0);
}
`

export const WGSL_CLEAR = /* wgsl */ `
${FULLSCREEN_VERT}
struct U { color: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    return u.color;
}
`

export const WGSL_HISTOGRAM = /* wgsl */ `
struct U { rec2020ToDisplay: mat3x3f, size: vec2f, pad0: f32, pad1: f32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> bins: array<atomic<u32>, 1024>;
fn oetf1(v: f32) -> f32 {
    let x = clamp(v, 0.0, 1.0);
    return select(1.055 * pow(x, 1.0 / 2.4) - 0.055, x * 12.92, x <= 0.0031308);
}
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2627, 0.678, 0.0593)); }
fn binOf(v: f32) -> u32 { return u32(clamp(v, 0.0, 1.0) * 255.0 + 0.5); }
@compute @workgroup_size(16, 16) fn cs(@builtin(global_invocation_id) gid: vec3u) {
    if (f32(gid.x) >= u.size.x || f32(gid.y) >= u.size.y) { return; }
    let lin = textureLoad(tex, vec2i(gid.xy), 0).rgb;
    let d = u.rec2020ToDisplay * lin;
    let r = oetf1(d.r);
    let g = oetf1(d.g);
    let b = oetf1(d.b);
    let y = oetf1(clamp(luma(lin), 0.0, 1.0));
    atomicAdd(&bins[binOf(r)], 1u);
    atomicAdd(&bins[256u + binOf(g)], 1u);
    atomicAdd(&bins[512u + binOf(b)], 1u);
    atomicAdd(&bins[768u + binOf(y)], 1u);
}
`
