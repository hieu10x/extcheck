// The engine lives in ../src (shared with the GitHub Action); vsce only packages this folder.
import { cpSync } from "node:fs";
cpSync(new URL("../src/", import.meta.url), new URL("./src/", import.meta.url), { recursive: true });
