import { defineConfig,devices } from "@playwright/test";

export default defineConfig({
 testDir:"./tests/e2e",timeout:45_000,fullyParallel:false,retries:0,workers:1,
 globalSetup:"./tests/e2e/global-setup.mjs",
 reporter:[["list"],["html",{open:"never",outputFolder:"playwright-report"}]],
 use:{baseURL:"http://127.0.0.1:4173",channel:"chrome",trace:"retain-on-failure",screenshot:"only-on-failure"},
 projects:[{name:"desktop-chrome",use:{...devices["Desktop Chrome"]}}],
});
