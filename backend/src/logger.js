const useColor = process.stdout.isTTY;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const color = {
  dim: paint(2), red: paint(31), green: paint(32), yellow: paint(33), cyan: paint(36), bold: paint(1),
};

const stamp = () => new Date().toISOString().slice(11, 23);

export const logger = {
  info: (msg) => console.log(`${color.dim(stamp())} ${msg}`),
  step: (msg) => console.log(`${color.dim(stamp())} ${color.cyan("›")} ${msg}`),
  ok: (msg) => console.log(`${color.dim(stamp())} ${color.green("✔")} ${msg}`),
  warn: (msg) => console.warn(`${color.dim(stamp())} ${color.yellow("!")} ${msg}`),
  error: (msg) => console.error(`${color.dim(stamp())} ${color.red("✘")} ${msg}`),
};

export const silentLogger = { info() {}, step() {}, ok() {}, warn() {}, error() {} };
