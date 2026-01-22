/**
 * 文件：sqliteDb.js
 * 模块：server/frameworks/database/sqlite
 * 作用：sqlite3 连接封装（Promise API + 事务/PRAGMA）
 * 依赖：sqlite3
 * @created 2026-01-07
 * @modified 2026-01-07
 */

import fs from "node:fs/promises";
import path from "node:path";

import sqlite3 from "sqlite3";

function toDbErrorMessage(err) {
  const msg = String(err?.message || err || "未知数据库错误");
  return msg.length > 0 ? msg : "未知数据库错误";
}

function normalizeParams(params) {
  if (params === undefined) return [];
  return params;
}

function wrapRun(db) {
  return async (sql, params) => {
    const p = normalizeParams(params);
    return await new Promise((resolve, reject) => {
      db.run(sql, p, function onRun(err) {
        if (err) return reject(new Error(toDbErrorMessage(err)));
        return resolve({ lastID: this?.lastID ?? null, changes: this?.changes ?? 0 });
      });
    });
  };
}

function wrapGet(db) {
  return async (sql, params) => {
    const p = normalizeParams(params);
    return await new Promise((resolve, reject) => {
      db.get(sql, p, (err, row) => {
        if (err) return reject(new Error(toDbErrorMessage(err)));
        return resolve(row ?? null);
      });
    });
  };
}

function wrapAll(db) {
  return async (sql, params) => {
    const p = normalizeParams(params);
    return await new Promise((resolve, reject) => {
      db.all(sql, p, (err, rows) => {
        if (err) return reject(new Error(toDbErrorMessage(err)));
        return resolve(Array.isArray(rows) ? rows : []);
      });
    });
  };
}

function wrapExec(db) {
  return async (sql) => {
    return await new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) return reject(new Error(toDbErrorMessage(err)));
        return resolve();
      });
    });
  };
}

function makeSavepointName(depth) {
  return `sp_${String(depth).padStart(2, "0")}`;
}

function createTransaction(exec, getDepth, setDepth) {
  return async (fn) => {
    const depth = getDepth();
    const isOuter = depth === 0;
    const savepoint = makeSavepointName(depth + 1);

    setDepth(depth + 1);
    await exec(isOuter ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);

    try {
      const result = await fn();
      await exec(isOuter ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (err) {
      await exec(isOuter ? "ROLLBACK" : `ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
      if (!isOuter) await exec(`RELEASE SAVEPOINT ${savepoint}`).catch(() => undefined);
      throw err;
    } finally {
      setDepth(Math.max(0, getDepth() - 1));
    }
  };
}

async function applyPragmas(exec) {
  await exec("PRAGMA foreign_keys = ON;");
  await exec("PRAGMA journal_mode = WAL;");
  await exec("PRAGMA busy_timeout = 5000;");
}

/**
 * 中文注释：
 * openSqliteDb({ filename })
 * 作用：打开 sqlite3 数据库连接，并提供 Promise 化的 run/get/all/exec/transaction API
 * 约束：会自动创建上级目录；默认启用 foreign_keys/WAL/busy_timeout
 * 参数：
 *  - filename: string（数据库文件路径）
 * 返回：Promise<{ filename, run, get, all, exec, transaction, close }>
 */
export async function openSqliteDb({ filename }) {
  const file = String(filename || "").trim();
  if (!file) throw new Error("filename 不能为空。");

  await fs.mkdir(path.dirname(file), { recursive: true });

  const db = await new Promise((resolve, reject) => {
    const instance = new sqlite3.Database(file, (err) => {
      if (err) return reject(new Error(toDbErrorMessage(err)));
      return resolve(instance);
    });
  });

  const exec = wrapExec(db);
  await applyPragmas(exec);

  let txDepth = 0;
  const getDepth = () => txDepth;
  const setDepth = (v) => {
    txDepth = v;
  };

  return {
    filename: file,
    run: wrapRun(db),
    get: wrapGet(db),
    all: wrapAll(db),
    exec,
    transaction: createTransaction(exec, getDepth, setDepth),
    close: async () => {
      return await new Promise((resolve, reject) => {
        db.close((err) => {
          if (err) return reject(new Error(toDbErrorMessage(err)));
          return resolve();
        });
      });
    },
  };
}

