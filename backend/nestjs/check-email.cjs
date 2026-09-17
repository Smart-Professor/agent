/**
 * SMTP 独立诊断脚本（不经过 NestJS / PG / Redis）
 * 运行：node test-smtp.cjs [收件邮箱]
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// 手动解析 .env
const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const to ='1172081019@qq.com'  // 默认发给自己 process.argv[2] || process.env.MAIL_USER;

console.log('SMTP 配置：');
console.log('  host   =', process.env.MAIL_HOST);
console.log('  port   =', process.env.MAIL_PORT);
console.log('  secure =', process.env.MAIL_SECURE);
console.log('  user   =', process.env.MAIL_USER);
console.log('  pass   =', process.env.MAIL_PASS ? `${process.env.MAIL_PASS.slice(0, 4)}****` : '(空)');
console.log('  收件人 =', to);
console.log('');

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT),
  secure: process.env.MAIL_SECURE === 'true',
  auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 15000,
});

(async () => {
  try {
    console.log('[1/2] 正在验证 SMTP 授权...');
    await transporter.verify();
    console.log('      ✅ 授权成功，连接正常');

    console.log('[2/2] 正在发送测试邮件...');
    const info = await transporter.sendMail({
      from: `"${process.env.MAIL_FROM_NAME || 'Agent'}" <${process.env.MAIL_USER}>`,
      to,
      subject: 'SMTP 测试邮件',
      html: '<h2>SMTP 配置正常</h2><p>如果你收到这封邮件，说明 163 邮箱发信链路完全正常。</p>',
    });
    console.log('      ✅ 发送成功，messageId =', info.messageId);
    console.log('      网易返回：', info.response);
    console.log('\n请登录收件箱查看（注意检查垃圾邮件/订阅邮件文件夹）');
  } catch (e) {
    console.log('\n      ❌ 失败');
    console.log('错误代码：', e.code);
    console.log('错误命令：', e.command);
    console.log('SMTP 响应：', e.response);
    console.log('完整信息：', e.message);
  }
})();
