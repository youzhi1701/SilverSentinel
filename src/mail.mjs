import nodemailer from 'nodemailer';

export const isEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));

export function validateMailbox(config, { requireRecipients = true } = {}) {
  if (!config?.host || ![465, 587].includes(Number(config.port)) || !isEmail(config.user) || !config.password) throw Error('发件邮箱配置不完整');
  if (requireRecipients && (!Array.isArray(config.to) || !config.to.length || config.to.some(value => !isEmail(value)))) throw Error('请至少添加一位有效收件人');
  return true;
}

function createTransport(config) {
  validateMailbox(config, { requireRecipients: false });
  return nodemailer.createTransport({
    host: config.host, port: Number(config.port), secure: Number(config.port) === 465,
    requireTLS: Number(config.port) === 587, auth: { user: config.user, pass: config.password },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    tls: { minVersion: 'TLSv1.2', servername: config.host },
  });
}

export async function verifyMailbox(config) {
  const transport = createTransport(config);
  try { return await transport.verify(); } finally { transport.close(); }
}

export async function sendAlert(config, { subject, text }) {
  if (!config?.enabled) throw Error('邮件提醒未启用');
  validateMailbox(config);
  const transport = createTransport(config);
  const from = config.fromName ? `"${String(config.fromName).replace(/["\r\n]/g, '')}" <${config.user}>` : config.user;
  const results = [];
  try {
    for (const recipient of config.to) {
      try {
        const result = await transport.sendMail({ from, to: recipient, subject: String(subject || '').slice(0, 160), text: String(text || '').slice(0, 12000), disableFileAccess: true, disableUrlAccess: true });
        results.push({ recipient, success: true, messageId: result.messageId || '', response: result.response || '' });
      } catch (error) {
        results.push({ recipient, success: false, error: String(error?.message || error).slice(0, 300) });
      }
    }
  } finally { transport.close(); }
  if (results.some(item => !item.success)) {
    const error = new Error(results.every(item => !item.success) ? '所有收件人发送失败' : '部分收件人发送失败');
    error.results = results;
    throw error;
  }
  return results;
}
