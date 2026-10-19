/**
 * Siril preprocess settings — presets + custom overrides for ZAP script builders.
 *
 * Presets per stage: default | monoRecommended | custom
 * Stack sampling: binningUpdate (Siril core.binning_update / “real pixel size”)
 */
'use strict';

const PRESETS = Object.freeze(['default', 'monoRecommended', 'custom']);

const STAGES = Object.freeze(['bias', 'flat', 'calibrate', 'register', 'stack']);

/** Canonical defaults persisted on dashboard JSON. */
function defaultPreprocessSettings() {
  return {
    bias: { preset: 'default', custom: defaultBiasCustom() },
    flat: { preset: 'default', custom: defaultFlatCustom() },
    calibrate: { preset: 'default', custom: defaultCalibrateCustom() },
    register: { preset: 'default', custom: defaultRegisterCustom(), ...defaultRegisterDrizzle() },
    stack: { preset: 'default', custom: defaultStackCustom() },
    /** Persisted default for Stack confirm checkbox (unchecked = false). */
    binningUpdate: false,
  };
}

function defaultBiasCustom() {
  return {
    method: 'rej',
    rejection: 'winsorized',
    sigmaLow: 3,
    sigmaHigh: 3,
    norm: 'none',
    weight: 'none',
  };
}

function defaultFlatCustom() {
  return {
    useBias: true,
    method: 'rej',
    rejection: 'winsorized',
    sigmaLow: 3,
    sigmaHigh: 3,
    norm: 'mul',
    weight: 'none',
  };
}

function defaultCalibrateCustom() {
  return {
    cosmetic: true,
    cosmeticFrom: 'dark',
    equalizeCfa: false,
    debayer: false,
  };
}

const DRIZZLE_SCALES = Object.freeze(['1', '2', '3']);
const DRIZZLE_PIXFRACS = Object.freeze(['1', '0.7', '0.5']);
const DRIZZLE_KERNELS = Object.freeze(['square', 'point', 'gaussian', 'turbo', 'lanczos2', 'lanczos3']);

function defaultRegisterCustom() {
  return {
    twoPass: false,
  };
}

/** Drizzle is independent of the Register preset. Off unless explicitly enabled. */
function defaultRegisterDrizzle() {
  return {
    drizzle: false,
    drizzleScale: '2',
    drizzlePixfrac: '0.5',
    drizzleKernel: 'square',
  };
}

function normalizeRegisterDrizzle(raw) {
  const base = defaultRegisterDrizzle();
  const src = raw && typeof raw === 'object' ? raw : {};
  const scale = String(src.drizzleScale == null ? base.drizzleScale : src.drizzleScale);
  const pix = String(src.drizzlePixfrac == null ? base.drizzlePixfrac : src.drizzlePixfrac);
  const kernel = String(src.drizzleKernel || base.drizzleKernel).toLowerCase();
  return {
    drizzle: src.drizzle === true,
    drizzleScale: DRIZZLE_SCALES.includes(scale) ? scale : base.drizzleScale,
    drizzlePixfrac: DRIZZLE_PIXFRACS.includes(pix) ? pix : base.drizzlePixfrac,
    drizzleKernel: DRIZZLE_KERNELS.includes(kernel) ? kernel : base.drizzleKernel,
  };
}

function defaultStackCustom() {
  return {
    method: 'rej',
    rejection: 'winsorized',
    sigmaLow: 3,
    sigmaHigh: 3,
    norm: 'addscale',
    weight: 'none',
    outputNorm: true,
    bits32: true,
    /** When true (Mono Recommended), use Winsorized only if frameCount >= winsorizedMinFrames. */
    winsorizedWhenNAtLeast: null,
    winsorizedMinFrames: 20,
    rejectionBelowThreshold: 'median',
  };
}

function monoRecommendedBias() {
  return { ...defaultBiasCustom() };
}

function monoRecommendedFlat() {
  return { ...defaultFlatCustom() };
}

function monoRecommendedCalibrate() {
  return { ...defaultCalibrateCustom() };
}

function monoRecommendedRegister() {
  return { ...defaultRegisterCustom(), twoPass: true };
}

function monoRecommendedStack() {
  return {
    ...defaultStackCustom(),
    winsorizedWhenNAtLeast: 20,
    winsorizedMinFrames: 20,
    rejectionBelowThreshold: 'median',
  };
}

/**
 * Normalize persisted settings (migrate missing keys).
 * @param {any} raw
 */
