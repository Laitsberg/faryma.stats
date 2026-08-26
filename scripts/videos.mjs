#!/usr/bin/env node
/* ============================================================
   РОЛИКИ С КАНАЛА
   ------------------------------------------------------------
   Композитор выпускает разборы целых тайтлов: «опенинги БЛИЧ»,
   «темы городов из ГЕРОЕВ 5», «весь саундтрек Silksong». На сайте
   такой тайтл уже есть — логично дать на разбор ссылку.

   Список роликов забирает yt-dlp: ключей не нужно, отдаёт весь канал,
   а не последние пятнадцать, как RSS. Дальше остаётся сопоставить
   название ролика с названием вселенной.

     node scripts/videos.mjs --list   только собрать список
     node scripts/videos.mjs          собрать и сопоставить
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = path.join(ROOT, 'data', 'videos.json');

const КАНАЛЫ = [
  'https://www.youtube.com/@faryma.composer/videos',
  'https://www.youtube.com/@farymaLIVE/videos'
];

function собрать() {
  const все = [];
  for (const url of КАНАЛЫ) {
    console.log('спрашиваю ' + url);
    let out = '';
    try {
      out = execFileSync('yt-dlp', [
        '--flat-playlist', '--skip-download', '--ignore-errors',
        '--print', '%(id)s\t%(title)s\t%(duration)s\t%(view_count)s',
        url
      ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      console.error('  не вышло: ' + (e.message || '').split('\n')[0]);
      if (e.stdout) out = e.stdout;
    }
    const строки = out.split('\n').map(s => s.trim()).filter(Boolean);
    строки.forEach(s => {
      const [id, title, dur, views] = s.split('\t');
      if (id && title) все.push({ id, title, sec: +dur || null, views: +views || null });
    });
    console.log('  роликов: ' + строки.length);
  }
  return все;
}

const видео = собрать();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  note: 'ролики с каналов композитора; собирает scripts/videos.mjs',
  videos: видео
}, null, 1) + '\n');
console.log('\nвсего роликов: ' + видео.length + ' → ' + path.relative(ROOT, OUT));
видео.slice(0, 15).forEach(v => console.log('  ' + v.title));
