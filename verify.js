const fs = require("fs");
const path = require("path");

console.log("Verifying iHome adapter structure...");

// Check required files
const requiredFiles = [
  "package.json",
  "io-package.json",
  "main.js",
  "README.md",
  "LICENSE",
  "svelte.config.js",
  "vite.config.js",
  "tsconfig.json",
  "eslint.config.mjs",
];

const requiredDirs = ["src", "src/routes", "src/routes/devices"];

let allGood = true;

// Check files
requiredFiles.forEach((file) => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`✓ ${file} exists`);
  } else {
    console.log(`✗ ${file} is missing`);
    allGood = false;
  }
});

// Check directories
requiredDirs.forEach((dir) => {
  const dirPath = path.join(__dirname, dir);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    console.log(`✓ ${dir}/ exists`);
  } else {
    console.log(`✗ ${dir}/ is missing or not a directory`);
    allGood = false;
  }
});

// Check key Svelte files
const keySvelteFiles = [
  "src/routes/+layout.svelte",
  "src/routes/+page.svelte",
  "src/routes/devices/+page.svelte",
  "src/app.css",
];

keySvelteFiles.forEach((file) => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`✓ ${file} exists`);
  } else {
    console.log(`✗ ${file} is missing`);
    allGood = false;
  }
});

if (allGood) {
  console.log("\n✅ All required files and directories are present!");
  console.log("\nNext steps:");
  console.log('1. Run "npm install" to install dependencies');
  console.log('2. Run "npm run dev" to start development server');
  console.log('3. Run "npm run build" to build for production');
} else {
  console.log("\n❌ Some files or directories are missing!");
  process.exit(1);
}