function normalizePreprocessSettings(raw) {
  const base = defaultPreprocessSettings();
  if (!raw || typeof raw !== 'object') return base;
  for (const stage of STAGES) {
    const src = raw[stage];
    if (!src || typeof src !== 'object') continue;
    const preset = PRESETS.includes(src.preset) ? src.preset : 'default';
    const customBase =
      stage === 'bias'
        ? defaultBiasCustom()
        : stage === 'flat'
          ? defaultFlatCustom()
          : stage === 'calibrate'
            ? defaultCalibrateCustom()
            : stage === 'register'
              ? defaultRegisterCustom()
              : defaultStackCustom();
    const stageOut = {
      preset,
      custom: { ...customBase, ...(src.custom && typeof src.custom === 'object' ? src.custom : {}) },
    };
    if (stage === 'register') Object.assign(stageOut, normalizeRegisterDrizzle(src));
    base[stage] = stageOut;
  }
  if (typeof raw.binningUpdate === 'boolean') base.binningUpdate = raw.binningUpdate;
  return base;
}

/**
 * Resolve effective options for a stage (what the script builder consumes).
 * @param {any} settings
 * @param {string} stage
 * @param {{ frameCount?: number }} [ctx]
 */
function resolveStageOptions(settings, stage, ctx = {}) {
  const norm = normalizePreprocessSettings(settings);
  const block = norm[stage] || { preset: 'default', custom: {} };
  const preset = block.preset || 'default';

  let opts;
  if (preset === 'monoRecommended') {
    opts =
      stage === 'bias'
        ? monoRecommendedBias()
        : stage === 'flat'
          ? monoRecommendedFlat()
          : stage === 'calibrate'
            ? monoRecommendedCalibrate()
            : stage === 'register'
              ? monoRecommendedRegister()
              : monoRecommendedStack();
  } else if (preset === 'custom') {
    opts = { ...block.custom };
  } else {
    // default = today’s hard-coded Mono 1.4 scripts (no 2-pass, always Winsorized via omitted type)
    opts =
      stage === 'bias'
        ? defaultBiasCustom()
        : stage === 'flat'
          ? defaultFlatCustom()
          : stage === 'calibrate'
            ? defaultCalibrateCustom()
            : stage === 'register'
              ? defaultRegisterCustom()
              : defaultStackCustom();
  }

  if (stage === 'stack' && opts.winsorizedWhenNAtLeast != null) {
    const n = Number(ctx.frameCount);
    const minN = Number(opts.winsorizedMinFrames) || 20;
    if (Number.isFinite(n) && n < minN) {
      opts = {
        ...opts,
        method: opts.rejectionBelowThreshold === 'median' ? 'med' : opts.method,
        rejection: opts.rejectionBelowThreshold === 'median' ? null : opts.rejection,
      };
    }
  }

  if (stage === 'register') {
    opts = { ...opts, ...normalizeRegisterDrizzle(norm.register) };
  }

  return { preset, ...opts, binningUpdate: !!norm.binningUpdate };
}

/**
 * Build Siril `stack …` method fragment (after sequence name).
 * @param {{ method?: string, rejection?: string|null, sigmaLow?: number, sigmaHigh?: number, norm?: string, weight?: string, outputNorm?: boolean, bits32?: boolean }} opts
 * @param {{ out?: string, extra?: string }} [extra]
 */
function formatStackArgs(opts, extra = {}) {
  const method = String(opts.method || 'rej');
  const parts = [];

  if (method === 'sum' || method === 'min' || method === 'max') {
    parts.push(method);
  } else if (method === 'med' || method === 'median') {
    parts.push('med');
  } else {
    parts.push('rej');
    const rej = opts.rejection;
    // Siril default rejection is Winsorized when the type token is omitted — keep Mono 1.4 shape.
    if (rej && rej !== 'winsorized') {
      const map = {
        none: 'n',
        percentile: 'p',
        sigma: 's',
        median: 'm',
        winsorized: 'w',
        linear: 'l',
        generalized: 'g',
        mad: 'a',
      };
      parts.push(map[rej] || rej);
    } else if (rej === 'winsorized' && opts.explicitRejection) {
      parts.push('w');
    }
    const lo = opts.sigmaLow != null ? opts.sigmaLow : 3;
    const hi = opts.sigmaHigh != null ? opts.sigmaHigh : 3;
    if (rej !== 'none') parts.push(String(lo), String(hi));
  }

  const norm = opts.norm;
  if (norm === 'none' || norm === 'nonorm') parts.push('-nonorm');
  else if (norm) parts.push(`-norm=${norm}`);

  if (opts.weight && opts.weight !== 'none') parts.push(`-weight=${opts.weight}`);
  if (opts.outputNorm) parts.push('-output_norm');
  if (opts.bits32) parts.push('-32b');
  if (extra.out) parts.push(`-out=${extra.out}`);
  if (extra.extra) parts.push(extra.extra);

  return parts.filter(Boolean).join(' ');
}

