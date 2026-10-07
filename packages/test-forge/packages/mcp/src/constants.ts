import { join, resolve } from "node:path";

export const SERVER_NAME = "test-forge-mcp-server";

export const SERVER_VERSION = "1.0.0";

export const CHARACTER_LIMIT = 25000;

export const TESTING_ROOT = resolve(import.meta.dirname, "..", "..", "..");

export const DB_PATH = join(TESTING_ROOT, "data", "forge.db");

export const RESOURCES_PATH = join(TESTING_ROOT, "resources");

export const DOCTRINE_PATH = join(RESOURCES_PATH, "doctrine");
