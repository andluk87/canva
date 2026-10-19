import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
export default defineConfig({
 testDir:'./tests/e2e', timeout:90000, workers:1,
 use:{baseURL:process.env.TEST_BASE_URL||'http://127.0.0.1:8192',viewport:{width:1440,height:1000},launchOptions:{...(existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox']},screenshot:'only-on-failure',trace:'retain-on-failure'},
 reporter:'list'
});
