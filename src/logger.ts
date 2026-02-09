import * as fs from "node:fs";
import * as path from "node:path";
import { inspect } from "node:util";
import * as winston from "winston";

const splatSymbol = Symbol.for("splat");

const logFilePath = process.env.LOG_FILE
  ? path.resolve(process.cwd(), process.env.LOG_FILE)
  : path.join(process.cwd(), "logs", "app.log");

fs.mkdirSync(path.dirname(logFilePath), { recursive: true });

const lineFormatter = winston.format.printf((info) => {
  const formatValue = (value: unknown) =>
    typeof value === "string"
      ? value
      : inspect(value, {
          depth: 5,
          breakLength: Infinity,
          compact: true,
        });

  const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (typeof value !== "object" || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const scope = typeof info.scope === "string" ? `[${info.scope}] ` : "";
  const message = formatValue(info.message);

  const splat =
    (info as Record<string | symbol, unknown>)[splatSymbol] instanceof Array
      ? ((info as Record<string | symbol, unknown>)[splatSymbol] as unknown[])
      : [];
  const meta = Object.fromEntries(
    Object.entries(info).filter(
      ([key]) =>
        key !== "level" &&
        key !== "message" &&
        key !== "timestamp" &&
        key !== "scope",
    ),
  );

  let printableSplat = splat;
  const firstSplat = splat[0];
  if (isPlainObject(firstSplat)) {
    const mergedIntoMeta = Object.keys(firstSplat).every(
      (key) =>
        Object.prototype.hasOwnProperty.call(meta, key) &&
        Object.is(meta[key], firstSplat[key]),
    );
    if (mergedIntoMeta) {
      printableSplat = splat.slice(1);
    }
  }

  const splatSuffix =
    printableSplat.length > 0
      ? ` ${printableSplat.map((value) => formatValue(value)).join(" ")}`
      : "";

  const metaSuffix =
    Object.keys(meta).length > 0
      ? ` ${inspect(meta, { depth: 5, breakLength: Infinity, compact: true })}`
      : "";

  return `[${info.timestamp}] [${String(info.level).toUpperCase()}] ${scope}${message}${splatSuffix}${metaSuffix}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "debug",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    winston.format.errors({ stack: true }),
    lineFormatter,
  ),
  transports: [
    new winston.transports.File({
      filename: logFilePath,
      options: { flags: "w" },
    }),
  ],
});

export function getLogger(scope: string) {
  return logger.child({ scope });
}

export { logFilePath };
