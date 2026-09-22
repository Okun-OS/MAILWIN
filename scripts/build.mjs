import { cp, mkdir, readFile, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/src', { recursive: true });

const required = ['index.html', 'src/main.js', 'src/styles.css'];
await Promise.all(required.map((file) => readFile(file, 'utf8')));
await cp('index.html', 'dist/index.html');
await cp('src/main.js', 'dist/src/main.js');
await cp('src/styles.css', 'dist/src/styles.css');

console.log(`Built MAILWIN dashboard (${required.length} assets) into dist/.`);
