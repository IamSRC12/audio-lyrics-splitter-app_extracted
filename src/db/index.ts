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

export const db: any = new Proxy(realDb as any, {
  get(target, prop, receiver) {
    if (globalForDb.__useFallbackDb) {
      return (fallbackDb as any)[prop];
    }
    const realMethod = target[prop];
    if (typeof realMethod === "function") {
      return function (...args: any[]) {
        try {
          const res = realMethod.apply(target, args);

          const isConnError = (err: any) =>
            err?.code === "ECONNREFUSED" ||
            err?.syscall === "connect" ||
            err?.message?.includes("connect ECONNREFUSED") ||
            err?.cause?.code === "ECONNREFUSED";

          if (res && typeof res.then === "function") {
            return res.catch((err: any) => {
              if (isConnError(err)) {
                globalForDb.__useFallbackDb = true;
                const fallbackMethod = (fallbackDb as any)[prop];
                if (typeof fallbackMethod === "function") {
                  return fallbackMethod.apply(fallbackDb, args);
                }
              }
              throw err;
            });
          }

          if (res && typeof res.from === "function") {
            const wrapChain = (chain: any) => {
              const originalThen = chain.then;
              if (typeof originalThen === "function") {
                chain.then = function (onFulfilled?: any, onRejected?: any) {
                  return originalThen.call(chain, onFulfilled, (err: any) => {
                    if (isConnError(err)) {
                      globalForDb.__useFallbackDb = true;
                      const fallbackChain = (fallbackDb as any)[prop](...args);
                      return fallbackChain.then(onFulfilled, onRejected);
                    }
                    if (onRejected) return onRejected(err);
                    throw err;
                  });
                };
              }
              return chain;
            };
            return wrapChain(res);
          }

          if (res && typeof res.values === "function") {
            const wrapInsertChain = (chain: any) => {
              const originalThen = chain.then;
              if (typeof originalThen === "function") {
                chain.then = function (onFulfilled?: any, onRejected?: any) {
                  return originalThen.call(chain, onFulfilled, (err: any) => {
                    if (isConnError(err)) {
                      globalForDb.__useFallbackDb = true;
                      const fallbackChain = (fallbackDb as any)[prop](...args);
                      return fallbackChain.then(onFulfilled, onRejected);
                    }
                    if (onRejected) return onRejected(err);
                    throw err;
                  });
                };
              }
              return chain;
            };
            return wrapInsertChain(res);
          }

          return res;
        } catch (err: any) {
          if (
            err?.code === "ECONNREFUSED" ||
            err?.syscall === "connect" ||
            err?.message?.includes("connect ECONNREFUSED") ||
            err?.cause?.code === "ECONNREFUSED"
          ) {
            globalForDb.__useFallbackDb = true;
            return (fallbackDb as any)[prop](...args);
          }
          throw err;
        }
      };
    }
    return Reflect.get(target, prop, receiver);
  },
});
