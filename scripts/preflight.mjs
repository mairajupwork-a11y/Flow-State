// Fails fast with a clear message instead of a blank page when the machine can't run Flowstate.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`\n  Flowstate needs Node.js 22.5 or newer — you have ${process.versions.node}.\n  Install the current LTS from https://nodejs.org, then run "npm install" and "npm run dev" again.\n`);
  process.exit(1);
}
try {
  await import('node:sqlite');
} catch {
  console.error('\n  This Node.js build has no built-in SQLite (node:sqlite). Install the official LTS from https://nodejs.org.\n');
  process.exit(1);
}
