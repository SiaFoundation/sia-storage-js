#!/usr/bin/env node

// src/cli.ts
import { copyFileSync, mkdirSync } from "fs";
import { join } from "path";
var WORKER_FILE = "sia-storage-sw.js";
var dir = process.argv[2] ?? "public";
mkdirSync(dir, { recursive: true });
copyFileSync(
  new URL(`./${WORKER_FILE}`, import.meta.url),
  join(dir, WORKER_FILE)
);
console.log(`Copied ${WORKER_FILE} into ${dir}/`);
