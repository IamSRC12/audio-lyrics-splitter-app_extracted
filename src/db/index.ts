import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createFallbackDb } from "./fallback-db";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __useFallbackDb?: boolean;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 1000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

const realDb = drizzle(pool, { schema });
const fallbackDb = createFallbackDb();

function isConnError(err: any): boolean {
  if (!err) return false;
  return (
    err.code === "ECONNREFUSED" ||
    err.syscall === "connect" ||
    err.message?.includes("connect ECONNREFUSED") ||
    err.cause?.code === "ECONNREFUSED"
  );
}

function wrapDrizzleQuery(getRealQuery: () => any, getFallbackQuery: () => any): any {
  let target: any;
  try {
    target = getRealQuery();
  } catch (err) {
    if (isConnError(err)) {
      globalForDb.__useFallbackDb = true;
      return getFallbackQuery();
    }
    throw err;
  }

  if (!target || (typeof target !== "object" && typeof target !== "function")) {
    return target;
  }

  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === "then") {
        return function (onFulfilled?: any, onRejected?: any) {
          return Promise.resolve(obj)
            .catch((err) => {
              if (isConnError(err)) {
                globalForDb.__useFallbackDb = true;
                const fallbackQuery = getFallbackQuery();
                return fallbackQuery;
              }
              throw err;
            })
            .then(onFulfilled, onRejected);
        };
      }

      const val = Reflect.get(obj, prop, receiver);
      if (typeof val === "function") {
        return function (...args: any[]) {
          return wrapDrizzleQuery(
            () => val.apply(obj, args),
            () => {
              const fb = getFallbackQuery();
              const fbMethod = fb[prop];
              if (typeof fbMethod === "function") {
                return fbMethod.apply(fb, args);
              }
              return fb;
            }
          );
        };
      }
      return val;
    },
  });
}

export const db: any = {
  select(...args: any[]) {
    if (globalForDb.__useFallbackDb) return fallbackDb.select(...args);
    return wrapDrizzleQuery(() => realDb.select(...args), () => fallbackDb.select(...args));
  },
  insert(...args: any[]) {
    if (globalForDb.__useFallbackDb) return fallbackDb.insert(...args);
    return wrapDrizzleQuery(() => realDb.insert(...args), () => fallbackDb.insert(...args));
  },
  update(...args: any[]) {
    if (globalForDb.__useFallbackDb) return fallbackDb.update(...args);
    return wrapDrizzleQuery(() => realDb.update(...args), () => fallbackDb.update(...args));
  },
  delete(...args: any[]) {
    if (globalForDb.__useFallbackDb) return fallbackDb.delete(...args);
    return wrapDrizzleQuery(() => realDb.delete(...args), () => fallbackDb.delete(...args));
  },
  execute(...args: any[]) {
    if (globalForDb.__useFallbackDb) return fallbackDb.execute(...args);
    return wrapDrizzleQuery(() => realDb.execute(...args), () => fallbackDb.execute(...args));
  },
};
