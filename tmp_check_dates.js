const d = new Date('2026-03-27T17:00:00Z'); // 10 PM PKT
console.log('Original UTC:', d.toISOString());
const localized = d.toLocaleString("en-US", {timeZone: "Asia/Karachi"});
console.log('Localized String:', localized);
const parsed = new Date(localized);
console.log('Parsed (Server Local):', parsed.toISOString());
