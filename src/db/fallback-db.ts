import fs from "fs";
import path from "path";
import { jobs, segments, type JobRow, type SegmentRow } from "./schema";

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "db.json");

type DbStore = {
  jobs: JobRow[];
  segments: SegmentRow[];
};

function readStore(): DbStore {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(STORE_PATH)) {
      const initial: DbStore = { jobs: [], segments: [] };
      fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), "utf-8");
      return initial;
    }
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    const data = JSON.parse(raw) as DbStore;
    return {
      jobs: Array.isArray(data.jobs) ? data.jobs : [],
      segments: Array.isArray(data.segments) ? data.segments : [],
    };
  } catch {
    return { jobs: [], segments: [] };
  }
}

function writeStore(store: DbStore) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write fallback db store:", err);
  }
}

function getTableName(table: any): "jobs" | "segments" {
  if (table === jobs || table?._?.name === "jobs" || table?.name === "jobs") return "jobs";
  if (table === segments || table?._?.name === "segments" || table?.name === "segments") return "segments";
  return "jobs";
}

function extractFilter(clause: any): { key?: string; val?: any } {
  if (!clause) return {};
  if (clause.left && clause.right !== undefined) {
    const key = clause.left.name || clause.left.key || clause.left.columnName;
    const val = clause.right?.value !== undefined ? clause.right.value : clause.right;
    return { key, val };
  }
  if (Array.isArray(clause.queryChunks)) {
    let key: string | undefined;
    let val: any;
    for (const chunk of clause.queryChunks) {
      if (chunk && typeof chunk === "object") {
        if ("name" in chunk) key = chunk.name;
        if ("key" in chunk) key = chunk.key;
        if ("value" in chunk) val = chunk.value;
      }
    }
    return { key, val };
  }
  return {};
}

export function createFallbackDb() {
  return {
    select(selection?: any) {
      let targetTable: "jobs" | "segments" = "jobs";
      let whereClause: any = null;
      let orderClause: any = null;

      const executeSelect = () => {
        const store = readStore();
        let list = [...store[targetTable]] as any[];
        const filter = extractFilter(whereClause);

        if (filter.key && filter.val !== undefined) {
          list = list.filter((item) => {
            if (filter.key === "id") return item.id === filter.val;
            if (filter.key === "job_id" || filter.key === "jobId") return item.jobId === filter.val;
            return true;
          });
        }

        if (orderClause) {
          list.sort((a, b) => {
            if (targetTable === "jobs") {
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            }
            if (targetTable === "segments") {
              return (a.index ?? 0) - (b.index ?? 0);
            }
            return 0;
          });
        }

        if (selection && typeof selection === "object") {
          const keys = Object.keys(selection);
          if (keys.length > 0) {
            list = list.map((item) => {
              const projected: any = {};
              for (const key of keys) {
                projected[key] = item[key];
              }
              return projected;
            });
          }
        }

        return list;
      };

      const chain = {
        from(t: any) {
          targetTable = getTableName(t);
          return chain;
        },
        where(w: any) {
          whereClause = w;
          return chain;
        },
        orderBy(o: any) {
          orderClause = o;
          return chain;
        },
        limit() {
          return chain;
        },
        returning() {
          return chain;
        },
        then(resolve: (val: any) => void, reject?: (err: any) => void) {
          try {
            const res = executeSelect();
            resolve(res);
          } catch (err) {
            if (reject) reject(err);
            else throw err;
          }
        },
        catch(reject: (err: any) => void) {
          return chain.then((x) => x, reject);
        },
      };

      return chain;
    },

    insert(t: any) {
      const targetTable = getTableName(t);
      let valuesToInsert: any = null;

      const executeInsert = () => {
        const store = readStore();
        const items = Array.isArray(valuesToInsert) ? valuesToInsert : [valuesToInsert];
        const now = new Date();
        const inserted: any[] = [];

        for (const rawItem of items) {
          const item = { ...rawItem };
          if (!item.id) {
            item.id = crypto.randomUUID();
          }
          if (!item.createdAt) {
            item.createdAt = now;
          }
          if (!item.updatedAt && targetTable === "jobs") {
            item.updatedAt = now;
          }
          if (targetTable === "jobs") {
            if (item.segmentsCount === undefined) item.segmentsCount = 0;
            if (item.status === undefined) item.status = "uploaded";
          }
          store[targetTable].push(item);
          inserted.push(item);
        }

        writeStore(store);
        return inserted;
      };

      const chain = {
        values(v: any) {
          valuesToInsert = v;
          return chain;
        },
        returning() {
          return chain;
        },
        onConflictDoUpdate() {
          return chain;
        },
        then(resolve: (val: any) => void, reject?: (err: any) => void) {
          try {
            const res = executeInsert();
            resolve(res);
          } catch (err) {
            if (reject) reject(err);
            else throw err;
          }
        },
        catch(reject: (err: any) => void) {
          return chain.then((x) => x, reject);
        },
      };

      return chain;
    },

    update(t: any) {
      const targetTable = getTableName(t);
      let setValues: any = null;
      let whereClause: any = null;

      const executeUpdate = () => {
        const store = readStore();
        const filter = extractFilter(whereClause);
        const now = new Date();
        const updated: any[] = [];

        store[targetTable] = store[targetTable].map((item: any) => {
          let matches = false;
          if (!filter.key) {
            matches = true;
          } else if (filter.key === "id" && item.id === filter.val) {
            matches = true;
          } else if ((filter.key === "job_id" || filter.key === "jobId") && item.jobId === filter.val) {
            matches = true;
          }

          if (matches) {
            const next = { ...item, ...setValues, updatedAt: now };
            updated.push(next);
            return next;
          }
          return item;
        });

        writeStore(store);
        return updated;
      };

      const chain = {
        set(v: any) {
          setValues = v;
          return chain;
        },
        where(w: any) {
          whereClause = w;
          return chain;
        },
        returning() {
          return chain;
        },
        then(resolve: (val: any) => void, reject?: (err: any) => void) {
          try {
            const res = executeUpdate();
            resolve(res);
          } catch (err) {
            if (reject) reject(err);
            else throw err;
          }
        },
        catch(reject: (err: any) => void) {
          return chain.then((x) => x, reject);
        },
      };

      return chain;
    },

    delete(t: any) {
      const targetTable = getTableName(t);
      let whereClause: any = null;

      const executeDelete = () => {
        const store = readStore();
        const filter = extractFilter(whereClause);

        store[targetTable] = store[targetTable].filter((item: any) => {
          if (filter.key === "id" && item.id === filter.val) return false;
          if ((filter.key === "job_id" || filter.key === "jobId") && item.jobId === filter.val) return false;
          return true;
        });

        writeStore(store);
        return [];
      };

      const chain = {
        where(w: any) {
          whereClause = w;
          return chain;
        },
        returning() {
          return chain;
        },
        then(resolve: (val: any) => void, reject?: (err: any) => void) {
          try {
            const res = executeDelete();
            resolve(res);
          } catch (err) {
            if (reject) reject(err);
            else throw err;
          }
        },
        catch(reject: (err: any) => void) {
          return chain.then((x) => x, reject);
        },
      };

      return chain;
    },

    async execute() {
      return [{ count: 1 }];
    },
  };
}
