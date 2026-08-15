export const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export const REC2020_LUMA: [number, number, number] = [0.2627, 0.678, 0.0593]

export const REC2020_TO_SRGB = [1.660491, -0.58764114, -0.07284986, -0.12455047, 1.1328999, -0.00834942, -0.01815076, -0.1005789, 1.11872966]

export const REC2020_TO_P3 = [1.34357825, -0.28217967, -0.06139858, -0.06529745, 1.07578792, -0.01049046, 0.00282179, -0.01959849, 1.01677671]

export const SRGB_TO_P3 = [0.82246197, 0.17753803, 0.0, 0.0331942, 0.9668058, 0.0, 0.01708263, 0.07239744, 0.91051993]

export const SRGB_TO_REC2020 = [0.6274039, 0.32928304, 0.04331306, 0.06909729, 0.91954039, 0.01136231, 0.01639144, 0.08801331, 0.89559525]

export const toColumnMajor = (rowMajor: number[]) =>
    new Float32Array([rowMajor[0], rowMajor[3], rowMajor[6], rowMajor[1], rowMajor[4], rowMajor[7], rowMajor[2], rowMajor[5], rowMajor[8]])
