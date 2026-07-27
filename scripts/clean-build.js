import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const releaseDir = path.join(process.cwd(), 'src-tauri', 'target', 'release');

console.log('🧹 Cleaning previous build artifacts...');

if (fs.existsSync(releaseDir)) {
  const oldExe = path.join(releaseDir, 'neia.exe');
  if (fs.existsSync(oldExe)) {
    try {
      fs.unlinkSync(oldExe);
      console.log('🗑️ Successfully deleted previous neia.exe');
    } catch (err) {
      console.warn('⚠️ Warning: Previous neia.exe might be running. Please close it if open.');
    }
  }
}

console.log('🏗️ Building fresh production release...');
execSync('npx tauri build --no-bundle', { stdio: 'inherit' });
