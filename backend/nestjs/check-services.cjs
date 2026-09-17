/**
 * 服务连接体检脚本（独立运行，不启动 NestJS）
 *
 * 用法：
 *   node check-services.cjs          检查全部服务（邮件只验证授权，不发信）
 *   node check-services.cjs mail     额外给自己的 163 邮箱发一封真实测试邮件
 *
 * 检测项：环境变量完整性 / PostgreSQL(TCP+账号登录+查询) / Redis(TCP+密码+PING)
 *        / 163 SMTP(授权验证[+发信]) / Cloudflare R2(端点可达性)
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const https = require('https');
const { Client } = require('pg');
const Redis = require('ioredis');
const nodemailer = require('nodemailer');

// ---------- 解析 .env ----------
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ 未找到 .env 文件，请确认在 backend/nestjs 目录下运行');
  process.exit(1);
}
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const SEND_MAIL = process.argv.includes('mail');
const results = [];

// ---------- 输出工具 ----------
const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function record(name, ok, detail, hint) {
  results.push({ name, ok, detail, hint });
  console.log(`  ${ok ? c.green('✅') : c.red('❌')} ${c.bold(name)}  ${c.gray(detail)}`);
  if (!ok && hint) console.log(`      ${c.yellow('→ ' + hint)}`);
}

/** TCP 端口探测，返回 { ok, code } */
function tcpProbe(host, port, timeout = 8000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (ok, code) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, code });
    };
    socket.setTimeout(timeout);
    socket.on('connect', () => done(true, 'OPEN'));
    socket.on('timeout', () => done(false, 'ETIMEDOUT'));
    socket.on('error', (e) => done(false, e.code));
  });
}

/** 把网络错误码翻译成人话（outbound=true 表示本机主动访问外部服务，如 163/R2） */
function netHint(code, port, svc, outbound = false) {
  switch (code) {
    case 'ECONNREFUSED':
      return outbound
        ? `${port} 端口拒绝连接：对方服务未开启该端口，请核对端口号（163: 465/994）`
        : `${port} 端口拒绝连接：服务器在线，但 ${svc} 没启动、或只监听了 127.0.0.1（需改 listen_addresses/bind 为 0.0.0.0）、或被主机防火墙拦截`;
    case 'ETIMEDOUT':
      return outbound
        ? `连接超时：本机到外部服务的出网被阻断，检查本机网络/代理 VPN，或运营商/公司防火墙是否封禁了 ${port} 出站端口（可尝试切换网络或改用 587 端口）`
        : `连接超时：多为云服务器安全组未放行 ${port} 端口，或服务器防火墙丢弃了数据包`;
    case 'ENOTFOUND':
      return '主机地址无法解析，请检查 HOST 配置';
    case 'EHOSTUNREACH':
      return '主机不可达，请检查本机网络或服务器是否关机';
    default:
      return `网络错误 ${code}，请检查网络/防火墙配置`;
  }
}

// ========== 1. 环境变量完整性 ==========
async function checkEnv() {
  console.log(c.bold('\n[1/5] 环境变量配置（.env）'));
  const required = [
    'DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE',
    'REDIS_HOST', 'REDIS_PORT',
    'JWT_SECRET',
    'MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASS',
    'R2_ENDPOINT',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length === 0) {
    record('必填变量齐全', true, `共 ${required.length} 项`);
  } else {
    record('必填变量齐全', false, `缺失：${missing.join(', ')}`, '请在 .env 中补全上述变量');
  }

  const mailUser = process.env.MAIL_USER || '';
  const mailPass = process.env.MAIL_PASS || '';
  if (!mailUser || mailUser.includes('your_mailbox')) {
    record('163 邮箱账号', false, 'MAIL_USER 仍是占位符', '填入完整的 163 邮箱地址，如 xxx@163.com');
  } else if (!mailPass || mailPass.includes('your_smtp')) {
    record('163 邮箱授权码', false, 'MAIL_PASS 仍是占位符', '填入 163 邮箱后台生成的 16 位 SMTP 授权码（不是登录密码）');
  } else {
    record('163 邮箱配置', true, `${mailUser} / 授权码 ${mailPass.slice(0, 4)}****`);
  }

  if (process.env.DB_SYNC === 'true') {
    console.log(`      ${c.yellow('→ 提示：DB_SYNC=true 会自动改表结构，上生产前记得改为 false')}`);
  }
}

