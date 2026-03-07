const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
// Set timezone to America/New_York
dayjs.tz.setDefault("America/New_York");

console.log("Input:", "2026-03-13T04:00:00Z");
console.log("Local JS Date:", new Date("2026-03-13T04:00:00Z").toString());
console.log("Dayjs UTC format:", dayjs.utc("2026-03-13T04:00:00Z").format("ddd, MMM D"));
