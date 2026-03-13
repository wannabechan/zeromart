/**
 * GET /api/cron/export-order-raw-log
 * Redis에 쌓인 주문 원시 로그(order_raw_log:YYYY-MM-DD)를 CSV로 flush 후 Vercel Blob에 비공개 저장.
 * 전날 날짜를 flush (당일은 아직 진행 중이므로). CRON_SECRET 필요.
 * Vercel Cron: 0 1 * * * (매일 01:00 UTC = 10:00 KST)
 * ※ Blob을 비공개로 쓰려면 Vercel 대시보드에서 Blob 스토어를 Private으로 생성해야 함.
 */

const { put } = require('@vercel/blob');
const { flushOrderRawLogToCsv } = require('../_orderRawLog');
const { toKSTDateKey } = require('../_kst');

function getYesterdayKSTDateKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toKSTDateKey(d);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).setHeader('Allow', 'GET, POST').end();
  }

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  if (!secret || token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const dateKey = getYesterdayKSTDateKey();
    const csv = await flushOrderRawLogToCsv(dateKey);
    const pathname = `rawlog/zeromartrawlog-${dateKey}.csv`;
    const blob = await put(pathname, csv, {
      access: 'private',
      contentType: 'text/csv; charset=utf-8',
    });
    return res.status(200).json({ ok: true, dateKey, pathname });
  } catch (e) {
    console.error('[export-order-raw-log]', e);
    return res.status(500).json({ error: e.message || 'Export failed' });
  }
};