// ========== 2. PostgreSQL ==========
async function checkPostgres() {
  console.log(c.bold('\n[2/5] PostgreSQL 数据库'));
  const host = process.env.DB_HOST;
  const port = Number(process.env.DB_PORT || 5432);

  const tcp = await tcpProbe(host, port);
  if (!tcp.ok) {
    record(`TCP ${host}:${port}`, false, tcp.code, netHint(tcp.code, port, 'PostgreSQL'));
    record('账号登录 & 查询', false, '跳过（端口不通）');
    return;
  }
  record(`TCP ${host}:${port}`, true, '端口可连通');

  const client = new Client({
    host,
    port,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionTimeoutMillis: 8000,
  });
  try {
    await client.connect();
    const ver = (await client.query('SHOW server_version')).rows[0].server_version;
    const who = (await client.query('SELECT current_user, current_database()')).rows[0];
    await client.end();
    record('账号登录 & 查询', true, `PG ${ver} / 用户 ${who.current_user} / 库 ${who.current_database}`);
  } catch (e) {
    let hint;
    if (/password authentication failed/i.test(e.message)) {
      hint = '账号或密码错误：检查 DB_USERNAME / DB_PASSWORD，并确认服务端 pg_hba.conf 允许该用户远程 md5 登录';
    } else if (/does not exist/i.test(e.message)) {
      hint = `数据库或用户不存在：请在服务端手动 CREATE USER/CREATE DATABASE（库名：${process.env.DB_DATABASE}）`;
    } else if (/no pg_hba.conf entry/i.test(e.message)) {
      hint = 'pg_hba.conf 未放行你的 IP：添加 host agent agent 0.0.0.0/0 md5 后重启 PostgreSQL';
    } else {
      hint = e.message;
    }
    record('账号登录 & 查询', false, e.code || 'AUTH/QUERY FAILED', hint);
    await client.end().catch(() => {});
  }
}

// ========== 3. Redis ==========
async function checkRedis() {
  console.log(c.bold('\n[3/5] Redis 缓存'));
  const host = process.env.REDIS_HOST;
  const port = Number(process.env.REDIS_PORT || 6379);

  const tcp = await tcpProbe(host, port);
  if (!tcp.ok) {
    record(`TCP ${host}:${port}`, false, tcp.code, netHint(tcp.code, port, 'Redis'));
    record('密码验证 & PING', false, '跳过（端口不通）');
    return;
  }
  record(`TCP ${host}:${port}`, true, '端口可连通');

  const redis = new Redis({
    host,
    port,
    password: process.env.REDIS_PASSWORD || undefined,
    connectTimeout: 8000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // 只试一次，快速失败
  });
  try {
    const pong = await redis.ping();
    const info = await redis.info('server');
    const ver = (info.match(/redis_version:(.+)/) || [])[1]?.trim() || 'unknown';
    record('密码验证 & PING', true, `PING → ${pong} / Redis ${ver}`);
  } catch (e) {
    let hint;
    if (/WRONGPASS|invalid password|NOAUTH|AUTH/i.test(e.message)) {
      hint = 'Redis 密码错误或服务端未设置密码：检查 REDIS_PASSWORD 是否与 redis.conf 的 requirepass 一致';
    } else {
      hint = e.message;
    }
    record('密码验证 & PING', false, e.message.split('\n')[0], hint);
  } finally {
    redis.disconnect();
  }
}