/** Prefixed lines for core.binning_update (sampling / “real pixel size”). */
function formatBinningUpdateLines(binningUpdate) {
  const v = binningUpdate ? 'true' : 'false';
  return `set core.binning_update=${v}\n`;
}

/**
 * Help catalog for UI (i) buttons and docs.
 * Each entry: { id, label, summary, options?: [{ value, label, when }] }
 */
const HELP_CATALOG = Object.freeze({
  preset: {
    id: 'preset',
    label: 'Stage preset',
    summary:
      'Default keeps today’s ZAP Mono 1.4 scripts. Mono Recommended applies your preferred mono recipe (2-pass register, Winsorized when N≥20, ASIAIR-safe sampling). Custom unlocks per-flag controls for that stage.',
    options: [
      { value: 'default', label: 'Default', when: 'Match the built-in scripts shipped with ZAP (no 2-pass).' },
      {
        value: 'monoRecommended',
        label: 'Mono Recommended',
        when: 'Deep-sky mono with ASIAIR Bin2 and typical night counts.',
      },
      { value: 'custom', label: 'Custom', when: 'You need a specific Siril flag that presets do not set.' },
    ],
  },
  binningUpdate: {
    id: 'binningUpdate',
    label: 'Update pixel size of binned images (real pixel size)',
    summary:
      'Siril preference core.binning_update. When checked, Siril multiplies FITS pixel size (XPIXSZ) by XBINNING. When unchecked, it treats the header µm as already effective (binned). ASIAIR usually writes the effective size — leave unchecked so plate solving and arcsec/px sampling stay correct on registered and stacked results.',
    options: [
      {
        value: 'unchecked',
        label: 'Unchecked (default)',
        when: 'ASIAIR / software that already wrote binned µm — recommended for your rig.',
      },
      {
        value: 'checked',
        label: 'Checked',
        when: 'Acquisition software wrote physical (unbinned) pixel size and a separate binning keyword.',
      },
    ],
  },
  stackMethod: {
    id: 'stackMethod',
    label: 'Stack method',
    summary: 'How pixels are combined across frames.',
    options: [
      { value: 'rej', label: 'Average + rejection', when: 'Default for lights and masters with enough frames.' },
      { value: 'med', label: 'Median', when: 'Small N (<~15) or stubborn outliers.' },
      { value: 'sum', label: 'Sum', when: 'Rare; preserves total electrons, no rejection.' },
    ],
  },
  rejection: {
    id: 'rejection',
    label: 'Rejection type',
    summary: 'Outlier clipper used with average (rej) stacking. If omitted in Siril, Winsorized is the default.',
    options: [
      { value: 'winsorized', label: 'Winsorized', when: 'General deep-sky; best around N≥20.' },
      { value: 'median', label: 'Median sigma', when: 'Smaller stacks; robust but softer.' },
      { value: 'sigma', label: 'Sigma', when: 'Classic clip; fine for clean data.' },
      { value: 'none', label: 'None', when: 'No rejection — only if data is already clean.' },
      { value: 'percentile', label: 'Percentile', when: 'Percentile clipping variant.' },
      { value: 'linear', label: 'Linear fit', when: 'Linear-fit clipping.' },
      { value: 'generalized', label: 'Generalized ESD', when: 'GESD clipping for stubborn outliers.' },
      { value: 'mad', label: 'k-MAD', when: 'MAD-based clipping.' },
    ],
  },
  norm: {
    id: 'norm',
    label: 'Normalization',
    summary: 'How frame levels are matched before combining.',
    options: [
      { value: 'none', label: 'None', when: 'Bias/dark masters.' },
      { value: 'mul', label: 'Multiplicative', when: 'Master flats after bias.' },
      { value: 'addscale', label: 'Additive + scale', when: 'Light stacks (Siril default).' },
      { value: 'add', label: 'Additive', when: 'Additive without scale.' },
      { value: 'mulscale', label: 'Multiplicative + scale', when: 'Scaled multiplicative match.' },
    ],
  },
  weight: {
    id: 'weight',
    label: 'Frame weighting',
    summary: 'Optional per-frame weights during rejection stacking.',
    options: [
      { value: 'none', label: 'None', when: 'Default; safest unless you curated quality.' },
      { value: 'noise', label: 'Noise', when: 'Prefer lower background-noise frames.' },
      { value: 'wfwhm', label: 'wFWHM', when: 'Prefer sharper registered frames.' },
      { value: 'nbstars', label: 'Star count', when: 'Prefer frames with more detected stars.' },
      { value: 'nbstack', label: 'Sub-stack count', when: 'Live stacking / pre-stacked inputs.' },
    ],
  },
  twoPass: {
    id: 'twoPass',
    label: 'Two-pass registration',
    summary:
      'register -2pass picks a quality/framing reference, then seqapplyreg writes r_pp_light_*. More stable for multi-night Aggregate; slightly slower.',
    options: [
      { value: 'false', label: 'Off', when: 'Default / single-night quick align.' },
      { value: 'true', label: 'On', when: 'Mono Recommended; multi-night Aggregate.' },
    ],
  },
  drizzle: {
    id: 'drizzle',
    label: 'Drizzle',
    summary:
      'Off by default. On writes Siril -drizzle when the aligned frames are created: on register for a one-pass run, on seqapplyreg after -2pass. Mono drizzle of already calibrated pp_light frames. It does not run the OSC Bayer-drizzle script and does not pass a flat into the kernel (lights are already flat-calibrated). Output is still r_pp_light_*. Scale 2 is 4× the pixels. Default pixel fraction 0.5 matches that scale. Lanczos kernels are only emitted at scale 1 and pixel fraction 1; any other scale falls back to square.',
    options: [
      { value: 'false', label: 'Off', when: 'Normal interpolation register. Default and Mono Recommended leave this off.' },
      { value: 'true', label: 'On', when: 'Drizzle the aligned frames. Use with two-pass or one-pass.' },
    ],
  },
  drizzleScale: {
    id: 'drizzleScale',
    label: 'Drizzle scale',
    summary: 'Siril -scale= on the drizzle export. Linear scale; pixel count grows with the square.',
    options: [
      { value: '1', label: '1×', when: 'Same dimensions. Redistributes samples without upscaling.' },
      { value: '2', label: '2×', when: 'Default when drizzle is on. Four times the pixels.' },
      { value: '3', label: '3×', when: 'Siril’s maximum. Nine times the pixels.' },
    ],
  },
  drizzlePixfrac: {
    id: 'drizzlePixfrac',
    label: 'Pixel fraction',
    summary: 'Siril -pixfrac=. How much of each input pixel is dropped onto the output grid. 1 is the Siril default.',
    options: [
      { value: '1', label: '1', when: 'Shift-and-add. Right for scale 1, and the Bayer-drizzle pairing. Softer if you upscale.' },
      { value: '0.7', label: '0.7', when: 'A little larger than 1/2, fewer empty pixels than 0.5 at scale 2.' },
      { value: '0.5', label: '0.5', when: 'Default. About 1/scale for a 2× drizzle, which is Siril’s rule of thumb.' },
    ],
  },
  drizzleKernel: {
    id: 'drizzleKernel',
    label: 'Drizzle kernel',
    summary: 'Siril -kernel=. Square is Siril’s default and the stock Bayer-drizzle script’s kernel.',
    options: [
      { value: 'square', label: 'Square', when: 'Default. Compact footprint.' },
      { value: 'point', label: 'Point', when: 'Smallest footprint.' },
      { value: 'gaussian', label: 'Gaussian', when: 'Softer drop.' },
      { value: 'turbo', label: 'Turbo', when: 'Siril turbo kernel.' },
      { value: 'lanczos2', label: 'Lanczos2', when: 'Only for scale 1 and pixel fraction 1. Otherwise ZAP writes square.' },
      { value: 'lanczos3', label: 'Lanczos3', when: 'Only for scale 1 and pixel fraction 1. Otherwise ZAP writes square.' },
    ],
  },
  cosmetic: {
    id: 'cosmetic',
    label: 'Cosmetic correction',
    summary: 'Hot/cold pixel fix during light calibration (-cc=dark uses the master dark).',
    options: [
      { value: 'on', label: 'On (from dark)', when: 'Mono lights with a good master dark.' },
      { value: 'off', label: 'Off', when: 'Already cleaned data or no usable dark.' },
    ],
  },
  useBias: {
    id: 'useBias',
    label: 'Use master bias on flats',
    summary: 'calibrate flat -bias=… before stacking the master flat.',
    options: [
      { value: 'true', label: 'On', when: 'Always for mono dark-flats / bias workflow.' },
      { value: 'false', label: 'Off', when: 'Only if flats are already bias-corrected.' },
    ],
  },
});

module.exports = {
  PRESETS,
  STAGES,
  HELP_CATALOG,
  defaultPreprocessSettings,
  normalizePreprocessSettings,
  resolveStageOptions,
  formatStackArgs,
  formatBinningUpdateLines,
  defaultBiasCustom,
  defaultFlatCustom,
  defaultCalibrateCustom,
  defaultRegisterCustom,
  defaultRegisterDrizzle,
  normalizeRegisterDrizzle,
  defaultStackCustom,
  monoRecommendedBias,
  monoRecommendedFlat,
  monoRecommendedCalibrate,
  monoRecommendedRegister,
  monoRecommendedStack,
};
