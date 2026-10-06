/**
 * 独立的开发数据库：本机起一个只认 dev 端点的状态服务 + 一个连它的 Vite，跟 NAS 完全隔开。
 *
 *   node scripts/dev-with-local-db.mjs                  → http://localhost:3100（数据在 .dev-data/）
 *   node scripts/dev-with-local-db.mjs --reset          → 先用种子重置数据
 *   FITLOG_DEVDB_SEED=<快照.json> node scripts/...       → 指定种子（默认 ../fitlog-backups 里最新的 prod-snapshot-*.json）
 *
 * 为什么不直接用 NAS 的 state-dev：.env.local 没配 VITE_API_KEY_DEV，dev 会回落到 prod key，
 * 服务端按端点绑 key → 403（交接文档 §0 记过）。而且测试会大量写，跟生产在同一台机器上也不该。
 *
 * 守卫（任一不满足即 403，模仿 NAS 服务端的隔离规则）：
 *   - 只有 /api/fitlog/state-dev，prod 路径一律拒绝
 *   - Authorization 必须是本地 dev key；X-Fitlog-Env 必须是 dev；PUT 的快照 env 必须是 dev
 * 种子是生产快照的拷贝：读进来时 env 改成 dev（客户端会拒绝 env 不符的快照）。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, '.dev-data');
const DATA_FILE = path.join(DATA_DIR, 'state-dev.json');
const API_PORT = Number(process.env.FITLOG_DEVDB_PORT || 8787);
const WEB_PORT = Number(process.env.FITLOG_DEVDB_WEB_PORT || 3100);
const DEV_KEY = 'local-dev-key';

function defaultSeed() {
  const dir = path.resolve(ROOT, '..', 'fitlog-backups');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => /^prod-snapshot-.*\.json$/.test(f)).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const seed = process.env.FITLOG_DEVDB_SEED || defaultSeed();
if (process.argv.includes('--reset') || !fs.existsSync(DATA_FILE)) {
  if (seed && fs.existsSync(seed)) {
    const snap = JSON.parse(fs.readFileSync(seed, 'utf-8'));
    snap.env = 'dev';
    fs.writeFileSync(DATA_FILE, JSON.stringify(snap));
    console.log(`[devdb] 用种子初始化：${path.basename(seed)}（${(snap.workouts || []).length} 场训练）`);
  } else if (fs.existsSync(DATA_FILE)) {
    fs.unlinkSync(DATA_FILE);
    console.log('[devdb] 没有种子，从空库开始');
  }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Fitlog-Env',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
};
const deny = (res, msg) => {
  res.writeHead(403, { ...cors, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
};

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/api/fitlog/state-dev') return deny(res, 'local devdb only serves /api/fitlog/state-dev');
    if (req.headers.authorization !== `Bearer ${DEV_KEY}`) return deny(res, 'bad key');
    if (req.headers['x-fitlog-env'] !== 'dev') return deny(res, 'env must be dev');
    if (req.method === 'GET') {
      if (!fs.existsSync(DATA_FILE)) {
        res.writeHead(404, cors);
        return res.end();
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      return res.end(fs.readFileSync(DATA_FILE));
    }
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try {
          const snap = JSON.parse(body);
          if (snap.env !== 'dev') return deny(res, 'snapshot env must be dev');
          fs.writeFileSync(DATA_FILE, JSON.stringify(snap));
          res.writeHead(200, cors);
          res.end('ok');
        } catch {
          res.writeHead(400, cors);
          res.end('bad json');
        }
      });
      return;
    }
    res.writeHead(405, cors);
    res.end();
  })
  .listen(API_PORT, () => console.log(`[devdb] 状态服务 http://localhost:${API_PORT}/api/fitlog/state-dev`));

const vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  // Vite 里已经存在的进程环境变量优先于 .env 文件：接口指到本机、dev key 用本地那把
  env: { ...process.env, VITE_API_URL: `http://localhost:${API_PORT}`, VITE_API_KEY_DEV: DEV_KEY, VITE_FITLOG_DEV_MODE: 'true' },
});
const stop = () => {
  vite.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', code => process.exit(code ?? 0));