// ========== 4. 163 SMTP ==========
async function checkMail() {
  console.log(c.bold('\n[4/5] 163 邮箱 SMTP'));
  const host = process.env.MAIL_HOST || 'smtp.163.com';
  const port = Number(process.env.MAIL_PORT || 465);
  const secure = process.env.MAIL_SECURE !== 'false';

  const tcp = await tcpProbe(host, port);
  if (!tcp.ok) {
    record(`TCP ${host}:${port}`, false, tcp.code, netHint(tcp.code, port, 'SMTP', true));
    record('SMTP 授权验证', false, '跳过');
    return;
  }
  record(`TCP ${host}:${port}`, true, secure ? 'SSL' : 'STARTTLS');

  const transporter = nodemailer.createTransport({
    host, port, secure,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    connectionTimeout: 10000,
  });
  try {
    await transporter.verify();
    record('SMTP 授权验证', true, '账号 + 授权码有效');
  } catch (e) {
    let hint;
    if (e.responseCode === 535 || /authentication failed/i.test(e.message)) {
      hint = '535 授权失败：去 163 邮箱后台确认已开启 SMTP 服务并重新生成授权码（MAIL_PASS 是授权码，不是登录密码）';
    } else {
      hint = `${e.code || ''} ${e.response || e.message}`;
    }
    record('SMTP 授权验证', false, e.responseCode || e.code || 'AUTH FAILED', hint);
    return;
  }

  if (SEND_MAIL) {
    try {
      const info = await transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME || 'Agent'}" <${process.env.MAIL_USER}>`,
        to: process.env.MAIL_USER,
        subject: '服务体检 - 测试邮件',
        html: '<h2>邮件链路正常</h2><p>这是 check-services.cjs 发出的测试邮件。</p>',
      });
      record('真实发信测试', true, `已发送至 ${process.env.MAIL_USER}（查收/垃圾箱）`, `messageId: ${info.messageId}`);
    } catch (e) {
      record('真实发信测试', false, e.responseCode || e.code, e.response || e.message);
    }
  } else {
    console.log(`      ${c.gray('（未发真实邮件；如需测试发信，运行：node check-services.cjs mail）')}`);
  }
}

// ========== 5. Cloudflare R2 ==========
function checkR2() {
  console.log(c.bold('\n[5/5] Cloudflare R2 对象存储'));
  return new Promise((resolve) => {
    const endpoint = process.env.R2_ENDPOINT;
    if (!endpoint) {
      record('R2 端点可达性', false, 'R2_ENDPOINT 未配置');
      return resolve();
    }
    let url;
    try { url = new URL(endpoint); } catch {
      record('R2 端点可达性', false, 'R2_ENDPOINT 不是合法 URL');
      return resolve();
    }
    const req = https.request(
      { hostname: url.hostname, path: '/', method: 'GET', timeout: 10000 },
      (res) => {
        // 未带签名访问根路径通常返回 403/400，能拿到 HTTP 响应即说明网络与端点正常
        res.resume();
        record('R2 端点可达性', true, `HTTP ${res.statusCode}（端点可达，403/400 属正常）`);
        resolve();
      },
    );
    req.on('timeout', () => { req.destroy(); record('R2 端点可达性', false, 'ETIMEDOUT', '连接超时，检查本机网络或 R2 端点地址'); resolve(); });
    req.on('error', (e) => record('R2 端点可达性', false, e.code, netHint(e.code, 443, 'R2', true)));
    req.end();
  });
}

// ========== 汇总 ==========
(async () => {
  console.log(c.bold('╔══════════════════════════════════════════╗'));
  console.log(c.bold('║   NestJS 项目 - 外部服务连接体检          ║'));
  console.log(c.bold('╚══════════════════════════════════════════╝'));
  const start = Date.now();

  await checkEnv();
  await checkPostgres();
  await checkRedis();
  await checkMail();
  await checkR2();

  const failed = results.filter((r) => !r.ok);
  console.log(c.bold('\n──────────────── 汇总 ────────────────'));
  if (failed.length === 0) {
    console.log(c.green(`✅ 全部 ${results.length} 项检查通过（耗时 ${Date.now() - start}ms），可以启动 npm run start:dev`));
  } else {
    console.log(c.red(`❌ ${results.length - failed.length}/${results.length} 通过，${failed.length} 项失败：`));
    for (const f of failed) {
      console.log(c.red(`   • ${f.name}：${f.detail || ''}`));
      if (f.hint) console.log(c.yellow(`     ${f.hint}`));
    }
  }
  process.exit(failed.length === 0 ? 0 : 1);
})();
